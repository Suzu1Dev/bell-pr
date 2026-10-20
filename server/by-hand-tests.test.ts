// BELL runs the person's confirmed test command, as the person (DESIGN v1.2
// F9): only the confirmed command, only on a request, in the run's folder,
// with secrets stripped from the environment, a timeout and process-group
// kill. Each test uses a temporary Git repository as the run's worktree and
// runs harmless `node -e` commands; fake codex, claude and gh come first on
// PATH, and every process a test starts is stopped by the test.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { repeatFailure, type TestRun } from "../shared/by-hand.js";
import { changeFingerprint } from "../shared/change-fingerprint.js";
import { testRunLimits } from "./by-hand-tests.js";
import { readDiff } from "./git.js";
import { withLocale } from "./i18n/index.js";
import { createApp } from "./index.js";
import { fixedLicense } from "./license.js";
import { git } from "./process.js";
import * as byHandRoutes from "./routes/by-hand.js";
import { Store } from "./store.js";
import { AppError, type Run } from "./types.js";
import { Workbench } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-tests-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

const en = <T>(fn: () => Promise<T>) => withLocale("en", fn);

/** A temporary repository with one commit, a Workbench, and a Learn-by-hand run in review on it. */
async function fixture(t: TestContext, options: { learnByHand?: boolean } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-tests-"));
  const repository = path.join(directory, "repo");
  await git(directory, ["init", "-q", "-b", "main", repository]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, ".gitignore"), "ignored/\n*.log\n");
  await writeFile(path.join(repository, "retry.js"), "export const attempts = 1;\n");
  await git(repository, ["add", "--", "."]);
  await git(repository, ["commit", "-q", "-m", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  // The person's edit, so the change has a fingerprint of its own.
  await writeFile(path.join(repository, "retry.js"), "export const attempts = 3;\n");
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  let stopped = false;
  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    await workbench.shutdown();
  };
  t.after(async () => {
    testRunLimits.timeoutMs = 10 * 60_000;
    testRunLimits.maxBytes = 50 * 1024 * 1024;
    await shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(repository);
  const run: Run = {
    id: "lbh-tests-run",
    repoId: repo.id,
    title: "Retry GET requests",
    prompt: "Retry temporary GET failures.",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: new Date().toISOString(),
    locale: "en",
    agents: [],
    logs: [],
    draft: { title: "Retry GET requests", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    ...(options.learnByHand === false ? {} : { learnByHand: true as const }),
  };
  store.data.runs.push(run);
  const byHand = workbench.byHand;
  const confirm = (command: string) => en(() => byHand.confirmTestCommand(repo.id, { command }));
  /** Waits until the run's test job has recorded its result. */
  const finished = async (count: number) => {
    const deadline = Date.now() + 30_000;
    while ((run.byHand?.tests?.length ?? 0) < count || run.byHand?.busy) {
      if (Date.now() > deadline) assert.fail("the test run did not finish");
      await sleep(25);
    }
    return run.byHand!.tests!.at(-1)!;
  };
  /** Starts a run and waits for its result. */
  const runOnce = async (input: Parameters<typeof byHand.runTests>[1] = {}) => {
    const count = run.byHand?.tests?.length ?? 0;
    await en(() => byHand.runTests(run.id, input));
    return finished(count + 1);
  };
  /** Waits until the live tail shows `pattern`, and returns its first group. */
  const liveMatch = async (pattern: RegExp) => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const live = await byHand.liveTests(run.id);
      const match = pattern.exec(live.tail);
      if (match) return { live, value: match[1] };
      if (Date.now() > deadline) assert.fail(`the live tail never showed ${pattern}: ${live.tail}`);
      await sleep(25);
    }
  };
  return { directory, repository, store, workbench, repo, run, byHand, confirm, finished, runOnce, liveMatch, shutdown };
}

/** True while a process with this pid exists. */
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kills the process after the test, in case the test failed before the
 * runner ended it: by pid, and only while its command line is still the
 * test's own script (Linux).
 */
function reap(t: TestContext, pid: number) {
  t.after(() => {
    try {
      if (readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("setInterval")) process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  });
  return pid;
}

/** Waits until the process is gone (the group kill reaches it at once; reaping takes a moment). */
async function gone(pid: number) {
  const deadline = Date.now() + 5_000;
  while (alive(pid)) {
    if (Date.now() > deadline) return false;
    await sleep(25);
  }
  return true;
}

/**
 * A script that starts two grandchildren and keeps running: one that
 * leaves the output pipes, and one that holds them and ignores SIGTERM, so
 * only the SIGKILL that follows reaches it. It prints a token-like string
 * and both pids.
 */
const lingeringScript = `const { spawn } = require("child_process");
const quiet = spawn("sleep", ["300"], { stdio: "ignore" });
const stubborn = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "inherit" });
console.log("token ghp_" + "A".repeat(30));
console.log("pids " + quiet.pid + " " + stubborn.pid);
setInterval(() => {}, 1000);
`;

/** Writes the lingering script next to the repository (not in it) and returns the command that runs it. */
async function lingering(directory: string) {
  const script = path.join(directory, "lingering.cjs");
  await writeFile(script, lingeringScript);
  return `node ${JSON.stringify(script)}`;
}

/**
 * A script whose grandchild ignores SIGTERM and holds no output pipe, so
 * nothing but a SIGKILL to the group after the pipes closed reaches it.
 * Once the grandchild ignores SIGTERM, the script prints its pid and then
 * keeps running, or exits with `exitCode`.
 */
const pipelessScript = (exitCode?: number) => `const { spawn } = require("child_process");
const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); process.send('ready', () => process.disconnect()); setInterval(() => {}, 1000)"], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
child.once("message", () => {
  console.log("pid " + child.pid);
  ${exitCode === undefined ? "setInterval(() => {}, 1000);" : `process.exit(${exitCode});`}
});
`;

/** Writes the pipeless script next to the repository and returns the command that runs it. */
async function pipeless(directory: string, exitCode?: number) {
  const script = path.join(directory, "pipeless.cjs");
  await writeFile(script, pipelessScript(exitCode));
  return `node ${JSON.stringify(script)}`;
}

test("a confirmed command that exits 0 is recorded as passed, with the prediction and the change it ran on", async (t) => {
  const f = await fixture(t);
  await f.confirm(`node -e "console.log('3 passing')"`);
  const count = f.run.byHand?.tests?.length ?? 0;
  const started = await en(() => f.byHand.runTests(f.run.id, { prediction: "pass", expect: "  retries a 503  " }));
  // 202 body: the run, busy with the tests until they finish.
  const busy = { ...started.run.byHand?.busy };
  assert.equal(busy.kind, "tests");
  const result = await f.finished(count + 1);
  const files = await readDiff(f.run);
  assert.equal(result.outcome, "passed");
  assert.equal(result.exitCode, 0);
  assert.equal(result.command, `node -e "console.log('3 passing')"`);
  assert.equal(result.changeFingerprint, changeFingerprint(files));
  assert.equal(result.prediction, "pass");
  assert.equal(result.expect, "retries a 503");
  assert.equal(result.outputTail, "3 passing");
  assert.match(result.tailHash ?? "", /^[0-9a-f]{16}$/);
  assert.ok(result.ms >= 0 && !result.reported && !result.newFiles);
  assert.ok(Date.parse(result.at) >= Date.parse(busy.since!));
  assert.equal(f.run.byHand?.busy, undefined);
  assert.deepEqual(await f.byHand.liveTests(f.run.id), { running: false, tail: "" });
  // Saved: a new store reads the result back.
  const reloaded = new Store(f.store.directory);
  await reloaded.initialize();
  assert.deepEqual(reloaded.data.runs.find((run) => run.id === f.run.id)?.byHand?.tests?.at(-1), result);
});

test("a failing suite is recorded as failed with its exit code and the end of its output", async (t) => {
  const f = await fixture(t);
  await f.confirm(`node -e "console.log('1 passing'); console.error('AssertionError: expected 3 attempts'); process.exit(1)"`);
  const failed = await f.runOnce({ prediction: "fail" });
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.exitCode, 1);
  assert.match(failed.outputTail ?? "", /1 passing/);
  assert.match(failed.outputTail ?? "", /AssertionError: expected 3 attempts/);
  await f.confirm(`node -e "process.exit(3)"`);
  const three = await f.runOnce();
  assert.equal(three.outcome, "failed");
  assert.equal(three.exitCode, 3);
  assert.equal(three.outputTail, undefined);
});

test("a suite a signal ends that BELL did not send is a failure, with the signal named in the run's log", async (t) => {
  const f = await fixture(t);
  // As the OOM killer would: the shell itself dies of SIGKILL (no core file).
  await f.confirm(`echo "1 passing"; kill -KILL $$`);
  const crashed = await f.runOnce({ prediction: "pass" });
  assert.equal(crashed.outcome, "failed");
  assert.equal(crashed.exitCode, undefined);
  assert.equal(crashed.outputTail, "1 passing");
  assert.equal(
    f.run.logs.at(-1)?.message,
    "Your tests were ended by the signal SIGKILL, which BELL PR did not send, so the run counts as failed.",
  );
  // A crash loop: each run is a failure with the same end of output.
  const again = await f.runOnce();
  assert.equal(again.outcome, "failed");
  assert.equal(again.tailHash, crashed.tailHash);
  // BELL's own Stop and timeout keep their outcomes.
  testRunLimits.timeoutMs = 1_000;
  await f.confirm(`node -e "setInterval(() => {}, 1000)"`);
  assert.equal((await f.runOnce()).outcome, "timeout");
  testRunLimits.timeoutMs = 10 * 60_000;
  await en(() => f.byHand.runTests(f.run.id, {}));
  assert.equal((await f.byHand.stopTests(f.run.id)).run.byHand?.tests?.at(-1)?.outcome, "stopped");
});

test("a run past its time limit is recorded as timeout and its process group is stopped", async (t) => {
  const f = await fixture(t);
  testRunLimits.timeoutMs = 2_000;
  await f.confirm(`node -e "console.log('child ' + require('child_process').spawn('sleep', ['300'], { stdio: 'ignore' }).pid); setInterval(() => {}, 1000)"`);
  const result = await f.runOnce();
  assert.equal(result.outcome, "timeout");
  assert.equal(result.exitCode, undefined);
  assert.ok(result.ms >= 2_000 && result.ms < 20_000, `${result.ms} ms`);
  const pid = Number(/child (\d+)/.exec(result.outputTail ?? "")?.[1]);
  assert.ok(pid > 0);
  assert.ok(await gone(pid), "the grandchild still runs");
});

test("Stop ends the run as stopped, and every process the command started is gone", async (t) => {
  const f = await fixture(t);
  await f.confirm(await lingering(f.directory));
  await en(() => f.byHand.runTests(f.run.id, {}));
  const { live, value } = await f.liveMatch(/pids (\d+ \d+)/);
  // The live tail is served while it runs, with credentials masked.
  assert.equal(live.running, true);
  assert.ok(live.startedAt);
  assert.match(live.tail, /token \[REDACTED\]/);
  assert.doesNotMatch(live.tail, /ghp_A/);
  const pids = value.split(" ").map(Number);
  assert.ok(pids.every(alive));
  const { run } = await en(() => f.byHand.stopTests(f.run.id));
  const result = run.byHand!.tests!.at(-1)!;
  assert.equal(result.outcome, "stopped");
  assert.equal(result.exitCode, undefined);
  assert.equal(run.byHand?.busy, undefined);
  assert.match(result.outputTail ?? "", /token \[REDACTED\]/);
  for (const pid of pids) assert.ok(await gone(pid), `process ${pid} still runs`);
  assert.equal((await f.byHand.liveTests(f.run.id)).running, false);
  // Stop with nothing running changes nothing.
  const again = await f.byHand.stopTests(f.run.id);
  assert.equal(again.run.byHand?.tests?.length, 1);
});

test("Stop and the timeout also end a grandchild that ignores SIGTERM and holds no output pipe", async (t) => {
  const f = await fixture(t);
  await f.confirm(await pipeless(f.directory));
  await en(() => f.byHand.runTests(f.run.id, {}));
  const stopped = reap(t, Number((await f.liveMatch(/pid (\d+)/)).value));
  assert.ok(alive(stopped));
  const { run } = await en(() => f.byHand.stopTests(f.run.id));
  assert.equal(run.byHand?.tests?.at(-1)?.outcome, "stopped");
  assert.ok(await gone(stopped), "the grandchild still runs after Stop");
  testRunLimits.timeoutMs = 2_000;
  const timedOut = await f.runOnce();
  assert.equal(timedOut.outcome, "timeout");
  const pid = reap(t, Number(/pid (\d+)/.exec(timedOut.outputTail ?? "")?.[1]));
  assert.ok(pid > 0 && pid !== stopped);
  assert.ok(await gone(pid), "the grandchild still runs after the timeout");
});

test("a suite that exits while a process it started holds the output ends with its exit code, and the process is ended", async (t) => {
  const f = await fixture(t);
  // Without settling on the suite's own exit, the open pipe made this a timeout.
  testRunLimits.timeoutMs = 20_000;
  await f.confirm(
    `node -e "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }); console.log('child ' + c.pid); console.log('3 passing'); setTimeout(() => process.exit(0), 100)"`,
  );
  const passed = await f.runOnce();
  assert.equal(passed.outcome, "passed");
  assert.equal(passed.exitCode, 0);
  assert.ok(passed.ms < 15_000, `${passed.ms} ms`);
  assert.match(passed.outputTail ?? "", /3 passing$/);
  const pid = reap(t, Number(/child (\d+)/.exec(passed.outputTail ?? "")?.[1]));
  assert.ok(await gone(pid), "the process the suite left behind still runs");
  // A pipeless leftover is ended too, and a failing exit stays a failure.
  await f.confirm(await pipeless(f.directory, 1));
  const failed = await f.runOnce();
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.exitCode, 1);
  const leftover = reap(t, Number(/pid (\d+)/.exec(failed.outputTail ?? "")?.[1]));
  assert.ok(await gone(leftover), "the pipeless leftover still runs");
});

