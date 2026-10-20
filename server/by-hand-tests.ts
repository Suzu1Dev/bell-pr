/**
 * Learn by hand: the test command the person confirmed and BELL's runs of
 * it, as the person (DESIGN v1.2 F9). The façade in server/by-hand.ts has
 * already refused a run that is not Learn by hand.
 *
 * Only a command confirmed in its own request runs, only on a click,
 * never automatically, with the secret variables stripped by pattern and
 * the process group killed on Stop, timeout and shutdown; one test job per
 * run, registered in `ctx.byHandJobs` and `ctx.controllers` as
 * `tests:<id>`. BELL runs it as the person's terminal would: with their
 * permissions, in the run's folder, with no OS sandbox (v1.3).
 *
 * - `testCommand(ctx, id)`: GET …/by-hand/test-command, the suggestion and
 *   the confirmed command.
 * - `confirmTestCommand(ctx, repoId, input)`: PUT /api/repos/:id/test-command,
 *   stores `Repository.testCommand`; any change is a new confirmation.
 * - `runTests(ctx, id, input)`: POST …/by-hand/tests (202), with the
 *   person's prediction.
 * - `liveTests(ctx, id)`: GET …/by-hand/tests/live, the running job's tail.
 * - `stopTests(ctx, id)`: POST …/by-hand/tests/stop.
 * - `reportTests(ctx, id, input)`: POST …/by-hand/tests/report, a result
 *   from the person's own terminal, marked as reported.
 */
