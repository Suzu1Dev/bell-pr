// What an agent wrote reaches the run log, the agent card and errors in a
// Learn-by-hand run only through the code filter (DESIGN v1.2 F7): a command
// the guide ran (a search can spell the fix), a CLI error event, Claude Code's
// result text of a failed turn, a CLI that failed with the agent's own output
// on stdout, a denied tool's reason, a web query and a plain answer. Agent
// runs log and fail byte for byte as before. Codex is a fake executable on PATH
// printing JSONL; Claude Code's stream-json comes through the injected command.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { command } from "./process.js";
import { runAgent } from "./run-executor.js";
import { Store } from "./store.js";
import { AppError, type Run } from "./types.js";
import { withLocale } from "./i18n/index.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;
const code = "return delayMs * 2 ** attempt;";
const search = 'rg -n "return delay \\* 2 \\*\\* attempt" src';

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-text-bin-"));
  // Codex: each word of the prompt adds one event; FAILED and CRASH exit 1 with nothing on stderr;
  // without ANSWER the answer is a pointer.
  await writeFile(
    path.join(fakeBin, "codex"),
    `#!/usr/bin/env node
const prompt = require('node:fs').readFileSync(0, 'utf8');
const emit = (event) => console.log(JSON.stringify(event));
const item = (item) => emit({ type: 'item.completed', item });
const code = ${JSON.stringify(code)};
if (prompt.includes('COMMAND')) item({ type: 'command_execution', command: ${JSON.stringify(search)} + '\\nsecond line', aggregated_output: '', exit_code: 1 });
if (prompt.includes('PLAIN')) item({ type: 'command_execution', command: 'rg -n retry src', aggregated_output: '', exit_code: 0 });
if (prompt.includes('SEARCH')) item({ type: 'web_search', query: 'js ' + code });
if (prompt.includes('ERROR')) emit({ type: 'error', message: 'Reconnecting after the model wrote ' + code });
if (prompt.includes('ANSWER')) item({ type: 'agent_message', text: 'Write ' + code });
if (prompt.includes('FAILED')) { emit({ type: 'turn.failed', error: { message: 'Turn failed after: ' + code } }); process.exit(1); }
if (prompt.includes('CRASH')) process.exit(1);
if (!prompt.includes('ANSWER')) item({ type: 'agent_message', text: 'Look at src/retry.ts:1.' });
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

/** Claude Code's stream-json of a turn that ends in error, then the CLI's exit 1 with its stdout as the reason. */
const claudeFailure: Execute = (async (executable: string, _args: string[], options: Options = {}) => {
  const lines = [
    { type: "system", subtype: "permission_denied", tool_name: "Grep", decision_reason: `Grep for ${code} is outside the allowed tools` },
    { type: "assistant", message: { content: [{ type: "text", text: `Write ${code}` }] } },
    { type: "result", subtype: "success", is_error: true, result: `I could not finish. The fix is ${code}` },
  ].map((event) => JSON.stringify(event));
  for (const line of lines) options.onLine?.(line, "stdout");
  throw new AppError((m) => m.run.command.failed({ executable, output: lines.join("\n").slice(-1800) }), 422, {
    details: { stderr: `stderr: ${code}`, exitCode: 1 },
  });
}) as Execute;

async function fixture(t: TestContext, options: { learnByHand: boolean; provider?: "codex" | "claude"; execute?: Execute }) {
  const provider = options.provider ?? "codex";
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-text-"));
  const worktree = path.join(directory, "worktree");
  await mkdir(worktree, { recursive: true });
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store, undefined, options.execute ? { command: options.execute } : {});
  t.after(async () => {
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const run: Run = {
    id: `text-${options.learnByHand ? "lbh" : "agent"}-${provider}`,
    repoId: "repo",
    title: "Retry twice",
    prompt: "Retry a GET twice after a 503.",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha: "a".repeat(40),
    worktreePath: worktree,
    createdAt: "2026-10-20T00:00:00.000Z",
    locale: "en",
    ...(options.learnByHand ? { learnByHand: true } : {}),
    modelExecution: { provider, source: "cli-default", webAccess: true },
    agents: [{ id: "lead", name: "Atlas", role: "Team lead", status: "waiting", detail: "" }],
    logs: [],
    draft: { title: "Retry twice", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  store.data.runs.push(run);
  const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
  /** One read-only turn; `isolated` keeps it off the log's answer line and off the reports. */
  const turn = (prompt: string, isolated = false) =>
    withLocale("en", () => runAgent(ctx, run, "lead", prompt, new AbortController().signal, true, { isolated }));
  /** The log as the Activity tab shows it, without times and the started line. */
  const logs = () => run.logs.slice(1).map(({ message, kind, detail }) => ({ message, ...(kind ? { kind } : {}), ...(detail ? { detail } : {}) }));
  return { run, turn, logs };
}

/** Everything the person can read of the run: its log, the agent card, the reports. */
const visible = (run: Run) =>
  JSON.stringify([run.logs.map(({ message, detail }) => [message, detail]), run.agents.map((agent) => agent.detail), run.reports ?? {}]);
const noCode = (text: string) => !/delayMs|2 \*\* attempt|delay \\\* 2/.test(text);

test("a Learn-by-hand turn logs a fixed line for a command, and a plain read as the agent ran it", async (t) => {
  const f = await fixture(t, { learnByHand: true });
  assert.equal(await f.turn("COMMAND then PLAIN", true), "Look at src/retry.ts:1.");
  const commands = f.run.logs.filter((entry) => entry.kind === "command").map((entry) => entry.message);
  assert.deepEqual(commands, ["The guide ran a read-only command.", "rg -n retry src"]);
  assert.ok(noCode(visible(f.run)), visible(f.run));
});

test("a Learn-by-hand turn filters CLI error events, web queries and its answer out of the log and the reports", async (t) => {
  const f = await fixture(t, { learnByHand: true });
  // Not isolated: the answer would otherwise be logged and kept in run.reports.
  assert.equal(await f.turn("ERROR SEARCH ANSWER"), `Write ${code}`);
  assert.ok(noCode(visible(f.run)), visible(f.run));
  assert.equal(f.run.reports?.lead, undefined);
  assert.ok(f.run.logs.some((entry) => entry.message.startsWith("Reconnecting after the model wrote")));
});

test("a failed Learn-by-hand turn never carries the agent's code in its error or the log", async (t) => {
  const f = await fixture(t, { learnByHand: true });
  for (const prompt of ["FAILED", "ANSWER CRASH"]) {
    let failure: unknown;
    await f.turn(prompt, true).catch((error: unknown) => (failure = error));
    assert.ok(failure instanceof AppError, prompt);
    assert.ok(noCode(failure.message), `${prompt}: ${failure.message}`);
    assert.ok(noCode(JSON.stringify(failure.details ?? {})), prompt);
    assert.ok(failure.message.startsWith("codex failed:"), failure.message);
  }
  assert.ok(noCode(visible(f.run)), visible(f.run));
});

test("a failed Claude Code turn in a Learn-by-hand run: result text, denied tool and stderr filtered", async (t) => {
  const f = await fixture(t, { learnByHand: true, provider: "claude", execute: claudeFailure });
  let failure: unknown;
  await f.turn("Where is the retry loop?").catch((error: unknown) => (failure = error));
  assert.ok(failure instanceof AppError);
  assert.ok(noCode(failure.message), failure.message);
  assert.ok(failure.message.startsWith("claude failed: I could not finish."), failure.message);
  assert.ok(noCode(JSON.stringify(failure.details ?? {})), JSON.stringify(failure.details));
  assert.ok(noCode(visible(f.run)), visible(f.run));
  assert.ok(f.run.logs.some((entry) => entry.kind === "notice" && entry.message.includes("Grep")));
});

test("agent runs log and fail exactly as before", async (t) => {
  const f = await fixture(t, { learnByHand: false });
  assert.equal(await f.turn("COMMAND PLAIN ERROR SEARCH ANSWER"), `Write ${code}`);
  assert.deepEqual(f.logs(), [
    { message: search, kind: "command", detail: "exit 1" },
    { message: "rg -n retry src", kind: "command", detail: "exit 0" },
    { message: `Web search: js ${code}`, kind: "status", detail: `js ${code}` },
    { message: `Reconnecting after the model wrote ${code}` },
    { message: `Write ${code}` },
  ]);
  assert.equal(f.run.reports?.lead, `Write ${code}`);
  await assert.rejects(f.turn("FAILED", true), (error: unknown) =>
    error instanceof AppError && error.message === `codex failed: Turn failed after: ${code}`);
  await assert.rejects(f.turn("ANSWER CRASH", true), (error: unknown) =>
    error instanceof AppError &&
    error.message === `codex failed: ${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: `Write ${code}` } })}`);
  const claude = await fixture(t, { learnByHand: false, provider: "claude", execute: claudeFailure });
  await assert.rejects(claude.turn("Where is the retry loop?"), (error: unknown) =>
    error instanceof AppError &&
    error.message === `claude failed: I could not finish. The fix is ${code}` &&
    (error.details as { stderr?: string }).stderr === `stderr: ${code}`);
  assert.ok(claude.run.logs.some((entry) => entry.message === `I could not finish. The fix is ${code}`));
  assert.ok(claude.run.logs.some((entry) => entry.kind === "notice" && entry.message.includes(`Grep for ${code}`)));
});

test("an isolated Learn-by-hand turn filters Claude Code's failed result too, and keeps BELL's timeout message whole", async (t) => {
  const f = await fixture(t, { learnByHand: true, provider: "claude", execute: claudeFailure });
  let failure: unknown;
  await f.turn("Where is the retry loop?", true).catch((error: unknown) => (failure = error));
  assert.ok(failure instanceof AppError && noCode(failure.message), String(failure));
  assert.ok(noCode(visible(f.run)), visible(f.run));
  // The CLI ran out of time: BELL's message names the setting to raise.
  const timedOut: Execute = (async (executable: string) => {
    throw new AppError((m) => m.run.command.timedOut({ executable }), 504);
  }) as Execute;
  const slow = await fixture(t, { learnByHand: true, provider: "claude", execute: timedOut });
  await assert.rejects(slow.turn("Where is the retry loop?", true), (error: unknown) =>
    error instanceof AppError && error.statusCode === 504 && /raise BELLPR_AGENT_TIMEOUT_SCALE\.$/.test(error.message));
});