test("cancel and shutdown stop a running test job and its process group", async (t) => {
  const f = await fixture(t);
  await f.confirm(await lingering(f.directory));
  await en(() => f.byHand.runTests(f.run.id, {}));
  const first = (await f.liveMatch(/pids (\d+ \d+)/)).value.split(" ").map(Number);
  // Stop on the run (Workbench.cancel) ends the test job; the run keeps its status.
  await f.workbench.cancel(f.run.id);
  assert.equal(f.run.status, "review");
  assert.equal(f.run.byHand?.tests?.at(-1)?.outcome, "stopped");
  for (const pid of first) assert.ok(await gone(pid), `process ${pid} still runs`);
  await en(() => f.byHand.runTests(f.run.id, {}));
  const second = (await f.liveMatch(/pids (\d+ \d+)/)).value.split(" ").map(Number);
  await f.shutdown();
  assert.equal(f.run.byHand?.tests?.length, 2);
  assert.equal(f.run.byHand?.tests?.at(-1)?.outcome, "stopped");
  assert.equal(f.run.byHand?.busy, undefined);
  for (const pid of second) assert.ok(await gone(pid), `process ${pid} still runs`);
  // Nothing new starts once shutdown has begun.
  await assert.rejects(f.byHand.runTests(f.run.id, {}), (error: AppError) => error.statusCode === 503);
});

