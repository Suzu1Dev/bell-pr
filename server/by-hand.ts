/**
 * Learn by hand on the server (DESIGN v1.2 F1-F5, F8, F10, F11): the run's
 * flow, and the façade the routes call (`Workbench.byHand`). The façade at
 * the end of this module refuses a run that is not Learn by hand (409
 * `m.byHand.notByHand`) before it calls the flow, the guide
 * (server/by-hand-guide.ts) or the test runner (server/by-hand-tests.ts).
 * No member is gated by plan.
 *
 * - `planByHand(ctx, run, locale, signal)`: executeRun's Learn-by-hand
 *   branch: the read-only orientation turn (F3), its filtered outline in
 *   `byHand.guidePlan`, `team.tasks` and the agent cards left as they are
 *   (empty, so an older build has no plan to approve), the premise and its
 *   help event, then `awaiting_plan`. Never a write turn.
 * - `savePlan`, `revealOutline`, `updateStep`, `checkIn`, `leave`: the
 *   person's plan, the outline reveals (`plan` help, refused outside a
 *   fitted run's help set), step state and the R3 choice, the stuck card,
 *   and handing the task to the agent team.
 * - `ready(ctx, id, input)`: Ready for review at the current fingerprint
 *   (409 when stale; a second review needs a test run at this version), and
 *   the job `review:<id>` that runs the guide's structured review (F8,
 *   server/by-hand-guide.ts) when asked; `reviewAgain` is "Run the review
 *   again" for the ready version.
 * - The façade's `template` is server/draft-jobs.ts: the project's PR
 *   templates, verbatim.
 * - `assertReady(run, files)`: nothing is explained or reviewed before
 *   Ready (F5); the reading routes in server/learning.ts call it.
 */
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  byHandLimits as limits,
  helpAllowed,
  needsWhy,
  readyNow,
  type ByHandCheckInInput,
  type ByHandGuideInput,
  type ByHandPlanInput,
  type ByHandReadyInput,
  type ByHandRevealInput,
  type ByHandStep,
  type ByHandStepInput,
  type ByHandTemplate,
  type ByHandTestInput,
  type ByHandTestReportInput,
  type LiveTests,
  type TestCommandInput,
  type TestCommandView,
} from "../shared/by-hand.js";
import { filterAgentText } from "../shared/by-hand-filter.js";
import type { Locale } from "../shared/i18n/locale.js";
import { changeFingerprint, understandingWords } from "../shared/understanding.js";
import * as guide from "./by-hand-guide.js";
import { turnFiles } from "./by-hand-filter.js";
import { assertHelpAllowed, recordHelp } from "./by-hand-record.js";
import { orientationJsonSchema, orientationSchema, parseByHandAnswer, withSchemaFile } from "./by-hand-schemas.js";
import * as tests from "./by-hand-tests.js";
import { template } from "./draft-jobs.js";
import { shuttingDown, sm, type ServerMessages } from "./i18n/index.js";
import { log } from "./log.js";
import { git, redact } from "./process.js";
import { byHandPlanPrompt } from "./prompts/by-hand.js";
import { enterPhase, parseAgentOutput } from "./run-events.js";
import { runAgent } from "./run-executor.js";
import { AppError, withRunLocale, type DiffFile, type Repository, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

const now = () => new Date().toISOString();
const refuse = (message: (m: ServerMessages) => string, status = 409) => new AppError(message, status);

/** executeRun's Learn-by-hand branch: the orientation turn and the outline (F3). */
export async function planByHand(
  ctx: WorkbenchContext,
  run: Run,
  locale: Locale,
  signal: AbortSignal,
): Promise<void> {
  const team = run.team!;
  enterPhase(run, team, "planning");
  // Orientation and premise are `explain` help, which every help set holds.
  assertHelpAllowed(run, "explain");
  const record = (run.byHand ??= {});
  record.busy = { kind: "plan", since: now() };
  try {
    // Isolated: its raw answer reaches neither the log nor run.reports.
    const answer = await withSchemaFile(orientationJsonSchema, (outputSchema) =>
      runAgent(ctx, run, "lead", byHandPlanPrompt(locale, run), signal, true, { outputSchema, isolated: true }),
    );
    const outline = parseAgentOutput(run, "by-hand-orientation", () => parseByHandAnswer(orientationSchema, answer));
    const named = [...outline.readFirst.map((range) => range.path), ...outline.steps.flatMap((step) => step.files)];
    // A path is agent text too: only the checkout's own are kept, the others are dropped and counted.
    const known = await checkoutPaths(run, named);
    const sources = await turnFiles(run).sources(named.filter((file) => known.has(file)));
    let removed = 0;
    const clean = (text: string) => {
      const filtered = filterAgentText(text, sources);
      removed += filtered.removed;
      return filtered.value;
    };
    // Read-first ranges must be lines of a file at the base commit.
    const readFirst = outline.readFirst
      .filter(({ path: file, startLine, endLine }) => known.get(file) === "file" && startLine <= endLine && endLine <= (sources.base[file]?.length ?? 0))
      .map((range) => ({ ...range, why: clean(range.why) }));
    const summary = clean(outline.summary);
    const files = (step: { files: string[] }) => step.files.filter((file) => known.has(file));
    const dropped = named.length - readFirst.length - outline.steps.flatMap(files).length;
    // The step names are `plan` help: a run fitted to rules that don't name it gets none of them (F12).
    const steps = helpAllowed(run, "plan") ? outline.steps.map((step) => ({ title: clean(step.title), files: files(step) })) : [];
    const premise = outline.premise && {
      verdict: outline.premise.verdict,
      statement: clean(outline.premise.statement),
      evidence: clean(outline.premise.evidence),
    };
    record.guidePlan = {
      summary,
      steps,
      ...(readFirst.length ? { readFirst } : {}),
      at: now(),
      ...(removed ? { removed } : {}),
      ...(dropped ? { dropped } : {}),
    };
    // The outline stays outside team.tasks, so nothing ever executes it.
    team.planSummary = summary;
    if (premise) {
      team.premise = premise;
      recordHelp(run, { source: "premise", ...(removed ? { removed } : {}) });
    } else delete team.premise;
    countRemoved(run, removed);
    enterPhase(run, team, "awaiting_approval");
    run.status = "awaiting_plan";
    ctx.log(run, "lead", sm().byHand.flow.guideRead);
  } finally {
    // The one busy slot is shared with the guide, the review and the tests: clear only this turn's.
    if (record.busy?.kind === "plan") delete record.busy;
  }
}

/** Adds what the filter removed to the run's total. */
export function countRemoved(run: Run, removed: number) {
  if (removed) (run.byHand ??= {}).removedTotal = (run.byHand.removedTotal ?? 0) + removed;
}

/**
 * The paths an agent named that are in the checkout, as files or folders:
 * at the base commit by `git cat-file` (`git show <sha>:<path>` prints
 * nothing for a missing path with *, ? or [ in it, as for an empty file),
 * else in the worktree. Any other "path" is agent text, never stored as one.
 */
export async function checkoutPaths(run: Pick<Run, "baseSha" | "worktreePath">, paths: readonly string[]) {
  const found = new Map<string, "file" | "folder">();
  const asked = [...new Set(paths)].filter((file) => file && !/\p{Cc}/u.test(file) && !path.isAbsolute(file) && !file.split(/[\\/]/).includes(".."));
  if (!asked.length) return found;
  const input = asked.map((file) => `${run.baseSha}:${file}\n`).join("");
  const types = (await git(run.worktreePath, ["cat-file", "--batch-check=%(objecttype)"], { input })).stdout.split("\n");
  const root = await realpath(run.worktreePath);
  for (const [index, file] of asked.entries()) {
    if (types[index] === "blob" || types[index] === "tree") found.set(file, types[index] === "blob" ? "file" : "folder");
    const full = found.has(file) ? "" : await realpath(path.join(root, file)).catch(() => "");
    const info = full.startsWith(`${root}${path.sep}`) ? await stat(full).catch(() => undefined) : undefined;
    if (info?.isFile() || info?.isDirectory()) found.set(file, info.isFile() ? "file" : "folder");
  }
  return found;
}

/** A step id not in use. */
function newStepId(used: ReadonlySet<string>) {
  let id: string;
  do id = `s-${randomUUID().slice(0, 8)}`;
  while (used.has(id));
  return id;
}

/** PUT /api/runs/:id/by-hand/plan: before the person confirms it, and while they write (not at the ready version). */
export async function savePlan(
  ctx: WorkbenchContext,
  id: string,
  input: ByHandPlanInput,
): Promise<{ run: Run }> {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    const writing = run.status === "review" && !readyNow(run, await ctx.diff(id));
    if (run.status !== "awaiting_plan" && !writing) throw refuse((m) => m.byHand.flow.planClosed);
    const record = (run.byHand ??= {});
    const previous = new Map((record.plan?.steps ?? []).map((step) => [step.id, step]));
    const assigned = new Set<string>();
    const steps = input.steps.map((step): ByHandStep => {
      // A step keeps its id (and its state); a new or repeated one gets an id of its own.
      const stepId = step.id && !assigned.has(step.id) ? step.id : newStepId(new Set([...previous.keys(), ...assigned]));
      assigned.add(stepId);
      const { files: _files, how: _how, ...state } = previous.get(stepId) ?? { id: stepId, title: "" };
      const how = step.how?.trim();
      return { ...state, id: stepId, title: step.title.trim(), ...(step.files?.length ? { files: step.files } : {}), ...(how ? { how } : {}) };
    });
    const plan = { ...record.plan, steps, savedAt: now() };
    // The answers before writing (the prediction above all) stay as confirmed while the person writes.
    if (run.status === "awaiting_plan")
      for (const key of ["tests", "unsure", "prediction"] as const) {
        const value = input[key]?.trim();
        if (value) plan[key] = value;
        else if (input[key] !== undefined) delete plan[key];
      }
    record.plan = plan;
    await ctx.store.save();
    return { run };
  });
}

