/**
 * The pairing and devices routes behind the request guard. Synthetic
 * tokens only; the clock is real, so time-based rules live in
 * pairing.test.ts.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request, type IncomingHttpHeaders } from "node:http";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { loadOrCreateApiToken, readApiToken } from "./api-token.js";
import { createApp } from "./app.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";

const publicUrl = "https://bell.example.internal";

/** A response; `json` is loose so each test reads the fields it checks. */
interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-pairing-routes-"));
  const file = path.join(directory, "api-token");
  const token = await loadOrCreateApiToken(file);
  const store = new Store(directory);
  await store.initialize();
  const workbench = new Workbench(store);
  const app = createApp(workbench, {
    staticDirectory: path.join(directory, "missing"),
    port: 4311,
    publicUrl,
    apiTokenFile: file,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const send = (
    method: string,
    urlPath: string,
    headers: Record<string, string | undefined> = {},
    body?: unknown,
  ) =>
    new Promise<Reply>((resolve, reject) => {
      const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: urlPath,
          method,
          headers: {
            host: "127.0.0.1:4311",
            "content-type": "application/json",
            ...(text ? { "content-length": String(Buffer.byteLength(text)) } : {}),
            ...headers,
          },
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            let json: unknown;
            try {
              json = data ? JSON.parse(data) : undefined;
            } catch {
              json = undefined;
            }
            resolve({ status: res.statusCode!, headers: res.headers, body: data, json });
          });
        },
      );
      req.on("error", reject);
      req.end(text);
    });
  const install = { authorization: `Bearer ${token}` };
  const bearer = (value: string) => ({ authorization: `Bearer ${value}` });
  const newCode = async () => {
    const response = await send("POST", "/api/pair/codes", install, {});
    assert.equal(response.status, 201, response.body);
    return response.json.code as string;
  };
  const pairDevice = async (name = "Phone") => {
    const response = await send("POST", "/api/pair", {}, { code: await newCode(), name });
    assert.equal(response.status, 201, response.body);
    return response.json as { deviceId: string; token: string; name: string };
  };
  return { directory, file, token, send, install, bearer, newCode, pairDevice };
}

function assertPairingHeaders(headers: IncomingHttpHeaders) {
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(headers["set-cookie"], undefined);
}

