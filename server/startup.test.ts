import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs, {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir, uptime } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { baseUrl, resolveConfig, ConfigError, defaultStaticDir } from "./config.js";
import { createApp } from "./app.js";
import { version } from "./build-info.js";
import type { CollabHost } from "./collab-host.js";
import { acquireWriterLock, lockHolderRunning, startServer, StartupError } from "./index.js";
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
      [{ dev: true, host: "0.0.0.0" }, {}, /Development mode only listens on this computer/],
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

test("a wildcard host without BELLPR_PUBLIC_URL warns once that remotes get 403", async () => {
  const box = await sandbox();
  try {
    const warnings: string[] = [];
    const printed: string[] = [];
    await withLocale("en", async () => {
    for (const host of ["0.0.0.0", "::"] as const) {
      warnings.length = 0;
      printed.length = 0;
      const running = await startServer({
        config: resolveConfig(
          { host, port: String(await freePort()), dataDir: box.data },
          box.env,
        ),
        handleExit: false,
        print: (line) => printed.push(line),
        warn: (line) => warnings.push(line),
      });
      try {
        assert.equal(warnings.length, 1, host);
        assert.match(warnings[0]!, /BELLPR_PUBLIC_URL/);
        assert.match(warnings[0]!, /403/);
        assert.equal(
          printed.some((line) => /API token is still required/.test(line)),
          false,
          host,
        );
      } finally {
        await running.shutdown();
      }
    }
    });
    // With PUBLIC_URL set, keep the generic exposed-host line instead.
    warnings.length = 0;
    printed.length = 0;
    await withLocale("en", async () => {
      const withUrl = await startServer({
        config: resolveConfig(
          { host: "0.0.0.0", port: String(await freePort()), dataDir: box.data },
          { ...box.env, BELLPR_PUBLIC_URL: "https://bell.example.com" },
        ),
        handleExit: false,
        print: (line) => printed.push(line),
        warn: (line) => warnings.push(line),
      });
      try {
        assert.equal(warnings.length, 0);
        assert.equal(
          printed.some((line) => /listening on 0\.0\.0\.0/.test(line) && /API token/.test(line)),
          true,
          printed.join("\n"),
        );
      } finally {
        await withUrl.shutdown();
      }
    });
  } finally {
    await box.cleanup();
  }
});

