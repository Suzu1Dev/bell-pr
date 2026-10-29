import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request, type IncomingHttpHeaders } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  apiSessionCookie,
  apiSessionLifetime,
  createApiSession,
  readApiSession,
  rememberedApiSessionLifetime,
} from "./api-session.js";
import { generateApiToken, loadOrCreateApiToken, readApiToken, rotateApiToken } from "./api-token.js";
import { createApp } from "./app.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import { localhostGuard } from "./http-guard.js";
import { registerApiSessionRoutes } from "./routes/api-session.js";

const remoteOrigin = "https://bell.example.internal:8443";
const localCookieName = `${apiSessionCookie}-4311`;

async function fixture(t: TestContext, withTokenFile = true, endpointPort = 4311) {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-api-session-"));
  const file = path.join(directory, "api-token");
  const token = await loadOrCreateApiToken(file);
  const store = new Store(directory);
  await store.initialize();
  const workbench = new Workbench(store);
  const app = createApp(workbench, {
    staticDirectory: path.join(directory, "missing"),
    allowedOrigins: [remoteOrigin, "https://bell.example.internal", "http://localhost"],
    port: endpointPort,
    ...(withTokenFile ? { apiTokenFile: file } : { apiToken: token }),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const send = (
    method: string,
    urlPath = "/api/session",
    headers: Record<string, string | undefined> = {},
    body?: unknown,
  ) => new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const req = request({
      host: "127.0.0.1", port, path: urlPath, method,
      headers: {
        host: `127.0.0.1:${endpointPort}`,
        "content-type": "application/json",
        ...(text ? { "content-length": String(Buffer.byteLength(text)) } : {}),
        ...headers,
      },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: text }));
    });
    req.on("error", reject);
    req.end(text);
  });
  const bearer = { authorization: `Bearer ${token}` };
  const login = async (remember = false, headers: Record<string, string | undefined> = bearer) => {
    const response = await send("POST", "/api/session", headers, { remember });
    assert.equal(response.status, 200, response.body);
    const setCookie = response.headers["set-cookie"]?.[0];
    assert.ok(setCookie);
    return { ...response, setCookie, cookie: setCookie.split(";")[0] };
  };
  return { file, token, send, bearer, login };
}

test("signed sessions have bounded lifetimes, reject tampering and do not contain the token", () => {
  const token = generateApiToken();
  const now = 1_800_000_000_000;
  for (const remembered of [false, true]) {
    const value = createApiSession(token, remembered, now);
    const cookie = `${localCookieName}=${value}`;
    const session = readApiSession(cookie, token, localCookieName, now);
    assert.ok(session);
    assert.equal(session.remembered, remembered);
    const lifetime = remembered ? rememberedApiSessionLifetime : apiSessionLifetime;
    assert.equal(session.exp - session.iat, lifetime);
    assert.ok(readApiSession(cookie, token, localCookieName, now + lifetime * 1000 - 1));
    assert.equal(readApiSession(cookie, token, localCookieName, now + lifetime * 1000), undefined);
    assert.equal(readApiSession(cookie, token, localCookieName, now - 1000), undefined);
    assert.equal(readApiSession(cookie, generateApiToken(), localCookieName, now), undefined);
    assert.equal(readApiSession(`${cookie}; ${cookie}`, token, localCookieName, now), undefined);
    assert.equal(readApiSession(`${cookie}x`, token, localCookieName, now), undefined);
    assert.equal(value.includes(token), false);
    assert.equal(Buffer.from(value.split(".")[0], "base64url").toString().includes(token), false);
    assert.notEqual(createApiSession(token, remembered, now), value);
  }
});