import { createHash } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import {
  byHandLimits,
  type ByHandTestInput,
  type ByHandTestReportInput,
  type LiveTests,
  type TestCommandInput,
  type TestCommandView,
  type TestOutcome,
  type TestRun,
} from "../shared/by-hand.js";
import { changeFingerprint } from "../shared/change-fingerprint.js";
import { shuttingDown, sm } from "./i18n/index.js";
import { log } from "./log.js";
import { command, git, redact } from "./process.js";
import { suggestTestCommand, testEnvironment } from "./test-command.js";
import { AppError, withRunLocale, type Repository, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

/**
 * The limits of one test run: 10 minutes, the output BELL reads before it
 * stops the run (far above command()'s 2 MB default, so a verbose suite
 * is not cut), and how long BELL still reads output after the shell
 * exited. Tests lower them.
 */
export const testRunLimits = { timeoutMs: 10 * 60_000, maxBytes: 50 * 1024 * 1024, settleMs: 2_000 };

/** The live tail kept in memory while a run goes on. */
const liveTailChars = 64 * 1024;
/** Every exit code is a result: a failing suite resolves with its code. */
const exitCodes = Array.from({ length: 256 }, (_, code) => code);

const jobKey = (id: string) => `tests:${id}`;
const now = () => new Date().toISOString();

/** A running job's output, kept only in memory and only while it runs. */
interface LiveJob {
  startedAt: string;
  tail: string;
}
const liveJobs = new WeakMap<WorkbenchContext, Map<string, LiveJob>>();
function lives(ctx: WorkbenchContext) {
  let jobs = liveJobs.get(ctx);
  if (!jobs) liveJobs.set(ctx, (jobs = new Map()));
  return jobs;
}

/** One output line as a terminal leaves it: no escape sequences, only the text after the last carriage return. */
function cleanLine(line: string) {
  const text = stripVTControlCharacters(line).replace(/\r+$/, "");
  return text.slice(text.lastIndexOf("\r") + 1);
}

/** Text the person pasted or a tail kept: cleaned line by line, credentials masked, trailing space dropped. */
function cleanOutput(text: string) {
  return redact(text.split("\n").map(cleanLine).join("\n")).trimEnd();
}

/**
 * The hash of the last 40 output lines (`repeatFailure`), with durations
 * and clock times masked so the same failure hashes alike on every run.
 */
function tailHash(output: string) {
  const lines = output
    .split("\n")
    .slice(-byHandLimits.tailHashLines)
    .join("\n")
    .replace(/\d+(?:[.,]\d+)?\s?(?:ns|µs|μs|us|ms|s|secs?|seconds?|m|mins?|minutes?|h)\b/gi, "<time>")
    .replace(/\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?/g, "<time>");
  return createHash("sha256").update(lines).digest("hex").slice(0, 16);
}

/** The worktree's untracked files (as the diff sees them), or undefined when Git can't list them. */
async function untrackedFiles(worktree: string) {
  try {
    const { stdout } = await git(worktree, ["ls-files", "--others", "--exclude-standard", "-z"]);
    return stdout.split("\0").filter(Boolean);
  } catch {
    return undefined;
  }
}

/** Appends a run to the record: the newest 10 are kept, and the output only on the newest 5. */
function appendTestRun(run: Run, test: TestRun) {
  const record = (run.byHand ??= {});
  const tests = [...(record.tests ?? []), test].slice(-byHandLimits.tests);
  const tailsFrom = tests.length - byHandLimits.testTails;
  record.tests = tests.map((entry, index) => {
    if (index >= tailsFrom || entry.outputTail === undefined) return entry;
    const kept = { ...entry };
    delete kept.outputTail;
    return kept;
  });
}

/** Tests run while the change waits for the person's review, never while it publishes. */
function assertReview(run: Run) {
  if (run.status !== "review" || run.publishing)
    throw new AppError((m) => m.byHand.tests.notNow, 409);
}

/** GET /api/runs/:id/by-hand/test-command */
export async function testCommand(ctx: WorkbenchContext, id: string): Promise<TestCommandView> {
  const run = ctx.run(id);
  const confirmed = ctx.repo(run.repoId).testCommand;
  const suggestion =
    run.workspaceRemovedAt || !run.worktreePath ? "" : await suggestTestCommand(run.worktreePath);
  return {
    suggestion,
    ...(confirmed ? { confirmed: { command: confirmed.command, confirmedAt: confirmed.confirmedAt } } : {}),
  };
}

/**
 * Line breaks, NUL and the other control characters (a tab is allowed),
 * invisible formatting such as bidirectional overrides, and lone
 * surrogates (shown as one replacement character, run as another), which
 * could make the command on screen differ from the one that runs.
 */
const hasControlCharacter = (text: string) => /[^\P{Cc}\t]|[\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(text);

/** PUT /api/repos/:id/test-command */
export async function confirmTestCommand(
  ctx: WorkbenchContext,
  repoId: string,
  input: TestCommandInput,
): Promise<{ repo: Repository }> {
  const text = input.command.trim();
  if (!text || text.length > byHandLimits.commandChars || hasControlCharacter(text))
    throw new AppError((m) => m.byHand.tests.commandInvalid, 400);
  return ctx.lock(`repository:${repoId}`, async () => {
    const repo = ctx.repo(repoId);
    // Every confirmation is new, also of the same text.
    repo.testCommand = { command: text, confirmedAt: now() };
    await ctx.store.save();
    return { repo };
  });
}

/** What the run records when it starts. */
interface TestStart {
  at: string;
  command: string;
  changeFingerprint: string;
  untracked?: string[];
}

/** POST /api/runs/:id/by-hand/tests (202) */
export async function runTests(
  ctx: WorkbenchContext,
  id: string,
  input: ByHandTestInput,
): Promise<{ run: Run }> {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    const key = jobKey(id);
    assertReview(run);
    if (ctx.byHandJobs.has(key) || ctx.controllers.has(key))
      throw new AppError((m) => m.byHand.tests.running, 409);
    // One guide turn, review or test job per run at a time.
    const busy = run.byHand?.busy;
    if ((busy && busy.kind !== "tests") || ["guide", "review"].some((kind) => ctx.byHandJobs.has(`${kind}:${id}`)))
      throw new AppError((m) => m.byHand.busy, 409);
    // Only the command the person confirmed for the project, never one from a request.
    const confirmed = () => ctx.repo(run.repoId).testCommand?.command;
    if (!confirmed()) throw new AppError((m) => m.byHand.tests.noCommand, 409);
    const files = await ctx.diff(id);
    const untracked = await untrackedFiles(run.worktreePath);
    if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
    // Read again with no await before the start: a confirmation that
    // landed meanwhile is the command that runs and is recorded.
    const latest = confirmed();
    if (!latest) throw new AppError((m) => m.byHand.tests.noCommand, 409);
    startJob(ctx, run, input, {
      at: now(),
      command: latest,
      changeFingerprint: changeFingerprint(files),
      ...(untracked ? { untracked } : {}),
    });
    await ctx.store.save();
    return { run };
  });
}

