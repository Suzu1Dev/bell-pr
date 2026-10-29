/**
 * The local API token, host and origin checks, and the loopback bind.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import {
  apiListenerProof,
  generateApiToken,
  loadOrCreateApiToken,
  readApiToken,
  rotateApiToken,
  tokensMatch,
} from "./api-token.js";
import { createApp } from "./app.js";
import { dataPaths, resolveConfig } from "./config.js";
import { runDoctorCli } from "./doctor.js";
import { withLocale } from "./i18n/index.js";
import { startServer } from "./index.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";

const tokenPattern = /^[0-9a-f]{64}$/;

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function snapshot(directory: string) {
  const names = ["state.json", "app-settings.json", "discovery.json", "api-token"];
  const files: Record<string, string | null> = {};
  for (const name of names) {
    try {
      files[name] = await readFile(path.join(directory, name), "utf8");
    } catch {
      files[name] = null;
    }
  }
  return files;
}

/** Every file under `directory` except the token file itself. */
async function textExceptToken(directory: string): Promise<string> {
  const chunks: string[] = [];
  const walk = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name !== "api-token") chunks.push(await readFile(file, "utf8"));
    }
  };
  await walk(directory);
  return chunks.join("\n");
}

test("the token file is created once, kept across restarts, and replaced on rotate", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-api-token-"));
  try {
    const file = path.join(directory, "api-token");
    const first = await loadOrCreateApiToken(file);
    assert.match(first, tokenPattern);
    assert.equal(await loadOrCreateApiToken(file), first);
    assert.equal((await stat(file)).mode & 0o777, 0o600);

    await writeFile(file, `${first}\n`, { mode: 0o644 });
    assert.equal(await loadOrCreateApiToken(file), first);
    assert.equal((await stat(file)).mode & 0o777, 0o600);

    await writeFile(file, "not-a-token\n", { mode: 0o600 });
    const replaced = await loadOrCreateApiToken(file);
    assert.match(replaced, tokenPattern);
    assert.notEqual(replaced, first);
    assert.notEqual(replaced, "not-a-token");

    const rotated = await rotateApiToken(file);
    assert.match(rotated, tokenPattern);
    assert.notEqual(rotated, replaced);
    assert.equal(readApiToken(file), rotated);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(tokensMatch(rotated, rotated), true);
    assert.equal(tokensMatch(rotated, replaced), false);
    assert.equal(tokensMatch(rotated, rotated.slice(0, -1)), false);
    assert.equal(tokensMatch(rotated, `${rotated}00`), false);
    assert.equal(generateApiToken().length, 64);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("API routes require the token, and a bad host, origin or body changes nothing", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-api-auth-"));
  const store = new Store(directory);
  await store.initialize();
  const workbench = new Workbench(store);
  const file = dataPaths(directory).apiToken;
  const token = await loadOrCreateApiToken(file);
  const app = createApp(workbench, {
    staticDirectory: path.join(directory, "missing"),
    readApiToken: () => readApiToken(file),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const send = (
    method: string,
    urlPath: string,
    headers: Record<string, string>,
    body = "",
  ) =>
    new Promise<{ status: number; body: string; allowOrigin: string | undefined }>(
      (resolve, reject) => {
        const req = request(
          {
            host: "127.0.0.1",
            port: address.port,
            path: urlPath,
            method,
            headers: { ...headers, ...(body ? { "content-length": String(Buffer.byteLength(body)) } : {}) },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
                allowOrigin: res.headers["access-control-allow-origin"] as string | undefined,
              }),
            );
          },
        );
        req.on("error", reject);
        req.end(body);
      },
    );
  const local = { host: "127.0.0.1:4311" };
  const json = { ...local, "content-type": "application/json" };
  const bearer = { ...json, authorization: `Bearer ${token}` };
  try {
    const before = await snapshot(directory);
    const health = await send("GET", "/api/health", local);
    assert.equal(health.status, 200);
    assert.equal(health.allowOrigin, undefined);
    assert.deepEqual(Object.keys(JSON.parse(health.body)).sort(), ["name", "version"]);
    const nonce = generateApiToken();
    const proof = await send("GET", `/api/health?challenge=${nonce}`, local);
    const expectedProof = apiListenerProof(token, nonce, "127.0.0.1", address.port);
    assert.equal(proof.status, 200);
    assert.equal(JSON.parse(proof.body).proof, expectedProof);
    assert.equal(proof.body.includes(token), false);
    assert.notEqual(expectedProof, apiListenerProof(token, nonce, "127.0.0.1", address.port === 65535 ? 65534 : address.port + 1));
    for (const query of ["arbitrary-payload", `${nonce}&challenge=${nonce}`, `${nonce}00`]) {
      const invalid = await send("GET", `/api/health?challenge=${query}`, local);
      assert.equal(invalid.status, 200);
      assert.equal(JSON.parse(invalid.body).proof, undefined);
    }

    const missing = await send("GET", "/api/app-settings", {
      ...local,
      "x-bell-locale": "en",
    });
    assert.equal(missing.status, 401);
    assert.match(missing.body, /API token/);
    assert.equal(missing.allowOrigin, undefined);

    const wrong = await send("PUT", "/api/app-settings", {
      ...json,
      authorization: "Bearer 0000000000000000000000000000000000000000000000000000000000000000",
    }, "{}");
    assert.equal(wrong.status, 401);

    const zh = await send("GET", "/api/app-settings", { ...local, "x-bell-locale": "zh-TW" });
    assert.equal(zh.status, 401);
    assert.match(zh.body, /API 權杖/);

    for (const [method, urlPath] of [
      ["PUT", "/api/app-settings"],
      ["POST", "/api/runs"],
      ["POST", "/api/discovery"],
      ["PATCH", "/api/runs/00000000-0000-4000-8000-000000000001/notes"],
      ["DELETE", "/api/runs/00000000-0000-4000-8000-000000000001"],
    ] as const) {
      const refused = await send(method, urlPath, json, "{}");
      assert.equal(refused.status, 401, `${method} ${urlPath}`);
    }
    assert.deepEqual(await snapshot(directory), before);

    const forgedHost = await send("PUT", "/api/app-settings", {
      ...bearer,
      host: "evil.example:4311",
    }, "{}");
    assert.equal(forgedHost.status, 403);
    const forgedOrigin = await send("PUT", "/api/app-settings", {
      ...bearer,
      origin: "https://evil.example",
    }, "{}");
    assert.equal(forgedOrigin.status, 403);
    assert.equal(forgedOrigin.allowOrigin, undefined);
    const plain = await send("PUT", "/api/app-settings", {
      ...bearer,
      "content-type": "text/plain",
    }, "{}");
    assert.equal(plain.status, 415);
    assert.deepEqual(await snapshot(directory), before);

    const header = await send("GET", "/api/app-settings", {
      ...local,
      "x-bell-token": token,
    });
    assert.equal(header.status, 200);
    const saved = await send("PUT", "/api/app-settings", bearer, JSON.stringify({ locale: "zh-TW" }));
    assert.equal(saved.status, 200);
    assert.match((await snapshot(directory))["app-settings.json"] ?? "", /zh-TW/);

    const rotated = await rotateApiToken(file);
    const rotatedProof = await send("GET", `/api/health?challenge=${nonce}`, local);
    assert.equal(JSON.parse(rotatedProof.body).proof, apiListenerProof(rotated, nonce, "127.0.0.1", address.port));
    assert.notEqual(JSON.parse(rotatedProof.body).proof, expectedProof);
    const stale = await send("GET", "/api/app-settings", bearer);
    assert.equal(stale.status, 401);
    const fresh = await send("GET", "/api/app-settings", {
      ...local,
      authorization: `Bearer ${rotated}`,
    });
    assert.equal(fresh.status, 200);

    const acceptedRun = await send("POST", "/api/runs", {
      ...json,
      authorization: `Bearer ${rotated}`,
    }, "{}");
    assert.equal(acceptedRun.status, 400);
    assert.equal(store.data.runs.length, 0);

    const leaked = `${token}\n${rotated}\n0000000000000000000000000000000000000000000000000000000000000000`;
    assert.equal((await textExceptToken(directory)).includes(token), false, leaked);
    let doctor = "";
    await withLocale("en", () =>
      runDoctorCli(["--json"], {
        dataDir: directory,
        stdout: { write: (chunk: string) => (doctor += chunk) },
        exec: async () => {
          throw Object.assign(new Error("missing"), { cause: { code: "ENOENT" } });
        },
      }),
    );
    assert.equal(doctor.includes(token), false);
    assert.equal(doctor.includes(rotated), false);
    assert.match(doctor, /"checks"/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the server listens on 127.0.0.1 unless --host says otherwise, and warns then", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-api-bind-"));
  const port = await freePort();
  const lines: string[] = [];
  const running = await startServer({
    config: resolveConfig({ port, dataDir: directory }, {}),
    handleExit: false,
    print: (line) => lines.push(line),
  });
  try {
    const address = running.server.address() as AddressInfo;
    assert.equal(address.address, "127.0.0.1");
    assert.equal(resolveConfig({}, {}).host, "127.0.0.1");
    assert.equal(lines.some((line) => line.includes("explicit setting")), false);
    const token = readApiToken(dataPaths(directory).apiToken);
    assert.match(token ?? "", tokenPattern);
    assert.equal(lines.some((line) => token !== undefined && line.includes(token)), false);
    assert.equal((await stat(dataPaths(directory).apiToken)).mode & 0o777, 0o600);
    const session = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ remember: false }),
    });
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), { remembered: false });
    assert.match(session.headers.get("set-cookie") ?? "", new RegExp(`bellpr-session-${port}=.*; HttpOnly`));
  } finally {
    await running.shutdown();
  }

  const exposedDir = await mkdtemp(path.join(tmpdir(), "bell-api-exposed-"));
  const exposedPort = await freePort();
  const exposed: string[] = [];
  const wide = await startServer({
    config: resolveConfig({ port: exposedPort, host: "0.0.0.0", dataDir: exposedDir }, {}),
    handleExit: false,
    print: (line) => exposed.push(line),
  });
  try {
    assert.equal((wide.server.address() as AddressInfo).address, "0.0.0.0");
    assert.ok(exposed.some((line) => line.includes("0.0.0.0")));
    const token = readApiToken(dataPaths(exposedDir).apiToken)!;
    assert.equal(exposed.some((line) => line.includes(token)), false);
  } finally {
    await wide.shutdown();
    await rm(directory, { recursive: true, force: true });
    await rm(exposedDir, { recursive: true, force: true });
  }
});

test("bell-pr token rotate replaces the file and does not print the token", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-api-rotate-"));
  const { main } = await import("./cli.js");
  try {
    const file = dataPaths(directory).apiToken;
    const first = await loadOrCreateApiToken(file);
    let stdout = "";
    const code = await withLocale("en", () =>
      main(["token", "rotate", "--data-dir", directory], {
        stdout: { write: (chunk: string) => (stdout += chunk) },
        stderr: { write: () => undefined },
      }),
    );
    assert.equal(code, 0);
    const next = readApiToken(file);
    assert.match(next ?? "", tokenPattern);
    assert.notEqual(next, first);
    assert.equal(stdout.includes(first), false);
    assert.equal(stdout.includes(next!), false);
    assert.match(stdout, /Replaced the API token/);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