test("the command runs in the run's folder without secret variables, with CI=1 and NO_COLOR=1", async (t) => {
  const f = await fixture(t);
  const names = ["GH_TOKEN", "OPENAI_API_KEY", "BELLPR_X", "MY_SECRET", "JAVA_HOME", "CI", "NO_COLOR"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const name of names)
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
  });
  Object.assign(process.env, {
    GH_TOKEN: "not-a-real-token",
    OPENAI_API_KEY: "not-a-real-key",
    BELLPR_X: "bell",
    MY_SECRET: "hidden",
    JAVA_HOME: "/opt/jdk",
    CI: "false",
  });
  await f.confirm(
    `node -e "console.log('cwd=' + process.cwd()); for (const n of ${JSON.stringify(names).replaceAll('"', "'")}) console.log(n + '=' + (process.env[n] ?? '<unset>'))"`,
  );
  const result = await f.runOnce();
  assert.equal(result.outcome, "passed");
  assert.deepEqual(result.outputTail?.split("\n"), [
    `cwd=${f.repository}`,
    "GH_TOKEN=<unset>",
    "OPENAI_API_KEY=<unset>",
    "BELLPR_X=<unset>",
    "MY_SECRET=<unset>",
    "JAVA_HOME=/opt/jdk",
    "CI=1",
    "NO_COLOR=1",
  ]);
});

