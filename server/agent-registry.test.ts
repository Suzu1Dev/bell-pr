import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AgentRegistry,
  childSchema,
  isAgentCommand,
  isAgentExecutable,
  parsePsLine,
  readChildren,
  reapOrphanedAgents,
  writeChildren,
} from "./agent-registry.js";
import { resolveConfig } from "./config.js";
import { startServer } from "./index.js";
import { readModelCatalog } from "./models.js";
import { lenientRead } from "./persisted-schema.js";
import { command, setSpawnObserver } from "./process.js";

const posix = process.platform !== "win32";

async function tempDir() {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-pr-agents-"));
  const bin = path.join(directory, "bin");
  mkdirSync(bin);
  return { directory, bin, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

/** Puts `bin` first on PATH while `fn` runs. */
async function withPath<T>(bin: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = previous;
  }
}

function script(file: string, body: string) {
  writeFileSync(file, body, { mode: 0o755 });
  return file;
}

/** Waits for `predicate` to hold, polling every 20 ms. */
async function until(predicate: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Starts a long-running fake agent in its own process group, as if a
 * crashed BELL PR had left it behind.
 */
function orphan(file: string): ChildProcess {
  return spawn(file, [], { detached: true, stdio: "ignore" });
}

function exitOf(child: ChildProcess) {
  return new Promise<NodeJS.Signals | number | null>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null)
      resolve(child.signalCode ?? child.exitCode);
    else child.once("exit", (code, signal) => resolve(signal ?? code));
  });
}

test("observeChild reports each started child once and its exit, through command()", async () => {
  const events: string[] = [];
  setSpawnObserver({
    onSpawn: (pid, executable) => events.push(`spawn ${executable} ${pid > 0}`),
    onExit: (pid) => events.push(`exit ${pid > 0}`),
  });
  try {
    await command(process.execPath, ["-e", ""]);
    assert.deepEqual(events, [`spawn ${process.execPath} true`, "exit true"]);

    // A command that fails to start has no pid and is not reported.
    events.length = 0;
    await assert.rejects(command("bell-pr-no-such-command", []));
    assert.deepEqual(events, []);

    // Observer errors never break the command.
    setSpawnObserver({
      onSpawn: () => {
        throw new Error("observer failed");
      },
      onExit: () => {
        throw new Error("observer failed");
      },
    });
    const result = await command(process.execPath, ["-e", "process.stdout.write('ok')"]);
    assert.equal(result.stdout, "ok");

    // Without an observer nothing is reported.
    setSpawnObserver();
    events.length = 0;
    await command(process.execPath, ["-e", ""]);
    assert.deepEqual(events, []);
  } finally {
    setSpawnObserver();
  }
});

test("only codex and claude count as agent CLIs", () => {
  for (const name of ["codex", "claude", "/usr/local/bin/codex", "claude.cmd", "codex.exe"])
    assert.equal(isAgentExecutable(name), true, name);
  for (const name of ["git", "gh", "node", "codex-helper", "claudex"])
    assert.equal(isAgentExecutable(name), false, name);
  for (const argv of [
    ["codex", "exec"],
    ["/usr/bin/node", "/usr/lib/node_modules/@openai/codex/bin/codex.js", "app-server"],
    ["node", "/opt/node_modules/@anthropic-ai/claude-code/cli.js", "-p"],
    ["/home/u/.local/share/claude/versions/2.1.0", "-p"],
    ["/bin/sh", "/tmp/x/bin/codex"],
  ])
    assert.equal(isAgentCommand(argv), true, argv.join(" "));
  for (const argv of [
    ["sleep", "300"],
    ["/bin/sh", "/tmp/claude-1000/x/bin/fake"],
    ["node", "server.js", "codex"],
    ["git", "-C", "/srv/codex", "status"],
  ])
    assert.equal(isAgentCommand(argv), false, argv.join(" "));
});

test("AgentRegistry records running agent process groups in children.json and drops them on exit", async () => {
  const temp = await tempDir();
  const file = path.join(temp.directory, "children.json");
  const registry = new AgentRegistry(file);
  try {
    script(path.join(temp.bin, "codex"), "#!/bin/sh\nsleep 0.4\n");
    registry.start();
    assert.deepEqual(readChildren(file), []);
    if (posix) assert.equal(statSync(file).mode & 0o777, 0o600);
    await withPath(temp.bin, async () => {
      const running = command("codex", ["exec"]);
      await until(() => readChildren(file).length === 1);
      const [child] = readChildren(file);
      assert.equal(child.executable, "codex");
      assert.ok(child.pgid > 1);
      assert.ok(Math.abs(Date.parse(child.startedAt!) - Date.now()) < 5000);
      await running;
    });
    assert.deepEqual(readChildren(file), []);
    // Other programs are not agents and are not recorded.
    await command(process.execPath, ["-e", ""]);
    assert.deepEqual(readChildren(file), []);
  } finally {
    registry.stop();
    await temp.cleanup();
  }
});

