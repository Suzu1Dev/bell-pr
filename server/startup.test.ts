import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { baseUrl, resolveConfig, ConfigError, defaultStaticDir } from "./config.js";
import { createApp } from "./app.js";
import { version } from "./build-info.js";
import { startServer, StartupError } from "./index.js";
import { withLocale } from "./i18n/index.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";

const repoRoot = path.resolve(import.meta.dirname, "..");

/** A port the OS reports free on 127.0.0.1, released before it is returned. */
async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/**
 * A temp dir with a data dir, a built-UI stand-in and fake agent CLIs that
 * fail, so nothing can reach a real codex, claude or gh.
 */
async function sandbox() {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-pr-startup-"));
  const bin = path.join(directory, "bin");
  const ui = path.join(directory, "ui");
  mkdirSync(bin);
  mkdirSync(path.join(ui, "assets"), { recursive: true });
  for (const name of ["codex", "claude", "gh"])
    writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  writeFileSync(path.join(ui, "index.html"), "<!doctype html><title>ui</title>");
  writeFileSync(path.join(ui, "assets", "app-1234.js"), "console.log(1);\n");
  return {
    directory,
    data: path.join(directory, "data"),
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      BELLPR_LOCALE: "en",
      BELLPR_NO_OPEN: "1",
      BELLPR_STATIC_DIR: ui,
      BELLPR_DATA_DIR: "",
      BELLPR_PORT: "",
      BELLPR_HOST: "",
      BELLPR_DEV: "",
      BELLPR_PUBLIC_URL: "",
      BELLPR_ALLOWED_ORIGINS: "",
    } as NodeJS.ProcessEnv,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

interface Launched {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

/** Runs a BELL PR entry file under tsx with `args`. */
function launch(entry: string, args: string[], env: NodeJS.ProcessEnv): Launched {
  const child = spawn(process.execPath, ["--import", "tsx", entry, ...args], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout!.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr!.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  return { child, stdout: () => stdout, stderr: () => stderr, exited };
}

/** Waits until the process printed its startup line, or fails with its output. */
async function started(launched: Launched, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let exited = false;
  void launched.exited.then(() => (exited = true));
  while (!/→ http/.test(launched.stdout())) {
    if (exited || Date.now() > deadline)
      assert.fail(
        `BELL PR did not start.\nstdout: ${launched.stdout()}\nstderr: ${launched.stderr()}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function stop(launched: Launched) {
  if (launched.child.exitCode === null && launched.child.signalCode === null)
    launched.child.kill("SIGTERM");
  return launched.exited;
}

function get(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      const req = request(url, { headers }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, body }),
        );
      });
      req.on("error", reject);
      req.end();
    },
  );
}

const cliEntry = path.join(repoRoot, "server", "cli.ts");

/** The umask, read without the deprecated no-argument call. */
function currentUmask() {
  const mask = process.umask(0o022);
  process.umask(mask);
  return mask;
}

test("resolveConfig applies flags over BELLPR_* variables over defaults", () => {
  const home = path.join(tmpdir(), "bell-pr-config-home");
  const defaults = resolveConfig({}, {}, home);
  assert.equal(defaults.port, 4311);
  assert.equal(defaults.host, "127.0.0.1");
  assert.equal(defaults.dev, false);
  assert.equal(defaults.frontendPort, undefined);
  assert.equal(defaults.open, true);
  assert.equal(defaults.publicUrl, undefined);
  assert.deepEqual(defaults.allowedOrigins, []);
  assert.match(defaults.dataDir, /[\\/]\.bellpr$/);
  assert.equal(path.isAbsolute(defaults.dataDir), true);
  // The UI is found next to the server code, wherever BELL PR is started.
  assert.equal(defaultStaticDir(), path.join(repoRoot, "dist") + path.sep);
  assert.equal(defaults.staticDir, defaultStaticDir());
  assert.deepEqual(defaults.limits, {
    maxAgentProcesses: 3,
    maxActiveRuns: 2,
    agentTimeoutScale: 1,
  });

  const env = {
    BELLPR_PORT: "5000",
    BELLPR_HOST: "0.0.0.0",
    BELLPR_DATA_DIR: "relative/data",
    BELLPR_MAX_AGENT_PROCESSES: "5",
    BELLPR_STATIC_DIR: "ui",
  };
  const fromEnv = resolveConfig({}, env, home);
  assert.equal(fromEnv.port, 5000);
  assert.equal(fromEnv.host, "0.0.0.0");
  assert.equal(fromEnv.dataDir, path.join(home, "relative", "data"));
  assert.equal(fromEnv.staticDir, path.join(home, "ui"));
  assert.equal(fromEnv.limits.maxAgentProcesses, 5);

  const fromFlags = resolveConfig(
    { port: "6000", host: "[::1]", dataDir: "/srv/bell", open: false },
    env,
    home,
  );
  assert.equal(fromFlags.port, 6000);
  assert.equal(fromFlags.host, "::1");
  assert.equal(fromFlags.dataDir, path.resolve("/srv/bell"));
  assert.equal(fromFlags.open, false);
});

test("resolveConfig refuses settings that cannot work, in the request locale", () => {
  withLocale("en", () => {
    for (const [flags, env, pattern] of [
      [{ port: "80" }, {}, /--port must be a whole number from 1024 to 65535/],
      [{ port: "4311x" }, {}, /--port/],
      [{}, { BELLPR_PORT: "70000" }, /BELLPR_PORT/],
      [{ host: "bad host" }, {}, /--host/],
      [{ dev: true, host: "0.0.0.0" }, {}, /Development mode turns sign-in off/],
      [{}, { BELLPR_DEV: "1", BELLPR_HOST: "192.168.1.5" }, /Development mode/],
      // Another address needs the public URL, or the guard refuses every request.
      [{ host: "192.168.1.5" }, {}, /To listen on 192\.168\.1\.5, set BELLPR_PUBLIC_URL/],
      [{}, { BELLPR_HOST: "bell.lan" }, /BELLPR_PUBLIC_URL/],
      [{}, { BELLPR_PUBLIC_URL: "https://bell.example.com/sub" }, /BELLPR_PUBLIC_URL/],
      [{}, { BELLPR_PUBLIC_URL: "ftp://bell.example.com" }, /BELLPR_PUBLIC_URL/],
      [{}, { BELLPR_PUBLIC_URL: "https://user:pw@bell.example.com" }, /BELLPR_PUBLIC_URL/],
      [{}, { BELLPR_PUBLIC_URL: "not a url" }, /BELLPR_PUBLIC_URL/],
      // Plain http only for this computer.
      [{}, { BELLPR_PUBLIC_URL: "http://bell.example.com" }, /https for any address other than this computer/],
      [{}, { BELLPR_PUBLIC_URL: "http://192.168.1.5:4311" }, /BELLPR_PUBLIC_URL/],
      [{}, { BELLPR_ALLOWED_ORIGINS: "https://*.example.com" }, /BELLPR_ALLOWED_ORIGINS/],
      [{}, { BELLPR_MAX_ACTIVE_RUNS: "0" }, /BELLPR_MAX_ACTIVE_RUNS/],
    ] as const) {
      assert.throws(
        () => resolveConfig(flags, env),
        (error: unknown) => error instanceof ConfigError && pattern.test(error.message),
        JSON.stringify({ flags, env }),
      );
    }
  });
});

test("an invalid BELLPR_ALLOWED_ORIGINS is reported in the CLI's language", () => {
  withLocale("zh-TW", () =>
    assert.throws(
      () => resolveConfig({}, { BELLPR_ALLOWED_ORIGINS: "https://*.example.com" }),
      (error: unknown) =>
        error instanceof ConfigError && /^BELLPR_ALLOWED_ORIGINS 必須/.test(error.message),
    ),
  );
});

test("resolveConfig adds the public origin, trusts the dev port only in dev and never opens a browser in CI", () => {
  const config = resolveConfig(
    {},
    {
      BELLPR_PUBLIC_URL: "https://bell.example.com/",
      BELLPR_ALLOWED_ORIGINS: "https://proxy.example.com,https://bell.example.com",
    },
  );
  assert.equal(config.publicUrl, "https://bell.example.com");
  assert.deepEqual(config.allowedOrigins, [
    "https://proxy.example.com",
    "https://bell.example.com",
  ]);
  // A published port on this computer, as in Docker, may use http.
  for (const local of ["http://localhost:4311", "http://127.0.0.1:4535", "http://[::1]:8080"])
    assert.equal(resolveConfig({}, { BELLPR_PUBLIC_URL: local }).publicUrl, local);
  const dev = resolveConfig({ dev: true }, { BELLPR_FRONTEND_PORT: "4400" });
  assert.equal(dev.dev, true);
  assert.equal(dev.frontendPort, 4400);
  assert.equal(dev.open, false);
  assert.equal(resolveConfig({}, { BELLPR_DEV: "1" }).dev, true);
  assert.equal(resolveConfig({}, { BELLPR_DEV: "0" }).dev, false);
  assert.equal(resolveConfig({}, { BELLPR_NO_OPEN: "1" }).open, false);
  assert.equal(resolveConfig({}, { CI: "true" }).open, false);
  assert.equal(resolveConfig({}, { CI: "false" }).open, true);
});

test("resolveConfig prints links for the address BELL PR listens on", () => {
  const url = (host: string) => baseUrl(resolveConfig({ host, port: 5000 }, {}));
  assert.equal(url("127.0.0.1"), "http://127.0.0.1:5000");
  assert.equal(url("0.0.0.0"), "http://127.0.0.1:5000");
  assert.equal(url("::"), "http://127.0.0.1:5000");
  // A server on ::1 or localhost may not listen on 127.0.0.1.
  assert.equal(url("::1"), "http://[::1]:5000");
  assert.equal(url("[::1]"), "http://[::1]:5000");
  assert.equal(url("LocalHost"), "http://localhost:5000");
  assert.equal(
    baseUrl(
      resolveConfig(
        { host: "192.168.1.5", port: 5000 },
        { BELLPR_PUBLIC_URL: "https://bell.example.com" },
      ),
    ),
    "https://bell.example.com",
  );
  // The guard trusts localhost, 127.0.0.1 and [::1] by name; another
  // loopback address becomes an allowed origin.
  assert.deepEqual(resolveConfig({ host: "::1", port: 5000 }, {}).allowedOrigins, []);
  assert.deepEqual(resolveConfig({ host: "127.0.0.2", port: 5000 }, {}).allowedOrigins, [
    "http://127.0.0.2:5000",
  ]);
});

test("resolveConfig points at data in ./.bellpr without moving it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-pr-legacy-"));
  try {
    assert.equal(resolveConfig({}, {}, directory).legacyDataDir, undefined);
    mkdirSync(path.join(directory, ".bellpr"));
    writeFileSync(path.join(directory, ".bellpr", "state.json"), "{}");
    const config = resolveConfig({ dataDir: path.join(directory, "new") }, {}, directory);
    assert.equal(config.legacyDataDir, path.join(directory, ".bellpr"));
    // Using the old folder on purpose needs no hint.
    assert.equal(
      resolveConfig({ dataDir: "./.bellpr" }, {}, directory).legacyDataDir,
      undefined,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("startServer serves the app with an in-memory session token, takes the lock and releases it", async () => {
  const box = await sandbox();
  const port = await freePort();
  const lines: string[] = [];
  const opened: string[] = [];
  const previousUmask = currentUmask();
  try {
    mkdirSync(path.join(box.directory, "cwd", ".bellpr"), { recursive: true });
    writeFileSync(path.join(box.directory, "cwd", ".bellpr", "state.json"), "{}");
    const config = resolveConfig(
      { port, dataDir: box.data },
      { ...box.env, BELLPR_NO_OPEN: "", CI: "" },
      path.join(box.directory, "cwd"),
    );
    const running = await withLocale("en", () =>
      startServer({
        config,
        handleExit: false,
        print: (line) => lines.push(line),
        openBrowser: (url) => opened.push(url),
      }),
    );
    try {
      // Run from source, the version comes from package.json.
      assert.equal(
        version,
        JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version,
      );
      assert.equal(running.url, `http://127.0.0.1:${port}`);
      const token = new URL(running.signInUrl).searchParams.get("t")!;
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(new URL(running.signInUrl).pathname, "/auth");
      assert.ok(lines.some((line) => line.endsWith(`→ ${running.signInUrl}`)), lines.join("\n"));
      assert.ok(lines.some((line) => line.startsWith(`BELL PR ${version} → `)), lines.join("\n"));
      // The old ./.bellpr only gets a hint.
      assert.ok(lines.some((line) => line.includes("bell-pr start --data-dir ./.bellpr")));
      assert.deepEqual(opened, [running.signInUrl]);
      // The token exists in memory only.
      assert.ok(!JSON.stringify(process.env).includes(token));
      assert.ok(!process.argv.join(" ").includes(token));
      assert.ok(!readFileSync(path.join(box.data, "bellpr.lock"), "utf8").includes(token));
      assert.ok(!readFileSync(path.join(box.data, "state.json"), "utf8").includes(token));

      const lock = JSON.parse(readFileSync(path.join(box.data, "bellpr.lock"), "utf8"));
      assert.equal(lock.pid, process.pid);
      assert.equal(lock.port, port);
      assert.equal(lock.version, version);
      assert.equal(statSync(path.join(box.data, "bellpr.lock")).mode & 0o777, 0o600);
      assert.equal(statSync(path.join(box.data, "state.json")).mode & 0o777, 0o600);
      assert.equal(statSync(box.data).mode & 0o777, 0o700);

      const health = await get(`http://127.0.0.1:${port}/api/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(JSON.parse(health.body), { name: "bell-pr", version });
      // Without a session the app answers the sign-in page; the printed link signs in.
      assert.equal((await get(`http://127.0.0.1:${port}/`)).status, 401);
      const signIn = await get(running.signInUrl);
      assert.equal(signIn.status, 200);
      const cookie = (signIn.headers["set-cookie"] as string[])[0].split(";")[0];
      const page = await get(`http://127.0.0.1:${port}/`, { cookie });
      assert.equal(page.status, 200);
      assert.match(String(page.headers["content-type"]), /text\/html/);

      // A second start in this process sees the lock it holds.
      const otherPort = await freePort();
      await assert.rejects(
        withLocale("en", () =>
          startServer({
            config: { ...config, port: otherPort },
            handleExit: false,
            print: () => {},
          }),
        ),
        (error: unknown) =>
          error instanceof StartupError && /already running with the data directory/.test(error.message),
      );
      assert.equal(JSON.parse(readFileSync(path.join(box.data, "bellpr.lock"), "utf8")).pid, process.pid);
    } finally {
      await running.shutdown();
    }
    assert.equal(existsSync(path.join(box.data, "bellpr.lock")), false);
    assert.equal(currentUmask(), previousUmask);
    await assert.rejects(get(`http://127.0.0.1:${port}/api/health`));
  } finally {
    await box.cleanup();
  }
});

test("startServer replaces a stale lock left by a process that is gone", async () => {
  const box = await sandbox();
  try {
    // A pid that existed and exited.
    const gone = spawn(process.execPath, ["-e", ""]);
    await once(gone, "exit");
    mkdirSync(box.data, { recursive: true });
    writeFileSync(
      path.join(box.data, "bellpr.lock"),
      JSON.stringify({ pid: gone.pid, port: 1234, version: "0.9.0" }),
    );
    const running = await startServer({
      config: resolveConfig({ port: await freePort(), dataDir: box.data }, box.env),
      handleExit: false,
      print: () => {},
    });
    try {
      assert.equal(
        JSON.parse(readFileSync(path.join(box.data, "bellpr.lock"), "utf8")).pid,
        process.pid,
      );
    } finally {
      await running.shutdown();
    }
    // A lock with this process's pid that it does not hold is from an
    // earlier process with the same pid, such as a restarted container.
    writeFileSync(
      path.join(box.data, "bellpr.lock"),
      JSON.stringify({ pid: process.pid, port: 1234, version: "0.9.0" }),
    );
    const again = await startServer({
      config: resolveConfig({ port: await freePort(), dataDir: box.data }, box.env),
      handleExit: false,
      print: () => {},
    });
    await again.shutdown();
  } finally {
    await box.cleanup();
  }
});

test("createApp trusts the dev server port only in dev, adds the public origin and trusts a local proxy", async () => {
  const box = await sandbox();
  const store = new Store(box.data);
  await store.initialize();
  const workbench = new Workbench(store);
  const apps: Array<ReturnType<typeof createApp>> = [];
  const serve = async (options: Parameters<typeof createApp>[1]) => {
    const app = createApp(workbench, options);
    apps.push(app);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    return { server, port: (server.address() as AddressInfo).port };
  };
  const servers: Array<Awaited<ReturnType<typeof serve>>> = [];
  try {
    const production = await serve({ staticDirectory: box.env.BELLPR_STATIC_DIR });
    const dev = await serve({ staticDirectory: box.env.BELLPR_STATIC_DIR, dev: true });
    const proxied = await serve({
      staticDirectory: box.env.BELLPR_STATIC_DIR,
      publicUrl: "https://bell.example.com",
    });
    servers.push(production, dev, proxied);
    const health = (target: { port: number }, headers: Record<string, string>) =>
      get(`http://127.0.0.1:${target.port}/api/health`, headers).then((r) => r.status);
    assert.equal(await health(production, { host: "127.0.0.1:4311" }), 200);
    assert.equal(await health(production, { host: "localhost:4310" }), 403);
    assert.equal(
      await health(production, { host: "127.0.0.1:4311", origin: "http://localhost:4310" }),
      403,
    );
    assert.equal(await health(dev, { host: "localhost:4310" }), 200);
    assert.equal(
      await health(dev, { host: "127.0.0.1:4311", origin: "http://localhost:4310" }),
      200,
    );
    assert.equal(
      await health(proxied, { host: "bell.example.com", origin: "https://bell.example.com" }),
      200,
    );
    assert.equal(await health(production, { host: "bell.example.com" }), 403);
    for (const app of apps) assert.equal(app.get("trust proxy fn")("127.0.0.1", 0), true);
    assert.equal(apps[0].get("trust proxy fn")("203.0.113.9", 0), false);
  } finally {
    for (const { server } of servers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    for (const app of apps) {
      await app.locals.insights.shutdown();
      await app.locals.discovery.shutdown();
    }
    await workbench.shutdown();
    await box.cleanup();
  }
});

test("createApp revalidates the page, caches hashed assets for good and explains a missing UI build", async () => {
  const box = await sandbox();
  const store = new Store(box.data);
  await store.initialize();
  const workbench = new Workbench(store);
  const built = createApp(workbench, { staticDirectory: box.env.BELLPR_STATIC_DIR });
  const missing = createApp(workbench, {
    staticDirectory: path.join(box.directory, "not-built"),
  });
  const servers = [built.listen(0, "127.0.0.1"), missing.listen(0, "127.0.0.1")];
  await Promise.all(servers.map((server) => once(server, "listening")));
  const [builtPort, missingPort] = servers.map(
    (server) => (server.address() as AddressInfo).port,
  );
  const local = { host: "127.0.0.1:4311" };
  try {
    for (const route of ["/", "/settings/general", "/index.html"]) {
      const page = await get(`http://127.0.0.1:${builtPort}${route}`, local);
      assert.equal(page.status, 200, route);
      assert.equal(page.headers["cache-control"], "no-cache", route);
      assert.match(page.body, /<title>ui<\/title>/);
    }
    const asset = await get(`http://127.0.0.1:${builtPort}/assets/app-1234.js`, local);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers["cache-control"], "public, max-age=31536000, immutable");
    const gone = await get(`http://127.0.0.1:${builtPort}/assets/app-0000.js`, local);
    assert.equal(gone.status, 404);

    const page = await get(`http://127.0.0.1:${missingPort}/`, {
      ...local,
      "x-bell-locale": "en",
    });
    assert.equal(page.status, 503);
    assert.match(String(page.headers["content-type"]), /text\/html/);
    assert.match(page.body, /<html lang="en">/);
    assert.match(page.body, /web interface is not built/);
    // The API keeps working without the UI.
    const health = await get(`http://127.0.0.1:${missingPort}/api/health`, local);
    assert.equal(health.status, 200);
  } finally {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    for (const app of [built, missing]) {
      await app.locals.insights.shutdown();
      await app.locals.discovery.shutdown();
    }
    await workbench.shutdown();
    await box.cleanup();
  }
});

test("a symlinked bin entry starts the server", async () => {
  const box = await sandbox();
  const port = await freePort();
  // npm links bin names to the entry file; the entry guard must follow the link.
  const link = path.join(box.directory, "bin", "bell-pr");
  symlinkSync(cliEntry, link);
  const server = launch(link, ["start", "--port", String(port), "--data-dir", box.data], box.env);
  try {
    await started(server);
    assert.ok(
      server.stdout().includes(`BELL PR ${version} → http://127.0.0.1:${port}/auth?t=`),
      server.stdout(),
    );
    const health = await get(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).name, "bell-pr");
  } finally {
    const { code } = await stop(server);
    assert.equal(code, 0, server.stderr());
    await box.cleanup();
  }
});

test("a second instance on the same data dir exits 1 and leaves state.json byte-identical", async () => {
  const box = await sandbox();
  const first = launch(
    cliEntry,
    ["start", "--port", String(await freePort()), "--data-dir", box.data],
    box.env,
  );
  try {
    await started(first);
    // A run the first instance would have marked failed if it loaded now.
    const statePath = path.join(box.data, "state.json");
    const fixture = JSON.parse(readFileSync(statePath, "utf8"));
    fixture.runs = [{ id: "run-1", status: "running", agents: [], publishing: false }];
    writeFileSync(statePath, JSON.stringify(fixture, null, 2));
    const before = readFileSync(statePath);
    const mtime = statSync(statePath).mtimeMs;

    const second = launch(
      cliEntry,
      ["start", "--port", String(await freePort()), "--data-dir", box.data],
      box.env,
    );
    const { code } = await second.exited;
    assert.equal(code, 1, second.stdout() + second.stderr());
    assert.match(second.stderr(), /already running with the data directory/);
    assert.match(second.stderr(), /bell-pr open/);
    assert.deepEqual(readFileSync(statePath), before);
    assert.equal(statSync(statePath).mtimeMs, mtime);
    assert.equal(
      JSON.parse(readFileSync(path.join(box.data, "bellpr.lock"), "utf8")).pid,
      first.child.pid,
    );
  } finally {
    await stop(first);
    await box.cleanup();
  }
});

test("an occupied port exits non-zero and points to bell-pr open, never to a bare URL", async () => {
  const box = await sandbox();
  const port = await freePort();
  const first = launch(cliEntry, ["start", "--port", String(port), "--data-dir", box.data], box.env);
  const other = createServer();
  try {
    await started(first);
    const otherData = path.join(box.directory, "other-data");
    const second = launch(
      cliEntry,
      ["start", "--port", String(port), "--data-dir", otherData],
      box.env,
    );
    const { code } = await second.exited;
    assert.notEqual(code, 0);
    const output = second.stdout() + second.stderr();
    assert.match(output, /BELL PR is already running at http:\/\/127\.0\.0\.1:\d+\. Run `bell-pr open` to get a sign-in link; add --data-dir <dir> if that BELL PR was started with another data directory\./);
    assert.doesNotMatch(output, /auth\?t=/);
    assert.ok(
      !output.split("\n").some((line) => /^\s*https?:\/\/\S+\s*$/.test(line)),
      output,
    );
    // The port is checked before anything is written.
    assert.equal(existsSync(otherData), false);

    // Another program on the port: suggest a different one.
    other.listen(0, "127.0.0.1");
    await once(other, "listening");
    const busy = (other.address() as AddressInfo).port;
    const third = launch(
      cliEntry,
      ["start", "--port", String(busy), "--data-dir", otherData],
      box.env,
    );
    assert.notEqual((await third.exited).code, 0);
    assert.match(third.stderr(), new RegExp(`Port ${busy} is already in use by another program.*--port`));
    assert.equal(existsSync(otherData), false);
  } finally {
    other.close();
    await stop(first);
    await box.cleanup();
  }
});

test("SIGHUP and SIGTERM shut down cleanly and remove the lock file", async () => {
  const box = await sandbox();
  try {
    for (const signal of ["SIGHUP", "SIGTERM"] as const) {
      const server = launch(
        cliEntry,
        ["start", "--port", String(await freePort()), "--data-dir", box.data],
        box.env,
      );
      await started(server);
      const lock = path.join(box.data, "bellpr.lock");
      assert.equal(existsSync(lock), true);
      server.child.kill(signal);
      const { code } = await server.exited;
      assert.equal(code, 0, `${signal}: ${server.stderr()}`);
      assert.equal(existsSync(lock), false, signal);
    }
  } finally {
    await box.cleanup();
  }
});

test("server/index.ts started directly behaves like bell-pr start", async () => {
  const box = await sandbox();
  const port = await freePort();
  const server = launch(
    path.join(repoRoot, "server", "index.ts"),
    ["--port", String(port), "--data-dir", box.data],
    box.env,
  );
  try {
    await started(server);
    assert.equal((await get(`http://127.0.0.1:${port}/api/health`)).status, 200);
  } finally {
    assert.equal((await stop(server)).code, 0, server.stderr());
    await box.cleanup();
  }
});
