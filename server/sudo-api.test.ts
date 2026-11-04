import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createApp, type AppOptions } from "./app.js";
import { dataPaths } from "./config.js";
import { DeviceTokens } from "./device-tokens.js";
import { loopbackAddress } from "./routes/sudo.js";
import { PasswordlessSudo, type SudoRunner } from "./sudo.js";
import { SudoAudit, type SudoAuditEntry } from "./sudo-audit.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";

const correct = "test-only-password";
const installToken = "a".repeat(64);
const ok = { stdout: "", stderr: "", code: 0 };
const wrongPassword = { stdout: "", stderr: "sudo: Authentication failed, try again.\n", code: 1 };
const local = "127.0.0.1:4311";
const methods = ["GET", "POST", "DELETE"] as const;
/** An invented Tailscale host name, joined so the personal-info check does not take it for a real one. */
const tailnetHost = ["bell-box", "tail0000", "ts", "net"].join(".");

interface ApiResult {
  status: number;
  text: string;
  body: unknown;
}

interface RigOptions {
  /** Writes the install token file; true by default. */
  token?: boolean;
  /** The client address the app sees instead of the real loopback one. */
  remoteAddress?: string;
  app?: AppOptions;
}

/** A BELL server on a temp data directory with a fake sudo; nothing runs as root and /etc is never touched. */
async function rig(t: TestContext, options: RigOptions = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-sudo-api-test-"));
  const store = new Store(directory);
  await store.initialize();
  const workbench = new Workbench(store);
  if (options.token !== false) await writeFile(path.join(directory, "api-token"), `${installToken}\n`);
  const state = { passwordless: false, privileged: 0 };
  const run: SudoRunner = async (executable, args, runOptions = {}) => {
    if (executable === "visudo") return ok;
    if (args[0] === "-k" && args[1] === "-n" && args[2] === "true")
      return { ...ok, code: state.passwordless ? 0 : 1 };
    if (args[0] === "-k" && args[1] === "-n") {
      await rm(args[args.length - 1], { force: true });
      state.passwordless = false;
      return ok;
    }
    if (runOptions.input !== `${correct}\n`) return wrongPassword;
    state.privileged += 1;
    const command = args.slice(args.indexOf("--") + 1);
    if (command[0] === "install") await writeFile(command[command.length - 1], await readFile(command[command.length - 2]));
    if (command[0] === "mv") {
      await writeFile(command[command.length - 1], await readFile(command[command.length - 2]));
      await rm(command[command.length - 2]);
      state.passwordless = true;
    }
    if (command[0] === "rm") await rm(command[command.length - 1], { force: true });
    return ok;
  };
  const auditFile = dataPaths(directory).sudoAudit;
  const app = createApp(workbench, {
    staticDirectory: path.join(directory, "missing"),
    platform: "linux",
    apiTokenFile: path.join(directory, "api-token"),
    sudo: new PasswordlessSudo({
      run,
      user: "bellsvc",
      group: "1000",
      file: path.join(directory, "bell-pr-agent"),
      audit: new SudoAudit(auditFile),
    }),
    ...options.app,
  });
  const server = createServer((req, res) => {
    if (options.remoteAddress)
      Object.defineProperty(req.socket, "remoteAddress", { value: options.remoteAddress, configurable: true });
    app(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const api = (method: string, body?: unknown, headers: Record<string, string> = {}, route = "/api/system/sudo") =>
    new Promise<ApiResult>((resolve, reject) => {
      // Node omits Content-Length for DELETE when the body is written with end(); fetch sets it, so the helper does too.
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const all: Record<string, string | number> = {
        "Content-Type": "application/json",
        "X-Bell-Locale": "en",
        ...(payload === undefined ? {} : { "Content-Length": Buffer.byteLength(payload) }),
        Host: local,
        Authorization: `Bearer ${installToken}`,
        ...headers,
      };
      // An empty value leaves the header out.
      for (const [name, value] of Object.entries(all)) if (value === "") delete all[name];
      const req = request(
        `http://127.0.0.1:${address.port}${route}`,
        {
          method,
          headers: all,
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { text += chunk; });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text, body: text ? JSON.parse(text) : undefined }));
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
  /** The same request for each method, with the body each one sends. */
  const each = (headers: Record<string, string>) =>
    Promise.all(
      methods.map(async (method) => [
        method,
        (await api(method, method === "POST" ? { password: correct } : method === "DELETE" ? {} : undefined, headers)).status,
      ]),
    );
  const audit = async (): Promise<SudoAuditEntry[]> => {
    const text = await readFile(auditFile, "utf8").catch(() => "");
    return text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line) as SudoAuditEntry) : [];
  };
  /** Every file under the data directory, logs and the audit included. */
  const everyFile = async () => {
    const texts: string[] = [];
    for (const name of await readdir(directory, { recursive: true }))
      texts.push(await readFile(path.join(directory, name), "utf8").catch(() => ""));
    return texts.join("\n");
  };
  return { api, each, audit, everyFile, state, directory };
}

/** Each method is refused with 403, nothing runs as root, and the audit says why. */
async function assertDenied(
  t: TestContext,
  options: RigOptions,
  headers: Record<string, string>,
  reason: string,
) {
  const { each, audit, state } = await rig(t, options);
  assert.deepEqual(await each(headers), methods.map((method) => [method, 403]));
  assert.equal(state.privileged, 0);
  assert.equal(state.passwordless, false);
  const entries = await audit();
  assert.equal(entries.length, 3);
  for (const entry of entries) {
    assert.equal(entry.event, "denied");
    assert.equal(entry.ok, false);
    assert.equal(entry.reason, reason);
  }
}

test("sudo API reports status, enables once with the password, removes the rule, and refuses cross-site, malformed, and locked requests", async (t) => {
  const { api, state } = await rig(t);

  const status = await api("GET");
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, { sudo: { user: "bellsvc", available: true, installed: false, passwordless: false } });
  // Cross-site and malformed requests never reach sudo.
  assert.equal((await api("GET", undefined, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await api("POST", { password: correct }, { Origin: "https://evil.example" })).status, 403);
  for (const body of [{}, { password: "" }, { password: 123 }, { password: correct, extra: true }]) {
    assert.equal((await api("POST", body)).status, 400);
  }
  assert.equal(state.passwordless, false);

  // A wrong password is refused without echoing it; the right one enables sudo.
  const wrong = await api("POST", { password: "not-the-password" });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.text.includes("not-the-password"), false);
  const enabled = await api("POST", { password: correct });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.text.includes(correct), false);
  const sudo = (enabled.body as { sudo: Record<string, unknown> }).sudo;
  assert.deepEqual({ ...sudo, expiresAt: undefined }, { user: "bellsvc", available: true, installed: true, passwordless: true, expiresAt: undefined });

  // The client's send() always sends a JSON body, so DELETE is sent with {} the same way.
  const removed = await api("DELETE", {});
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { sudo: { user: "bellsvc", available: true, installed: false, passwordless: false } });

  // Three wrong passwords lock setup; the right password is refused until the lock expires.
  for (let attempt = 1; attempt <= 2; attempt++)
    assert.equal((await api("POST", { password: "wrong" })).status, 401);
  const locked = await api("POST", { password: "wrong" });
  assert.equal(locked.status, 429);
  assert.match(locked.text, /Try again in 15 minutes/);
  assert.equal((await api("POST", { password: correct })).status, 429);
  assert.equal(state.passwordless, false);
});

