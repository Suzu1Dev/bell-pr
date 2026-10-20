// command()'s default-off `endGroup` and `discardOutput` options, used for
// the person's test command (server/by-hand-tests.ts): the whole process
// group ends with the command, the command settles on its own process's
// exit, the group is recorded for the crash reaper until it is gone, and
// the output reaches only onLine.
// Every command is a harmless `node -e` script; every process a test
// starts is stopped by the test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { command, setSpawnObserver } from "./process.js";
import { AppError } from "./types.js";

const posix = process.platform !== "win32";
const everyCode = Array.from({ length: 256 }, (_, code) => code);

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits until the process is gone; a killed process may wait a moment to be reaped. */
async function gone(pid: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (alive(pid)) {
    if (Date.now() > deadline) return false;
    await sleep(20);
  }
  return true;
}

/**
 * Stops whatever a test left behind: by pid, and only while its command
 * line is still the test's own script (Linux).
 */
function cleanup(pids: number[]) {
  for (const pid of pids)
    try {
      if (readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("setInterval")) process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
}

/**
 * A grandchild that ignores SIGTERM and holds no output pipe, so only a
 * SIGKILL to the group reaches it after its parent closed the pipes. Once
 * it ignores SIGTERM, the script prints its pid, then `then` runs.
 */
const stubborn = (then: string) =>
  `const { spawn } = require("child_process");
const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); process.send('ready', () => process.disconnect()); setInterval(() => {}, 1000)"], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
child.once("message", () => {
  console.log("pid " + child.pid);
  ${then}
});`;

/** Runs `script` with node: its result, and the first pid it prints once `printed` resolves. */
function start(script: string, options: Parameters<typeof command>[2] = {}) {
  let pid = 0;
  let resolvePrinted = () => {};
  const printed = new Promise<void>((resolve) => (resolvePrinted = resolve));
  const result = command(process.execPath, ["-e", script], {
    ...options,
    onLine: (line) => {
      const match = /^pid (\d+)$/.exec(line);
      if (match && !pid) {
        pid = Number(match[1]);
        resolvePrinted();
      }
    },
  });
  // The test awaits the result itself; this only keeps an early rejection handled.
  result.catch(() => {});
  return {
    printed,
    result,
    get pid() {
      return pid;
    },
  };
}

test("without endGroup, a grandchild that holds no pipe outlives the command (the default is unchanged)", { skip: !posix }, async () => {
  const run = start(stubborn("process.exit(0)"));
  await run.printed;
  try {
    const result = await run.result;
    assert.equal(result.code, 0);
    await sleep(200);
    assert.equal(alive(run.pid), true);
  } finally {
    cleanup([run.pid]);
  }
});

test("endGroup: Stop ends a grandchild that ignores SIGTERM and holds no pipe", { skip: !posix }, async () => {
  const controller = new AbortController();
  const run = start(stubborn("setInterval(() => {}, 1000)"), {
    signal: controller.signal,
    timeoutMs: 30_000,
    endGroup: { settleAfterExitMs: 2_000 },
  });
  await run.printed;
  try {
    assert.equal(alive(run.pid), true);
    controller.abort();
    await assert.rejects(run.result, (error: AppError) => error.statusCode === 409);
    assert.equal(await gone(run.pid), true, "the grandchild still runs after Stop");
  } finally {
    cleanup([run.pid]);
  }
});

test("endGroup: the timeout ends a grandchild that ignores SIGTERM and holds no pipe", { skip: !posix }, async () => {
  const run = start(stubborn("setInterval(() => {}, 1000)"), {
    timeoutMs: 1_000,
    endGroup: { settleAfterExitMs: 2_000 },
  });
  await run.printed;
  try {
    await assert.rejects(run.result, (error: AppError) => error.statusCode === 504);
    assert.equal(await gone(run.pid), true, "the grandchild still runs after the timeout");
  } finally {
    cleanup([run.pid]);
  }
});

test("endGroup: what the command left behind is ended when it exits on its own", { skip: !posix }, async () => {
  const run = start(stubborn("process.exit(4)"), {
    timeoutMs: 30_000,
    allowedCodes: everyCode,
    endGroup: { settleAfterExitMs: 2_000 },
  });
  await run.printed;
  try {
    const result = await run.result;
    assert.equal(result.code, 4);
    assert.equal(await gone(run.pid), true, "the grandchild outlived the command");
  } finally {
    cleanup([run.pid]);
  }
});

test("endGroup: a command whose background process holds its output settles on its own exit, with its exit code", { skip: !posix }, async () => {
  // The grandchild inherits stdout, so the pipe stays open after the
  // command's own process exits: without endGroup only the timeout ends it.
  const script = `const { spawn } = require("child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
console.log("pid " + child.pid);
console.log("3 passing");
setTimeout(() => process.exit(0), 100);`;
  const lines: string[] = [];
  let pid = 0;
  const startedAt = Date.now();
  try {
    const result = await command(process.execPath, ["-e", script], {
      timeoutMs: 15_000,
      allowedCodes: everyCode,
      endGroup: { settleAfterExitMs: 300 },
      onLine: (line) => {
        lines.push(line);
        pid ||= Number(/^pid (\d+)$/.exec(line)?.[1] ?? 0);
      },
    });
    assert.equal(result.code, 0);
    assert.ok(Date.now() - startedAt < 10_000, `settled after ${Date.now() - startedAt} ms`);
    assert.deepEqual(lines.slice(1), ["3 passing"]);
    assert.equal(await gone(pid), true, "the background process still runs");
  } finally {
    if (pid) cleanup([pid]);
  }
});

test("endGroup: a Stop after the command's own exit keeps its exit code", { skip: !posix }, async () => {
  const controller = new AbortController();
  const script = `const { spawn } = require("child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
console.log("pid " + child.pid);
setTimeout(() => process.exit(2), 100);`;
  let pid = 0;
  const result = command(process.execPath, ["-e", script], {
    signal: controller.signal,
    timeoutMs: 15_000,
    allowedCodes: everyCode,
    endGroup: { settleAfterExitMs: 10_000 },
    onLine: (line) => {
      pid ||= Number(/^pid (\d+)$/.exec(line)?.[1] ?? 0);
    },
  });
  try {
    // The command's process has exited; its leftover holds the pipe.
    while (!pid) await sleep(20);
    await sleep(500);
    const stoppedAt = Date.now();
    controller.abort();
    assert.equal((await result).code, 2);
    assert.ok(Date.now() - stoppedAt < 5_000);
    assert.equal(await gone(pid), true);
  } finally {
    if (pid) cleanup([pid]);
  }
});

test("endGroup: the spawn observer records the group and hears of its exit only once the group is gone", { skip: !posix }, async () => {
  const events: string[] = [];
  let pid = 0;
  setSpawnObserver({
    onSpawn: (spawned, executable, details) =>
      events.push(`spawn ${spawned > 0} ${executable === process.execPath} ${JSON.stringify(details ?? null)}`),
    onExit: () => events.push(`exit ${pid > 0 && !alive(pid)}`),
  });
  try {
    const result = await command(process.execPath, ["-e", stubborn("process.exit(0)")], {
      endGroup: { settleAfterExitMs: 2_000 },
      onLine: (line) => {
        pid ||= Number(/^pid (\d+)$/.exec(line)?.[1] ?? 0);
      },
    });
    assert.equal(result.code, 0);
    assert.equal(await gone(pid), true);
    assert.deepEqual(events, ['spawn true true {"recordGroup":true}', "exit true"]);
    // Without endGroup the observer hears the two arguments it always did.
    events.length = 0;
    await command(process.execPath, ["-e", ""]);
    assert.deepEqual(events, ["spawn true true null", `exit ${!alive(pid)}`]);
  } finally {
    setSpawnObserver();
    if (pid) cleanup([pid]);
  }
});

test("endGroup: a command that cannot start still rejects, and nothing is recorded", async () => {
  const events: string[] = [];
  setSpawnObserver({ onSpawn: () => events.push("spawn"), onExit: () => events.push("exit") });
  try {
    await assert.rejects(
      command("bell-pr-no-such-command", [], { endGroup: { settleAfterExitMs: 100 } }),
      (error: AppError) => error.statusCode === 503,
    );
    assert.deepEqual(events, []);
  } finally {
    setSpawnObserver();
  }
});

test("discardOutput: lines reach onLine, and the result keeps no output", async () => {
  const lines: string[] = [];
  const result = await command(
    process.execPath,
    ["-e", "console.log('a'); console.error('b'); process.stdout.write('c')"],
    { discardOutput: true, onLine: (line, stream) => lines.push(`${stream} ${line}`) },
  );
  assert.deepEqual({ ...result }, { stdout: "", stderr: "", code: 0 });
  assert.deepEqual(lines.sort(), ["stderr b", "stdout a", "stdout c"]);
});