/** Registers the job and its controller under `tests:<id>`, marks the run busy and starts the command. */
function startJob(ctx: WorkbenchContext, run: Run, input: ByHandTestInput, start: TestStart) {
  const key = jobKey(run.id);
  const controller = new AbortController();
  const live: LiveJob = { startedAt: start.at, tail: "" };
  ctx.controllers.set(key, controller);
  lives(ctx).set(run.id, live);
  (run.byHand ??= {}).busy = { kind: "tests", since: start.at };
  /**
   * Ends the job's registration. The job calls it under the run's lock as
   * it clears `busy`, so a run that shows its result and no busy mark
   * takes the next request at once; it runs again, as a no-op, when the
   * job settles.
   */
  const release = () => {
    if (ctx.controllers.get(key) === controller) ctx.controllers.delete(key);
    if (lives(ctx).get(run.id) === live) lives(ctx).delete(run.id);
    if (ctx.byHandJobs.get(key) === job) ctx.byHandJobs.delete(key);
  };
  // Background work of the run: its log line uses the run's locale.
  const job: Promise<void> = withRunLocale(run, () =>
    execute(ctx, run, input, start, { signal: controller.signal, live, release }),
  )
    // Nothing awaits this job until Stop, cancel or shutdown; a failed save
    // must not become an unhandled rejection that stops the server.
    .catch((error) => log.error("Learn-by-hand test run failed", { runId: run.id, error: String(error) }))
    .finally(release);
  ctx.byHandJobs.set(key, job);
}

/** Why a run ended in `error`, for the run's log. */
function errorNote(error: unknown) {
  const m = sm().byHand.tests;
  // command() refuses an exit code outside the allowed ones (none here, so
  // only a run a signal ended) with details, and too much output without.
  if (error instanceof AppError && error.statusCode === 422)
    return error.details ? m.noExitCode : m.tooMuchOutput({ megabytes: Math.round(testRunLimits.maxBytes / 1_048_576) });
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return m.couldNotStart({ reason: redact(cause instanceof Error ? cause.message : String(cause)) });
}