test("an out-of-range limit is reported in the CLI's language", () => {
  withLocale("zh-TW", () => {
    for (const [env, expected] of [
      [{ BELLPR_MAX_AGENT_PROCESSES: "50" }, /^BELLPR_MAX_AGENT_PROCESSES 必須介於 1 到 32/],
      [{ BELLPR_MAX_ACTIVE_RUNS: "0" }, /^BELLPR_MAX_ACTIVE_RUNS 必須介於 1 到 8/],
      [{ BELLPR_AGENT_TIMEOUT_SCALE: "11" }, /^BELLPR_AGENT_TIMEOUT_SCALE 必須介於 0\.5 到 10/],
    ] as const)
      assert.throws(
        () => resolveConfig({}, env),
        (error: unknown) => error instanceof ConfigError && expected.test(error.message),
        JSON.stringify(env),
      );
  });
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

test("startServer serves the app, takes the lock and releases it", async () => {
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
      assert.ok(lines.some((line) => line.endsWith(`→ ${running.url}`)), lines.join("\n"));
      assert.ok(lines.some((line) => line.startsWith(`BELL PR ${version} → `)), lines.join("\n"));
      // The old ./.bellpr only gets a hint.
      assert.ok(lines.some((line) => line.includes("bell-pr start --data-dir ./.bellpr")));
      // The browser gets the token fragment; the printed line does not.
      const token = readFileSync(path.join(box.data, "api-token"), "utf8").trim();
      assert.deepEqual(opened, [`${running.url}#bell_token=${token}`]);
      assert.equal(lines.some((line) => line.includes(token)), false);
      assert.equal(statSync(path.join(box.data, "api-token")).mode & 0o777, 0o600);

      const lock = JSON.parse(readFileSync(path.join(box.data, "bellpr.lock"), "utf8"));
      assert.equal(lock.pid, process.pid);
      assert.equal(lock.port, port);
      assert.equal(lock.url, running.url);
      assert.equal(lock.version, version);
      assert.ok(lock.uptime > 0 && lock.uptime <= uptime(), String(lock.uptime));
      assert.equal(statSync(path.join(box.data, "bellpr.lock")).mode & 0o777, 0o600);
      assert.equal(statSync(path.join(box.data, "state.json")).mode & 0o777, 0o600);
      assert.equal(statSync(box.data).mode & 0o777, 0o700);

      const health = await get(`http://127.0.0.1:${port}/api/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(JSON.parse(health.body), { name: "bell-pr", version });
      // The app answers without a sign-in.
      const page = await get(`http://127.0.0.1:${port}/`);
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

test("startServer words the recovery notes in the language saved in the app, not BELLPR_LOCALE", async () => {
  const box = await sandbox();
  const port = await freePort();
  const previousLocale = process.env.BELLPR_LOCALE;
  try {
    mkdirSync(box.data, { recursive: true });
    writeFileSync(path.join(box.data, "app-settings.json"), JSON.stringify({ locale: "en" }));
    // A run saved without a locale, interrupted while it ran.
    const worktreePath = path.join(box.data, "worktrees", "interrupted");
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(
      path.join(box.data, "state.json"),
      JSON.stringify({
        version: 1,
        repos: [],
        runs: [
          {
            id: "interrupted",
            repoId: "missing",
            title: "Interrupted",
            prompt: "Do it",
            status: "running",
            branch: "fix/interrupted",
            baseBranch: "main",
            baseSha: "0".repeat(40),
            worktreePath,
            createdAt: "2026-10-12T00:00:00.000Z",
            agents: [],
            logs: [],
            draft: { title: "", body: "" },
            reviewedFiles: [],
            reviewedFingerprints: {},
          },
        ],
      }),
    );
    process.env.BELLPR_LOCALE = "zh-TW";
    const config = resolveConfig({ port, dataDir: box.data }, box.env, box.directory);
    // No request locale: the server-wide default decides.
    const running = await startServer({ config, handleExit: false, print: () => {} });
    await running.shutdown();
    const [run] = JSON.parse(readFileSync(path.join(box.data, "state.json"), "utf8")).runs;
    assert.equal(run.status, "failed");
    assert.match(run.error, /^The service restarted, so the run stopped\./);
  } finally {
    if (previousLocale === undefined) delete process.env.BELLPR_LOCALE;
    else process.env.BELLPR_LOCALE = previousLocale;
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

/**
 * A lock written by BELL PR in another container on the same volume. The
 * same entrypoint got the same pid there, so this process's pid says
 * nothing about it.
 */
const otherContainer = "f00dcafe1234 pid:[4026532001]";

test("a lock from another PID namespace counts while its holder renews it, whatever its pid", async () => {
  const box = await sandbox();
  try {
    mkdirSync(box.data, { recursive: true });
    const file = path.join(box.data, "bellpr.lock");
    const gone = spawn(process.execPath, ["-e", ""]);
    await once(gone, "exit");
    for (const pid of [process.pid, gone.pid!]) {
      const lock = { pid, port: 4311, version, pidNamespace: otherContainer };
      writeFileSync(file, JSON.stringify(lock));
      assert.equal(lockHolderRunning(box.data, lock), true, String(pid));
      // Not renewed for longer than the lease: its holder is gone.
      const lapsed = new Date(Date.now() - 31_000);
      utimesSync(file, lapsed, lapsed);
      assert.equal(lockHolderRunning(box.data, lock), false, String(pid));
    }
  } finally {
    await box.cleanup();
  }
});

test("startServer waits for a lock from another PID namespace to lapse before it takes over", async () => {
  const box = await sandbox();
  try {
    mkdirSync(box.data, { recursive: true });
    const file = path.join(box.data, "bellpr.lock");
    writeFileSync(
      file,
      JSON.stringify({ pid: process.pid, port: 4311, version: "1.0.0", pidNamespace: otherContainer }),
    );
    // Last renewed 28.5 seconds ago, as by a container that was just removed.
    const renewed = new Date(Date.now() - 28_500);
    utimesSync(file, renewed, renewed);
    const begun = Date.now();
    const running = await startServer({
      config: resolveConfig({ port: await freePort(), dataDir: box.data }, box.env),
      handleExit: false,
      print: () => {},
    });
    try {
      assert.ok(Date.now() - begun >= 1000, `took over after ${Date.now() - begun} ms`);
      const lock = JSON.parse(readFileSync(file, "utf8"));
      assert.equal(lock.pid, process.pid);
      assert.notEqual(lock.pidNamespace, otherContainer);
    } finally {
      await running.shutdown();
    }
  } finally {
    await box.cleanup();
  }
});

test("the running instance renews its lock and leaves one that another PID namespace took", async (t) => {
  const box = await sandbox();
  t.mock.timers.enable({ apis: ["setInterval"] });
  try {
    const file = path.join(box.data, "bellpr.lock");
    const running = await startServer({
      config: resolveConfig({ port: await freePort(), dataDir: box.data }, box.env),
      handleExit: false,
      print: () => {},
    });
    try {
      const old = new Date(Date.now() - 60_000);
      utimesSync(file, old, old);
      t.mock.timers.tick(10_000);
      assert.ok(Date.now() - statSync(file).mtimeMs < 5000);
      // Another container took the data directory over meanwhile, with the
      // same pid in its own namespace.
      const lock = JSON.parse(readFileSync(file, "utf8"));
      writeFileSync(file, JSON.stringify({ ...lock, pidNamespace: otherContainer }));
    } finally {
      await running.shutdown();
    }
    assert.equal(JSON.parse(readFileSync(file, "utf8")).pidNamespace, otherContainer);
  } finally {
    await box.cleanup();
  }
});

/** A pid that existed and exited. */
async function gonePid() {
  const gone = spawn(process.execPath, ["-e", ""]);
  await once(gone, "exit");
  return gone.pid!;
}

/** What the data directory holds besides its lock: claims and temp files a start left. */
const lockLitter = (data: string) =>
  readdirSync(data).filter((name) => name.startsWith("bellpr.lock."));

/** A start refused without waiting for a lease, naming `names` (the lock, or its directory). */
async function refusedQuickly(start: Promise<unknown>, names: string) {
  const begun = Date.now();
  await assert.rejects(start, (error: unknown) => {
    assert.ok(error instanceof StartupError, String(error));
    assert.ok(error.message.includes(names), error.message);
    return true;
  });
  assert.ok(Date.now() - begun < 10_000, `refused after ${Date.now() - begun} ms`);
}

test("a strict lock from another PID namespace is never taken over, however long ago it was renewed", async () => {
  const box = await sandbox();
  try {
    mkdirSync(box.data, { recursive: true });
    const file = path.join(box.data, "bellpr.lock");
    for (const pid of [process.pid, await gonePid()]) {
      const lock = { pid, port: 0, version, pidNamespace: otherContainer, strict: true };
      const text = JSON.stringify(lock);
      writeFileSync(file, text);
      // Its holder was paused, or its clock is behind: not renewed for an hour.
      const old = new Date(Date.now() - 3_600_000);
      utimesSync(file, old, old);
      assert.equal(lockHolderRunning(box.data, lock), true, String(pid));
      // An ordinary start of this version honours it as well as coordination does.
      const config = resolveConfig({ port: await freePort(), dataDir: box.data }, box.env);
      await refusedQuickly(startServer({ config, handleExit: false, print: () => {} }), file);
      await refusedQuickly(acquireWriterLock(box.data), file);
      assert.equal(readFileSync(file, "utf8"), text);
      assert.deepEqual(lockLitter(box.data), []);
    }
  } finally {
    await box.cleanup();
  }
});

test("under the strict rule a lock whose holder cannot be shown to have stopped stays, though an ordinary start replaces it", async () => {
  const box = await sandbox();
  try {
    mkdirSync(box.data, { recursive: true });
    const file = path.join(box.data, "bellpr.lock");
    const lapsed = new Date(Date.now() - 31_000);
    const cases: Array<[string, string, Date?]> = [
      [
        "another namespace, not renewed for longer than the lease",
        JSON.stringify({ pid: process.pid, port: 4311, version, pidNamespace: otherContainer }),
        lapsed,
      ],
      ["unreadable", "{ not a lock"],
    ];
    // Elsewhere there is no namespace to tell an older build's lock apart.
    if (process.platform === "linux")
      cases.push([
        "an older build's, whose pid is gone",
        JSON.stringify({ pid: await gonePid(), port: 1234, version: "0.9.0" }),
      ]);
    for (const [name, text, renewed] of cases) {
      writeFileSync(file, text);
      if (renewed) utimesSync(file, renewed, renewed);
      await refusedQuickly(acquireWriterLock(box.data), file);
      assert.equal(readFileSync(file, "utf8"), text, name);
      assert.deepEqual(lockLitter(box.data), [], name);
      const running = await startServer({
        config: resolveConfig({ port: await freePort(), dataDir: box.data }, box.env),
        handleExit: false,
        print: () => {},
      });
      try {
        assert.equal(JSON.parse(readFileSync(file, "utf8")).pid, process.pid, name);
      } finally {
        await running.shutdown();
      }
    }
  } finally {
    await box.cleanup();
  }
});

test("a held lock is renewed only while it is still the one this start wrote", async (t) => {
  const box = await sandbox();
  try {
    mkdirSync(box.data, { recursive: true });
    const file = path.join(box.data, "bellpr.lock");
    const hourAgo = new Date(Date.now() - 3_600_000);
    const modified = () => statSync(file).mtimeMs;
    t.mock.timers.enable({ apis: ["setInterval"] });
    const lock = await acquireWriterLock(box.data);
    utimesSync(file, hourAgo, hourAgo);
    t.mock.timers.tick(10_000);
    assert.ok(modified() > hourAgo.getTime() + 60_000, "its own lock was renewed");
    // Another start's lock lies there now, as after a person removed this one.
    const theirs = JSON.stringify({ pid: await gonePid(), port: 0, version, pidNamespace: otherContainer });
    writeFileSync(file, theirs);
    utimesSync(file, hourAgo, hourAgo);
    t.mock.timers.tick(30_000);
    assert.ok(Math.abs(modified() - hourAgo.getTime()) < 1, "another start's lock was renewed");
    assert.equal(lock.holds(), false);
    lock.release();
    assert.equal(readFileSync(file, "utf8"), theirs);
  } finally {
    t.mock.timers.reset();
    await rm(box.directory, { recursive: true, force: true });
  }
});

test("a strict lock is replaced once its holder is shown to have stopped here, and refuses every start while held", async () => {
  const box = await sandbox();
  try {
    mkdirSync(box.data, { recursive: true });
    const file = path.join(box.data, "bellpr.lock");
    const held = await acquireWriterLock(box.data);
    const text = readFileSync(file, "utf8");
    assert.equal(JSON.parse(text).strict, true);
    // Held: neither a second coordination nor an ordinary start gets it.
    const config = resolveConfig({ port: await freePort(), dataDir: box.data }, box.env);
    await refusedQuickly(acquireWriterLock(box.data), box.data);
    await assert.rejects(startServer({ config, handleExit: false, print: () => {} }), StartupError);
    assert.equal(held.holds(), true);
    assert.equal(readFileSync(file, "utf8"), text);
    // Given up on purpose: the file goes with it.
    held.release();
    assert.equal(held.holds(), false);
    assert.equal(existsSync(file), false);
    // Left by a process here that is gone, as after a crash: both replace it.
    const crashed = JSON.stringify({ ...JSON.parse(text), pid: await gonePid() });
    writeFileSync(file, crashed);
    const again = await acquireWriterLock(box.data);
    assert.deepEqual(
      [JSON.parse(readFileSync(file, "utf8")).pid, again.holds()],
      [process.pid, true],
    );
    again.release();
    writeFileSync(file, crashed);
    const running = await startServer({
      config: resolveConfig({ port: await freePort(), dataDir: box.data }, box.env),
      handleExit: false,
      print: () => {},
    });
    try {
      const lock = JSON.parse(readFileSync(file, "utf8"));
      assert.deepEqual([lock.pid, lock.strict], [process.pid, undefined]);
    } finally {
      await running.shutdown();
    }
    assert.deepEqual(lockLitter(box.data), []);
  } finally {
    await box.cleanup();
  }
});

test("group work is on only with --group or BELLPR_GROUP", () => {
  const home = path.join(tmpdir(), "bell-pr-config-home");
  assert.equal(resolveConfig({ group: true }, {}, home).collab, true);
  assert.equal(resolveConfig({}, { BELLPR_GROUP: "1" }, home).collab, true);
  for (const [flags, env] of [
    [{}, {}],
    [{ group: false }, {}],
    [{}, { BELLPR_GROUP: "0" }],
    [{}, { BELLPR_GROUP: "" }],
  ] as const)
    assert.equal("collab" in resolveConfig(flags, env, home), false);
});

/** A start in this process, the install token's header, and the lock it wrote. */
async function startedHere(box: Awaited<ReturnType<typeof sandbox>>, group?: boolean) {
  const port = await freePort();
  const running = await startServer({
    config: resolveConfig({ port, dataDir: box.data, group }, box.env),
    handleExit: false,
    print: () => {},
  });
  const token = readFileSync(path.join(box.data, "api-token"), "utf8").trim();
  const lockText = readFileSync(path.join(box.data, "bellpr.lock"), "utf8");
  return {
    running,
    port,
    auth: { authorization: `Bearer ${token}` },
    lockText,
    lock: JSON.parse(lockText),
  };
}
const groupFiles = (data: string) =>
  ["collab.json", "coordination.json"].filter((name) => existsSync(path.join(data, name)));

test("without --group a start is as before: an ordinary lock, no collab in /api/status, no group route or file", async () => {
  const box = await sandbox();
  try {
    const { running, port, auth, lock } = await startedHere(box);
    try {
      assert.deepEqual([lock.port, lock.url, "strict" in lock], [port, running.url, false]);
      const status = await get(`${running.url}/api/status`, auth);
      assert.equal(status.status, 200);
      assert.equal("collab" in JSON.parse(status.body), false);
      // The group routes are not there: the answer of any path the API does not have.
      const absent = await get(`${running.url}/api/collab`, auth);
      const unknown = await get(`${running.url}/api/no-such-route`, auth);
      assert.equal(absent.status, 404);
      assert.equal(absent.body, unknown.body);
      assert.equal(running.app.locals.collab, undefined);
    } finally {
      await running.shutdown();
    }
    assert.deepEqual(groupFiles(box.data), []);
  } finally {
    await box.cleanup();
  }
});

test("with --group a start takes the strict lock under its real address, reports group work and refuses a second start", async () => {
  const box = await sandbox();
  try {
    const plain = await startedHere(box);
    await plain.running.shutdown();
    const { running, port, auth, lock, lockText } = await startedHere(box, true);
    try {
      // The ordinary lock and one field more, so `bell-pr open` still finds the instance.
      assert.deepEqual(Object.keys(lock), [...Object.keys(plain.lock), "strict"]);
      assert.deepEqual(
        [lock.pid, lock.port, lock.host, lock.url, lock.strict],
        [process.pid, port, "127.0.0.1", running.url, true],
      );
      const status = await get(`${running.url}/api/status`, auth);
      assert.deepEqual(JSON.parse(status.body).collab, { state: "notSetUp" });
      const info = await get(`${running.url}/api/collab`, auth);
      assert.deepEqual([info.status, JSON.parse(info.body)], [200, { state: "notSetUp", host: true }]);
      // Asking wrote nothing: the files come with setup.
      assert.deepEqual(groupFiles(box.data), []);

      // A second start on this data directory is refused, with group work or without.
      for (const group of [true, false])
        await assert.rejects(
          startServer({
            config: resolveConfig({ port: await freePort(), dataDir: box.data, group }, box.env),
            handleExit: false,
            print: () => {},
          }),
          StartupError,
        );
      assert.equal(readFileSync(path.join(box.data, "bellpr.lock"), "utf8"), lockText);
    } finally {
      await running.shutdown();
    }
    assert.equal(existsSync(path.join(box.data, "bellpr.lock")), false);
    assert.deepEqual(lockLitter(box.data), []);
  } finally {
    await box.cleanup();
  }
});

test("shutdown lets group work in flight land before the server closes and the lock goes", async () => {
  const box = await sandbox();
  try {
    const { running } = await startedHere(box, true);
    try {
      const collab = running.app.locals.collab as CollabHost;
      await collab.setUp();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const work = collab.run(async () => {
        await gate;
        return collab.coordinator().addParticipant("m-0000000001", "member");
      });
      let stopped = false;
      const stopping = running.shutdown().then(() => (stopped = true));
      await new Promise((resolve) => setTimeout(resolve, 200));
      // Still waiting for the work: the server has not closed and the lock is held.
      assert.deepEqual(
        [stopped, running.server.listening, existsSync(path.join(box.data, "bellpr.lock"))],
        [false, true, true],
      );
      assert.deepEqual(collab.status(), { state: "stopped", reason: "closed" });
      release();
      // The write needed the lock, so it landed before the lock went.
      const { id } = await work;
      await stopping;
      assert.equal(existsSync(path.join(box.data, "bellpr.lock")), false);
      assert.equal(running.server.listening, false);
      assert.ok(readFileSync(path.join(box.data, "coordination.json"), "utf8").includes(id));
      await assert.rejects(collab.run(async () => undefined));
    } finally {
      await running.shutdown();
    }
  } finally {
    await box.cleanup();
  }
});

test("a signal leaves the workbench its time to stop after group work that never lands", async () => {
  const box = await sandbox();
  const stoppedFile = path.join(box.directory, "workbench-stopped");
  // In the child, group work never settles and the workbench takes 2 seconds to stop.
  const script = `
    import { writeFileSync } from "node:fs";
    const [port, dataDir, stoppedFile] = process.argv.slice(1);
    const { startServer } = await import("./server/index.ts");
    const { Workbench } = await import("./server/workbench.ts");
    const shutdown = Workbench.prototype.shutdown;
    Workbench.prototype.shutdown = async function () {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await shutdown.call(this);
      writeFileSync(stoppedFile, "");
    };
    const { app } = await startServer({ flags: { port, dataDir, group: true }, print: () => {} });
    await app.locals.collab.setUp();
    void app.locals.collab.run(() => new Promise(() => {}));
    process.kill(process.pid, "SIGTERM");
  `;
  try {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script, String(await freePort()), box.data, stoppedFile],
      { cwd: repoRoot, env: box.env, stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const [code] = await once(child, "exit");
    assert.equal(code, 0, stderr);
    // Group work waited its 4 seconds; the hard exit still left the workbench its own.
    assert.equal(existsSync(stoppedFile), true);
    assert.equal(existsSync(path.join(box.data, "bellpr.lock")), false);
  } finally {
    await box.cleanup();
  }
});

test("a takeover claim left by a start that stopped is cleared; one whose start still runs keeps the stale lock", async () => {
  const box = await sandbox();
  // A live Node.js process stands in for a start that is removing the lock.
  const claimer = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    await once(claimer, "spawn");
    mkdirSync(box.data, { recursive: true });
    const file = path.join(box.data, "bellpr.lock");
    const probe = await acquireWriterLock(box.data);
    const here = JSON.parse(readFileSync(file, "utf8"));
    probe.release();
    const crashed = { ...here, pid: await gonePid() };
    const starts = {
      strict: async () => {
        const lock = await acquireWriterLock(box.data);
        return () => lock.release();
      },
      ordinary: async () => {
        const running = await startServer({
          config: resolveConfig({ port: await freePort(), dataDir: box.data }, box.env),
          handleExit: false,
          print: () => {},
        });
        return () => running.shutdown();
      },
    };
    for (const [name, start] of Object.entries(starts)) {
      // A crashed holder's lock, strict or not, that another start was removing.
      const stale = JSON.stringify(name === "strict" ? crashed : { ...crashed, strict: undefined });
      const claim = `${file}.takeover-${createHash("sha256").update(stale).digest("hex").slice(0, 16)}`;
      writeFileSync(file, stale);
      writeFileSync(claim, JSON.stringify({ ...here, port: 0, pid: claimer.pid }));
      await assert.rejects(start(), StartupError);
      assert.equal(readFileSync(file, "utf8"), stale, name);
      assert.ok(existsSync(claim), name);
      // That start crashed too.
      writeFileSync(claim, JSON.stringify({ ...here, port: 0, pid: await gonePid() }));
      const stop = await start();
      try {
        assert.equal(JSON.parse(readFileSync(file, "utf8")).pid, process.pid, name);
        assert.deepEqual(lockLitter(box.data), [], name);
      } finally {
        await stop();
      }
    }
  } finally {
    claimer.kill("SIGKILL");
    await box.cleanup();
  }
});

/** The takeover claim file of the lock at `file` that reads `text`. */
const claimFile = (file: string, text: string) =>
  `${file}.takeover-${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;

/** A start on the box's data directory under each rule; each resolves to what stops it. */
const lockStarts = (box: { data: string; env: NodeJS.ProcessEnv }) => ({
  strict: async () => {
    const lock = await acquireWriterLock(box.data);
    return () => lock.release();
  },
  ordinary: async () => {
    const running = await startServer({
      config: resolveConfig({ port: await freePort(), dataDir: box.data }, box.env),
      handleExit: false,
      print: () => {},
    });
    return () => running.shutdown();
  },
});

/** The message a start is refused with; a start that goes through is stopped and fails. */
async function refusedWith(start: () => Promise<() => unknown>) {
  let stop: () => unknown;
  try {
    stop = await start();
  } catch (error) {
    assert.ok(error instanceof StartupError, String(error));
    return error.message;
  }
  await stop();
  return assert.fail("the start was not refused");
}

/** A refusal that names a process that does not exist. */
const processZero = /(process|行程) 0\b/;

test("an ordinary start clears a takeover claim that names no start once it is older than the lease; one that names a running process stays, and the refusal names it", async () => {
  const box = await sandbox();
  // A live Node.js process: a start suspended before it removed the lock, or a
  // program that got the pid of one that crashed. Nothing here tells them apart.
  const claimer = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    await once(claimer, "spawn");
    mkdirSync(box.data, { recursive: true });
    const file = path.join(box.data, "bellpr.lock");
    const starts = lockStarts(box);
    const probe = await acquireWriterLock(box.data);
    const here = { ...JSON.parse(readFileSync(file, "utf8")), strict: undefined };
    probe.release();
    const gone = await gonePid();
    const stale = JSON.stringify({ ...here, pid: gone });
    const claim = claimFile(file, stale);
    const leave = (text: string, written: number) => {
      writeFileSync(file, stale);
      writeFileSync(claim, text);
      utimesSync(claim, new Date(written), new Date(written));
    };
    const stays = async (name: string, text: string, written: number) => {
      leave(text, written);
      const message = await refusedWith(starts.ordinary);
      assert.ok(message.includes(claim), `${name}: ${message}`);
      assert.doesNotMatch(message, new RegExp(`\\b${gone}\\b`), name);
      assert.equal(readFileSync(file, "utf8"), stale, name);
      assert.equal(readFileSync(claim, "utf8"), text, name);
    };
    const lapsed = Date.now() - 31_000;
    // Resumed, a suspended start would remove the lock taken since: age shows nothing.
    const running = JSON.stringify({ ...here, pid: claimer.pid, strict: false });
    await stays("a running process, just now", running, Date.now());
    await stays("a running process, a lease ago", running, lapsed);
    await stays("a running process, an hour ago", running, Date.now() - 3_600_000);
    // Power was lost before the claim's text reached the disk: it names no start.
    await stays("nothing, just now", "", Date.now());
    // Dated an hour ahead: the clock was stepped back since.
    await stays("nothing, dated ahead", "", Date.now() + 3_600_000);
    // A takeover lasts milliseconds: a lease later, that start has stopped.
    leave("", lapsed);
    const stop = await starts.ordinary();
    try {
      assert.equal(JSON.parse(readFileSync(file, "utf8")).pid, process.pid);
      assert.deepEqual(lockLitter(box.data), []);
    } finally {
      await stop();
    }
  } finally {
    claimer.kill("SIGKILL");
    await box.cleanup();
  }
});

test("under the strict rule a takeover claim stays however old it is, and the refusal names it", async () => {
  const box = await sandbox();
  // A live Node.js process stands in for a start suspended before it removed the lock.
  const claimer = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    await once(claimer, "spawn");
    mkdirSync(box.data, { recursive: true });
    const file = path.join(box.data, "bellpr.lock");
    const starts = lockStarts(box);
    const probe = await acquireWriterLock(box.data);
    const here = { ...JSON.parse(readFileSync(file, "utf8")), strict: undefined };
    probe.release();
    const gone = await gonePid();
    const hourAgo = new Date(Date.now() - 3_600_000);
    // The rule is the start's, the stale lock's or the claim's own.
    const cases = [
      { name: "a strict start", start: starts.strict, lock: false, claim: false },
      { name: "a strict stale lock", start: starts.ordinary, lock: true, claim: false },
      { name: "a strict claim", start: starts.ordinary, lock: false, claim: true },
    ];
    for (const { name, start, ...strict } of cases) {
      const stale = JSON.stringify({ ...here, pid: gone, strict: strict.lock || undefined });
      const claim = claimFile(file, stale);
      const named = JSON.stringify({ ...here, pid: claimer.pid, strict: strict.claim });
      // One that names no start stays as well; it cannot carry the rule itself.
      for (const text of strict.claim ? [named] : [named, ""]) {
        writeFileSync(file, stale);
        writeFileSync(claim, text);
        utimesSync(claim, hourAgo, hourAgo);
        const message = await refusedWith(start);
        assert.ok(message.includes(claim), `${name}: ${message}`);
        assert.doesNotMatch(message, new RegExp(`\\b${gone}\\b`), name);
        assert.equal(readFileSync(file, "utf8"), stale, name);
        assert.equal(readFileSync(claim, "utf8"), text, name);
        assert.deepEqual(lockLitter(box.data), [path.basename(claim)], name);
        await rm(claim);
      }
    }
  } finally {
    claimer.kill("SIGKILL");
    await box.cleanup();
  }
});

/** Waits until a start is halted at `hook` (test/lock-stall.mjs), or fails with its output. */
async function halted(launched: Launched, hook: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(`${hook}.reached`)) {
    if (launched.child.exitCode !== null || Date.now() > deadline)
      assert.fail(
        `The start was not halted.\nstdout: ${launched.stdout()}\nstderr: ${launched.stderr()}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** A real start that test/lock-stall.mjs halts once at `where`, until `<hook>.go` is there. */
async function haltingStart(
  box: { data: string; env: NodeJS.ProcessEnv },
  hook: string,
  where: NodeJS.ProcessEnv,
) {
  const preload = pathToFileURL(path.join(repoRoot, "test", "lock-stall.mjs")).href;
  return launch(
    cliEntry,
    ["start", "--force", "--port", String(await freePort()), "--data-dir", box.data],
    {
      ...box.env,
      NODE_OPTIONS: `${box.env.NODE_OPTIONS ?? ""} --import=${preload}`,
      LOCK_TEST_HOOK: hook,
      ...where,
    },
  );
}

test("a start held up while it writes its takeover claim in place removes neither the lock nor the claim of the start that cleared it", async () => {
  const box = await sandbox();
  const launched: Launched[] = [];
  try {
    mkdirSync(box.data, { recursive: true });
    const file = path.join(box.data, "bellpr.lock");
    const probe = await acquireWriterLock(box.data);
    const here = { ...JSON.parse(readFileSync(file, "utf8")), strict: undefined };
    probe.release();
    const stale = JSON.stringify({ ...here, pid: await gonePid() });
    writeFileSync(file, stale);
    const claim = claimFile(file, stale);
    const claims = "\\.takeover-[0-9a-f]{16}$";
    // Hard links fail for its claim: the first start creates the claim in place
    // and is held up before it writes it. The claim lies empty for over a lease.
    const firstHook = path.join(box.directory, "first");
    const first = await haltingStart(box, firstHook, {
      LOCK_TEST_NO_LINK: claims,
      LOCK_TEST_STALL_WRITE: claims,
    });
    launched.push(first);
    await halted(first, firstHook);
    assert.equal(statSync(claim).size, 0);
    const lapsed = new Date(Date.now() - 31_000);
    utimesSync(claim, lapsed, lapsed);
    // The second clears the empty claim, writes its own and is held up just
    // before it removes the stale lock.
    const secondHook = path.join(box.directory, "second");
    const second = await haltingStart(box, secondHook, {
      LOCK_TEST_STALL_REMOVE: "bellpr\\.lock$",
    });
    launched.push(second);
    await halted(second, secondHook);
    const claimer = () => JSON.parse(readFileSync(claim, "utf8")).pid;
    assert.equal(claimer(), second.child.pid);
    // The first goes on. Its text went into the file it created, which the
    // claim path no longer leads to: the claim there is the second's, and it
    // may remove neither that claim nor the lock, or two starts would get the
    // lock, and coordination would lose one it took in between.
    writeFileSync(`${firstHook}.go`, "");
    const ended = await Promise.race([
      first.exited.then(({ code }) => code),
      started(first).then(() => "started"),
    ]);
    assert.equal(ended, 1, first.stdout() + first.stderr());
    assert.ok(first.stderr().includes(claim), first.stderr());
    assert.equal(readFileSync(file, "utf8"), stale);
    assert.equal(claimer(), second.child.pid);
    // Coordination that starts now finds the lock claimed, not free to take.
    const message = await refusedWith(lockStarts(box).strict);
    assert.ok(message.includes(claim), message);
    assert.equal(readFileSync(file, "utf8"), stale);
    // The second goes on, and is the one start that has the data directory.
    writeFileSync(`${secondHook}.go`, "");
    await started(second);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).pid, second.child.pid);
    assert.deepEqual(lockLitter(box.data), []);
  } finally {
    // A halted start handles no signal.
    for (const { child } of launched) child.kill("SIGKILL");
    await Promise.all(launched.map(({ exited }) => exited));
    await box.cleanup();
  }
});

test("a start held up while it writes its lock or its claim in place leaves the file to the start that claimed it empty", async () => {
  const cases = [
    { written: "lock", files: "bellpr\\.lock$" },
    { written: "claim", files: "\\.takeover-[0-9a-f]{16}$" },
  ];
  for (const { written, files } of cases) {
    const box = await sandbox();
    const launched: Launched[] = [];
    try {
      mkdirSync(box.data, { recursive: true });
      const file = path.join(box.data, "bellpr.lock");
      const probe = await acquireWriterLock(box.data);
      const here = { ...JSON.parse(readFileSync(file, "utf8")), strict: undefined };
      probe.release();
      const stale = JSON.stringify({ ...here, pid: await gonePid() });
      // The claim is written for a stale lock; the lock where there is none.
      if (written === "claim") writeFileSync(file, stale);
      const target = written === "claim" ? claimFile(file, stale) : file;
      // Hard links fail for it: the first start creates the file in place and
      // is held up before it writes it.
      const firstHook = path.join(box.directory, "first");
      const first = await haltingStart(box, firstHook, {
        LOCK_TEST_NO_LINK: files,
        LOCK_TEST_STALL_WRITE: files,
      });
      launched.push(first);
      await halted(first, firstHook);
      assert.equal(statSync(target).size, 0, written);
      // An empty lock is removed at once, an empty claim once it is a lease old.
      const lapsed = new Date(Date.now() - 31_000);
      if (written === "claim") utimesSync(target, lapsed, lapsed);
      // The second finds the file empty, claims it and is held up just before
      // it removes it.
      const secondHook = path.join(box.directory, "second");
      const second = await haltingStart(box, secondHook, { LOCK_TEST_STALL_REMOVE: files });
      launched.push(second);
      await halted(second, secondHook);
      const claim = claimFile(target, "");
      assert.equal(JSON.parse(readFileSync(claim, "utf8")).pid, second.child.pid, written);
      // The first goes on. Were its text to stay, the file would be its own,
      // and the second would still remove what lies at the path: the lock of
      // whichever start took it since, be it coordination, or the claim under
      // which the first replaces the stale lock. The file stays empty instead.
      writeFileSync(`${firstHook}.go`, "");
      const ended = await Promise.race([
        first.exited.then(({ code }) => code),
        started(first).then(() => "started"),
      ]);
      assert.equal(ended, 1, first.stdout() + first.stderr());
      // Never the lock itself: a person told to remove it could remove a later start's.
      assert.ok(first.stderr().includes(written === "claim" ? target : claim), first.stderr());
      assert.equal(readFileSync(target, "utf8"), "", written);
      // Coordination that starts now does not get the lock either.
      const message = await refusedWith(lockStarts(box).strict);
      assert.ok(message.includes(target), message);
      assert.equal(readFileSync(target, "utf8"), "", written);
      if (written === "claim") assert.equal(readFileSync(file, "utf8"), stale);
      // The second goes on, and is the one start that has the data directory.
      writeFileSync(`${secondHook}.go`, "");
      await started(second);
      assert.equal(JSON.parse(readFileSync(file, "utf8")).pid, second.child.pid, written);
      assert.deepEqual(lockLitter(box.data), [], written);
    } finally {
      // A halted start handles no signal.
      for (const { child } of launched) child.kill("SIGKILL");
      await Promise.all(launched.map(({ exited }) => exited));
      await box.cleanup();
    }
  }
});

const readableWhateverTheMode =
  process.platform === "win32"
    ? "Windows has no file mode that keeps its owner from reading a file"
    : process.getuid?.() === 0
      ? "root reads a file whatever its mode"
      : false;

test("no start replaces a lock file it cannot read, and the refusal names the file", { skip: readableWhateverTheMode }, async () => {
  const box = await sandbox();
  try {
    mkdirSync(box.data, { recursive: true });
    const file = path.join(box.data, "bellpr.lock");
    const starts = lockStarts(box);
    const hourAgo = new Date(Date.now() - 3_600_000);
    // As after its mode or owner was changed, or a start as another user was
    // killed before it removed its lock.
    const left = JSON.stringify({ pid: await gonePid(), port: 4311, version });
    writeFileSync(file, left);
    chmodSync(file, 0);
    utimesSync(file, hourAgo, hourAgo);
    for (const [name, start] of Object.entries(starts)) {
      const message = await refusedWith(start);
      assert.ok(message.includes(file), `${name}: ${message}`);
      assert.doesNotMatch(message, processZero, name);
      // An ordinary start gives the system's reason; the strict rule has its own words.
      if (name === "ordinary") assert.match(message, /EACCES/);
      assert.equal(statSync(file).mode & 0o777, 0, name);
      assert.deepEqual(lockLitter(box.data), [], name);
    }
    chmodSync(file, 0o600);
    assert.equal(readFileSync(file, "utf8"), left);
    await rm(file);
    // A running coordination's lock, last renewed an hour ago, as when its
    // process was suspended: its age does not show that it stopped.
    const held = await acquireWriterLock(box.data);
    chmodSync(file, 0);
    utimesSync(file, hourAgo, hourAgo);
    const message = await refusedWith(starts.ordinary);
    assert.ok(message.includes(file), message);
    chmodSync(file, 0o600);
    assert.equal(held.holds(), true);
    held.release();
    assert.deepEqual(lockLitter(box.data), []);
  } finally {
    await box.cleanup();
  }
});

test("an ordinary start reads the lock again after a read that failed; a lock that stays unreadable is refused and left", async (t) => {
  const box = await sandbox();
  try {
    mkdirSync(box.data, { recursive: true });
    const file = path.join(box.data, "bellpr.lock");
    const starts = lockStarts(box);
    const probe = await acquireWriterLock(box.data);
    const here = { ...JSON.parse(readFileSync(file, "utf8")), strict: undefined };
    probe.release();
    // A crashed holder's lock: a start that reads it replaces it.
    const stale = JSON.stringify({ ...here, pid: await gonePid() });
    writeFileSync(file, stale);
    // The next `failing` reads of the lock fail, as over a network file system.
    let failing = 0;
    const read = fs.readFileSync;
    const failingRead = (...args: Parameters<typeof read>) => {
      if (args[0] === file && failing > 0) {
        failing -= 1;
        throw Object.assign(new Error(`ESTALE: stale file handle, open '${file}'`), {
          code: "ESTALE",
        });
      }
      return read(...args);
    };
    t.mock.method(fs, "readFileSync", failingRead as typeof read);
    syncBuiltinESMExports();
    // Every read fails: the start gives up after its last attempt.
    failing = Infinity;
    const message = await refusedWith(starts.ordinary);
    failing = 0;
    assert.ok(message.includes(file) && message.includes("ESTALE"), message);
    assert.equal(readFileSync(file, "utf8"), stale);
    assert.deepEqual(lockLitter(box.data), []);
    // Under the strict rule the first read that fails is enough.
    failing = 3;
    assert.ok((await refusedWith(starts.strict)).includes(file));
    assert.equal(failing, 2);
    failing = 0;
    assert.equal(readFileSync(file, "utf8"), stale);
    // One read fails: the next attempt reads the stale lock and replaces it.
    failing = 1;
    const stop = await starts.ordinary();
    try {
      assert.equal(failing, 0);
      assert.equal(JSON.parse(readFileSync(file, "utf8")).pid, process.pid);
      assert.deepEqual(lockLitter(box.data), []);
    } finally {
      await stop();
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await box.cleanup();
  }
});

test("a lock path that holds nothing a start can read or replace is refused by naming it", async () => {
  const box = await sandbox();
  try {
    mkdirSync(box.data, { recursive: true });
    const file = path.join(box.data, "bellpr.lock");
    const starts = lockStarts(box);
    const cases: Array<[string, () => void]> = [["a directory", () => mkdirSync(file)]];
    // It is there for a start that creates the lock and gone for one that reads it.
    if (process.platform !== "win32")
      cases.push(["a link to nowhere", () => symlinkSync(path.join(box.data, "nowhere"), file)]);
    for (const [name, occupy] of cases) {
      occupy();
      for (const start of [starts.strict, starts.ordinary]) {
        const message = await refusedWith(start);
        assert.ok(message.includes(file), `${name}: ${message}`);
        assert.doesNotMatch(message, processZero, name);
      }
      assert.ok(lstatSync(file), name);
      assert.deepEqual(lockLitter(box.data), [], name);
      await rm(file, { recursive: true });
    }
  } finally {
    await box.cleanup();
  }
});

test("a stale lock that a start could not replace is not reported as a running process", {
  skip: process.platform === "win32" && "making a symbolic link needs a privilege there",
}, async () => {
  const box = await sandbox();
  try {
    mkdirSync(box.data, { recursive: true });
    const file = path.join(box.data, "bellpr.lock");
    const probe = await acquireWriterLock(box.data);
    const here = { ...JSON.parse(readFileSync(file, "utf8")), strict: undefined };
    probe.release();
    const gone = await gonePid();
    const stale = JSON.stringify({ ...here, pid: gone });
    writeFileSync(file, stale);
    // A link to nowhere at the claim path: it is there for a start that
    // creates its claim and gone for one that reads it.
    const claim = claimFile(file, stale);
    symlinkSync(path.join(box.data, "nowhere"), claim);
    for (const [name, start] of Object.entries(lockStarts(box))) {
      const message = await refusedWith(start);
      assert.ok(message.includes(file), `${name}: ${message}`);
      assert.doesNotMatch(message, new RegExp(`\\b${gone}\\b`), name);
      assert.equal(readFileSync(file, "utf8"), stale, name);
      assert.deepEqual(lockLitter(box.data), [path.basename(claim)], name);
    }
  } finally {
    await box.cleanup();
  }
});

test("a lock from before the last boot is told by its boot id or uptime, not by a clock step", async () => {
  const box = await sandbox();
  // A live Node.js process stands in for the running instance.
  const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    await once(holder, "spawn");
    // The clock stepped forward since the instance started, as when NTP
    // corrects a computer without a hardware clock: by the clock, it now
    // started 10 minutes before the computer did.
    const older = {
      pid: holder.pid!,
      port: 4311,
      version,
      startedAt: new Date(Date.now() - uptime() * 1000 - 10 * 60_000).toISOString(),
    };
    const lock = { ...older, uptime: uptime() };
    assert.equal(lockHolderRunning(box.data, lock), true);
    // Written when the computer had been up longer than it is now.
    assert.equal(lockHolderRunning(box.data, { ...lock, uptime: uptime() + 3600 }), false);
    if (process.platform === "linux") {
      const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      assert.equal(lockHolderRunning(box.data, { ...older, bootId }), true);
      assert.equal(lockHolderRunning(box.data, { ...lock, bootId: "an earlier boot" }), false);
    }
    // A lock from an older build has neither: its start is compared with the clock.
    assert.equal(lockHolderRunning(box.data, older), false);
    assert.equal(
      lockHolderRunning(box.data, { ...older, startedAt: new Date().toISOString() }),
      true,
    );
  } finally {
    holder.kill("SIGKILL");
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

async function serveFromDotPath() {
  const box = await sandbox();
  const store = new Store(box.data);
  await store.initialize();
  const workbench = new Workbench(store);
  // npm i -g under nvm, ~/.local or ~/.npm-global puts the UI below a dot directory.
  const staticDirectory = path.join(box.directory, ".nvm", "versions", "lib", "bell-pr", "dist");
  mkdirSync(path.dirname(staticDirectory), { recursive: true });
  cpSync(box.env.BELLPR_STATIC_DIR!, staticDirectory, { recursive: true });
  writeFileSync(path.join(staticDirectory, ".env"), "SYNTHETIC_SECRET=dotfile-must-not-leak\n");
  const app = createApp(workbench, { staticDirectory });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const fetchPage = (route: string) =>
    get(`http://127.0.0.1:${port}${route}`, { host: "127.0.0.1:4311" });
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    await box.cleanup();
  };
  return { fetchPage, close };
}

test("an install below a dot-prefixed directory serves the page on every route", async () => {
  const { fetchPage, close } = await serveFromDotPath();
  try {
    for (const route of ["/", "/pair", "/some/deep/link"]) {
      const page = await fetchPage(route);
      assert.equal(page.status, 200, route);
      assert.match(page.body, /<title>ui<\/title>/, route);
    }
  } finally {
    await close();
  }
});

test("dotfiles inside the UI directory are never served", async () => {
  const { fetchPage, close } = await serveFromDotPath();
  try {
    for (const route of ["/.env", "/pair/../.env", "/%2eenv"]) {
      const page = await fetchPage(route);
      assert.doesNotMatch(page.body, /dotfile-must-not-leak/, route);
    }
  } finally {
    await close();
  }
});

test("the page served from a dot-prefixed install is still revalidated", async () => {
  const { fetchPage, close } = await serveFromDotPath();
  try {
    for (const route of ["/", "/pair", "/some/deep/link"]) {
      const page = await fetchPage(route);
      assert.equal(page.headers["cache-control"], "no-cache", route);
    }
  } finally {
    await close();
  }
});

test("a symlinked bin entry starts the server", async () => {
  const box = await sandbox();
  const port = await freePort();
  // npm links bin names to the entry file; the entry guard must follow the link.
  const link = path.join(box.directory, "bin", "bell-pr");
  symlinkSync(cliEntry, link);
  const server = launch(link, ["start", "--force", "--port", String(port), "--data-dir", box.data], box.env);
  try {
    await started(server);
    assert.ok(
      server.stdout().includes(`BELL PR ${version} → http://127.0.0.1:${port}\n`),
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
    ["start", "--force", "--port", String(await freePort()), "--data-dir", box.data],
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
      ["start", "--force", "--port", String(await freePort()), "--data-dir", box.data],
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

test("an occupied port exits non-zero and points to bell-pr open", async () => {
  const box = await sandbox();
  const port = await freePort();
  const first = launch(cliEntry, ["start", "--force", "--port", String(port), "--data-dir", box.data], box.env);
  const other = createServer();
  try {
    await started(first);
    const otherData = path.join(box.directory, "other-data");
    const second = launch(
      cliEntry,
      ["start", "--force", "--port", String(port), "--data-dir", otherData],
      box.env,
    );
    const { code } = await second.exited;
    assert.notEqual(code, 0);
    const output = second.stdout() + second.stderr();
    assert.match(output, /BELL PR is already running at http:\/\/127\.0\.0\.1:\d+\. Run `bell-pr open` to open it; add --data-dir <dir> if that BELL PR was started with another data directory\./);
    // The port is checked before anything is written.
    assert.equal(existsSync(otherData), false);

    // Another program on the port: suggest a different one.
    other.listen(0, "127.0.0.1");
    await once(other, "listening");
    const busy = (other.address() as AddressInfo).port;
    const third = launch(
      cliEntry,
      ["start", "--force", "--port", String(busy), "--data-dir", otherData],
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
        ["start", "--force", "--port", String(await freePort()), "--data-dir", box.data],
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

/** Waits until the process exits, or fails while it is still running. */
async function finished(launched: Launched, timeoutMs = 30_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `BELL PR was still running.\nstdout: ${launched.stdout()}\nstderr: ${launched.stderr()}`,
          ),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([launched.exited, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

test("a first start listens when the only required failure is the provider", async () => {
  const box = await sandbox();
  const port = await freePort();
  const server = launch(
    cliEntry,
    ["start", "--port", String(port), "--data-dir", box.data],
    box.env,
  );
  try {
    await started(server);
    assert.match(server.stdout(), new RegExp(`→ http://127\\.0\\.0\\.1:${port}`));
    assert.doesNotMatch(server.stderr(), /did not start/);
    assert.equal((await get(`http://127.0.0.1:${port}/`)).status, 200);
    assert.equal((await stop(server)).code, 0, server.stderr());
  } finally {
    if (server.child.exitCode === null && server.child.signalCode === null) await stop(server);
    await box.cleanup();
  }
});

test("a second start also listens when the only required failure is the provider", async () => {
  const box = await sandbox();
  const listen = async () => {
    const port = await freePort();
    const server = launch(
      cliEntry,
      ["start", "--port", String(port), "--data-dir", box.data],
      box.env,
    );
    try {
      await started(server);
      assert.match(server.stdout(), new RegExp(`→ http://127\\.0\\.0\\.1:${port}`));
      assert.doesNotMatch(server.stderr(), /did not start/);
      assert.equal((await get(`http://127.0.0.1:${port}/`)).status, 200);
      assert.equal((await stop(server)).code, 0, server.stderr());
    } finally {
      if (server.child.exitCode === null && server.child.signalCode === null) await stop(server);
    }
  };
  try {
    await listen();
    assert.equal(existsSync(box.data), true);
    await listen();
  } finally {
    await box.cleanup();
  }
});

test("a start exits 1 when another required check fails, alone or with the provider", async () => {
  const box = await sandbox();
  const bin = path.join(box.directory, "bin");
  const refuse = async (name: string, dataDir: string) => {
    const port = await freePort();
    const server = launch(
      cliEntry,
      ["start", "--port", String(port), "--data-dir", dataDir],
      { ...box.env, PATH: bin },
    );
    try {
      const result = await finished(server);
      assert.equal(result.code, 1, `${name}\n${server.stderr()}`);
      assert.match(server.stderr(), /did not start/, name);
      assert.match(server.stderr(), /✗ Git/, name);
      assert.doesNotMatch(server.stdout(), /→ http/, name);
      const probe = createServer();
      probe.listen(port, "127.0.0.1");
      await once(probe, "listening");
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      return server.stderr();
    } finally {
      await stop(server);
    }
  };
  try {
    assert.match(await refuse("git and the provider", box.data), /✗ AI provider/);
    writeFileSync(
      path.join(bin, "codex"),
      `#!/bin/sh
case "$1" in
  --version) echo "codex-cli 0.159.0" ;;
  login) echo "Logged in using ChatGPT" ;;
  *) exit 1 ;;
esac
`,
      { mode: 0o755 },
    );
    const gitOnly = await refuse("git alone", path.join(box.directory, "git-only"));
    assert.doesNotMatch(gitOnly, /✗ AI provider/);
  } finally {
    await box.cleanup();
  }
});

test("server/index.ts started directly behaves like bell-pr start", async () => {
  const box = await sandbox();
  const port = await freePort();
  const server = launch(
    path.join(repoRoot, "server", "index.ts"),
    ["--force", "--port", String(port), "--data-dir", box.data],
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
