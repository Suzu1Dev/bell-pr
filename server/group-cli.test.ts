/**
 * `bell-pr group status`, `group setup` and `group invite`, against a
 * BELL PR running in this process. Synthetic tokens only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CollabJoinResponse } from "../shared/collab.js";
import { main } from "./cli.js";
import { resolveConfig } from "./config.js";
import { withLocale } from "./i18n/index.js";
import { startServer, type RunningServer } from "./index.js";

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function cli(argv: string[], locale: "en" | "zh-TW" = "en") {
  let stdout = "";
  let stderr = "";
  const code = await withLocale(locale, () =>
    main(argv, {
      env: { BELLPR_NO_OPEN: "1" },
      stdout: { write: (chunk: string) => (stdout += chunk) },
      stderr: { write: (chunk: string) => (stderr += chunk) },
      openUrl: () => {},
    }),
  );
  return { code, stdout, stderr };
}

/** A data directory, and how to start BELL PR on it with or without group work. */
async function withDataDir(
  fn: (dataDir: string, start: (group: boolean) => Promise<RunningServer>) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-group-cli-"));
  const ui = path.join(directory, "ui");
  mkdirSync(ui);
  writeFileSync(path.join(ui, "index.html"), "<!doctype html>");
  const dataDir = path.join(directory, "data");
  let server: RunningServer | undefined;
  try {
    await fn(dataDir, async (group) => {
      await server?.shutdown();
      server = await startServer({
        config: resolveConfig({ port: await freePort(), dataDir, group }, { BELLPR_STATIC_DIR: ui }),
        handleExit: false,
        print: () => {},
      });
      return server;
    });
  } finally {
    await server?.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
}

/** The invited person, at the host, joining with the printed code. */
function join(server: RunningServer, dataDir: string, code: string) {
  const url = new URL(server.url);
  const body = JSON.stringify({ code });
  return new Promise<{ status: number; json: CollabJoinResponse }>((resolve, reject) => {
    const req = request(
      {
        host: url.hostname,
        port: url.port,
        path: "/api/collab/join",
        method: "POST",
        headers: {
          authorization: `Bearer ${readFileSync(path.join(dataDir, "api-token"), "utf8").trim()}`,
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode!, json: JSON.parse(data) }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

const printedCode = (stdout: string) => /: ([0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4})$/m.exec(stdout)?.[1];

test("bell-pr group sets group work up once and invites people with a one-time code, never a token", async () => {
  await withDataDir(async (dataDir, start) => {
    const server = await start(true);
    const installToken = readFileSync(path.join(dataDir, "api-token"), "utf8").trim();
    const at = ["--data-dir", dataDir];

    const before = await cli(["group", "status", ...at]);
    assert.equal(before.code, 0, before.stderr);
    assert.equal(before.stdout, "Group work is not set up yet. Run `bell-pr group setup`.\n");
    const early = await cli(["group", "invite", "Ada", ...at]);
    assert.equal(early.code, 1);
    assert.equal(early.stdout, "");
    assert.equal(early.stderr, "Group work is not set up yet. Run `bell-pr group setup`.\n");

    const setup = await cli(["group", "setup", ...at]);
    assert.equal(setup.code, 0, setup.stderr);
    assert.equal(
      setup.stdout,
      "Group work is set up. Invite the first admin with `bell-pr group invite <name> --admin`.\n",
    );
    const again = await cli(["group", "setup", ...at]);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, "Group work is already set up.\n");
    assert.equal((await cli(["group", "status", ...at])).stdout, "Group work is set up and ready.\n");

    const admin = await cli(["group", "invite", "Ada", "--admin", ...at]);
    assert.equal(admin.code, 0, admin.stderr);
    assert.match(admin.stdout, /^Invite code for Ada \(admin\): /);
    assert.match(admin.stdout, /\nThe code works once and expires at .+ \(in 10 minutes\)\. Restarting BELL PR voids it\.\n$/);
    const ada = await join(server, dataDir, printedCode(admin.stdout)!);
    assert.equal(ada.status, 201);
    assert.equal(ada.json.name, "Ada");
    assert.equal(ada.json.admin, true);
    // Single use.
    assert.equal((await join(server, dataDir, printedCode(admin.stdout)!)).status, 400);

    const member = await cli(["group", "invite", "Grace Hopper", ...at]);
    assert.equal(member.code, 0, member.stderr);
    assert.match(member.stdout, /^Invite code for Grace Hopper: /);
    const grace = await join(server, dataDir, printedCode(member.stdout)!);
    assert.equal(grace.status, 201);
    assert.equal(grace.json.admin, undefined);

    const zh = await cli(["group", "invite", "小美", "--admin", ...at], "zh-TW");
    assert.equal(zh.code, 0, zh.stderr);
    assert.match(zh.stdout, /^給 小美（管理員）的邀請碼：/);
    assert.match(zh.stdout, /（10 分鐘後）。重新啟動 BELL PR 會讓它作廢。\n$/);

    for (const result of [before, early, setup, again, admin, member, zh]) {
      const text = `${result.stdout}${result.stderr}`;
      assert.equal(text.includes(installToken), false);
      assert.doesNotMatch(text, /bpc_|bell_token/);
    }
  });
});

test("bell-pr group says when BELL PR is not running, runs without group work, or group work has stopped", async () => {
  await withDataDir(async (dataDir, start) => {
    const at = ["--data-dir", dataDir];
    for (const argv of [["group", "status"], ["group", "setup"], ["group", "invite", "Ada"]]) {
      const result = await cli([...argv, ...at]);
      assert.equal(result.code, 1, argv.join(" "));
      assert.match(result.stderr, /No BELL PR is running with the data directory/);
    }

    const solo = await start(false);
    for (const argv of [["group", "status"], ["group", "setup"], ["group", "invite", "Ada"]]) {
      const result = await cli([...argv, ...at]);
      assert.equal(result.code, 1, argv.join(" "));
      assert.equal(result.stdout, "");
      assert.equal(
        result.stderr,
        `BELL PR is already running at ${solo.url} without group work. Stop it first, then start it with \`bell-pr start --group\`.\n`,
      );
    }

    await start(true);
    assert.equal((await cli(["group", "setup", ...at])).code, 0);
    // The file that names the group's people is gone: stopped, and nothing is made again.
    await rm(path.join(dataDir, "collab.json"));
    await start(true);
    for (const argv of [["group", "status"], ["group", "setup"], ["group", "invite", "Ada"]]) {
      const result = await cli([...argv, ...at]);
      assert.equal(result.code, 1, argv.join(" "));
      assert.equal(result.stdout, "");
      assert.equal(
        result.stderr,
        "Group work has stopped (reason: sideMissing). docs/troubleshooting.md explains each reason. Fix the cause, then restart BELL PR.\n",
      );
    }
    const zh = await cli(["group", "status", ...at], "zh-TW");
    assert.equal(zh.code, 1);
    assert.match(zh.stderr, /^小組協作已停止（原因：sideMissing）。/);
  });
});

test("bell-pr group mistakes exit 2 with the usage", async () => {
  const usage =
    "Run `bell-pr group status`, `bell-pr group setup` or `bell-pr group invite <name> [--admin]`.\n";
  for (const argv of [
    ["group"],
    ["group", "list"],
    ["group", "invite"],
    ["group", "invite", "--admin"],
    ["group", "status", "--admin"],
  ]) {
    const result = await cli(argv);
    assert.equal(result.code, 2, argv.join(" "));
    assert.equal(result.stderr, usage);
  }
  const extra = await cli(["group", "invite", "Ada", "Lovelace"]);
  assert.equal(extra.code, 2);
  assert.match(extra.stderr, /Unexpected argument "Lovelace"/);
});
