/**
 * `bell-pr pair`, `bell-pr devices` and the device side of `token rotate`,
 * against a BELL PR running in this process. Synthetic tokens only.
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
import { main, type CliDeps } from "./cli.js";
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

function output() {
  let text = "";
  return { stream: { write: (chunk: string) => (text += chunk), isTTY: false }, text: () => text };
}

async function cli(argv: string[], deps: CliDeps = {}) {
  const stdout = output();
  const stderr = output();
  const qr: string[] = [];
  const code = await withLocale("en", () =>
    main(argv, {
      env: { BELLPR_NO_OPEN: "1" },
      stdout: stdout.stream,
      stderr: stderr.stream,
      openUrl: () => {},
      printPairQr: (url) => qr.push(url),
      ...deps,
    }),
  );
  return { code, stdout: stdout.text(), stderr: stderr.text(), qr };
}

async function withServer(fn: (dataDir: string, server: RunningServer) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-pair-cli-"));
  const ui = path.join(directory, "ui");
  mkdirSync(ui);
  writeFileSync(path.join(ui, "index.html"), "<!doctype html>");
  const dataDir = path.join(directory, "data");
  const server = await startServer({
    config: resolveConfig({ port: await freePort(), dataDir }, { BELLPR_STATIC_DIR: ui }),
    handleExit: false,
    print: () => {},
  });
  try {
    await fn(dataDir, server);
  } finally {
    await server.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
}

/** A phone redeeming the printed code. */
function redeem(server: RunningServer, code: string, name: string) {
  const url = new URL(server.url);
  const body = JSON.stringify({ code, name });
  return new Promise<{ status: number; json: { deviceId: string; token: string } }>((resolve, reject) => {
    const req = request(
      {
        host: url.hostname,
        port: url.port,
        path: "/api/pair",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) },
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

const printedCode = (stdout: string) => /pairing code: ([0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4})/.exec(stdout)?.[1];

test("bell-pr pair prints the address and the code, never a token, and hands the QR the code link", async () => {
  await withServer(async (dataDir, server) => {
    const installToken = readFileSync(path.join(dataDir, "api-token"), "utf8").trim();
    const result = await cli(["pair", "--data-dir", dataDir, "--name", "Phone"]);
    assert.equal(result.code, 0, result.stderr);
    const code = printedCode(result.stdout);
    assert.ok(code, result.stdout);
    assert.match(result.stdout, new RegExp(`open ${server.url}/pair\\n`));
    assert.equal(result.stdout.includes(installToken), false);
    assert.doesNotMatch(result.stdout, /bpd_|bell_token/);
    assert.deepEqual(result.qr, [`${server.url}/pair#code=${code}`]);

    const noQr = await cli(["pair", "--data-dir", dataDir, "--no-qr"]);
    assert.equal(noQr.code, 0, noQr.stderr);
    assert.deepEqual(noQr.qr, []);
    // The newer code replaced the first.
    assert.equal((await redeem(server, code!, "Phone")).status, 401);
    assert.equal((await redeem(server, printedCode(noQr.stdout)!, "Phone")).status, 201);
  });
});

test("bell-pr devices lists and revokes; bell-pr token rotate signs every device out", async () => {
  await withServer(async (dataDir, server) => {
    assert.equal((await cli(["devices", "list", "--data-dir", dataDir])).stdout, "No paired devices.\n");
    const first = printedCode((await cli(["pair", "--data-dir", dataDir])).stdout)!;
    const phone = (await redeem(server, first, "Phone")).json;
    const second = printedCode((await cli(["pair", "--data-dir", dataDir])).stdout)!;
    const laptop = (await redeem(server, second, "Laptop")).json;

    const listed = await cli(["devices", "list", "--data-dir", dataDir]);
    assert.equal(listed.code, 0, listed.stderr);
    const lines = listed.stdout.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], new RegExp(`^${phone.deviceId}  Phone  paired .+  last used never$`));
    assert.doesNotMatch(listed.stdout, /bpd_|hash/i);

    const revoked = await cli(["devices", "revoke", phone.deviceId, "--data-dir", dataDir]);
    assert.equal(revoked.code, 0, revoked.stderr);
    assert.equal(revoked.stdout, `Revoked ${phone.deviceId}. Its token no longer works.\n`);
    const missing = await cli(["devices", "revoke", phone.deviceId, "--data-dir", dataDir]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /No paired device has the id/);

    const rotated = await cli(["token", "rotate", "--data-dir", dataDir]);
    assert.equal(rotated.code, 0, rotated.stderr);
    assert.match(rotated.stdout, /Paired devices are signed out/);
    const devices = JSON.parse(readFileSync(path.join(dataDir, "devices.json"), "utf8"));
    assert.deepEqual(devices, { devices: [] });
    assert.equal(rotated.stdout.includes(laptop.token), false);
  });
});

test("bell-pr pair reports a lock with its end and the unlock hint; --unlock clears it", async () => {
  await withServer(async (dataDir, server) => {
    const code = printedCode((await cli(["pair", "--data-dir", dataDir])).stdout)!;
    const wrong = code.startsWith("0") ? "1111-1111" : "0000-0000";
    for (let i = 0; i < 10; i++) await redeem(server, wrong, "x").catch(() => undefined);
    const locked = await cli(["pair", "--data-dir", dataDir]);
    assert.equal(locked.code, 1);
    assert.equal(locked.stdout, "");
    assert.deepEqual(locked.qr, []);
    assert.match(locked.stderr, /Pairing is locked until .+ after too many wrong codes\.\n.*bell-pr pair --unlock/);

    writeFileSync(path.join(dataDir, "pair-lock.json"), "garbage");
    const damaged = await cli(["pair", "--data-dir", dataDir]);
    assert.equal(damaged.code, 1);
    assert.match(damaged.stderr, /missing or damaged.*\n.*bell-pr pair --unlock/);

    const unlocked = await cli(["pair", "--unlock", "--data-dir", dataDir]);
    assert.equal(unlocked.code, 0, unlocked.stderr);
    assert.equal(unlocked.stdout, "Pairing is unlocked and its failure count is cleared.\n");
    assert.equal((await cli(["pair", "--data-dir", dataDir])).code, 0);
  });
});

test("pair and devices without a running server, and devices usage", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-pair-cli-"));
  try {
    for (const argv of [["pair"], ["pair", "--unlock"], ["devices", "list"], ["devices", "revoke", "dev_x"]]) {
      const result = await cli([...argv, "--data-dir", directory]);
      assert.equal(result.code, 1, argv.join(" "));
      assert.match(result.stderr, /No BELL PR is running/);
    }
    for (const argv of [["devices"], ["devices", "revoke"], ["devices", "remove", "x"]]) {
      const result = await cli(argv);
      assert.equal(result.code, 2);
      assert.match(result.stderr, /bell-pr devices list/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