const npmOnPath = (process.env.PATH ?? "").split(path.delimiter).some((folder) => existsSync(path.join(folder, "npm")));

test("started by npx, BELL runs npm test as the person's terminal would: no npx flags, no other project's tools", { skip: !npmOnPath }, async (t) => {
  const f = await fixture(t);
  // Another project, where the person ran `npx --yes --offline bell-pr`; its tools are not this project's.
  const elsewhere = path.join(f.directory, "elsewhere");
  await mkdir(path.join(elsewhere, "node_modules", ".bin"), { recursive: true });
  await writeFile(path.join(elsewhere, "node_modules", ".bin", "greet"), "#!/bin/sh\necho other project\n", { mode: 0o755 });
  const chain: string[] = [];
  for (let folder = elsewhere; ; folder = path.dirname(folder)) {
    chain.push(path.join(folder, "node_modules", ".bin"));
    if (folder === path.dirname(folder)) break;
  }
  // npm keeps its cache and log files in the test's folder.
  const npx: NodeJS.ProcessEnv = {
    PATH: [...chain, "/usr/share/nodejs/@npmcli/run-script/lib/node-gyp-bin", process.env.PATH].join(path.delimiter),
    INIT_CWD: elsewhere,
    NODE: process.execPath,
    COLOR: "0",
    npm_command: "exec",
    npm_config_offline: "true",
    npm_config_yes: "true",
    npm_config_local_prefix: elsewhere,
    npm_execpath: "/usr/share/nodejs/npm/bin/npx-cli.js",
    npm_lifecycle_event: "npx",
    npm_lifecycle_script: "bell-pr",
    npm_node_execpath: process.execPath,
    npm_package_json: path.join(elsewhere, "package.json"),
    NPM_CONFIG_CACHE: path.join(f.directory, "npm-cache"),
    NPM_CONFIG_USERCONFIG: path.join(f.directory, "npmrc"),
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
  };
  const saved = Object.fromEntries(Object.keys(npx).map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of Object.entries(saved))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });
  Object.assign(process.env, npx);
  await writeFile(path.join(f.directory, "npmrc"), "");
  await writeFile(
    path.join(f.repository, "package.json"),
    JSON.stringify({
      name: "retry",
      scripts: { test: `echo "offline=$npm_config_offline yes=$npm_config_yes init=$INIT_CWD" && greet` },
    }),
  );
  await f.confirm("npm test --silent");
  const result = await f.runOnce();
  // As in a terminal: npm's own defaults, this project's folder, and no greet here.
  assert.equal(result.outcome, "failed");
  assert.equal(result.exitCode, 127);
  assert.match(result.outputTail ?? "", new RegExp(`^offline= yes= init=${f.repository}$`, "m"));
  assert.doesNotMatch(result.outputTail ?? "", /other project/);
});