test("the install token creates a code; a device redeems it once without a token", async (t) => {
  const f = await fixture(t);
  const created = await f.send("POST", "/api/pair/codes", f.install, { name: "Phone" });
  assert.equal(created.status, 201, created.body);
  assertPairingHeaders(created.headers);
  assert.deepEqual(Object.keys(created.json).sort(), ["code", "expiresAt", "pairUrl"]);
  assert.match(created.json.code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(created.json.pairUrl, `${publicUrl}/pair`);
  const ttl = Date.parse(created.json.expiresAt) - Date.now();
  assert.ok(ttl > 4 * 60_000 && ttl <= 5 * 60_000);

  const redeemed = await f.send("POST", "/api/pair", {}, { code: created.json.code.toLowerCase() });
  assert.equal(redeemed.status, 201, redeemed.body);
  assertPairingHeaders(redeemed.headers);
  assert.match(redeemed.json.deviceId, /^dev_[0-9a-f]{32}$/);
  assert.match(redeemed.json.token, /^bpd_[0-9a-f]{64}$/);
  // The name suggested with the code applies when the device sends none.
  assert.equal(redeemed.json.name, "Phone");

  const again = await f.send("POST", "/api/pair", {}, { code: created.json.code });
  assert.equal(again.status, 401);
  assert.deepEqual(again.json, { error: "invalid_code" });
  assertPairingHeaders(again.headers);
  assert.equal(again.body.includes(created.json.code), false);
});

test("a device token works on the API, lists devices without secrets and revokes any device", async (t) => {
  const f = await fixture(t);
  const phone = await f.pairDevice("Phone");
  const laptop = await f.pairDevice("Laptop");

  for (const headers of [f.bearer(phone.token), { "x-bell-token": phone.token }]) {
    const counts = await f.send("GET", "/api/learning/counts", headers);
    assert.equal(counts.status, 200, counts.body);
  }

  const listed = await f.send("GET", "/api/devices", f.bearer(phone.token));
  assert.equal(listed.status, 200);
  assertPairingHeaders(listed.headers);
  assert.deepEqual(
    listed.json.map((device: { id: string; current: boolean }) => [device.id, device.current]),
    [[phone.deviceId, true], [laptop.deviceId, false]],
  );
  for (const device of listed.json)
    assert.deepEqual(Object.keys(device).sort(), ["createdAt", "current", "id", "lastUsedAt", "name"]);
  assert.doesNotMatch(listed.body, /bpd_|tokenHash|hash/i);
  assert.equal(listed.body.includes(phone.token.slice(4)), false);

  const byInstall = await f.send("GET", "/api/devices", f.install);
  assert.equal(byInstall.json.every((device: { current: boolean }) => !device.current), true);

  // The phone revokes the lost laptop; the laptop's token stops at once.
  const revoked = await f.send("DELETE", `/api/devices/${laptop.deviceId}`, f.bearer(phone.token), {});
  assert.equal(revoked.status, 204);
  assertPairingHeaders(revoked.headers);
  assert.equal((await f.send("GET", "/api/devices", f.bearer(laptop.token))).status, 401);
  assert.equal((await f.send("DELETE", `/api/devices/${laptop.deviceId}`, f.install, {})).status, 404);
  // A device may revoke itself.
  assert.equal((await f.send("DELETE", `/api/devices/${phone.deviceId}`, f.bearer(phone.token), {})).status, 204);
  assert.equal((await f.send("GET", "/api/learning/counts", f.bearer(phone.token))).status, 401);
});

test("a device token cannot create codes, rotate or unlock", async (t) => {
  const f = await fixture(t);
  const phone = await f.pairDevice();
  for (const route of ["/api/pair/codes", "/api/devices/rotate", "/api/pair/unlock"]) {
    const response = await f.send("POST", route, f.bearer(phone.token), {});
    assert.equal(response.status, 403, route);
    assert.deepEqual(response.json, { error: "install_token_required" });
    assertPairingHeaders(response.headers);
  }
  assert.equal(readApiToken(f.file), f.token);
});

test("no token, a malformed one or another install's: 401 everywhere but redeem", async (t) => {
  const f = await fixture(t);
  const attempts: Array<[string, string]> = [
    ["POST", "/api/pair/codes"],
    ["POST", "/api/pair/unlock"],
    ["POST", "/api/devices/rotate"],
    ["GET", "/api/devices"],
    ["DELETE", "/api/devices/dev_00000000000000000000000000000000"],
  ];
  const fakeDevice = `bpd_${"ab".repeat(32)}`;
  for (const headers of [{}, f.bearer("bpd_x"), f.bearer(fakeDevice), { "x-bell-token": fakeDevice }])
    for (const [method, route] of attempts) {
      const response = await f.send(method, route, headers, method === "GET" ? undefined : {});
      assert.equal(response.status, 401, `${method} ${route}`);
      assert.equal(response.headers["cache-control"], "no-store");
    }
  // A device token is not a cookie.
  const phone = await f.pairDevice();
  assert.equal((await f.send("GET", "/api/devices", { cookie: `token=${phone.token}` })).status, 401);
});

test("rotate through the API signs out every device and voids the code", async (t) => {
  const f = await fixture(t);
  const phone = await f.pairDevice();
  const pending = await f.newCode();
  const rotated = await f.send("POST", "/api/devices/rotate", f.install, {});
  assert.equal(rotated.status, 204);
  assertPairingHeaders(rotated.headers);
  assert.notEqual(readApiToken(f.file), f.token);
  assert.equal((await f.send("GET", "/api/devices", f.bearer(phone.token))).status, 401);
  assert.equal((await f.send("GET", "/api/devices", f.install)).status, 401);
  const late = await f.send("POST", "/api/pair", {}, { code: pending });
  assert.equal(late.status, 401);
  const devices = JSON.parse(await readFile(path.join(f.directory, "devices.json"), "utf8"));
  assert.deepEqual(devices, { devices: [] });
});

test("parallel redeems of one code: exactly one 201", async (t) => {
  const f = await fixture(t);
  const code = await f.newCode();
  const responses = await Promise.all(
    Array.from({ length: 25 }, () => f.send("POST", "/api/pair", {}, { code })),
  );
  assert.equal(responses.filter((response) => response.status === 201).length, 1);
  // The others count as failures, so the tenth locks pairing.
  assert.deepEqual(
    responses.filter((response) => response.status !== 201).map((response) => response.status).sort(),
    [...Array(9).fill(401), ...Array(15).fill(423)],
  );
  assert.equal((await f.send("GET", "/api/devices", f.install)).json.length, 1);
});

test("failures lock pairing for everyone, whatever X-Forwarded-For says; unlock clears it", async (t) => {
  const f = await fixture(t);
  const code = await f.newCode();
  const wrong = code.startsWith("0") ? "1111-1111" : "0000-0000";
  for (let i = 0; i < 9; i++) {
    const response = await f.send("POST", "/api/pair", { "x-forwarded-for": `198.51.100.${i}` }, { code: wrong });
    assert.equal(response.status, 401);
  }
  const tripped = await f.send("POST", "/api/pair", { "x-forwarded-for": "203.0.113.9" }, { code: wrong });
  assert.equal(tripped.status, 423);
  assertPairingHeaders(tripped.headers);
  assert.equal(tripped.json.error, "pairing_locked");
  assert.ok(Date.parse(tripped.json.lockedUntil) > Date.now() + 14 * 60_000);
  assert.match(tripped.json.hint, /pair --unlock/);

  // The voided code no longer works, and no new code is minted while locked.
  assert.equal((await f.send("POST", "/api/pair", {}, { code })).status, 423);
  const refused = await f.send("POST", "/api/pair/codes", f.install, {});
  assert.equal(refused.status, 423);
  assert.equal("code" in refused.json, false);

  const unlocked = await f.send("POST", "/api/pair/unlock", f.install, {});
  assert.equal(unlocked.status, 204);
  assertPairingHeaders(unlocked.headers);
  assert.equal((await f.send("POST", "/api/pair", {}, { code })).status, 401);
  await f.pairDevice();
});

test("a damaged failure record locks pairing until unlock", async (t) => {
  const f = await fixture(t);
  await f.pairDevice();
  await writeFile(path.join(f.directory, "pair-lock.json"), "[]");
  const refused = await f.send("POST", "/api/pair/codes", f.install, {});
  assert.equal(refused.status, 423);
  assert.equal(refused.json.lockedUntil, undefined);
  assert.match(refused.json.hint, /pair --unlock/);
  assert.equal((await f.send("POST", "/api/pair/unlock", f.install, {})).status, 204);
  await f.pairDevice();
});

test("pairing and devices requests need a JSON body and pass the Host and Origin checks", async (t) => {
  const f = await fixture(t);
  const phone = await f.pairDevice();
  const plain = { "content-type": "text/plain" };
  for (const [method, route, headers] of [
    ["POST", "/api/pair", plain],
    ["POST", "/api/pair/codes", { ...f.install, ...plain }],
    ["POST", "/api/pair/unlock", { ...f.install, ...plain }],
    ["POST", "/api/devices/rotate", { ...f.install, ...plain }],
    ["DELETE", `/api/devices/${phone.deviceId}`, { ...f.bearer(phone.token), ...plain }],
    ["DELETE", `/api/devices/${phone.deviceId}`, { ...f.bearer(phone.token), "content-type": "application/x-www-form-urlencoded" }],
  ] as const) {
    const response = await f.send(method, route, headers, "code=0000-0000");
    assert.equal(response.status, 415, `${method} ${route}`);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  assert.equal((await f.send("GET", "/api/devices", f.install)).json.length, 1);

  const evilOrigin = await f.send("POST", "/api/pair", { origin: "https://evil.example" }, { code: "0000-0000" });
  assert.equal(evilOrigin.status, 403);
  const evilHost = await f.send("GET", "/api/devices", { ...f.install, host: "evil.example" });
  assert.equal(evilHost.status, 403);
  const crossSite = await f.send("DELETE", `/api/devices/${phone.deviceId}`, { ...f.bearer(phone.token), "sec-fetch-site": "cross-site" }, {});
  assert.equal(crossSite.status, 403);
  // None of those counted as a pairing failure.
  const lock = JSON.parse(await readFile(path.join(f.directory, "pair-lock.json"), "utf8"));
  assert.deepEqual(lock.failures, []);
  // Unknown fields are refused.
  assert.equal((await f.send("POST", "/api/pair", {}, { code: "0000-0000", token: "x" })).status, 400);
});

test("the server log names the paired device only, never the code or the token", async (t) => {
  const f = await fixture(t);
  const code = await f.newCode();
  const paired = await f.send("POST", "/api/pair", {}, { code, name: "Kitchen tablet" });
  assert.equal(paired.status, 201);
  const logs = path.join(f.directory, "logs");
  const text = (await Promise.all((await readdir(logs)).map((name) => readFile(path.join(logs, name), "utf8")))).join("\n");
  assert.match(text, new RegExp(`device paired: ${paired.json.deviceId} Kitchen tablet`));
  assert.equal(text.includes(code), false);
  assert.equal(text.includes(code.replace("-", "")), false);
  assert.equal(text.includes(paired.json.token), false);
  assert.equal(text.includes(paired.json.token.slice(4)), false);
});

test("pairing modules never read the source address or forwarded headers", () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  for (const file of ["pairing.ts", "device-tokens.ts", "routes/pairing.ts", "pair-qr.ts"]) {
    const source = readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /req\.ip\b|\.ips\b|x-forwarded|forwarded|remoteAddress|\.socket\b/i, file);
  }
});