test("a bearer token bootstraps an HttpOnly session usable without the token", async (t) => {
  const { send, bearer, login, token } = await fixture(t);
  assert.equal((await send("GET")).status, 401);
  assert.equal((await send("POST", "/api/session", {}, { remember: false })).status, 401);
  assert.equal((await send("GET", "/api/health")).status, 200);
  assert.deepEqual(JSON.parse((await send("GET", "/api/session", bearer)).body), { remembered: false });
  const loggedIn = await login();
  assert.match(loggedIn.setCookie, /; HttpOnly/);
  assert.match(loggedIn.setCookie, /; SameSite=Strict/);
  assert.match(loggedIn.setCookie, /; Path=\//);
  assert.doesNotMatch(loggedIn.setCookie, /(?:Domain|Max-Age|Expires|Secure)=?/i);
  assert.equal(loggedIn.setCookie.includes(token), false);
  assert.equal(loggedIn.headers["cache-control"], "no-store");
  const session = await send("GET", "/api/session", { cookie: loggedIn.cookie });
  assert.equal(session.status, 200);
  assert.deepEqual(JSON.parse(session.body), { remembered: false });
  assert.equal(session.headers["cache-control"], "no-store");
  assert.equal((await send("GET", "/api/app-settings", { cookie: loggedIn.cookie })).status, 200);
});

test("remembering a browser persists for 30 days and a later session choice removes persistence", async (t) => {
  const { login, send } = await fixture(t);
  const remembered = await login(true);
  assert.match(remembered.setCookie, /; Max-Age=2592000/);
  assert.match(remembered.setCookie, /; Expires=/);
  assert.deepEqual(JSON.parse((await send("GET", "/api/session", { cookie: remembered.cookie })).body), { remembered: true });
  const temporary = await login(false, { cookie: remembered.cookie });
  assert.doesNotMatch(temporary.setCookie, /(?:Max-Age|Expires)=/);
  assert.deepEqual(JSON.parse(temporary.body), { remembered: false });
});

test("public hosts receive Secure cookies even through an HTTP proxy, while logout clears the cookie", async (t) => {
  const { bearer, login, send } = await fixture(t);
  const remote = { ...bearer, host: new URL(remoteOrigin).host, origin: remoteOrigin, "x-forwarded-host": "localhost" };
  const loggedIn = await login(true, remote);
  assert.match(loggedIn.setCookie, /; Secure/);
  assert.doesNotMatch(loggedIn.setCookie, /; Domain=/);
  const logout = await send("DELETE", "/api/session", { ...remote, cookie: loggedIn.cookie }, {});
  assert.equal(logout.status, 204);
  assert.equal(logout.body, "");
  assert.equal(logout.headers["cache-control"], "no-store");
  assert.match(logout.headers["set-cookie"]?.[0] ?? "", /bellpr-session-8443=;.*Expires=Thu, 01 Jan 1970/);
  assert.match(logout.headers["set-cookie"]?.[0] ?? "", /; Secure/);
  assert.equal((await send("GET")).status, 401);
});

test("default HTTP and HTTPS ports have stable cookie names", async (t) => {
  const { bearer, login, send } = await fixture(t);
  for (const [host, name] of [
    ["localhost", "bellpr-session-80"],
    ["bell.example.internal", "bellpr-session-443"],
  ]) {
    const session = await login(false, { ...bearer, host });
    assert.equal(session.cookie.split("=")[0], name);
    assert.equal((await send("GET", "/api/session", { host, cookie: session.cookie })).status, 200);
  }
});

test("two instances on one host keep separate sessions and logging out of one preserves the other", async (t) => {
  const first = await fixture(t, true, 4311);
  const second = await fixture(t, true, 4312);
  // Browser cookies are shared by hostname, including across these ports.
  const jar = new Map<string, string>();
  const storeCookie = (setCookie: string) => {
    const pair = setCookie.split(";")[0];
    const equals = pair.indexOf("=");
    const name = pair.slice(0, equals);
    const value = pair.slice(equals + 1);
    if (value) jar.set(name, value);
    else jar.delete(name);
  };
  const headers = () => ({ cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") });
  storeCookie((await first.login(false)).setCookie);
  storeCookie((await second.login(true)).setCookie);
  assert.deepEqual([...jar.keys()], ["bellpr-session-4311", "bellpr-session-4312"]);
  const firstSession = await first.send("GET", "/api/session", headers());
  const secondSession = await second.send("GET", "/api/session", headers());
  assert.equal(firstSession.status, 200);
  assert.equal(secondSession.status, 200);
  assert.deepEqual(JSON.parse(firstSession.body), { remembered: false });
  assert.deepEqual(JSON.parse(secondSession.body), { remembered: true });
  const logout = await first.send("DELETE", "/api/session", headers(), {});
  assert.equal(logout.status, 204);
  storeCookie(logout.headers["set-cookie"]![0]);
  assert.deepEqual([...jar.keys()], ["bellpr-session-4312"]);
  assert.equal((await first.send("GET", "/api/session", headers())).status, 401);
  assert.equal((await second.send("GET", "/api/session", headers())).status, 200);
});

test("forged, expired and duplicate cookies fail, and explicit wrong token headers cannot fall back", async (t) => {
  const { token, login, send } = await fixture(t);
  const { cookie } = await login();
  const expired = `${localCookieName}=${createApiSession(token, false, Date.now() - apiSessionLifetime * 1000)}`;
  for (const invalid of [`${localCookieName}=forged`, `${cookie}x`, expired, `${cookie}; ${cookie}`]) {
    const response = await send("GET", "/api/app-settings", { cookie: invalid });
    assert.equal(response.status, 401);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  for (const header of [
    { authorization: "Bearer wrong" },
    { authorization: "Basic wrong" },
    { authorization: "" },
    { "x-bell-token": "wrong" },
    { "x-bell-token": "" },
  ]) {
    assert.equal((await send("GET", "/api/app-settings", { ...header, cookie })).status, 401);
  }
  assert.equal((await send("GET", "/api/app-settings", { "x-bell-token": token })).status, 200);
});

test("cookie authentication retains Host, Origin, Fetch Metadata, JSON and strict body checks", async (t) => {
  const { login, send, file, token } = await fixture(t);
  const { cookie } = await login();
  for (const headers of [
    { host: "evil.example:4311" },
    { origin: "https://evil.example" },
    { "sec-fetch-site": "cross-site" },
  ]) {
    const denied = await send("POST", "/api/session/revoke", { ...headers, cookie }, {});
    assert.equal(denied.status, 403);
    assert.equal(denied.headers["set-cookie"], undefined);
    assert.equal(readApiToken(file), token);
  }
  assert.equal((await send("POST", "/api/session", { cookie, "content-type": "text/plain" }, { remember: true })).status, 415);
  for (const body of [{}, { remember: "true" }, { remember: true, extra: true }]) {
    const bad = await send("POST", "/api/session", { cookie }, body);
    assert.equal(bad.status, 400);
    assert.equal(bad.headers["set-cookie"], undefined);
  }
  for (const [method, urlPath] of [["DELETE", "/api/session"], ["POST", "/api/session/revoke"]]) {
    for (const body of [{ extra: true }, []]) {
      const bad = await send(method, urlPath, { cookie }, body);
      assert.equal(bad.status, 400);
      assert.equal(bad.headers["set-cookie"], undefined);
      assert.equal(readApiToken(file), token);
    }
  }
});

test("CLI rotation and revoke invalidate every session and old API token immediately", async (t) => {
  const { login, send, file, bearer, token } = await fixture(t);
  const first = await login(false);
  const second = await login(true);
  const rotated = await rotateApiToken(file);
  for (const headers of [bearer, { cookie: first.cookie }, { cookie: second.cookie }])
    assert.equal((await send("GET", "/api/session", headers)).status, 401);
  const current = await login(true, { authorization: `Bearer ${rotated}` });
  const other = await login(false, { authorization: `Bearer ${rotated}` });
  const revoked = await send("POST", "/api/session/revoke", { cookie: current.cookie }, {});
  assert.equal(revoked.status, 204);
  assert.equal(revoked.headers["cache-control"], "no-store");
  assert.match(revoked.headers["set-cookie"]?.[0] ?? "", /bellpr-session-4311=;/);
  assert.equal(revoked.body, "");
  const newToken = readApiToken(file);
  assert.ok(newToken);
  assert.notEqual(newToken, token);
  assert.notEqual(newToken, rotated);
  for (const headers of [{ cookie: current.cookie }, { cookie: other.cookie }, { authorization: `Bearer ${rotated}` }])
    assert.equal((await send("GET", "/api/app-settings", headers)).status, 401);
  assert.equal((await send("GET", "/api/app-settings", { authorization: `Bearer ${newToken}` })).status, 200);
});

test("static-token app setups retain bearer auth without a token-rotation endpoint", async (t) => {
  const { send, bearer } = await fixture(t, false);
  assert.equal((await send("GET", "/api/app-settings", bearer)).status, 200);
  assert.equal((await send("GET", "/api/session", bearer)).status, 404);
  assert.equal((await send("POST", "/api/session/revoke", bearer, {})).status, 404);
});

test("rotation while a JSON body is arriving prevents renewal or revocation with the old credential", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-api-session-race-"));
  const file = path.join(directory, "api-token");
  await loadOrCreateApiToken(file);
  let passedGuard: (() => void) | undefined;
  const app = express();
  app.use(localhostGuard({
    ports: [4311], allowedOrigins: [],
    readApiToken: () => {
      const token = readApiToken(file);
      passedGuard?.();
      return token;
    },
  }));
  app.use(express.json());
  registerApiSessionRoutes(app, file);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  for (const urlPath of ["/api/session", "/api/session/revoke"]) {
    for (const credential of ["bearer", "cookie"]) {
      const token = readApiToken(file)!;
      const guardReached = new Promise<void>((resolve) => { passedGuard = resolve; });
      const body = JSON.stringify(urlPath === "/api/session" ? { remember: true } : {});
      const req = request({
        host: "127.0.0.1", port, path: urlPath, method: "POST",
        headers: {
          host: "127.0.0.1:4311",
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
          ...(credential === "bearer"
            ? { authorization: `Bearer ${token}` }
            : { cookie: `${localCookieName}=${createApiSession(token, true)}` }),
        },
      });
      const response = once(req, "response");
      req.write(body.slice(0, 1));
      await guardReached;
      const rotated = await rotateApiToken(file);
      req.end(body.slice(1));
      const [res] = await response;
      res.resume();
      await once(res, "end");
      assert.equal(res.statusCode, 401, `${urlPath} with ${credential}`);
      assert.equal(res.headers["set-cookie"], undefined);
      assert.equal(readApiToken(file), rotated);
    }
  }
});