test("a readModelCatalog spawn (fake codex on PATH) is recorded and removed again", async () => {
  const temp = await tempDir();
  const file = path.join(temp.directory, "children.json");
  // A codex app-server that answers the catalog requests after a pause.
  script(
    path.join(temp.bin, "codex"),
    `#!${process.execPath}
const readline = require("node:readline");
const reply = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 0) setTimeout(() => reply(0, {}), 300);
  if (message.method === "model/list")
    reply(message.id, {
      data: [{ model: "fake-model", displayName: "Fake", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "medium" }] }],
      nextCursor: null,
    });
});
`,
  );
  const registry = new AgentRegistry(file);
  registry.start();
  try {
    await withPath(temp.bin, async () => {
      const seen: number[] = [];
      const catalog = readModelCatalog(undefined, 5000);
      let done = false;
      void catalog.finally(() => (done = true));
      await until(() => {
        seen.push(...readChildren(file).map((child) => child.pgid));
        return seen.length > 0 || done;
      });
      assert.equal(seen.length > 0, true, "the catalog process was recorded");
      const result = await catalog;
      assert.deepEqual(result.models.map((model) => model.id), ["fake-model"]);
      await until(() => readChildren(file).length === 0);
    });
  } finally {
    registry.stop();
    await temp.cleanup();
  }
});

test("reapOrphanedAgents stops recorded agent groups, escalates to SIGKILL and leaves other processes alone", { skip: !posix }, async () => {
  const temp = await tempDir();
  const file = path.join(temp.directory, "children.json");
  const earlier = path.join(temp.directory, "earlier");
  mkdirSync(earlier);
  const stubborn = orphan(
    script(path.join(temp.bin, "codex"), "#!/bin/sh\ntrap '' TERM\nwhile :; do sleep 1; done\n"),
  );
  const unrelated = orphan(script(path.join(temp.bin, "worker"), "#!/bin/sh\nsleep 300\n"));
  const reused = orphan(script(path.join(earlier, "claude"), "#!/bin/sh\nsleep 300\n"));
  try {
    // Wait until the fakes run their scripts.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const now = new Date().toISOString();
    writeChildren(file, [
      { pgid: stubborn.pid!, executable: "codex", startedAt: now },
      // Recorded as an agent, but its group runs something else now.
      { pgid: unrelated.pid!, executable: "codex", startedAt: now },
      // Recorded before this boot: the pid belongs to a new process now.
      { pgid: reused.pid!, executable: "claude", startedAt: "2001-01-01T00:00:00.000Z" },
    ]);
    const result = await reapOrphanedAgents(file, { graceMs: 300 });
    assert.deepEqual(result.terminated.map((child) => child.pgid), [stubborn.pid]);
    assert.deepEqual(result.killed.map((child) => child.pgid), [stubborn.pid]);
    assert.deepEqual(result.skipped.map((child) => child.pgid), [unrelated.pid, reused.pid]);
    assert.equal(await exitOf(stubborn), "SIGKILL");
    for (const child of [unrelated, reused]) {
      assert.equal(child.exitCode, null);
      assert.equal(child.signalCode, null);
    }
    assert.deepEqual(readChildren(file), []);
  } finally {
    for (const child of [stubborn, unrelated, reused])
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // Already gone.
      }
    await temp.cleanup();
  }
});

test("reapOrphanedAgents leaves a group alone whose first process started after the record", { skip: !posix }, async () => {
  const temp = await tempDir();
  const file = path.join(temp.directory, "children.json");
  // An agent CLI the person started themselves, under a pid that a crashed
  // BELL PR had recorded for its own agent earlier in this boot.
  const theirs = orphan(script(path.join(temp.bin, "codex"), "#!/bin/sh\nsleep 300\n"));
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
    writeChildren(file, [
      {
        pgid: theirs.pid!,
        executable: "codex",
        startedAt: new Date(Date.now() - 45_000).toISOString(),
      },
    ]);
    const result = await reapOrphanedAgents(file, { graceMs: 0 });
    assert.deepEqual(result.terminated, []);
    assert.deepEqual(result.skipped.map((child) => child.pgid), [theirs.pid]);
    assert.equal(theirs.exitCode, null);
    assert.equal(theirs.signalCode, null);
  } finally {
    try {
      process.kill(-theirs.pid!, "SIGKILL");
    } catch {
      // Already gone.
    }
    await temp.cleanup();
  }
});

