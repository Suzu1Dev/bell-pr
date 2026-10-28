import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "./app.js";
import { PasswordlessSudo, type SudoRunner } from "./sudo.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";

const correct = "test-only-password";
const ok = { stdout: "", stderr: "", code: 0 };
const wrongPassword = { stdout: "", stderr: "sudo: Authentication failed, try again.\n", code: 1 };

interface ApiResult {
  status: number;
  text: string;
  body: unknown;
}

test("sudo API reports status, enables once with the password, removes the rule, and refuses cross-site, malformed, and locked requests", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-sudo-api-test-"));
  const store = new Store(directory);
  await store.initialize();
  const workbench = new Workbench(store);
  // Fake sudo: no real command runs and nothing is written outside the temp directory.
  let passwordless = false;
  const run: SudoRunner = async (executable, args, options = {}) => {
    if (executable === "visudo") return ok;
    if (args[0] === "-k" && args[1] === "-n" && args[2] === "true")
      return { ...ok, code: passwordless ? 0 : 1 };
    if (args[0] === "-k" && args[1] === "-n") {
      passwordless = false;
      return ok;
    }
    if (options.input !== `${correct}\n`) return wrongPassword;
    passwordless = true;
    return ok;
  };
  const app = createApp(workbench, {
    staticDirectory: path.join(directory, "missing"),
    sudo: new PasswordlessSudo({ run, user: "bellsvc", file: path.join(directory, "bell-pr-agent") }),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const api = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
    new Promise<ApiResult>((resolve, reject) => {
      // Node omits Content-Length for DELETE when the body is written with end(); fetch sets it, so the helper does too.
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        `http://127.0.0.1:${address.port}/api/system/sudo`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Bell-Locale": "en",
            ...(payload === undefined ? {} : { "Content-Length": Buffer.byteLength(payload) }),
            Host: "127.0.0.1:4311",
            ...headers,
          },
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

  const status = await api("GET");
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, { sudo: { user: "bellsvc", available: true, installed: false, passwordless: false } });
  // Cross-site and malformed requests never reach sudo.
  assert.equal((await api("GET", undefined, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await api("POST", { password: correct }, { Origin: "https://evil.example" })).status, 403);
  for (const body of [{}, { password: "" }, { password: 123 }, { password: correct, extra: true }]) {
    assert.equal((await api("POST", body)).status, 400);
  }
  assert.equal(passwordless, false);

  // A wrong password is refused without echoing it; the right one enables sudo.
  const wrong = await api("POST", { password: "not-the-password" });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.text.includes("not-the-password"), false);
  const enabled = await api("POST", { password: correct });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.text.includes(correct), false);
  assert.deepEqual(enabled.body, { sudo: { user: "bellsvc", available: true, installed: false, passwordless: true } });

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
  assert.equal(passwordless, false);
});