test("runs are refused with 409 without a confirmed command, while one runs, outside review and on agent runs", async (t) => {
  const f = await fixture(t);
  const refused = (message: string) => (error: AppError) => error.statusCode === 409 && error.message === message;
  await assert.rejects(
    en(() => f.byHand.runTests(f.run.id, {})),
    refused("Confirm a test command for this project first."),
  );
  assert.equal(f.run.byHand?.tests?.length ?? 0, 0);
  await f.confirm(`node -e "setInterval(() => {}, 1000)"`);
  await en(() => f.byHand.runTests(f.run.id, {}));
  await assert.rejects(
    en(() => f.byHand.runTests(f.run.id, {})),
    refused("Your tests are already running. Wait for them to finish, or stop them."),
  );
  await f.byHand.stopTests(f.run.id);
  // Only while the change waits for review, and never while publishing.
  f.run.status = "awaiting_plan";
  const notNow = refused("Tests run while the change waits for your review, not while the run plans or publishes.");
  await assert.rejects(en(() => f.byHand.runTests(f.run.id, {})), notNow);
  f.run.status = "approved";
  await assert.rejects(en(() => f.byHand.runTests(f.run.id, {})), notNow);
  f.run.status = "review";
  f.run.publishing = true;
  await assert.rejects(en(() => f.byHand.runTests(f.run.id, {})), notNow);
  delete f.run.publishing;
  // One guide turn, review or test job at a time.
  f.run.byHand!.busy = { kind: "guide", since: new Date().toISOString() };
  await assert.rejects(
    en(() => f.byHand.runTests(f.run.id, {})),
    refused("The guide is already working on this run. Wait for it to finish, or stop it."),
  );
  delete f.run.byHand!.busy;
  // An agent run never runs tests.
  delete f.run.learnByHand;
  await assert.rejects(en(() => f.byHand.runTests(f.run.id, {})), refused("This is only for Learn-by-hand runs."));
  assert.equal(f.run.byHand?.tests?.length, 1);
});

test("byHand.busy: the tests take the slot only when it is free and clear only their own mark, on every end", async (t) => {
  const f = await fixture(t);
  const busy = () => f.run.byHand?.busy;
  const since = new Date().toISOString();
  // Another job holds the slot: no run starts, and its mark stays.
  await f.confirm(`node -e "process.exit(0)"`);
  for (const kind of ["guide", "review"]) {
    (f.run.byHand ??= {}).busy = { kind, since };
    await assert.rejects(en(() => f.byHand.runTests(f.run.id, {})), (error: AppError) => error.statusCode === 409);
    assert.deepEqual(busy(), { kind, since });
  }
  delete f.run.byHand!.busy;
  // Passed and failed (each waits until the mark is gone).
  assert.equal((await f.runOnce()).outcome, "passed");
  await f.confirm(`node -e "process.exit(1)"`);
  assert.equal((await f.runOnce()).outcome, "failed");
  // The shell cannot start: the run's folder vanished after the change was read.
  const moved = `${f.repository}-moved`;
  const diff = f.workbench.diff.bind(f.workbench);
  f.workbench.diff = async (id) => {
    const files = await diff(id);
    await rename(f.repository, moved);
    return files;
  };
  try {
    const failed = await f.runOnce();
    assert.equal(failed.outcome, "error");
    assert.match(f.run.logs.at(-1)?.message ?? "", /^Your test command could not start: /);
  } finally {
    f.workbench.diff = diff;
    await rename(moved, f.repository);
  }
  assert.equal(busy(), undefined);
  // Stop on the run (cancel) clears the mark.
  await f.confirm(`node -e "setInterval(() => {}, 1000)"`);
  await en(() => f.byHand.runTests(f.run.id, {}));
  assert.equal(busy()?.kind, "tests");
  await f.workbench.cancel(f.run.id);
  assert.equal(f.run.byHand?.tests?.at(-1)?.outcome, "stopped");
  assert.equal(busy(), undefined);
  // A mark of another kind is never cleared by the tests' end.
  await en(() => f.byHand.runTests(f.run.id, {}));
  f.run.byHand!.busy = { kind: "guide", since };
  await f.byHand.stopTests(f.run.id);
  assert.equal(f.run.byHand?.tests?.at(-1)?.outcome, "stopped");
  assert.deepEqual(busy(), { kind: "guide", since });
});

