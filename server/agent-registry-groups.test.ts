// The process group of the person's test command (command()'s `endGroup`,
// server/by-hand-tests.ts) is recorded in children.json like an agent's,
// until the whole group is gone, and a test run a crashed BELL PR left
// behind is stopped at the next start. Every process is a harmless shell
// loop in its own group, stopped by the test that started it.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { AgentRegistry, readChildren, reapOrphanedAgents, writeChildren } from "./agent-registry.js";
import { command } from "./process.js";

const posix = process.platform !== "win32";

function groupAlive(pgid: number) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits until the group is gone; killed processes may wait a moment to be reaped. */
async function groupGone(pgid: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (groupAlive(pgid)) {
    if (Date.now() > deadline) return false;
    await sleep(20);
  }
  return true;
}

/** Ends a group this test started (by its own pgid), whatever state the test left it in. */
function endOwnGroup(pgid: number | undefined) {
  if (!pgid) return;
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/** A shell loop in its own process group, as a test run left by a crashed BELL PR. */
function orphan(script: string): ChildProcess {
  return spawn("/bin/sh", ["-c", script], { detached: true, stdio: "ignore" });
}

async function temp() {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-pr-test-groups-"));
  return { directory, file: path.join(directory, "children.json"), cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("a test command's process group is recorded while it runs and dropped once the group is gone", { skip: !posix }, async () => {
  const { file, cleanup } = await temp();
  const registry = new AgentRegistry(file);
  registry.start();
  let pgid: number | undefined;
  try {
    let printed = () => {};
    const ready = new Promise<void>((resolve) => (printed = resolve));
    const run = command("/bin/sh", ["-c", "echo $$; sleep 1"], {
      endGroup: { settleAfterExitMs: 2_000 },
      onLine: (line) => {
        pgid = Number(line);
        printed();
      },
    });
    await ready;
    assert.deepEqual(
      readChildren(file).map(({ pgid, executable }) => ({ pgid, executable })),
      [{ pgid, executable: "sh" }],
    );
    await run;
    assert.equal(groupAlive(pgid!), false);
    assert.deepEqual(readChildren(file), []);
    // Without endGroup a shell is not recorded, as before.
    await command("/bin/sh", ["-c", "true"]);
    assert.deepEqual(readChildren(file), []);
  } finally {
    registry.stop();
    endOwnGroup(pgid);
    await cleanup();
  }
});

test("a recorded test run is stopped at the next start, and only while its first process shows it is the same group", { skip: !posix }, async () => {
  const { file, cleanup } = await temp();
  const stubborn = orphan("trap '' TERM; while :; do sleep 1; done");
  const reused = orphan("sleep 300");
  // The first process exited; only its background child is left.
  const leaderless = orphan("sleep 300 & exit 0");
  try {
    await once(leaderless, "exit");
    await sleep(200);
    const now = new Date().toISOString();
    writeChildren(file, [
      { pgid: stubborn.pid!, executable: "sh", startedAt: now },
      // Recorded 45 s before its first process started: the pid was reused.
      { pgid: reused.pid!, executable: "sh", startedAt: new Date(Date.now() - 45_000).toISOString() },
      { pgid: leaderless.pid!, executable: "sh", startedAt: now },
    ]);
    const result = await reapOrphanedAgents(file, { graceMs: 300 });
    assert.deepEqual(result.terminated.map((child) => child.pgid), [stubborn.pid]);
    assert.deepEqual(result.killed.map((child) => child.pgid), [stubborn.pid]);
    assert.deepEqual(result.skipped.map((child) => child.pgid), [reused.pid, leaderless.pid]);
    assert.equal(await groupGone(stubborn.pid!), true);
    assert.equal(groupAlive(reused.pid!), true);
    assert.equal(groupAlive(leaderless.pid!), true);
    assert.deepEqual(readChildren(file), []);
  } finally {
    for (const child of [stubborn, reused, leaderless]) endOwnGroup(child.pid);
    await cleanup();
  }
});

test("a test run a crashed BELL PR left behind is recorded and stopped at the next start", { skip: !posix }, async () => {
  const { directory, file, cleanup } = await temp();
  // A stand-in for BELL PR: it records its groups and runs a test command
  // that ignores SIGTERM, then is killed without a chance to clean up.
  const script = path.join(directory, "bell.mjs");
  writeFileSync(
    script,
    `const [registryUrl, processUrl, file] = process.argv.slice(2);
const { AgentRegistry } = await import(registryUrl);
const { command } = await import(processUrl);
new AgentRegistry(file).start();
await command("/bin/sh", ["-c", "trap '' TERM; echo ready $$; while :; do sleep 1; done"], {
  endGroup: { settleAfterExitMs: 2000 },
  timeoutMs: 60000,
  onLine: (line) => console.log(line),
});
`,
  );
  const url = (name: string) => pathToFileURL(path.join(import.meta.dirname, name)).href;
  const bell = spawn(process.execPath, ["--import", "tsx", script, url("agent-registry.ts"), url("process.ts"), file], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "inherit"],
  });
  let pgid: number | undefined;
  try {
    pgid = await new Promise<number>((resolve, reject) => {
      bell.stdout!.on("data", (data: Buffer) => {
        const match = /ready (\d+)/.exec(data.toString());
        if (match) resolve(Number(match[1]));
      });
      bell.once("exit", () => reject(new Error("the stand-in exited early")));
    });
    assert.deepEqual(readChildren(file).map((child) => child.pgid), [pgid]);
    bell.kill("SIGKILL");
    await once(bell, "exit");
    await sleep(200);
    // The test run outlives its BELL PR: it has its own session.
    assert.equal(groupAlive(pgid), true);
    const result = await reapOrphanedAgents(file, { graceMs: 300 });
    assert.deepEqual(result.terminated.map((child) => child.pgid), [pgid]);
    assert.deepEqual(result.killed.map((child) => child.pgid), [pgid]);
    assert.equal(await groupGone(pgid), true);
    assert.deepEqual(readChildren(file), []);
  } finally {
    if (bell.exitCode === null && bell.signalCode === null) bell.kill("SIGKILL");
    endOwnGroup(pgid);
    await cleanup();
  }
});
