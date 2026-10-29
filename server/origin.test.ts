import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request, type IncomingHttpHeaders } from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { localhostGuard, parseAllowedOrigins } from "./http-guard.js";
import { createApp } from "./index.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";

const remoteOrigin = "https://bell.example.internal:8443";
const remoteHost = new URL(remoteOrigin).host;

/** A port the OS reports free on 127.0.0.1, released before it is returned. */
async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

test("origin configuration accepts precise HTTP(S) origins and rejects ambiguous values", () => {
  assert.deepEqual(parseAllowedOrigins(), []);
  assert.deepEqual(
    parseAllowedOrigins(
      ` ${remoteOrigin}, https://EXAMPLE.COM:443,http://localhost:5173,http://127.0.0.1:80,http://[::1]:8080 `,
    ),
    [
      remoteOrigin,
      "https://example.com",
      "http://localhost:5173",
      "http://127.0.0.1",
      "http://[::1]:8080",
    ],
  );
  for (const value of [
    // Plain HTTP only for this computer: the API must not cross the network in clear.
    "http://example.com",
    "http://example.com:80",
    "http://192.168.1.10:4311",
    "http://bell.example.internal:8443",
    "*",
    "https://*.example.com",
    "https://%2a.example.com",
    "ftp://example.com",
    "https://user:secret@example.com",
    "https://@example.com",
    "https://example.com/",
    "https://example.com/path",
    "https://example.com?query=1",
    "https://example.com#fragment",
    "https://example.com:0",
    "https://example.com:",
    "https://example.com:65536",
    "https://example.com:invalid",
    "https://exam\nple.com",
    "https://example.com\\path",
    `${remoteOrigin},`,
  ]) {
    assert.throws(
      () =>
        localhostGuard({
          ports: [4311],
          allowedOrigins: [value],
        }),
      /BELLPR_ALLOWED_ORIGINS/,
      value,
    );
  }
  // A list entry is exactly one origin; an empty entry or two origins in one
  // entry fail the same way.
  for (const allowedOrigins of [
    [""],
    [" "],
    [remoteOrigin, ""],
    [`${remoteOrigin},https://example.com`],
  ]) {
    assert.throws(
      () => localhostGuard({ ports: [4311], allowedOrigins }),
      /BELLPR_ALLOWED_ORIGINS/,
      JSON.stringify(allowedOrigins),
    );
  }
});

