import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { closeLog, initLog, log, recentLogLines } from "./log.js";
import { command, git } from "./process.js";
import { agentSpawn } from "./run-events.js";
import { Store } from "./store.js";
import type { Run } from "./types.js";
import { Workbench } from "./workbench.js";

const token = `ghp_${"A1b2C3d4".repeat(4)}`;

async function logDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-log-test-"));
  return {
    directory,
    logs: path.join(directory, "logs"),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

/** Captures what the logger writes to stderr. */
function capture(isTTY: boolean) {
  const lines: string[] = [];
  return { lines, stream: { isTTY, write: (text: string) => lines.push(text) } };
}

async function entries(file: string) {
  return (await readFile(file, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("entries are JSON lines in a private daily file, with secrets masked in every field", async (t) => {
  const { directory, logs, cleanup } = await logDirectory();
  t.after(cleanup);
  const stderr = capture(false);
  const now = new Date("2026-10-14T08:30:00.000Z");
  initLog(directory, { now: () => now, stderr: stderr.stream });
  log.info("agent.spawn", {
    runId: "run-1",
    executable: "codex",
    env: { GH_TOKEN: token },
    args: ["--token", token],
    msg: "cannot replace the message",
  });
  log.warn(`push failed with ${token}`, {
    error: new Error(`remote said https://x:${token}@github.com`),
  });
  const file = path.join(logs, "bell-pr-2026-10-14.log");
  if (process.platform !== "win32")
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  const text = await readFile(file, "utf8");
  assert.ok(!text.includes(token), "the token must be masked");
  const [spawn, warning] = await entries(file);
  assert.deepEqual(
    { ts: spawn.ts, level: spawn.level, msg: spawn.msg },
    { ts: now.toISOString(), level: "info", msg: "agent.spawn" },
  );
  assert.equal(spawn.runId, "run-1");
  assert.deepEqual(spawn.env, { GH_TOKEN: "[REDACTED]" });
  assert.deepEqual(spawn.args, ["--token", "[REDACTED]"]);
  assert.equal(warning.msg, "push failed with [REDACTED]");
  assert.match(
    (warning.error as { message: string }).message,
    /\[REDACTED\]/,
  );
  // Off a terminal, stderr carries warnings and errors only.
  assert.equal(stderr.lines.length, 1);
  assert.match(stderr.lines[0], /^2026-10-14T08:30:00\.000Z WARN push failed with \[REDACTED\]/);
  assert.ok(!stderr.lines.join("").includes(token));
});

test("a terminal gets readable lines, and BELLPR_LOG_LEVEL filters both outputs", async (t) => {
  const { directory, logs, cleanup } = await logDirectory();
  const previous = process.env.BELLPR_LOG_LEVEL;
  t.after(async () => {
    if (previous === undefined) delete process.env.BELLPR_LOG_LEVEL;
    else process.env.BELLPR_LOG_LEVEL = previous;
    await cleanup();
  });
  const stderr = capture(true);
  const now = new Date("2026-10-14T08:30:00.000Z");
  initLog(directory, { now: () => now, stderr: stderr.stream });
  process.env.BELLPR_LOG_LEVEL = "warn";
  log.info("run.started", { runId: "a" });
  log.error("run.failed", { runId: "a", durationMs: 1200 });
  process.env.BELLPR_LOG_LEVEL = "debug";
  log.debug("agent.output", { runId: "b" });
  delete process.env.BELLPR_LOG_LEVEL;
  log.debug("hidden at info");
  const written = await entries(path.join(logs, "bell-pr-2026-10-14.log"));
  assert.deepEqual(
    written.map((entry) => [entry.level, entry.msg]),
    [
      ["error", "run.failed"],
      ["debug", "agent.output"],
    ],
  );
  assert.equal(stderr.lines.length, 2);
  // eslint-disable-next-line no-control-regex
  const plain = stderr.lines.map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""));
  assert.match(plain[0], /ERROR run\.failed runId=a durationMs=1200\n$/);
  assert.match(plain[1], /DEBUG agent\.output runId=b\n$/);
});

test("daily files rotate and old ones go once 7 files or the size budget are exceeded", async (t) => {
  const { directory, logs, cleanup } = await logDirectory();
  t.after(cleanup);
  await mkdir(logs, { recursive: true });
  // Ten earlier days, plus a file that is not a BELL log.
  for (let day = 1; day <= 10; day++)
    await writeFile(
      path.join(logs, `bell-pr-2026-10-${String(day).padStart(2, "0")}.log`),
      "x".repeat(100) + "\n",
    );
  await writeFile(path.join(logs, "notes.txt"), "kept");
  let now = new Date("2026-10-11T23:59:59.000Z");
  initLog(directory, {
    now: () => now,
    maxBytes: 1_000,
    stderr: capture(false).stream,
  });
  log.info("first");
  let files = await readdir(logs);
  assert.deepEqual(files.filter((name) => name.endsWith(".log")).sort(), [
    "bell-pr-2026-10-05.log",
    "bell-pr-2026-10-06.log",
    "bell-pr-2026-10-07.log",
    "bell-pr-2026-10-08.log",
    "bell-pr-2026-10-09.log",
    "bell-pr-2026-10-10.log",
    "bell-pr-2026-10-11.log",
  ]);
  assert.ok(files.includes("notes.txt"));
  // The next UTC day opens a new file and drops the oldest.
  now = new Date("2026-10-12T00:00:01.000Z");
  log.info("second");
  files = (await readdir(logs)).filter((name) => name.endsWith(".log")).sort();
  assert.equal(files.length, 7);
  assert.equal(files[0], "bell-pr-2026-10-06.log");
  assert.equal(files.at(-1), "bell-pr-2026-10-12.log");
  assert.deepEqual(
    (await entries(path.join(logs, "bell-pr-2026-10-12.log"))).map((entry) => entry.msg),
    ["second"],
  );
  // A size budget smaller than the files keeps the newest ones that fit.
  initLog(directory, {
    now: () => now,
    maxBytes: 350,
    stderr: capture(false).stream,
  });
  log.info("third");
  files = (await readdir(logs)).filter((name) => name.endsWith(".log")).sort();
  assert.deepEqual(files, [
    "bell-pr-2026-10-09.log",
    "bell-pr-2026-10-10.log",
    "bell-pr-2026-10-11.log",
    "bell-pr-2026-10-12.log",
  ]);
  // The budget held when the file was opened; the entry written since is
  // counted at the next check.
  let total = 0;
  for (const name of files) total += (await stat(path.join(logs, name))).size;
  const third = (await readFile(path.join(logs, "bell-pr-2026-10-12.log"), "utf8"))
    .split("\n")
    .find((line) => line.includes('"third"'))!;
  assert.ok(total - Buffer.byteLength(`${third}\n`) <= 350, `total ${total}`);
});

test("one day that alone fills the budget stops writing instead of growing", async (t) => {
  const { directory, logs, cleanup } = await logDirectory();
  t.after(cleanup);
  const now = new Date("2026-10-14T08:30:00.000Z");
  initLog(directory, { now: () => now, maxBytes: 4_000, stderr: capture(false).stream });
  const line = "y".repeat(3_000);
  // Each entry is ~3 KB; the budget check runs every megabyte written.
  for (let index = 0; index < 400; index++) log.info("bulk", { line });
  log.info("after the budget");
  const file = path.join(logs, "bell-pr-2026-10-14.log");
  const size = (await stat(file)).size;
  assert.ok(size < 1_100_000, `size ${size}`);
  const text = await readFile(file, "utf8");
  assert.match(text, /"msg":"log\.budget_reached"/);
  assert.ok(!text.includes("after the budget"));
});

test("recentLogLines returns the newest lines across daily files, oldest first", async (t) => {
  const { directory, cleanup } = await logDirectory();
  t.after(cleanup);
  let now = new Date("2026-10-13T10:00:00.000Z");
  initLog(directory, { now: () => now, stderr: capture(false).stream });
  for (let index = 0; index < 5; index++) log.info(`day1-${index}`);
  now = new Date("2026-10-14T10:00:00.000Z");
  for (let index = 0; index < 3; index++) log.info(`day2-${index}`);
  const recent = await recentLogLines(directory, 6);
  assert.deepEqual(
    recent.map((line) => JSON.parse(line).msg),
    ["day1-2", "day1-3", "day1-4", "day2-0", "day2-1", "day2-2"],
  );
  assert.deepEqual(await recentLogLines(path.join(directory, "missing")), []);
});

test("recentLogLines keeps characters whole where a read chunk ends inside one", async (t) => {
  const { directory, logs, cleanup } = await logDirectory();
  t.after(cleanup);
  await mkdir(logs);
  // Three-byte characters, so 64 KiB chunk boundaries fall inside some.
  const lines = Array.from({ length: 400 }, (_, index) =>
    JSON.stringify({ msg: `${index}-${"語".repeat(100)}` }),
  );
  await writeFile(
    path.join(logs, "bell-pr-2026-10-14.log"),
    `${lines.join("\n")}\n`,
  );
  const recent = await recentLogLines(directory, 300);
  assert.equal(recent.length, 300);
  assert.deepEqual(recent, lines.slice(-300));
});

test("a run's lifecycle, its agent processes and a rejected answer are logged as events without the prompt", async (t) => {
  const { directory } = await logDirectory();
  const repository = path.join(directory, "repo");
  await mkdir(repository);
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "hello.ts"), "export const hello = 1;\n");
  await git(repository, ["add", "hello.ts"]);
  await git(repository, ["commit", "-m", "initial"]);
  const calls: string[] = [];
  // The lead's answer is not a plan: the "format incomplete" path.
  const fakeCommand = (async (executable, _args, options) => {
    calls.push(executable);
    options?.onLine?.(
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Here is my plan, in prose." },
      }),
      "stdout",
    );
    return { stdout: "", stderr: "", code: 0 };
  }) as typeof command;
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store, undefined, {
    command: fakeCommand,
    getModelCatalog: async () => ({ models: [], source: "codex" }),
  });
  workbench.status = async () => ({
    codex: true,
    codexAuthenticated: true,
    claude: false,
    claudeAuthenticated: false,
    github: false,
  });
  t.after(async () => {
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(repository);
  const prompt = "Rename the greeting PROMPT-MARKER-1234 everywhere";
  const run = await workbench.createRun(repo.id, prompt);
  const end = Date.now() + 10_000;
  while (run.status !== "failed") {
    if (Date.now() > end) throw new Error(`run stayed ${run.status}`);
    await delay(10);
  }
  await workbench.shutdown();
  assert.deepEqual(calls, ["codex"]);
  const files = await readdir(path.join(store.directory, "logs"));
  assert.equal(files.length, 1);
  const written = (await recentLogLines(store.directory)).map(
    (line) => JSON.parse(line) as Record<string, unknown>,
  );
  const events = written
    .filter((entry) => entry.runId === run.id)
    .map((entry) => entry.msg);
  assert.deepEqual(events, [
    "run.queued",
    "run.started",
    "run.phase",
    "agent.spawn",
    "agent.exit",
    "agent.output_retry",
    "run.failed",
  ]);
  const byEvent = (msg: string) => written.find((entry) => entry.msg === msg)!;
  assert.equal(byEvent("run.queued").reason, "created");
  assert.equal(byEvent("run.phase").phase, "planning");
  assert.equal(byEvent("agent.spawn").executable, "codex");
  assert.equal(typeof byEvent("agent.spawn").timeoutMs, "number");
  assert.equal(byEvent("agent.exit").exitCode, 0);
  assert.equal(typeof byEvent("agent.exit").durationMs, "number");
  assert.deepEqual(
    { level: byEvent("agent.output_retry").level, schema: byEvent("agent.output_retry").schema },
    { level: "warn", schema: "team-plan" },
  );
  assert.equal(typeof byEvent("run.failed").durationMs, "number");
  const text = await readFile(path.join(store.directory, "logs", files[0]), "utf8");
  assert.ok(!text.includes("PROMPT-MARKER-1234"), "the prompt must not be logged");
});