test("the install token from this computer may use every method at localhost, 127.0.0.1 and [::1]", async (t) => {
  const { api, audit } = await rig(t);
  for (const host of ["localhost:4311", "127.0.0.1:4311", "[::1]:4311"])
    assert.equal((await api("GET", undefined, { Host: host })).status, 200, host);
  assert.equal((await api("POST", { password: correct }, { Host: "localhost:4311" })).status, 200);
  assert.equal((await api("DELETE", {}, { Host: "localhost:4311" })).status, 200);
  // A sub-path passes the same check and then finds no route.
  assert.equal((await api("GET", undefined, {}, "/api/system/sudo/other")).status, 404);
  assert.deepEqual(
    (await audit()).map((entry) => [entry.event, entry.ok, entry.tokenType, entry.host]),
    [
      ["enable", true, "host", "localhost:4311"],
      ["disable", true, "host", "localhost:4311"],
    ],
  );
});

test("a paired device token is refused for every method and sub-path, even from this computer", async (t) => {
  const { each, api, audit, state, directory } = await rig(t);
  const device = await new DeviceTokens(directory).add("phone", installToken);
  const headers = { Authorization: `Bearer ${device.token}` };
  // The device token is accepted by the API in general.
  assert.equal((await api("GET", undefined, headers, "/api/status")).status, 200);
  assert.deepEqual(await each(headers), methods.map((method) => [method, 403]));
  assert.equal((await api("GET", undefined, headers, "/api/system/sudo/other")).status, 403);
  assert.equal((await api("GET", undefined, { "X-Bell-Token": device.token, Authorization: "" }, "/api/system/sudo")).status, 403);
  assert.equal(state.privileged, 0);
  assert.ok((await audit()).every((entry) => entry.reason === "device_token" && entry.tokenType === "device"));
});

test("a request without a token is refused for every method", async (t) => {
  const { each } = await rig(t);
  // The API guard refuses it before the sudo route sees it.
  assert.deepEqual(await each({ Authorization: "" }), methods.map((method) => [method, 401]));
});

