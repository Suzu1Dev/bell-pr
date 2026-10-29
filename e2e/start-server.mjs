/**
 * BELL PR servers for the e2e tests.
 *
 * The default export is Playwright's globalSetup: it builds the app once
 * (skipped with BELLPR_E2E_SKIP_BUILD=1), then starts the real `bell-pr start`
 * on BELLPR_E2E_PORT (default 4599). The function it returns is the global
 * teardown.
 *
 * `launchServer()` is the same path for spec-local servers, for example a
 * fresh data dir without the onboarding settings, a PATH without agent
 * CLIs, a seeded state.json or extra environment variables. Each server
 * gets a temporary HOME and data dir from mkdtemp(os.tmpdir()/bellpr-e2e-),
 * and fake codex, claude and gh commands first on PATH, so no real agent
 * CLI can start. `stop()` ends the server's process group and removes the
 * temporary directories.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = path.join(root, "bin", "bellpr.mjs");
const addressPattern = /→ (http:\/\/\S+)\s/;
const startTimeoutMs = 60_000;
const stopTimeoutMs = 10_000;

/** A free port on 127.0.0.1, from the operating system. */
export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string")
    throw new Error("Could not find a free port on 127.0.0.1.");
  return address.port;
}

/** codex, claude and gh that fail at once: no real agent CLI can run. */
async function writeFakeClis(directory) {
  await mkdir(directory, { recursive: true });
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(directory, name), "#!/bin/sh\nexit 1\n", {
      mode: 0o755,
    });
}

/**
 * The server's environment: this process's, without BELLPR_* settings and
 * NODE_OPTIONS, plus the test's directories and `env` (where undefined
 * removes a variable). A PATH in `env` replaces the default, which puts
 * the fake CLIs first.
 */
function serverEnvironment({ home, dataDir, fakeBin, env }) {
  const inherited = Object.entries(process.env).filter(
    ([name]) => !name.startsWith("BELLPR_") && name !== "NODE_OPTIONS",
  );
  const result = {
    ...Object.fromEntries(inherited),
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    BELLPR_DATA_DIR: dataDir,
    BELLPR_NO_OPEN: "1",
    PATH: [fakeBin, process.env.PATH].filter(Boolean).join(path.delimiter),
  };
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete result[name];
    else result[name] = value;
  }
  return result;
}

/** Resolves with the address the server prints at startup. */
function waitForAddress(child, log) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const timer = setTimeout(() => {
    finish(new Error(`BELL PR did not print its address within ${startTimeoutMs / 1000} s:\n${log.text}`));
  }, startTimeoutMs);
  const check = () => {
    const match = addressPattern.exec(log.text);
    if (match) finish(undefined, match[1]);
  };
  const exited = (code, signal) =>
    finish(new Error(`BELL PR exited (${signal ?? code}) before it printed its address:\n${log.text}`));
  function finish(error, address) {
    clearTimeout(timer);
    log.onData = undefined;
    child.off("exit", exited);
    if (error) reject(error);
    else resolve(address);
  }
  log.onData = check;
  child.once("exit", exited);
  check();
  return promise;
}

/** Ends the server's process group, then forcefully if it does not exit. */
async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
    } catch {
      // The group is already gone.
    }
  };
  signal("SIGTERM");
  const timer = setTimeout(() => signal("SIGKILL"), stopTimeoutMs);
  await exited;
  clearTimeout(timer);
}

/** Marks onboarding done, so no spec lands on Welcome. */
async function completeOnboarding(context) {
  const response = await context.put("/api/app-settings", {
    data: {
      onboardingCompletedAt: new Date().toISOString(),
    },
  });
  if (!response.ok())
    throw new Error(
      `PUT /api/app-settings answered ${response.status()}: ${await response.text()}`,
    );
}

/**
 * Starts `bell-pr start`. Options:
 * - `port`: default a free port from the operating system;
 * - `env`: extra environment variables (undefined removes one);
 * - `dataDir`: use this data dir, which stop() leaves in place;
 * - `seed(dataDir)`: writes files into the data dir before the start;
 * - `settingsPut`: false skips marking onboarding done, to see a first
 *   start.
 * Resolves with the base URL, the data dir and stop().
 */
export async function launchServer(options = {}) {
  const { env = {}, seed, settingsPut = true } = options;
  const port = options.port ?? (await freePort());
  const temp = await mkdtemp(path.join(os.tmpdir(), "bellpr-e2e-"));
  const home = path.join(temp, "home");
  const fakeBin = path.join(temp, "bin");
  const dataDir = options.dataDir ?? path.join(temp, "data");
  const removeTemp = () => rm(temp, { recursive: true, force: true });
  let child;
  const killOnExit = () => {
    try {
      if (child?.exitCode === null) process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  };
  try {
    await mkdir(home, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    await writeFakeClis(fakeBin);
    await seed?.(dataDir);
    child = spawn(
      process.execPath,
      // Fake CLIs fail the readiness gate. --force is what keeps these
      // servers, including the sample tour, able to start.
      [bin, "start", "--force", "--no-open", "--port", String(port)],
      {
        cwd: root,
        env: serverEnvironment({ home, dataDir, fakeBin, env }),
        // Its own process group, so stop() ends the server and its children.
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    // A crashed or interrupted test run must not leave the server running.
    process.on("exit", killOnExit);
    const log = { text: "", onData: undefined };
    const collect = (chunk) => {
      log.text = (log.text + chunk).slice(-64 * 1024);
      log.onData?.();
    };
    child.stdout.setEncoding("utf8").on("data", collect);
    child.stderr.setEncoding("utf8").on("data", collect);
    const address = new URL(await waitForAddress(child, log));
    const baseURL = `http://127.0.0.1:${port}`;
    if (address.origin !== baseURL)
      throw new Error(`BELL PR printed ${address.origin}, not ${baseURL}.`);
    if (settingsPut) {
      const context = await request.newContext({ baseURL });
      try {
        await completeOnboarding(context);
      } finally {
        await context.dispose();
      }
    }
    let stopped;
    const stop = () =>
      (stopped ??= (async () => {
        await stopProcess(child);
        process.off("exit", killOnExit);
        await removeTemp();
      })());
    return { baseURL, dataDir, stop };
  } catch (error) {
    if (child) await stopProcess(child);
    process.off("exit", killOnExit);
    await removeTemp();
    throw error;
  }
}

/** Playwright globalSetup: one shared server for every spec. */
export default async function globalSetup() {
  if (process.env.BELLPR_E2E_SKIP_BUILD !== "1")
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  const port = Number(process.env.BELLPR_E2E_PORT || 4599);
  const server = await launchServer({ port });
  process.env.BELLPR_E2E_BASE_URL = server.baseURL;
  process.env.BELLPR_E2E_DATA_DIR = server.dataDir;
  return () => server.stop();
}