/** POST /api/runs/:id/by-hand/plan/reveal: `plan` help, recorded with when the outline was first shown. */
export async function revealOutline(
  ctx: WorkbenchContext,
  id: string,
  input: ByHandRevealInput,
): Promise<{ run: Run }> {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    // A fitted run whose help set lacks `plan`: refused before anything is recorded.
    assertHelpAllowed(run, "plan");
    const record = run.byHand;
    if (!record?.guidePlan || !["awaiting_plan", "review"].includes(run.status))
      throw refuse((m) => m.byHand.flow.noOutline);
    const drafted = !!record.plan?.steps.length;
    if (input.mode === "compare" && !drafted) throw refuse((m) => m.byHand.flow.stepFirst);
    const at = now();
    const plan = (record.plan ??= { steps: [], savedAt: at });
    plan.outlineAt ??= at;
    if (!drafted) plan.outlineBeforeDraft = true;
    recordHelp(run, { source: "outline", at });
    await ctx.store.save();
    return { run };
  });
}

/** A Learn-by-hand run in its writing part: after the plan is confirmed, before publishing. */
function assertWriting(run: Run) {
  if (!["review", "approved"].includes(run.status) || run.publishing) throw refuse((m) => m.byHand.flow.notWriting);
}

/** PATCH /api/runs/:id/by-hand/steps/:stepId */
export async function updateStep(
  ctx: WorkbenchContext,
  id: string,
  stepId: string,
  input: ByHandStepInput,
): Promise<{ run: Run }> {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    assertWriting(run);
    const record = run.byHand ?? {};
    const step = record.plan?.steps.find((entry) => entry.id === stepId);
    if (!step) throw refuse((m) => m.byHand.flow.noStep, 404);
    // Everything is checked before anything changes.
    const why = input.why === undefined ? step.why : input.why.trim();
    if (input.done && !step.doneAt && needsWhy(step) && understandingWords(why) < limits.whyWords)
      throw refuse((m) => m.byHand.whyFirst);
    if (input.chosen) {
      const entry = record.thread?.find((value) => value.id === input.chosen!.entryId);
      const fits = entry?.kind === "hint" && entry.rung === 3 && (!entry.stepId || entry.stepId === stepId);
      if (!fits || !entry.options?.[input.chosen.option]) throw refuse((m) => m.byHand.flow.noOption);
      step.chosen = { ...input.chosen, why: input.chosen.why.trim() };
    }
    if (why) step.why = why;
    else delete step.why;
    const at = now();
    if (input.done === true) step.doneAt ??= at;
    else if (input.done === false) delete step.doneAt;
    if (input.parked === true) step.parkedAt ??= at;
    else if (input.parked === false) delete step.parkedAt;
    // R0 is local and not help; only its use is kept.
    if (input.talked) record.talks = [...(record.talks ?? []), { stepId, at }].slice(-limits.talks);
    await ctx.store.save();
    return { run };
  });
}