/** Runs `/bin/sh -c <confirmed command>` in the run's folder and records the result. */
async function execute(
  ctx: WorkbenchContext,
  run: Run,
  input: ByHandTestInput,
  start: TestStart,
  { signal, live, release }: { signal: AbortSignal; live: LiveJob; release: () => void },
) {
  const clock = Date.now();
  let outcome: TestOutcome;
  let exitCode: number | undefined;
  let note: string | undefined;
  try {
    // detached: the command leads its own process group. On Stop (the
    // signal) and on the timeout, command() sends SIGTERM to the whole
    // group. The run ends when the shell exits (output still in the pipes
    // is read for `settleMs` more), and then whatever is left of the
    // group, in any case, gets SIGTERM and, 1.5 s after the first one,
    // SIGKILL (`endGroup`). Its stdin is closed at once; nothing is ever
    // typed into it. The output is read only line by line, into the live
    // tail.
    const result = await command("/bin/sh", ["-c", start.command], {
      cwd: run.worktreePath,
      env: testEnvironment(process.env),
      timeoutMs: testRunLimits.timeoutMs,
      maxBytes: testRunLimits.maxBytes,
      signal,
      allowedCodes: exitCodes,
      endGroup: { settleAfterExitMs: testRunLimits.settleMs },
      discardOutput: true,
      onLine: (line) => {
        live.tail += `${cleanLine(line)}\n`;
        if (live.tail.length > 2 * liveTailChars) live.tail = live.tail.slice(-liveTailChars);
      },
    });
    exitCode = result.code;
    outcome = result.code === 0 ? "passed" : "failed";
  } catch (error) {
    if (signal.aborted) outcome = "stopped";
    else if (error instanceof AppError && error.statusCode === 504) outcome = "timeout";
    else {
      outcome = "error";
      note = errorNote(error);
    }
  }
  const ms = Date.now() - clock;
  const after = start.untracked && (await untrackedFiles(run.worktreePath));
  const before = new Set(start.untracked);
  const newFiles = after
    ?.filter((file) => !before.has(file))
    .sort()
    .slice(0, byHandLimits.newFiles);
  await ctx.lock(run.id, async () => {
    try {
      // Credentials are masked over the whole live tail first, so a cut
      // never leaves part of one in the kept end.
      const output = cleanOutput(live.tail.slice(-liveTailChars));
      const expect = input.expect?.trim().slice(0, byHandLimits.expectChars);
      appendTestRun(run, {
        at: now(),
        // The record masks a credential written into the command, as in the output.
        command: redact(start.command),
        changeFingerprint: start.changeFingerprint,
        outcome,
        ...(exitCode === undefined ? {} : { exitCode }),
        ms,
        ...(input.prediction ? { prediction: input.prediction } : {}),
        ...(expect ? { expect } : {}),
        ...(output ? { outputTail: output.slice(-byHandLimits.tailChars) } : {}),
        tailHash: tailHash(output),
        ...(newFiles?.length ? { newFiles } : {}),
      });
      if (note) ctx.log(run, "system", note);
      log.info("by-hand.tests.finished", { runId: run.id, outcome, ms });
    } finally {
      if (run.byHand?.busy?.kind === "tests") delete run.byHand.busy;
      release();
      await ctx.store.save();
    }
  });
}

/** GET /api/runs/:id/by-hand/tests/live */
export async function liveTests(ctx: WorkbenchContext, id: string): Promise<LiveTests> {
  ctx.run(id);
  const live = lives(ctx).get(id);
  if (!live || !ctx.byHandJobs.has(jobKey(id))) return { running: false, tail: "" };
  return { running: true, tail: redact(live.tail.slice(-liveTailChars)), startedAt: live.startedAt };
}

/** POST /api/runs/:id/by-hand/tests/stop */
export async function stopTests(ctx: WorkbenchContext, id: string): Promise<{ run: Run }> {
  const key = jobKey(id);
  const job = ctx.byHandJobs.get(key);
  if (job) {
    // Not under the run's lock: the job takes it to record the result.
    ctx.controllers.get(key)?.abort();
    await Promise.allSettled([job]);
  }
  return { run: ctx.run(id) };
}

/** POST /api/runs/:id/by-hand/tests/report */
export async function reportTests(
  ctx: WorkbenchContext,
  id: string,
  input: ByHandTestReportInput,
): Promise<{ run: Run }> {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    assertReview(run);
    const files = await ctx.diff(id);
    const output = cleanOutput(input.output ?? "");
    appendTestRun(run, {
      at: now(),
      // The confirmed command, or none: BELL can't see what the person ran.
      command: redact(ctx.repo(run.repoId).testCommand?.command ?? ""),
      changeFingerprint: changeFingerprint(files),
      outcome: input.outcome,
      ms: 0,
      ...(output ? { outputTail: output.slice(-byHandLimits.tailChars) } : {}),
      reported: true,
    });
    await ctx.store.save();
    return { run };
  });
}