test("the stored tail is ANSI-stripped, keeps what a terminal shows of progress lines, and masks credentials", async (t) => {
  const f = await fixture(t);
  // A credential the person wrote into the command is masked in the record too.
  const inline = `ghp_${"D".repeat(30)}`;
  await f.confirm(
    `TOKEN_FOR_TESTS=${inline} node -e "console.log('\\x1b[31mFAIL\\x1b[0m retry.test.js'); console.log('progress 10%\\rprogress 100%'); console.error('token ghp_' + 'B'.repeat(30) + ' sent'); process.exit(1)"`,
  );
  const result = await f.runOnce();
  assert.equal(result.outcome, "failed");
  assert.equal(result.outputTail, "FAIL retry.test.js\nprogress 100%\ntoken [REDACTED] sent");
  assert.match(result.command, /^TOKEN_FOR_TESTS=\[REDACTED\] node -e/);
  assert.doesNotMatch(JSON.stringify(f.run.byHand), /ghp_B|ghp_D|\\u001b/);
});

test("the command a run records stays within 300 characters after masking", async (t) => {
  const f = await fixture(t);
  // Masking a short password makes it longer ("[REDACTED]" is 10 characters).
  const command = `node -e "process.exit(0)" # password=12345678 ${"x".repeat(260)}`.slice(0, 300);
  await f.confirm(command);
  const ran = await f.runOnce();
  assert.match(ran.command, /password=\[REDACTED\]/);
  assert.ok(ran.command.length <= 300, `${ran.command.length} characters`);
  const reported = (await f.byHand.reportTests(f.run.id, { outcome: "passed" })).run.byHand!.tests!.at(-1)!;
  assert.ok(reported.command.length <= 300, `${reported.command.length} characters`);
});

test("the live tail starts at a whole line, so a credential cut at its start is not shown in part", async (t) => {
  const f = await fixture(t);
  // 65,556 characters: a 64 KiB window from the end starts inside the token.
  await f.confirm(
    `node -e "console.log('token ghp_' + 'A'.repeat(30)); for (let i = 0; i < 655; i++) console.log('x'.repeat(99)); console.log('y'.repeat(14) + ' done'); setInterval(() => {}, 1000)"`,
  );
  await en(() => f.byHand.runTests(f.run.id, {}));
  const { live } = await f.liveMatch(/(done)$/m);
  assert.doesNotMatch(live.tail, /A{8}/);
  assert.match(live.tail, /^x{99}$/m);
  const { run } = await en(() => f.byHand.stopTests(f.run.id));
  assert.doesNotMatch(run.byHand?.tests?.at(-1)?.outputTail ?? "", /A{8}/);
});

test("new untracked files the command created are listed; ignored and earlier files are not", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.repository, "notes.txt"), "mine\n");
  await f.confirm(
    `node -e "const fs = require('fs'); fs.writeFileSync('made-by-tests.txt', 'x'); fs.writeFileSync('run.log', 'x'); fs.mkdirSync('ignored'); fs.writeFileSync('ignored/cache', 'x')"`,
  );
  const result = await f.runOnce();
  assert.equal(result.outcome, "passed");
  assert.deepEqual(result.newFiles, ["made-by-tests.txt"]);
  // The change the run started on did not have the file yet.
  assert.notEqual(result.changeFingerprint, changeFingerprint(await readDiff(f.run)));
});

test("a 3 MB output is not cut at 2 MB; past the output limit the run is an error with the end kept", async (t) => {
  const f = await fixture(t);
  const verbose = (lines: number) =>
    `node -e "const line = 'x'.repeat(99) + '\\n'; for (let i = 0; i < ${lines}; i++) process.stdout.write(line); console.log('END OF OUTPUT')"`;
  await f.confirm(verbose(30_000));
  const large = await f.runOnce();
  assert.equal(large.outcome, "passed");
  assert.equal(large.exitCode, 0);
  assert.ok(large.outputTail?.endsWith("\nEND OF OUTPUT"));
  assert.equal(large.outputTail?.length, 4000);
  testRunLimits.maxBytes = 1_048_576;
  const result = await f.runOnce();
  assert.equal(result.outcome, "error");
  assert.equal(result.exitCode, undefined);
  assert.match(result.outputTail ?? "", /^x{99}$/m);
  assert.equal(f.run.logs.at(-1)?.message, "Your tests wrote more than 1 MB of output, so BELL PR stopped them. The end of the output is kept.");
});

test("long runs of carriage returns or digits in the output keep BELL responsive", async (t) => {
  const f = await fixture(t);
  // A runaway progress line and a long number: each took seconds of the server's one thread.
  await f.confirm(`node -e "process.stdout.write('7'.repeat(60000) + '\\n' + '\\r'.repeat(131072) + 'done\\n')"`);
  let gap = 0;
  let last = Date.now();
  const timer = setInterval(() => {
    gap = Math.max(gap, Date.now() - last);
    last = Date.now();
  }, 10);
  t.after(() => clearInterval(timer));
  const result = await f.runOnce();
  clearInterval(timer);
  assert.equal(result.outcome, "passed");
  assert.ok(result.outputTail?.endsWith("7777\ndone"), result.outputTail?.slice(-20));
  assert.match(result.tailHash ?? "", /^[0-9a-f]{16}$/);
  assert.ok(gap < 1_500, `BELL's event loop stood still for ${gap} ms`);
});