/** POST /api/runs/:id/by-hand/check-ins: the stuck card and the exit the person took. */
export async function checkIn(
  ctx: WorkbenchContext,
  id: string,
  input: ByHandCheckInInput,
): Promise<{ run: Run }> {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (run.status !== "awaiting_plan") assertWriting(run);
    const record = (run.byHand ??= {});
    if (input.stepId && !record.plan?.steps.some((step) => step.id === input.stepId))
      throw refuse((m) => m.byHand.flow.noStep, 404);
    const at = now();
    const step = input.stepId ? { stepId: input.stepId } : {};
    record.checkIns = [
      ...(record.checkIns ?? []),
      { ...step, signal: input.signal, ...(input.choice ? { choice: input.choice } : {}), at },
    ].slice(-limits.checkIns);
    if (input.choice) record.exits = [...(record.exits ?? []), { ...step, exit: input.choice, at }].slice(-limits.exits);
    await ctx.store.save();
    return { run };
  });
}

/** POST /api/runs/:id/by-hand/ready */
export async function ready(
  ctx: WorkbenchContext,
  id: string,
  input: ByHandReadyInput,
): Promise<{ run: Run }> {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    assertWriting(run);
    if (ctx.byHandJobs.has(`review:${id}`)) throw refuse((m) => m.byHand.busy);
    // A fitted run whose help set lacks `review`: Ready itself is never refused for that.
    if (input.review) assertHelpAllowed(run, "review");
    // The review waits for the run's guide turn or test run (one busy slot).
    if (input.review && (run.byHand?.busy || ["guide", "tests"].some((kind) => ctx.byHandJobs.has(`${kind}:${id}`))))
      throw refuse((m) => m.byHand.busy);
    const files = await ctx.diff(id);
    if (!files.length) throw refuse((m) => m.byHand.flow.nothingReady);
    const fingerprint = changeFingerprint(files);
    if (input.changeFingerprint !== fingerprint) throw refuse((m) => m.byHand.flow.changed);
    const record = (run.byHand ??= {});
    // Tests are the judge: another review needs a test run (or a reported one) of this version.
    if (input.review && record.reviews?.length && !record.tests?.some((test) => test.changeFingerprint === fingerprint))
      throw refuse((m) => m.byHand.testFirst);
    if (record.ready) {
      const { at, changeFingerprint: version, review } = record.ready;
      record.readyHistory = [...(record.readyHistory ?? []), { at, changeFingerprint: version, review }].slice(-limits.readyHistory);
    }
    const leastSure = input.leastSure?.trim();
    record.ready = { at: now(), changeFingerprint: fingerprint, ...(leastSure ? { leastSure } : {}), review: input.review };
    // The first Ready completes the phase; afterwards the client compares fingerprints (readyNow).
    if (run.team && run.team.phase !== "complete") enterPhase(run, run.team, "complete");
    ctx.log(run, "user", input.review ? sm().byHand.flow.readyReview : sm().byHand.flow.readyMarked);
    if (input.review) startReview(ctx, run);
    await ctx.store.save();
    return { run };
  });
}