test("without an install token, no request may use the sudo helper", async (t) => {
  await assertDenied(t, { token: false, app: { apiTokenFile: undefined } }, { Authorization: "" }, "no_host_token");
});

test("the install token is refused from an address that is not this computer", async (t) => {
  await assertDenied(t, { remoteAddress: "192.0.2.10" }, {}, "remote_address");
});

test("the install token is refused at a Tailscale host name", async (t) => {
  await assertDenied(
    t,
    { app: { allowedOrigins: `https://${tailnetHost}` } },
    { Host: tailnetHost },
    "tailnet_host",
  );
});

test("the install token is refused at the BELLPR_PUBLIC_URL host", async (t) => {
  await assertDenied(t, { app: { publicUrl: "https://bell.example.com" } }, { Host: "bell.example.com" }, "public_host");
});

for (const [header, value] of [
  ["X-Forwarded-For", "127.0.0.1"],
  ["Forwarded", "for=127.0.0.1"],
  ["X-Forwarded-Host", "localhost:4311"],
  ["X-Forwarded-Proto", "http"],
  ["X-Real-IP", "127.0.0.1"],
]) {
  test(`the install token is refused when the request carries ${header}`, async (t) => {
    await assertDenied(t, {}, { [header]: value }, "forwarded");
  });
}

test("loopback means 127.0.0.0/8 and ::1, also IPv4-mapped", async (t) => {
  for (const address of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1", "::FFFF:127.0.0.2"])
    assert.equal(loopbackAddress(address), true, address);
  for (const address of [undefined, "", "192.0.2.10", "::ffff:192.0.2.10", "fe80::1", "128.0.0.1", "::"])
    assert.equal(loopbackAddress(address), false, String(address));
  const mapped = await rig(t, { remoteAddress: "::ffff:127.0.0.1" });
  assert.equal((await mapped.api("GET")).status, 200);
});

test("enable takes ttlSeconds from 60 to 28800, one hour when missing, and nothing else", async (t) => {
  const { api } = await rig(t);
  const before = Date.now();
  const enabled = await api("POST", { password: correct });
  assert.equal(enabled.status, 200);
  const expiresAt = Date.parse((enabled.body as { sudo: { expiresAt: string } }).sudo.expiresAt);
  assert.ok(expiresAt >= before + 3_600_000 - 1000 && expiresAt <= Date.now() + 3_600_000);
  for (const ttlSeconds of [60, 120, 28_800])
    assert.equal((await api("POST", { password: correct, ttlSeconds })).status, 200, String(ttlSeconds));
  for (const ttlSeconds of [0, -1, 59, 28_801, 90.5, null, "3600", "permanent", 1e12])
    assert.equal((await api("POST", { password: correct, ttlSeconds })).status, 400, String(ttlSeconds));
});

test("the password never appears in responses, logs or the audit file", async (t) => {
  const captured: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  const writeOut = process.stdout.write.bind(process.stdout);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    captured.push(String(chunk));
    return write(chunk, ...(rest as []));
  }) as typeof process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    captured.push(String(chunk));
    return writeOut(chunk, ...(rest as []));
  }) as typeof process.stdout.write;
  t.after(() => {
    process.stderr.write = write;
    process.stdout.write = writeOut;
  });
  const synthetic = "synthetic-Pa55word-4-tests";
  const { api, everyFile, audit } = await rig(t);
  const responses = [
    await api("POST", { password: synthetic }),
    await api("POST", { password: synthetic, ttlSeconds: 1 }),
    await api("POST", { password: synthetic }, { "X-Forwarded-For": "127.0.0.1" }),
    await api("POST", { password: correct, ttlSeconds: 60 }),
    await api("DELETE", {}),
  ];
  assert.deepEqual(responses.map((response) => response.status), [401, 400, 403, 200, 200]);
  for (const response of responses) {
    assert.equal(response.text.includes(synthetic), false);
    assert.equal(response.text.includes(correct), false);
  }
  assert.ok((await audit()).length >= 3);
  const files = await everyFile();
  assert.equal(files.includes(synthetic), false);
  assert.equal(files.includes(correct), false);
  assert.equal(captured.join("").includes(synthetic), false);
  assert.equal(captured.join("").includes(correct), false);
});

test("sudo routes are not registered off Linux", async (t) => {
  let calls = 0;
  const run: SudoRunner = async () => {
    calls += 1;
    return ok;
  };
  const { api } = await rig(t, {
    app: {
      platform: "darwin",
      sudo: new PasswordlessSudo({ run, user: "bellsvc", file: path.join(os.tmpdir(), "bell-sudo-platform-missing") }),
    },
  });
  for (const method of methods)
    assert.equal((await api(method, method === "GET" ? undefined : {})).status, 404, method);
  assert.equal(calls, 0);
});
