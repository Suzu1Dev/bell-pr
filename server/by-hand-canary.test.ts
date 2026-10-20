// The write canary (DESIGN v1.2 F2): in a Learn-by-hand run, a file change
// from either CLI or a command from Claude Code stops the turn, counts in
// byHand.agentWrites and withdraws the claim; a Codex command (a read in its
// read-only sandbox) does not. Codex is a fake executable on PATH printing
// JSONL; Claude Code's stream-json comes through the injected command.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { byHandClean } from "../shared/by-hand.js";
import type { command } from "./process.js";
import { runAgent } from "./run-executor.js";
import { Store } from "./store.js";
import { AppError, type Run } from "./types.js";
import { withLocale } from "./i18n/index.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";
import { canaryHit } from "./by-hand-canary.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-canary-bin-"));
  // Codex: a write in its answer to "WRITE", a shell read to "READ". The
  // schema arguments are accepted and ignored.
  await writeFile(
    path.join(fakeBin, "codex"),
    `#!/usr/bin/env node
const prompt = require('node:fs').readFileSync(0, 'utf8');
const emit = (item) => console.log(JSON.stringify({ type: 'item.completed', item }));
if (prompt.includes('WRITE')) emit({ type: 'file_change', changes: [{ path: 'retry.ts', kind: 'update' }] });
if (prompt.includes('READ')) emit({ type: 'command_execution', command: 'rg -n retry src', aggregated_output: 'src/retry.ts:1', exit_code: 0 });
emit({ type: 'agent_message', text: 'Look at src/retry.ts:1.' });
`,
    { mode: 0o755 },
  );
  for (const name of ["claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

type Execute = typeof command;
type Options = NonNullable<Parameters<Execute>[2]>;

async function fixture(t: TestContext, provider: "codex" | "claude", execute?: Execute) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-canary-"));
  const worktree = path.join(directory, "worktree");
  await mkdir(worktree, { recursive: true });
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store, undefined, execute ? { command: execute } : {});
  t.after(async () => {
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const run: Run = {
    id: `lbh-canary-${provider}`,
    repoId: "repo",
    title: "Retry twice",
    prompt: "Retry a GET twice after a 503.",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha: "a".repeat(40),
    worktreePath: worktree,
    createdAt: new Date().toISOString(),
    locale: "en",
    learnByHand: true,
    modelExecution: { provider, source: "cli-default" },
    agents: [
      { id: "lead", name: "Atlas", role: "Team lead", status: "waiting", detail: "" },
      { id: "reviewer", name: "Lens", role: "Reviewer", status: "waiting", detail: "" },
      { id: "tester", name: "Scout", role: "Test analyst", status: "waiting", detail: "" },
    ],
    logs: [],
    draft: { title: "Retry twice", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    team: {
      config: { maxTeammates: 2, requirePlanApproval: true, provider, protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
      phase: "developing",
      planSummary: "",
      tasks: [],
      messages: [],
    },
  };
  store.data.runs.push(run);
  const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
  const turn = (prompt: string) =>
    withLocale("en", () => runAgent(ctx, run, "lead", prompt, new AbortController().signal));
  return { run, turn };
}

const stopped = (error: unknown) =>
  error instanceof AppError &&
  error.statusCode === 409 &&
  error.message === "BELL PR stopped an agent that ran a shell command or changed a file in a Learn-by-hand run.";

test("a Codex file_change in a Learn-by-hand turn stops it and withdraws the claim", async (t) => {
  const f = await fixture(t, "codex");
  assert.deepEqual(byHandClean(f.run), { clean: true });
  await assert.rejects(f.turn("WRITE the retry loop."), stopped);
  assert.equal(f.run.byHand?.agentWrites, 1);
  assert.deepEqual(byHandClean(f.run), { clean: false, reason: "agent-writes" });
  assert.equal(f.run.agents[0].status, "failed");
  assert.ok(
    f.run.logs.some(
      (entry) => entry.kind === "notice" && entry.message === "BELL PR stopped an agent that ran a shell command or changed a file in a Learn-by-hand run.",
    ),
  );
});

test("a Codex command_execution is a read: no hit, and the turn completes", async (t) => {
  const f = await fixture(t, "codex");
  assert.equal(await f.turn("READ where the retry loop is."), "Look at src/retry.ts:1.");
  assert.equal(f.run.byHand?.agentWrites, undefined);
  assert.deepEqual(byHandClean(f.run), { clean: true });
  assert.ok(f.run.logs.some((entry) => entry.kind === "command" && entry.message === "rg -n retry src"));
});

/** Claude Code stream-json: one tool use and its result, then the final answer. */
const claudeTool = (name: string, input: Record<string, string>): Execute =>
  (async (_executable: string, _args: string[], options: Options = {}) => {
    const emit = (event: unknown) => options.onLine?.(JSON.stringify(event), "stdout");
    emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "tool-1", name, input }] } });
    emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-1", is_error: false, content: "done" }] } });
    emit({ type: "result", subtype: "success", is_error: false, result: "Look at src/retry.ts:1." });
    return { stdout: "", stderr: "", code: 0 };
  }) as Execute;

test("a Claude Code Bash tool_result in a Learn-by-hand turn is a hit", async (t) => {
  const f = await fixture(t, "claude", claudeTool("Bash", { command: "sed -i s/1/2/ retry.ts" }));
  await assert.rejects(f.turn("Where is the retry loop?"), stopped);
  assert.equal(f.run.byHand?.agentWrites, 1);
  assert.equal(byHandClean(f.run).clean, false);
});

test("a Claude Code Edit tool_result in a Learn-by-hand turn is a hit", async (t) => {
  const f = await fixture(t, "claude", claudeTool("Edit", { file_path: "/tmp/retry.ts" }));
  await assert.rejects(f.turn("Where is the retry loop?"), stopped);
  assert.equal(f.run.byHand?.agentWrites, 1);
  assert.equal(byHandClean(f.run).clean, false);
});

test("the canary's rule: file changes from either CLI, commands only from Claude Code", () => {
  assert.equal(canaryHit({ kind: "file-change", path: "a.ts" }, "codex"), true);
  assert.equal(canaryHit({ kind: "file-change" }, "claude"), true);
  assert.equal(canaryHit({ kind: "command", outcome: "exit 0", command: "ls" }, "claude"), true);
  assert.equal(canaryHit({ kind: "command", outcome: "exit 0", command: "ls" }, "codex"), false);
  assert.equal(canaryHit({ kind: "message", text: "done" }, "claude"), false);
});