test("ps lines give the group, the command line and the start time", () => {
  assert.deepEqual(
    parsePsLine("  412   410 Sun Oct  4 06:29:36 2026     /usr/local/bin/node /opt/codex/bin/codex.js exec"),
    {
      pgid: 410,
      member: {
        pid: 412,
        argv: ["/usr/local/bin/node", "/opt/codex/bin/codex.js", "exec"],
        startedAt: new Date(2026, 9, 4, 6, 29, 36).getTime(),
      },
    },
  );
  assert.deepEqual(parsePsLine("   7     7 Tue Jan 13 23:05:01 2026"), {
    pgid: 7,
    member: { pid: 7, argv: [], startedAt: new Date(2026, 0, 13, 23, 5, 1).getTime() },
  });
  assert.equal(parsePsLine(""), undefined);
  assert.equal(parsePsLine("PID PGID STARTED COMMAND"), undefined);
});

test("a fake long-running agent recorded in children.json is stopped at the next startup", { skip: !posix }, async () => {
  const temp = await tempDir();
  const dataDir = path.join(temp.directory, "data");
  mkdirSync(dataDir);
  writeFileSync(path.join(temp.directory, "index.html"), "<!doctype html>");
  const agent = orphan(script(path.join(temp.bin, "codex"), "#!/bin/sh\nsleep 300\n"));
  const port = await (async () => {
    const probe = createServer().listen(0, "127.0.0.1");
    await once(probe, "listening");
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
  })();
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
    writeFileSync(
      path.join(dataDir, "children.json"),
      JSON.stringify({
        version: 1,
        children: [
          { pgid: agent.pid, executable: "codex", startedAt: new Date().toISOString(), note: "a field from a newer build" },
        ],
      }),
    );
    const server = await startServer({
      config: resolveConfig({ port, dataDir }, { BELLPR_STATIC_DIR: temp.directory }),
      handleExit: false,
      print: () => {},
    });
    try {
      assert.equal(await exitOf(agent), "SIGTERM");
      // The registry starts over with what this process runs.
      assert.deepEqual(readChildren(path.join(dataDir, "children.json")), []);
    } finally {
      await server.shutdown();
    }
  } finally {
    try {
      process.kill(-agent.pid!, "SIGKILL");
    } catch {
      // Already gone.
    }
    await temp.cleanup();
  }
});

test("children.json reads leniently: unknown fields and bad entries are dropped, garbage means nothing recorded", async () => {
  const temp = await tempDir();
  const file = path.join(temp.directory, "children.json");
  try {
    assert.deepEqual(readChildren(file), []);
    writeFileSync(file, "not json");
    assert.deepEqual(readChildren(file), []);
    writeFileSync(file, JSON.stringify({ version: 1, children: "nope" }));
    assert.deepEqual(readChildren(file), []);
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        future: true,
        children: [
          // Group ids above any pid_max, so no real process can match.
          { pgid: 99999998, executable: "codex", startedAt: "2026-01-01T00:00:00.000Z", extra: 1 },
          { pgid: "not a number" },
          { pgid: 99999999 },
        ],
      }),
    );
    assert.deepEqual(readChildren(file), [
      { pgid: 99999998, executable: "codex", startedAt: "2026-01-01T00:00:00.000Z" },
      { pgid: 99999999 },
    ]);
    // Groups that are gone are passed over without a signal.
    const result = await reapOrphanedAgents(file, { graceMs: 0 });
    assert.deepEqual(result, { terminated: [], killed: [], skipped: [] });
  } finally {
    await temp.cleanup();
  }
});

test("an older build that lacks a children.json field still reads entries that have it", () => {
  // Simulates a build whose schema has no startedAt yet.
  const older = lenientRead(childSchema.omit({ startedAt: true }));
  assert.deepEqual(
    older.parse({ pgid: 7, executable: "claude", startedAt: "2026-01-01T00:00:00.000Z" }),
    { pgid: 7, executable: "claude" },
  );
});