test("agent.exit records the exit code of an agent process that failed", async (t) => {
  const { directory, cleanup } = await logDirectory();
  t.after(cleanup);
  initLog(directory, { stderr: capture(false).stream });
  const run = { id: "run-exit" } as Run;
  const failed = await command(process.execPath, ["-e", "process.exit(3)"]).then(
    () => assert.fail("the process exited 3"),
    (error: unknown) => error,
  );
  agentSpawn(run, "lead", "codex", 1000).failed(failed);
  // A process that never exited has no code to record.
  agentSpawn(run, "lead", "codex", 1000).failed(new Error("spawn EACCES"));
  const exits = (await recentLogLines(directory))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.msg === "agent.exit");
  assert.deepEqual(
    exits.map(({ outcome, exitCode }) => ({ outcome, exitCode })),
    [
      { outcome: "failed", exitCode: 3 },
      { outcome: "failed", exitCode: undefined },
    ],
  );
});

test("after the Workbench shuts down, the process logs to stderr, not into the data directory it left", async (t) => {
  const first = await logDirectory();
  const second = await logDirectory();
  t.after(first.cleanup);
  t.after(second.cleanup);
  const workbench = new Workbench(new Store(first.directory));
  await workbench.store.initialize();
  log.info("first.running");
  await workbench.shutdown();
  const before = await recentLogLines(first.directory);
  assert.ok(before.some((line) => line.includes("first.running")));
  log.warn("after.shutdown");
  assert.deepEqual(await recentLogLines(first.directory), before);
  // Closing another directory's log leaves the current one open.
  initLog(second.directory, { stderr: capture(false).stream });
  closeLog(first.directory);
  log.info("second.running");
  assert.ok((await recentLogLines(second.directory)).some((line) => line.includes("second.running")));
  closeLog();
  log.warn("closed.again");
  assert.ok(!(await recentLogLines(second.directory)).some((line) => line.includes("closed.again")));
});