test("POST /api/pair?code= ignores the query: no redeem and no prefill from query", async (t) => {
  const f = await fixture(t);
  const code = await f.newCode();
  // Query carries a valid code; body has none / a different code — query must not redeem.
  const noBodyCode = await f.send("POST", `/api/pair?code=${code}`, {}, { name: "FromQuery" });
  assert.equal(noBodyCode.status, 400);
  assert.equal((await f.send("GET", "/api/devices", f.install)).json.length, 0);

  const other = code.startsWith("0") ? "1111-1111" : "0000-0000";
  const wrongBody = await f.send("POST", `/api/pair?code=${code}`, {}, { code: other });
  assert.equal(wrongBody.status, 401);
  assert.deepEqual(wrongBody.json, { error: "invalid_code" });
  assert.equal((await f.send("GET", "/api/devices", f.install)).json.length, 0);

  // Body code still works when query is absent or present with noise.
  const ok = await f.send("POST", `/api/pair?code=${other}`, {}, { code, name: "BodyWins" });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.name, "BodyWins");
});

test("pairing lock returns only 423 pairing_locked, never 429", async (t) => {
  const f = await fixture(t);
  const code = await f.newCode();
  const wrong = code.startsWith("0") ? "1111-1111" : "0000-0000";
  const statuses: number[] = [];
  for (let i = 0; i < 40; i++) {
    const response = await f.send("POST", "/api/pair", {}, { code: wrong });
    statuses.push(response.status);
    if (response.status === 423) {
      assert.equal(response.json.error, "pairing_locked");
      break;
    }
  }
  assert.equal(statuses.includes(429), false);
  assert.equal(statuses.at(-1), 423);
  // Creating codes while locked also stays off 429.
  const refused = await f.send("POST", "/api/pair/codes", f.install, {});
  assert.equal(refused.status, 423);
  assert.equal(refused.json.error, "pairing_locked");
  const unlocked = await f.send("POST", "/api/pair/unlock", f.install, {});
  assert.equal(unlocked.status, 204);
});
