/**
 * Starts the BELL PR product from this checkout for the capture, the same
 * way a person does (`bell-pr start --no-open`), but sealed off from the
 * machine it runs on:
 *
 * - its own temporary HOME and data dir (BELLPR_DATA_DIR);
 * - stand-in codex, claude and gh commands first on PATH. They answer the
 *   setup checks like signed-in tools, so the pages show a finished setup,
 *   and fail every other call, so no agent and no GitHub request can run;
 * - a Git identity for a fictional sample contributor;
 * - its own process group, so stop() ends the server and its children.
 *
 * The sign-in link it prints is returned to the caller and never logged.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const signInPattern = /http:\/\/127\.0\.0\.1:\d+\/auth\?t=[\w-]+/;
const startTimeoutMs = 60_000;
const stopTimeoutMs = 10_000;

/** The server log with sign-in tokens masked. */
export const maskTokens = (text) => text.replace(/([?&]t=)[\w-]+/g, "$1***");

/** Stand-ins that answer the doctor's probes; every other call fails. */
const standIns = {
  codex: `case "$1" in
  --version) echo "codex-cli 0.159.0" ;;
  login) echo "Logged in using ChatGPT" ;;
  *) exit 1 ;;
esac`,
  claude: `case "$1" in
  --version) echo "2.1.292 (Claude Code)" ;;
  auth) echo '{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "pro"}' ;;
  *) exit 1 ;;
esac`,
  gh: `case "$1" in
  --version) echo "gh version 2.46.0 (2024-03-13)" ;;
  auth) echo "gho_sample" ;;
  api) printf 'HTTP/2.0 200 OK\\r\\nX-Oauth-Scopes: repo, workflow, read:org\\r\\n\\r\\nsample-contributor\\n1\\n' ;;
  *) exit 1 ;;
esac`,
};

/**
 * Starts the server and resolves once it printed its sign-in link.
 * `temp` is a directory the caller created and removes afterwards.
 */
export async function startBellServer({ repoRoot, temp, port }) {
  const home = path.join(temp, "home");
  const dataDir = path.join(temp, "data");
  const bin = path.join(temp, "bin");
  for (const directory of [home, dataDir, bin])
    await mkdir(directory, { recursive: true });
  for (const [name, body] of Object.entries(standIns))
    await writeFile(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  const gitconfig = path.join(temp, "gitconfig");
  await writeFile(
    gitconfig,
    "[user]\n\tname = Sample Contributor\n\temail = contributor@sample.invalid\n",
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("BELLPR_") && name !== "NODE_OPTIONS",
    ),
  );
  Object.assign(env, {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    BELLPR_DATA_DIR: dataDir,
    BELLPR_NO_OPEN: "1",
    GIT_CONFIG_GLOBAL: gitconfig,
    PATH: [bin, process.env.PATH].filter(Boolean).join(path.delimiter),
  });
  const child = spawn(
    process.execPath,
    [path.join(repoRoot, "bin", "bellpr.mjs"), "start", "--no-open", "--port", String(port)],
    { cwd: repoRoot, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const killOnExit = () => {
    try {
      if (child.exitCode === null) process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  };
  process.on("exit", killOnExit);
  let log = "";
  const stop = async () => {
    process.off("exit", killOnExit);
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
  };
  try {
    const link = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error(`BELL PR printed no sign-in link within ${startTimeoutMs / 1000} s:\n${maskTokens(log)}`)),
        startTimeoutMs,
      );
      const onData = (chunk) => {
        log = (log + chunk).slice(-64 * 1024);
        const match = signInPattern.exec(log);
        if (match) finish(undefined, match[0]);
      };
      const onExit = (code, signal) =>
        finish(new Error(`BELL PR exited (${signal ?? code}) before it printed a sign-in link:\n${maskTokens(log)}`));
      function finish(error, value) {
        clearTimeout(timer);
        child.off("exit", onExit);
        if (error) reject(error);
        else resolve(value);
      }
      child.stdout.setEncoding("utf8").on("data", onData);
      child.stderr.setEncoding("utf8").on("data", onData);
      child.once("exit", onExit);
    });
    const signIn = new URL(link);
    const baseURL = `http://127.0.0.1:${port}`;
    if (signIn.origin !== baseURL)
      throw new Error(`BELL PR printed a sign-in link for another address than ${baseURL}.`);
    return { baseURL, signInPath: signIn.pathname + signIn.search, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