test("localhost guard allows only local hosts and origins and JSON mutations", async () => {
  const app = express();
  app.use(
    localhostGuard({ ports: [4311], allowedOrigins: [] }),
  );
  app.use((_req, res) => {
    res.json({ passed: true });
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const send = (
    headers: Record<string, string>,
    { method = "GET", path = "/api/repos", body = "" } = {},
  ) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
      (resolve, reject) => {
        // DELETE and OPTIONS bodies are not chunked by default; send a length.
        const length = body ? { "content-length": String(body.length) } : {};
        const req = request(
          `http://127.0.0.1:${address.port}${path}`,
          { method, headers: { ...headers, ...length } },
          (res) => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (text += chunk));
            res.on("end", () =>
              resolve({ status: res.statusCode!, headers: res.headers, body: text }),
            );
          },
        );
        req.on("error", reject);
        req.end(body);
      },
    );
  const local = { host: "127.0.0.1:4311" };
  const json = { ...local, "content-type": "application/json" };
  try {
    const passed = await send(local);
    assert.equal(passed.status, 200);
    assert.deepEqual(JSON.parse(passed.body), { passed: true });
    assert.equal(passed.headers["x-content-type-options"], "nosniff");
    assert.equal(passed.headers["referrer-policy"], "no-referrer");
    assert.equal(passed.headers["x-frame-options"], "DENY");
    assert.equal(passed.headers["cache-control"], "no-store");
    const page = await send(local, { path: "/" });
    assert.equal(page.status, 200);
    assert.equal(page.headers["x-frame-options"], "DENY");
    assert.equal(page.headers["cache-control"], undefined);
    for (const headers of [
      { host: "localhost:4311" },
      { host: "LOCALHOST:4311" },
      { host: "[::1]:4311" },
      { ...local, origin: "http://localhost:4311" },
      { host: "localhost:4311", origin: "http://127.0.0.1:4311" },
      { host: "[::1]:4311", origin: "http://[::1]:4311" },
      { ...local, "sec-fetch-site": "same-origin" },
    ]) {
      assert.equal((await send(headers)).status, 200, JSON.stringify(headers));
    }
    for (const headers of [
      { host: "localhost:4310" },
      { host: "localhost" },
      { host: "evil.example:4311" },
      { host: "bell.example.internal:8443" },
      { ...local, origin: "http://localhost:4310" },
      { ...local, origin: "https://localhost:4311" },
      { ...local, origin: "http://localhost:4311/" },
      { ...local, origin: "https://evil.example" },
      { ...local, origin: "null" },
      { ...local, "sec-fetch-site": "cross-site" },
    ]) {
      const response = await send(headers);
      assert.equal(response.status, 403, JSON.stringify(headers));
      assert.match(JSON.parse(response.body).error, /\S/);
    }
    // A link on another site, or a sign-in proxy's redirect back from its
    // identity provider, opens the page itself. The API, subresources,
    // frames and form posts from other sites stay refused.
    const navigation = {
      ...local,
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    };
    for (const path of ["/", "/runs/x"]) {
      assert.equal((await send(navigation, { path })).status, 200, path);
    }
    for (const { headers, ...options } of [
      { headers: navigation, path: "/api/repos" },
      { headers: navigation, path: "/API/health" },
      { headers: { ...navigation, "sec-fetch-dest": "iframe" }, path: "/" },
      {
        headers: {
          ...navigation,
          "sec-fetch-mode": "no-cors",
          "sec-fetch-dest": "script",
        },
        path: "/",
      },
      {
        headers: {
          ...navigation,
          "sec-fetch-mode": "cors",
          "sec-fetch-dest": "empty",
        },
        path: "/",
      },
      {
        headers: { ...navigation, "content-type": "application/json" },
        method: "POST",
        path: "/",
        body: "{}",
      },
    ]) {
      const response = await send(headers, options);
      assert.equal(response.status, 403, JSON.stringify({ headers, options }));
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(
        (await send(json, { method, body: "{}" })).status,
        200,
        method,
      );
      assert.equal(
        (await send(local, { method, body: "text" })).status,
        415,
        method,
      );
      assert.equal(
        (
          await send(
            { ...local, "content-type": "text/plain" },
            { method, body: "{}" },
          )
        ).status,
        415,
        method,
      );
    }
    for (const method of ["HEAD", "OPTIONS"]) {
      assert.equal((await send(local, { method })).status, 200, method);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("configured proxy supports same-origin JSON API requests without weakening local guards", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-pr-origin-"));
  const workbench = new Workbench(new Store(directory));
  let imports = 0;
  workbench.importRepository = async () => {
    imports += 1;
    return {
      id: "test",
      name: "test",
      owner: "local",
      fullName: "local/test",
      path: directory,
      defaultBranch: "main",
      url: "",
    };
  };
  const app = createApp(workbench, {
    allowedOrigins: remoteOrigin,
    staticDirectory: path.join(directory, "missing"),
    // The UI dev server's origin below is trusted in development mode.
    dev: true,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const post = (
    headers: Record<string, string | undefined>,
    body = '{"source":"test"}',
  ) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders }>(
      (resolve, reject) => {
        const req = request(
          `http://127.0.0.1:${address.port}/api/repos`,
          {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
          },
          (res) => {
            res.resume();
            res.on("end", () =>
              resolve({ status: res.statusCode!, headers: res.headers }),
            );
          },
        );
        req.on("error", reject);
        req.end(body);
      },
    );
  try {
    const success = await post({
      host: remoteHost.toUpperCase(),
      origin: remoteOrigin,
    });
    assert.equal(success.status, 201);
    assert.equal(success.headers["x-content-type-options"], "nosniff");
    assert.equal(success.headers["referrer-policy"], "no-referrer");
    assert.equal(success.headers["x-frame-options"], "DENY");
    assert.equal(success.headers["cache-control"], "no-store");
    assert.equal(
      (await post({ host: "127.0.0.1:4311", origin: "http://localhost:4310" }))
        .status,
      201,
    );
    assert.equal((await post({ host: "localhost:4311" })).status, 201);
    for (const headers of [
      { host: "evil.example:8443", origin: remoteOrigin },
      { host: remoteHost, origin: "https://evil.example" },
      { host: remoteHost, origin: `${remoteOrigin}/` },
      { host: remoteHost, origin: remoteOrigin.replace("https:", "http:") },
      { host: remoteHost, origin: "null" },
      { host: remoteHost, origin: "http://localhost:4310" },
      { host: "localhost:4311", origin: remoteOrigin },
      {
        host: remoteHost,
        origin: remoteOrigin,
        "sec-fetch-site": "cross-site",
      },
    ]) {
      assert.equal((await post(headers)).status, 403, JSON.stringify(headers));
    }
    assert.equal(
      (
        await post({
          host: remoteHost,
          origin: remoteOrigin,
          "content-type": "text/plain",
        })
      ).status,
      415,
    );
    assert.equal(
      (await post({ host: remoteHost, origin: remoteOrigin }, "{}")).status,
      400,
    );
    assert.equal(imports, 3);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await workbench.shutdown();
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("createApp also takes the allowed origins as a list", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-pr-origin-list-"));
  const workbench = new Workbench(new Store(directory));
  const staticDirectory = path.join(directory, "missing");
  assert.throws(
    () => createApp(workbench, { allowedOrigins: ["*"], staticDirectory }),
    /BELLPR_ALLOWED_ORIGINS/,
  );
  const app = createApp(workbench, {
    allowedOrigins: [remoteOrigin, "https://second.example"],
    staticDirectory,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const get = (headers: Record<string, string>) =>
    new Promise<number>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${address.port}/api/repos`,
        { headers },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.on("error", reject);
      req.end();
    });
  try {
    assert.equal(await get({ host: remoteHost, origin: remoteOrigin }), 200);
    assert.equal(
      await get({
        host: "second.example",
        origin: "https://second.example",
      }),
      200,
    );
    assert.equal(
      await get({ host: remoteHost, origin: "https://second.example" }),
      403,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await workbench.shutdown();
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid origin configuration fails startup before creating application data", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "bell-pr-origin-startup-"),
  );
  const dataDirectory = path.join(directory, "data");
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "server/index.ts"],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: {
          ...process.env,
          BELLPR_PORT: String(await freePort()),
          BELLPR_FRONTEND_PORT: "4310",
          BELLPR_ALLOWED_ORIGINS: "https://*.example.com",
          BELLPR_DATA_DIR: dataDirectory,
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /BELLPR_ALLOWED_ORIGINS/);
    assert.equal(existsSync(dataDirectory), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** A BELL server on a loopback port, and a request helper that keeps headers and body. */
async function appServer(options: { port?: number; publicUrl?: string } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-pr-auth-"));
  const workbench = new Workbench(new Store(directory));
  workbench.importRepository = async () => ({
    id: "test",
    name: "test",
    owner: "local",
    fullName: "local/test",
    path: directory,
    defaultBranch: "main",
    url: "",
  });
  // The address the browser uses: the public URL's when there is one.
  const host = options.publicUrl
    ? new URL(options.publicUrl).host
    : `127.0.0.1:${options.port ?? 4311}`;
  const app = createApp(workbench, {
    staticDirectory: path.join(directory, "missing"),
    ...(options.port ? { port: options.port } : {}),
    ...(options.publicUrl ? { publicUrl: options.publicUrl } : {}),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const send = (
    requestPath: string,
    {
      method = "GET",
      headers = {},
      body,
    }: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
      (resolve, reject) => {
        const req = request(
          `http://127.0.0.1:${port}${requestPath}`,
          {
            method,
            headers: {
              host,
              ...(body ? { "content-type": "application/json" } : {}),
              ...headers,
            },
          },
          (res) => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (text += chunk));
            res.on("end", () =>
              resolve({ status: res.statusCode!, headers: res.headers, body: text }),
            );
          },
        );
        req.on("error", reject);
        req.end(body);
      },
    );
  return {
    app,
    send,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await workbench.shutdown();
      await app.locals.insights.shutdown();
      await app.locals.discovery.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

const cspHeader =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

test("an app with no API token configured answers without credentials, sets no cookie and carries the security headers", async () => {
  const server = await appServer();
  try {
    // An origin-less POST, as a local script would send it.
    const created = await server.send("/api/repos", { method: "POST", body: '{"source":"x"}' });
    assert.equal(created.status, 201);
    const listed = await server.send("/api/repos");
    assert.equal(listed.status, 200);
    const health = await server.send("/api/health");
    const page = await server.send("/");
    // /auth was the sign-in route; it is an unknown path now.
    const auth = await server.send("/auth?t=anything");
    for (const response of [created, listed, health, page, auth]) {
      assert.notEqual(response.status, 401);
      assert.equal(response.headers["set-cookie"], undefined);
      assert.equal(response.headers["content-security-policy"], cspHeader);
      assert.equal(response.headers["cross-origin-resource-policy"], "same-origin");
      assert.equal(response.headers["x-frame-options"], "DENY");
    }
    assert.equal(auth.status, page.status);
    assert.doesNotMatch(auth.body, /sign/i);
  } finally {
    await server.close();
  }
});