/** "Run the review again" in a Learn-by-hand run: Ready for the ready version, with the review (409 before Ready). */
export async function reviewAgain(ctx: WorkbenchContext, id: string) {
  const run = ctx.run(id);
  const files = await ctx.lock(id, () => ctx.diff(id));
  assertReady(run, files);
  const leastSure = run.byHand?.ready?.leastSure;
  return (await ready(ctx, id, { changeFingerprint: changeFingerprint(files), ...(leastSure ? { leastSure } : {}), review: true })).run;
}

let reviewOverride: typeof guide.review | undefined;

/** For tests only (nothing else calls it): runs `review` instead of the guide's review turn, until called without one. */
export function byHandReviewInTests(review?: typeof guide.review) {
  reviewOverride = review;
}

/**
 * The guide's structured review of the ready version (F8, the guide's
 * `review` turn in server/by-hand-guide.ts, which filters and stores it)
 * as the job `review:<id>`: Stop, cancel() and shutdown() abort it. This
 * job owns `byHand.busy` (kind `review`) and the run's log lines about it.
 */
function startReview(ctx: WorkbenchContext, run: Run) {
  const key = `review:${run.id}`;
  const controller = new AbortController();
  ctx.controllers.set(key, controller);
  const record = run.byHand!;
  const leastSure = record.ready?.leastSure;
  record.busy = { kind: "review", since: now() };
  const job = withRunLocale(run, async () => {
    try {
      await (reviewOverride ?? guide.review)(ctx, run, leastSure ? { leastSure } : {}, controller.signal);
      ctx.log(run, "system", sm().byHand.flow.review.done);
    } catch (error) {
      const reason = redact(error instanceof Error ? error.message : String(error));
      ctx.log(run, "system", controller.signal.aborted ? sm().byHand.flow.review.stopped : sm().byHand.flow.review.failed({ reason }));
    }
  })
    .catch((error) => log.error("by-hand review failed", { runId: run.id, error: String(error) }))
    .finally(async () => {
      if (record.busy?.kind === "review") delete record.busy;
      if (ctx.controllers.get(key) === controller) ctx.controllers.delete(key);
      ctx.byHandJobs.delete(key);
      await ctx.store.save().catch(() => undefined);
    });
  ctx.byHandJobs.set(key, job);
}