test("a new run starts at once when the last one shows its result and the run is no longer busy", async (t) => {
  const f = await fixture(t);
  await f.confirm(`node -e "process.exit(1)"`);
  // A slow disk: the job's last save takes a while after the result shows.
  const save = f.store.save.bind(f.store);
  f.store.save = async () => {
    await sleep(200);
    return save();
  };
  for (let index = 1; index <= 3; index++) {
    // As the Tests card does: Run again as soon as the result shows and busy is gone.
    await en(() => f.byHand.runTests(f.run.id, {}));
    while ((f.run.byHand?.tests?.length ?? 0) < index || f.run.byHand?.busy) await sleep(5);
  }
  assert.deepEqual(
    f.run.byHand?.tests?.map((test) => test.outcome),
    ["failed", "failed", "failed"],
  );
});

test("three identical failures in a row hash alike, even when their timings differ", async (t) => {
  const f = await fixture(t);
  await f.confirm(
    `node -e "console.log('FAIL retry.test.js (' + Math.ceil(Math.random() * 900) + ' ms)'); console.log('1 failed in ' + Math.random().toFixed(3) + 's at ' + new Date().toISOString().slice(11, 23)); process.exit(1)"`,
  );
  const runs: TestRun[] = [];
  for (let index = 0; index < 3; index++) runs.push(await f.runOnce());
  assert.equal(new Set(runs.map((run) => run.tailHash)).size, 1);
  assert.equal(repeatFailure(f.run.byHand?.tests), true);
  await f.confirm(`node -e "console.log('a different failure'); process.exit(1)"`);
  assert.notEqual((await f.runOnce()).tailHash, runs[0].tailHash);
  assert.equal(repeatFailure(f.run.byHand?.tests), false);
});

test("a result reported from the person's own terminal is stored as reported, with the current change", async (t) => {
  const f = await fixture(t);
  const files = await readDiff(f.run);
  const { run } = await en(() =>
    f.byHand.reportTests(f.run.id, { outcome: "failed", output: "\x1b[31m1 failed\x1b[0m\nkey ghp_" + "C".repeat(30) + "\n\n" }),
  );
  const reported = run.byHand!.tests!.at(-1)!;
  assert.deepEqual({ ...reported, at: "" }, {
    at: "",
    command: "",
    changeFingerprint: changeFingerprint(files),
    outcome: "failed",
    ms: 0,
    outputTail: "1 failed\nkey [REDACTED]",
    reported: true,
  });
  await f.confirm("npm test");
  const passed = (await f.byHand.reportTests(f.run.id, { outcome: "passed" })).run.byHand!.tests!.at(-1)!;
  assert.equal(passed.command, "npm test");
  assert.equal(passed.outputTail, undefined);
  assert.equal(passed.reported, true);
  f.run.status = "awaiting_plan";
  await assert.rejects(en(() => f.byHand.reportTests(f.run.id, { outcome: "passed" })), (error: AppError) => error.statusCode === 409);
});

test("the record keeps the newest 10 runs and the output of the newest 5", async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 12; index++)
    await f.byHand.reportTests(f.run.id, { outcome: "failed", output: `run ${index}` });
  const tests = f.run.byHand!.tests!;
  assert.equal(tests.length, 10);
  assert.deepEqual(
    tests.map((entry) => entry.outputTail),
    [undefined, undefined, undefined, undefined, undefined, "run 7", "run 8", "run 9", "run 10", "run 11"],
  );
});

test("the test command view: BELL's suggestion from the run's folder and the person's confirmation", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.byHand.testCommand(f.run.id), { suggestion: "" });
  await writeFile(path.join(f.repository, "go.mod"), "module example.com/retry\n");
  assert.deepEqual(await f.byHand.testCommand(f.run.id), { suggestion: "go test ./..." });
  const { repo } = await f.confirm("  go test ./retry/...  ");
  assert.equal(repo.testCommand?.command, "go test ./retry/...");
  const first = repo.testCommand!.confirmedAt;
  assert.deepEqual(await f.byHand.testCommand(f.run.id), {
    suggestion: "go test ./...",
    confirmed: { command: "go test ./retry/...", confirmedAt: first },
  });
  // Every confirmation is new, also of the same text.
  await sleep(5);
  const again = (await f.confirm("go test ./retry/...")).repo.testCommand!;
  assert.ok(Date.parse(again.confirmedAt) > Date.parse(first));
  // One line, no control characters, 1-300 characters.
  for (const command of [
    "go test\nrm -rf ~",
    "go\rtest",
    "go\0test",
    "go \x1b[2Jtest",
    "go test\u0085./...",
    "go test\u2028./...",
    "go test \u202e/... ./",
    "go\u200btest",
    // A lone surrogate is shown as a replacement character and run as another.
    "go\ud800test",
    "   ",
    "x".repeat(301),
  ])
    await assert.rejects(
      f.confirm(command),
      (error: AppError) =>
        error.statusCode === 400 && error.message === "Write the test command on one line, without control characters.",
      JSON.stringify(command),
    );
  assert.equal((await f.confirm("go test\t./...")).repo.testCommand?.command, "go test\t./...");
  assert.equal((await f.confirm("x".repeat(300))).repo.testCommand?.command.length, 300);
  await assert.rejects(
    f.byHand.confirmTestCommand("missing", { command: "npm test" }),
    (error: AppError) => error.statusCode === 404,
  );
});