/** Nothing is explained or reviewed before the person says the change is ready (F5): 409 otherwise. */
export function assertReady(run: Run, files: readonly DiffFile[]) {
  if (run.learnByHand && !readyNow(run, files)) throw refuse((m) => m.byHand.notReady);
}

/** POST /api/runs/:id/by-hand/leave: the run stays as it is; the client opens the task dialog. */
export async function leave(ctx: WorkbenchContext, id: string): Promise<{ run: Run }> {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (run.status === "published" || run.publishing) throw refuse((m) => m.byHand.flow.notWriting);
    const record = (run.byHand ??= {});
    const at = now();
    record.leftAt ??= at;
    record.exits = [...(record.exits ?? []), { exit: "leave", at }].slice(-limits.exits);
    ctx.log(run, "user", sm().byHand.flow.left);
    await ctx.store.save();
    return { run };
  });
}

/** What the routes call (server/routes/by-hand.ts): `Workbench.byHand`. */
export interface ByHandFacade {
  savePlan(id: string, input: ByHandPlanInput): Promise<{ run: Run }>;
  revealOutline(id: string, input: ByHandRevealInput): Promise<{ run: Run }>;
  planQuestions(id: string): Promise<{ run: Run }>;
  updateStep(id: string, stepId: string, input: ByHandStepInput): Promise<{ run: Run }>;
  guide(id: string, input: ByHandGuideInput): Promise<{ run: Run }>;
  checkIn(id: string, input: ByHandCheckInInput): Promise<{ run: Run }>;
  testCommand(id: string): Promise<TestCommandView>;
  /** The project's test command; for any project, before or without a run. */
  confirmTestCommand(repoId: string, input: TestCommandInput): Promise<{ repo: Repository }>;
  runTests(id: string, input: ByHandTestInput): Promise<{ run: Run }>;
  liveTests(id: string): Promise<LiveTests>;
  stopTests(id: string): Promise<{ run: Run }>;
  reportTests(id: string, input: ByHandTestReportInput): Promise<{ run: Run }>;
  ready(id: string, input: ByHandReadyInput): Promise<{ run: Run }>;
  leave(id: string): Promise<{ run: Run }>;
  template(id: string): Promise<{ templates: ByHandTemplate[] }>;
}

/** The façade (W1A, final): a Learn-by-hand run, else 409, then the work. */
export function byHandFacade(ctx: WorkbenchContext): ByHandFacade {
  const byHandRun = (id: string) => {
    if (!ctx.run(id).learnByHand) throw new AppError((m) => m.byHand.notByHand, 409);
  };
  return {
    async savePlan(id, input) {
      byHandRun(id);
      return savePlan(ctx, id, input);
    },
    async revealOutline(id, input) {
      byHandRun(id);
      return revealOutline(ctx, id, input);
    },
    async planQuestions(id) {
      byHandRun(id);
      return guide.planQuestions(ctx, id);
    },
    async updateStep(id, stepId, input) {
      byHandRun(id);
      return updateStep(ctx, id, stepId, input);
    },
    async guide(id, input) {
      byHandRun(id);
      return guide.guide(ctx, id, input);
    },
    async checkIn(id, input) {
      byHandRun(id);
      return checkIn(ctx, id, input);
    },
    async testCommand(id) {
      byHandRun(id);
      return tests.testCommand(ctx, id);
    },
    async confirmTestCommand(repoId, input) {
      ctx.repo(repoId);
      return tests.confirmTestCommand(ctx, repoId, input);
    },
    async runTests(id, input) {
      byHandRun(id);
      return tests.runTests(ctx, id, input);
    },
    async liveTests(id) {
      byHandRun(id);
      return tests.liveTests(ctx, id);
    },
    async stopTests(id) {
      byHandRun(id);
      return tests.stopTests(ctx, id);
    },
    async reportTests(id, input) {
      byHandRun(id);
      return tests.reportTests(ctx, id, input);
    },
    async ready(id, input) {
      byHandRun(id);
      return ready(ctx, id, input);
    },
    async leave(id) {
      byHandRun(id);
      return leave(ctx, id);
    },
    async template(id) {
      byHandRun(id);
      return template(ctx, id);
    },
  };
}