test("a run uses the command confirmed last before it starts, and a confirmation while it runs applies to the next run", async (t) => {
  const f = await fixture(t);
  await f.confirm(`node -e "console.log('first')"`);
  // A new confirmation lands while the run reads the change.
  const diff = f.workbench.diff.bind(f.workbench);
  f.workbench.diff = async (id) => {
    const files = await diff(id);
    if (f.run.byHand?.tests === undefined) await f.confirm(`node -e "console.log('second')"`);
    return files;
  };
  const first = await f.runOnce();
  assert.equal(first.command, `node -e "console.log('second')"`);
  assert.equal(first.outputTail, "second");
  // Confirmed while a run goes on: that run keeps its command and records it.
  await f.confirm(`node -e "setTimeout(() => console.log('slow'), 500)"`);
  await en(() => f.byHand.runTests(f.run.id, {}));
  await f.confirm(`node -e "console.log('third')"`);
  const slow = await f.finished(2);
  assert.equal(slow.outputTail, "slow");
  assert.equal(slow.command, `node -e "setTimeout(() => console.log('slow'), 500)"`);
  assert.equal((await f.runOnce()).outputTail, "third");
});

test("only the confirmed command runs: no route takes a command with a run request", async (t) => {
  const f = await fixture(t);
  // Every Learn-by-hand request schema except the confirm refuses a command field.
  const valid: Record<string, Record<string, unknown>> = {
    planSchema: { steps: [{ title: "Read the retry loop" }] },
    revealSchema: { mode: "names" },
    stepSchema: { done: true },
    guideSchema: { kind: "test" },
    checkInSchema: { signal: "button" },
    testRunSchema: { prediction: "fail" },
    testReportSchema: { outcome: "passed" },
    readySchema: { changeFingerprint: "0123456789abcdef", review: false },
  };
  const schemas = Object.entries(byHandRoutes).filter(([name]) => name.endsWith("Schema") && name !== "testCommandSchema");
  assert.deepEqual(schemas.map(([name]) => name).sort(), Object.keys(valid).sort());
  for (const [name, schema] of schemas) {
    const parse = (schema as { safeParse(value: unknown): { success: boolean } }).safeParse;
    assert.equal(parse(valid[name]).success, true, name);
    assert.equal(parse({ ...valid[name], command: "rm -rf ~" }).success, false, name);
  }
  // Over HTTP: the run request with a command is a 400, and nothing runs.
  const app = createApp(f.workbench, { staticDirectory: path.join(f.directory, "missing"), license: fixedLicense("free") });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
  });
  const { port } = server.address() as AddressInfo;
  const call = (method: string, endpoint: string, body: unknown) =>
    new Promise<number>((resolve, reject) => {
      const text = JSON.stringify(body);
      const req = request(
        `http://127.0.0.1:${port}/api${endpoint}`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(text),
            Host: "127.0.0.1:4311",
            "X-Bell-Locale": "en",
          },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode!));
        },
      );
      req.on("error", reject);
      req.end(text);
    });
  const marker = path.join(f.directory, "ran");
  assert.equal(await call("POST", `/runs/${f.run.id}/by-hand/tests`, { command: `touch ${marker}` }), 400);
  // Without a confirmed command the run request is refused too.
  assert.equal(await call("POST", `/runs/${f.run.id}/by-hand/tests`, {}), 409);
  assert.equal(await call("PUT", `/repos/${f.repo.id}/test-command`, { command: "npm test\nrm -rf ~" }), 400);
  assert.equal(await call("PUT", `/repos/${f.repo.id}/test-command`, { command: `node -e "console.log('confirmed')"` }), 200);
  assert.equal(await call("POST", `/runs/${f.run.id}/by-hand/tests`, { prediction: "pass" }), 202);
  const result = await f.finished(1);
  assert.equal(result.outputTail, "confirmed");
  assert.equal(existsSync(marker), false);
});
