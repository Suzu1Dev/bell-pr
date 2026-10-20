/**
 * Learn by hand: the guide's turns (DESIGN v1.2 F3, F6-F8), for runs the
 * façade (server/by-hand.ts) found to be Learn by hand. Every turn is
 * read-only and isolated, never sees the guide's outline, is checked with
 * `assertHelpAllowed` before it starts (a fitted run gets only the help its
 * `byHand.helpLock` names), and is filtered (F7) and recorded through
 * `recordHelp` before it is stored. One guide job per run (409 busy), as
 * `guide:<id>` in `ctx.byHandJobs` and `ctx.controllers`, so Stop,
 * cancel() and shutdown() abort it.
 *
 * - `guide`: POST …/by-hand/guide (202): an ask ("My change" goes to the
 *   lowest unused rung the run allows), a hint R1-R4 behind the attempt
 *   gate, or "Explain this failure". `planQuestions`: POST
 *   …/by-hand/plan/questions (202), at most 3 per run.
 * - `review`: the structured review at Ready (F8), run by `ready()` as
 *   `review:<id>`. `chat`: the per-file Ask tab's answer after Ready.
 */
import { randomUUID } from "node:crypto";
import { attemptSince, byHandLimits, helpKindOf, helpAllowed, nextRungAllowed, repeatFailure } from "../shared/by-hand.js";
import type { AskEntry, ByHandGuideInput, ByHandReview, ByHandStep, GuideEntry, GuideKind, HelpSource } from "../shared/by-hand.js";
import { filterAgentText, type FilteredGuideOutput, type Filtered } from "../shared/by-hand-filter.js";
import { changeFingerprint } from "../shared/change-fingerprint.js";
import { filterGuideAnswer, filterStoredText, turnFiles } from "./by-hand-filter.js";
import { assertHelpAllowed, recordHelp } from "./by-hand-record.js";
import { guideAnswerJsonSchema, guideAnswerSchema, parseByHandAnswer, reviewerAnswerJsonSchema, reviewerAnswerSchema, withSchemaFile } from "./by-hand-schemas.js";
import { readDiff } from "./git.js";
import { currentLocale, shuttingDown, sm } from "./i18n/index.js";
import { byHandReviewerPrompt, byHandTesterPrompt, guidePrompt, latestTest, planQuestionsPrompt, stepDiff, testTail, type GuidePromptInput } from "./prompts/by-hand.js";
import { runAgent, runIndependentReview } from "./run-executor.js";
import { reviewDiffContext } from "./team.js";
import { AppError, withRunLocale, type DiffFile, type Run } from "./types.js";
import type { Locale } from "../shared/i18n/locale.js";
import type { WorkbenchContext } from "./workbench.js";

const limits = byHandLimits;
const now = () => new Date().toISOString();
/** Lines of a selection a question carries. */
const selectionLines = 40;
const removedMark = "…";

/** What a turn reads of the run: its request, checkout, plan and record (the eval passes its own). */
export type GuideRun = Pick<Run, "prompt" | "contributionSettings" | "team" | "baseSha" | "worktreePath" | "modelExecution" | "byHand">;

/** One resolved guide turn: what is asked, at which version, and what the guide sees. */
export interface GuideRequest {
  /** Also the help event's source: every guide kind is one. */
  kind: GuideKind;
  rung?: number;
  entry?: AskEntry;
  step?: ByHandStep;
  /** The person's question and "what I tried". */
  question?: string; tried?: string;
  /** Every changed file when it was asked; the filter checks code against them. */
  files: DiffFile[];
  /** The files whose diff the guide sees: the step's, or the chat's one file; all when absent. */
  scope?: readonly string[];
  fingerprint: string;
  /** When it was asked: the hint state's time. */
  at: string;
  selection?: { path: string; startLine: number; endLine: number };
  /** A chat's file, its earlier turns, and the review's findings on it. */
  file?: string; history?: GuideEntry[]; findings?: ByHandReview["findings"];
}

/** `path:line` or `path:line-endLine`, one per line. */
const pointers = (refs: readonly { path: string; line: number; endLine?: number }[]) =>
  refs.map((ref) => (ref.endLine ? `${ref.path}:${ref.line}-${ref.endLine}` : `${ref.path}:${ref.line}`)).join("\n");

/** A quote cut to the stored cap by whole lines, so it stays verbatim. */
function fitQuote(quote: FilteredGuideOutput["quotes"][number]) {
  const lines = quote.text.split("\n");
  while (lines.length > 1 && lines.join("\n").length > limits.quoteTextChars) lines.pop();
  return { ...quote, endLine: quote.startLine + lines.length - 1, text: lines.join("\n").slice(0, limits.quoteTextChars) };
}

/**
 * The stored entry of a filtered answer. An ask of another entry that the
 * guide says is about the change keeps only its refs and its question
 * (DESIGN v1.2 F6); an answer with nothing left but removals points to its
 * refs, or says BELL removed it.
 */
function answerEntry(run: GuideRun, request: GuideRequest, filtered: Filtered<FilteredGuideOutput>): GuideEntry {
  const { value, removed, dropped } = filtered;
  const offTopic = request.kind === "ask" && value.topic === "change";
  let text = offTopic ? sm().byHand.guide.aboutYourChange : value.text;
  if (!/[\p{L}\p{N}]/u.test(text.replaceAll(removedMark, "")))
    text = value.refs.length ? pointers(value.refs) : removed ? sm().byHand.guide.nothingLeft : text;
  const quotes = offTopic ? [] : value.quotes.map(fitQuote);
  const options = offTopic ? undefined : value.options;
  const execution = run.modelExecution;
  const model = execution?.reported?.model ?? execution?.model;
  return {
    id: randomUUID(),
    at: now(),
    kind: request.kind,
    ...(request.step ? { stepId: request.step.id } : {}),
    ...(request.kind === "hint" && request.rung !== undefined ? { rung: request.rung } : {}),
    ...(request.entry ? { entry: request.entry } : {}),
    ...(request.question?.trim() ? { question: request.question.trim().slice(0, limits.entryQuestionChars) } : {}),
    ...(request.tried?.trim() ? { tried: request.tried.trim().slice(0, limits.triedChars) } : {}),
    text: text.slice(0, limits.entryTextChars),
    ...(value.question ? { ask: value.question.slice(0, limits.askChars) } : {}),
    ...(value.refs.length ? { refs: value.refs.slice(0, limits.refs) } : {}),
    ...(quotes.length ? { quotes: quotes.slice(0, limits.quotes) } : {}),
    ...(options?.length ? { options: options.slice(0, limits.options) } : {}),
    ...(removed ? { removed } : {}),
    ...(dropped ? { dropped } : {}),
    ...(request.fingerprint ? { changeFingerprint: request.fingerprint } : {}),
    ...(model ? { model } : {}),
  };
}

/** The lines of the person's file a question is about, as BELL read them. */
async function selectionText(run: GuideRun, selection: NonNullable<GuideRequest["selection"]>) {
  const sources = await turnFiles(run).sources([selection.path]);
  const lines = sources.worktree[selection.path];
  if (!lines || selection.startLine > lines.length) return undefined;
  const endLine = Math.min(selection.endLine, lines.length, selection.startLine + selectionLines - 1);
  return { ...selection, endLine, text: lines.slice(selection.startLine - 1, endLine).join("\n") };
}

/** The prompt of one guide turn: the request and its context (DESIGN v1.2 F6), never the outline. */
export async function guideTurnPrompt(run: GuideRun, request: GuideRequest, locale: Locale) {
  const plan = run.byHand?.plan;
  if (request.kind === "plan" && plan) return planQuestionsPrompt(locale, { run, plan });
  const selection = request.selection ? await selectionText(run, request.selection) : undefined;
  const sameStep = (entry: GuideEntry) => entry.stepId === request.step?.id && entry.kind !== "plan";
  const { kind, rung, entry, step, file, findings } = request;
  const input: GuidePromptInput = {
    run, kind, rung, entry, plan, step, selection, file, findings,
    question: request.question?.trim() || undefined,
    tried: request.tried?.trim() || undefined,
    diff: stepDiff(request.files, request.scope),
    testTail: testTail(run.byHand?.tests, request.fingerprint),
    history: (request.history ?? (run.byHand?.thread ?? []).filter(sameStep)).slice(-4),
  };
  return guidePrompt(locale, input);
}

/** The person's diff as the filter checks code against it: the changed files and their patches. */
const changeOf = (files: readonly DiffFile[]) => {
  const visible = files.filter((file) => !file.blocked);
  return { changed: visible.map((file) => file.path), diff: visible.map((file) => file.patch).join("\n") };
};

/**
 * The paths an agent named that are text files of the checkout, at base or
 * in the worktree (the reader reads a blob only, never a pattern or a
 * folder). A path is agent text: any other one is dropped, never stored.
 */
async function checkoutPaths(reader: ReturnType<typeof turnFiles>, paths: readonly string[]) {
  const sources = await reader.sources(paths);
  return new Set(paths.filter((file) => !!sources.worktree[file] || !!sources.base[file]));
}

/** One guide answer as BELL stores it (DESIGN v1.2 F7): parsed strictly, its paths checked, quotes cut by BELL, prose filtered. */
export async function storedGuideAnswer(run: GuideRun, request: GuideRequest, answer: string) {
  const output = parseByHandAnswer(guideAnswerSchema, answer);
  const reader = turnFiles(run);
  const known = await checkoutPaths(reader, [...output.refs, ...output.quotes].map((value) => value.path));
  const [refs, quotes] = [output.refs.filter((ref) => known.has(ref.path)), output.quotes.filter((quote) => known.has(quote.path))];
  const unknown = output.refs.length + output.quotes.length - refs.length - quotes.length;
  const change = { ...changeOf(request.files), stepFiles: request.step?.files };
  const filtered = await filterGuideAnswer(reader, { ...output, refs, quotes }, change);
  return answerEntry(run, request, { ...filtered, dropped: filtered.dropped + unknown });
}

/** An agent turn's error, its message filtered (F7): the CLI's error can carry the agent's own text. */
function filteredError(error: unknown): never {
  const { value, removed } = filterAgentText(error instanceof Error ? error.message : String(error), { base: {}, worktree: {} });
  if (!removed) throw error;
  throw error instanceof AppError ? new AppError(value, error.statusCode, { code: error.code, params: error.params, fixes: error.fixes }) : new Error(value);
}

/** One guide turn (DESIGN v1.2 F6, F7): read-only and isolated, under the guide's schema; the caller records it. */
export async function runGuideTurn(ctx: WorkbenchContext, run: Run, request: GuideRequest, signal: AbortSignal) {
  const prompt = await guideTurnPrompt(run, request, currentLocale());
  const answer = await withSchemaFile(guideAnswerJsonSchema, (outputSchema) =>
    runAgent(ctx, run, "lead", prompt, signal, true, { isolated: true, outputSchema }),
  ).catch(filteredError);
  return storedGuideAnswer(run, request, answer);
}

/** Records one stored answer (F13): the help event first (it refuses a kind outside the lock), the entry, the hint state, the removals. */
function storeAnswer(run: Run, request: GuideRequest, entry: GuideEntry) {
  const hint = request.kind === "hint";
  const source: HelpSource = request.kind;
  recordHelp(run, { source, rung: hint ? request.rung : undefined, stepId: entry.stepId, removed: entry.removed, at: entry.at });
  const record = (run.byHand ??= {});
  if (request.kind === "plan") record.planQuestions = [...(record.planQuestions ?? []), entry].slice(-limits.planQuestions);
  else record.thread = [...(record.thread ?? []), entry].slice(-limits.thread);
  if (entry.removed) record.removedTotal = (record.removedTotal ?? 0) + entry.removed;
  if (!hint || !request.step || request.rung === undefined) return;
  const previous = record.hints?.[request.step.id];
  const tried = request.tried?.trim() || previous?.tried;
  const testRunAt = latestTest(record.tests)?.at;
  const rung = Math.max(previous?.rung ?? 0, request.rung);
  (record.hints ??= {})[request.step.id] = { rung, at: request.at, fingerprint: request.fingerprint };
  if (testRunAt) record.hints[request.step.id].testRunAt = testRunAt;
  if (tried) record.hints[request.step.id].tried = tried.slice(0, limits.triedChars);
  const step = record.plan?.steps.find((value) => value.id === request.step?.id);
  if (step) step.maxRung = Math.max(step.maxRung ?? 0, request.rung);
}

/** Refuses a guide turn while another guide turn, the review or the person's tests run (409). */
function assertIdle(ctx: WorkbenchContext, run: Run) {
  const busy = run.byHand?.busy;
  if (busy?.kind === "tests" || ctx.byHandJobs.has(`tests:${run.id}`))
    throw new AppError((m) => m.byHand.guide.testsRunning, 409);
  const keys = [`guide:${run.id}`, `review:${run.id}`];
  if (busy || keys.some((key) => ctx.byHandJobs.has(key)) || ctx.controllers.has(keys[0]))
    throw new AppError((m) => m.byHand.busy, 409);
}

/** Starts the job `guide:<id>` and sets `busy`; however it ends, it clears `busy` and saves, and logs why when it failed. */
function startGuideJob(ctx: WorkbenchContext, run: Run, request: GuideRequest) {
  const key = `guide:${run.id}`;
  const controller = new AbortController();
  ctx.controllers.set(key, controller);
  (run.byHand ??= {}).busy = { kind: "guide", since: now() };
  const job = withRunLocale(run, async () => {
    try {
      const entry = await runGuideTurn(ctx, run, request, controller.signal);
      await ctx.lock(run.id, async () => storeAnswer(ctx.run(run.id), request, entry));
    } catch (error) {
      ctx.log(run, "lead", error instanceof Error ? error.message : String(error), { kind: "notice" });
    } finally {
      if (run.byHand?.busy?.kind === "guide") delete run.byHand.busy;
      if (ctx.controllers.get(key) === controller) ctx.controllers.delete(key);
      ctx.byHandJobs.delete(key);
      await ctx.store.save().catch(() => undefined);
    }
  });
  ctx.byHandJobs.set(key, job);
}

/** The step a hint or a "My change" question is about: the one named, else the first open one. */
function stepOf(run: Run, stepId: string | undefined) {
  const steps = run.byHand?.plan?.steps ?? [];
  const step = steps.find((value) => (stepId ? value.id === stepId : !value.doneAt && !value.parkedAt));
  if (!step) throw new AppError((m) => m.byHand.guide.pickStep, 409);
  return step;
}

/**
 * The rung of a hint, or of a "My change" question routed to the ladder:
 * the lowest unused rung, when the run allows its kind of help; otherwise
 * 409 with the exits (a fitted run's lock, or no rung after R4).
 */
function routedRung(run: Run, step: ByHandStep) {
  const rung = (run.byHand?.hints?.[step.id]?.rung ?? 0) + 1;
  if (rung > 4) throw new AppError((m) => m.byHand.guide.lastRungGiven, 409);
  const kind = helpKindOf("hint", rung);
  if (!helpAllowed(run, kind))
    throw new AppError((m) => m.byHand.guide.noRungLeft({ kind: kind ? m.byHand.helpKinds[kind] : "?" }), 409);
  return rung;
}

/** POST /api/runs/:id/by-hand/guide (202). */
export async function guide(ctx: WorkbenchContext, id: string, input: ByHandGuideInput): Promise<{ run: Run }> {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (run.status !== "review" || run.publishing) throw new AppError((m) => m.byHand.guide.notNow, 409);
    // "My change" goes to the ladder (DESIGN v1.2 F6).
    const routed = input.kind === "ask" && input.entry === "change";
    const kind: GuideKind = routed ? "hint" : input.kind;
    // A fitted run's help set comes first: no gate and no turn for a kind outside it.
    let step: ByHandStep | undefined;
    let rung: number | undefined;
    if (routed) {
      step = stepOf(run, input.stepId);
      rung = routedRung(run, step);
    } else if (kind === "hint") {
      if (input.rung !== undefined) assertHelpAllowed(run, helpKindOf("hint", input.rung));
      step = stepOf(run, input.stepId);
      rung = input.rung ?? (run.byHand?.hints?.[step.id]?.rung ?? 0) + 1;
      assertHelpAllowed(run, helpKindOf("hint", rung));
    } else {
      assertHelpAllowed(run, helpKindOf(kind));
      if (input.stepId) step = stepOf(run, input.stepId);
    }
    assertIdle(ctx, run);
    const tests = run.byHand?.tests;
    if (kind === "test" && (latestTest(tests)?.outcome ?? "passed") === "passed")
      throw new AppError((m) => m.byHand.guide.noFailure, 409);
    const files = await ctx.diff(id);
    const fingerprint = changeFingerprint(files);
    if (kind === "hint") {
      const state = run.byHand?.hints?.[step!.id];
      if (!nextRungAllowed(state, rung!)) throw new AppError((m) => m.byHand.guide.rungTooHigh, 409);
      const tried = { fingerprint, tests, ...(input.tried ? { tried: input.tried } : {}) };
      if (!attemptSince(state, tried) && !(rung === 4 && repeatFailure(tests)))
        throw new AppError((m) => m.byHand.attemptFirst, 409);
    }
    const { path, startLine } = input;
    const selection = path && startLine ? { path, startLine, endLine: Math.max(input.endLine ?? startLine, startLine) } : undefined;
    startGuideJob(ctx, run, {
      kind,
      ...(rung !== undefined ? { rung } : {}),
      ...(input.entry && (routed || kind === "ask") ? { entry: input.entry } : {}),
      ...(step ? { step, scope: step.files } : {}),
      ...(input.question ? { question: input.question } : {}),
      ...(input.tried ? { tried: input.tried } : {}),
      files,
      fingerprint,
      at: now(),
      ...(selection ? { selection } : {}),
    });
    await ctx.store.save();
    return { run };
  });
}

/** POST /api/runs/:id/by-hand/plan/questions (202). */
export async function planQuestions(ctx: WorkbenchContext, id: string): Promise<{ run: Run }> {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (run.status !== "awaiting_plan") throw new AppError((m) => m.byHand.guide.planOnly, 409);
    assertHelpAllowed(run, helpKindOf("plan"));
    assertIdle(ctx, run);
    if (!run.byHand?.plan?.steps.length) throw new AppError((m) => m.byHand.guide.planFirst, 409);
    if ((run.byHand.planQuestions?.length ?? 0) >= limits.planQuestions)
      throw new AppError((m) => m.byHand.guide.planQuestionsUsed, 409);
    startGuideJob(ctx, run, { kind: "plan", files: [], fingerprint: "", at: now() });
    await ctx.store.save();
    return { run };
  });
}

/** A run of at least `min` backticks, longer than any inside `text`, so none of them ends its code. */
const ticks = (text: string, min: number) => "`".repeat(Math.max(min, ...[...text.matchAll(/`+/g)].map(([run]) => run.length + 1)));
const fenced = (text: string) => `${ticks(text, 3)}\n${text}\n${ticks(text, 3)}`;
/** Agent prose in BELL's Markdown: its fence markers stay literal, so it never opens a code block that swallows what follows. */
const literalFences = (text: string) =>
  text.replace(/^([ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?)(`{3,}|~{3,})/gm, (_line, prefix: string, fence: string) => prefix + fence.replace(/./g, "\\$&"));
/** Agent prose on one line of BELL's Markdown (a review's list). */
const oneLine = (text: string) => literalFences(text).replace(/\s*\n\s*/g, " ");

/** A chat answer as the conversation stores it: the prose, the guide's question, BELL's quotes. */
function chatText(entry: GuideEntry) {
  const messages = sm().byHand.guide;
  const unnamed = (entry.refs ?? []).filter((ref) => !entry.text.includes(`${ref.path}:${ref.line}`));
  return [
    literalFences(entry.text),
    ...(unnamed.length ? [pointers(unnamed)] : []),
    ...(entry.quotes ?? []).map((quote) => {
      const place = `${quote.path}:${quote.startLine}-${quote.endLine}`;
      const header = quote.from === "change" ? messages.fromChange({ place }) : messages.fromBase({ place });
      return `${header}\n${fenced(quote.text)}`;
    }),
    ...(entry.ask ? [literalFences(entry.ask)] : []),
    ...(entry.removed ? [messages.removedFromAnswer] : []),
  ]
    .filter((part) => part.trim())
    .join("\n\n");
}

/** The per-file Ask tab's answer in a Learn-by-hand run, after Ready (F6). */
export async function chat(ctx: WorkbenchContext, run: Run, filePath: string, question: string, signal: AbortSignal): Promise<string> {
  assertHelpAllowed(run, helpKindOf("chat"));
  if (ctx.byHandJobs.has(`guide:${run.id}`)) throw new AppError((m) => m.byHand.busy, 409);
  const files = await readDiff(run);
  const file = files.find((value) => value.path === filePath);
  // Earlier turns about this version of the file, as the guide's history.
  const messages = (run.conversations?.[filePath]?.messages ?? []).filter(
    (message) => !file || message.fingerprint === file.fingerprint,
  );
  const history: GuideEntry[] = [];
  for (let index = 0; index + 1 < messages.length; index += 2)
    if (messages[index].role === "user" && messages[index + 1].role === "assistant")
      history.push({ id: "", at: "", kind: "chat", question: messages[index].content, text: messages[index + 1].content });
  const findings = (run.byHand?.reviews?.at(-1)?.findings ?? []).filter((finding) => finding.path === filePath);
  const fingerprint = changeFingerprint(files);
  const request: GuideRequest = { kind: "chat", question, files, scope: [filePath], fingerprint, at: now(), file: filePath, history, findings };
  const entry = await runGuideTurn(ctx, run, request, signal);
  recordHelp(run, { source: "chat", removed: entry.removed, at: entry.at });
  if (entry.removed) (run.byHand ??= {}).removedTotal = (run.byHand.removedTotal ?? 0) + entry.removed;
  return chatText(entry);
}

/** A review quote BELL can show: text a cited file or the last test output has, else none. */
async function verbatimQuote(files: ReturnType<typeof turnFiles>, quote: string, cited: string[], tail?: string) {
  const sources = await files.sources(cited);
  const text = quote.trim();
  const inFile = [...Object.values(sources.base), ...Object.values(sources.worktree)].some((lines) => lines?.join("\n").includes(text));
  return text && (inFile || tail?.includes(text)) ? text.slice(0, 300) : undefined;
}

/** Inline code for a verbatim quote. */
const inlineCode = (text: string) => `${ticks(text, 1)} ${text.replace(/\s*\n\s*/g, " ")} ${ticks(text, 1)}`;

/** The structured review as the Reports tab shows it (Markdown, the run's language). */
export function reviewMarkdown(review: ByHandReview) {
  const words = sm().byHand.guide.review;
  const place = (path?: string, line?: number) => (path ? (line ? `${path}:${line}` : path) : "");
  const findings = review.findings.map((finding, index) => {
    const { evidence } = finding;
    const shown =
      evidence.type === "none" || !(evidence.type in words.evidence) || !(evidence.path || evidence.quote)
        ? words.mayBeWrong
        : `${words.evidence[evidence.type as keyof typeof words.evidence]}: ${[place(evidence.path, evidence.line), evidence.quote ? inlineCode(evidence.quote) : ""].filter(Boolean).join(" ")}`;
    return `${index + 1}. ${place(finding.path, finding.line)}: ${oneLine(finding.observed)}\n   - ${shown}\n   - ${words.why}: ${oneLine(finding.why)}\n   - ${words.question}: ${oneLine(finding.question)}`;
  });
  return [
    `**${words.verified}**\n\n${oneLine(review.verified)}`,
    `**${words.checked}**\n\n${review.checked.map((item) => `- ${oneLine(item)}`).join("\n")}`,
    `**${words.findings}**\n\n${findings.length ? findings.join("\n") : words.noFindings}`,
    words.advice,
  ].join("\n\n");
}

/** What the reviewer and the test analyst read at Ready (F8): the diff, the plan, the last run at this version. */
export function reviewInput(run: GuideRun, files: DiffFile[], leastSure?: string) {
  const fingerprint = changeFingerprint(files);
  const lastTest = latestTest(run.byHand?.tests, fingerprint);
  const sure = leastSure?.trim().slice(0, limits.leastSureChars) || undefined;
  const prompt = { run, diff: reviewDiffContext(files), plan: run.byHand?.plan, leastSure: sure, lastTest, previous: run.byHand?.reviews?.at(-1) };
  return { fingerprint, prompt };
}

/**
 * The review as BELL stores it (F7, F8): the reviewer parsed strictly (422
 * otherwise, nothing stored), every text filtered, an evidence quote kept
 * only when a cited file or the last test output has it.
 */
export async function storedReview(run: GuideRun, files: DiffFile[], input: ReturnType<typeof reviewInput>, reports: { reviewer: string; tester: string }) {
  const answer = parseByHandAnswer(reviewerAnswerSchema, reports.reviewer);
  const { lastTest, leastSure } = input.prompt;
  const reader = turnFiles(run);
  let removed = 0;
  const prose = async (text: string, cited: string[] = [], lines = false) => {
    const change = { ...changeOf(files), cited };
    let filtered = await filterStoredText(reader, text, change);
    // The Reports tab shows a reviewer's field on one line (reviewMarkdown): code that forms when its lines join goes too.
    const joined = lines ? undefined : await filterStoredText(reader, filtered.value.replace(/\s*\n\s*/g, " "), change);
    if (joined?.removed) filtered = { ...joined, removed: filtered.removed + joined.removed };
    removed += filtered.removed;
    return filtered.value;
  };
  // A finding stays only at a path of the checkout, and its evidence keeps a path only when it is one.
  const known = await checkoutPaths(reader, answer.findings.flatMap((finding) => [finding.path, finding.evidence.path ?? ""]));
  const isFile = (file?: string | null) => !!file && known.has(file);
  const findings: ByHandReview["findings"] = [];
  for (const finding of answer.findings.filter((value) => isFile(value.path))) {
    const evidence = isFile(finding.evidence.path) ? finding.evidence : { ...finding.evidence, path: null, line: null };
    const cited = [finding.path, ...(evidence.path ? [evidence.path] : [])];
    const quote = evidence.quote ? await verbatimQuote(reader, evidence.quote, cited, lastTest?.outputTail) : undefined;
    const observed = (await prose(finding.observed, cited)).slice(0, limits.findingObservedChars);
    const why = (await prose(finding.why, cited)).slice(0, limits.findingWhyChars);
    const question = (await prose(finding.question, cited)).slice(0, limits.findingQuestionChars);
    findings.push({
      path: finding.path,
      ...(finding.line ? { line: finding.line } : {}),
      observed,
      evidence: { type: evidence.type, ...(evidence.path ? { path: evidence.path } : {}), ...(evidence.line ? { line: evidence.line } : {}), ...(quote ? { quote } : {}) },
      why,
      question,
      ...(finding.dimension ? { dimension: finding.dimension } : {}),
    });
  }
  const verified = (await prose(answer.verified)).slice(0, limits.reviewVerifiedChars);
  const checked: string[] = [];
  for (const item of answer.checked) checked.push((await prose(item)).slice(0, 300));
  const tester = await prose(reports.tester, [], true);
  const review: ByHandReview = { at: now(), changeFingerprint: input.fingerprint, verified, checked, findings };
  if (leastSure) review.leastSure = leastSure;
  if (lastTest) review.testRunAt = lastTest.at;
  if (removed) review.removed = removed;
  return { review, tester };
}

/** The structured review at Ready (F8); `ready()` runs it as the job `review:<id>`. */
export async function review(ctx: WorkbenchContext, run: Run, input: { leastSure?: string }, signal: AbortSignal): Promise<void> {
  assertHelpAllowed(run, helpKindOf("review"));
  await withRunLocale(run, async () => {
    const files = await readDiff(run);
    const turn = reviewInput(run, files, input.leastSure);
    const locale = currentLocale();
    const [reviewerPrompt, testerPrompt] = [byHandReviewerPrompt(locale, turn.prompt), byHandTesterPrompt(locale, turn.prompt)];
    const reports = await withSchemaFile(reviewerAnswerJsonSchema, (reviewerSchema) =>
      runIndependentReview(ctx, run, files, undefined, signal, { reviewerPrompt, testerPrompt, reviewerSchema, isolated: true }),
    ).catch(filteredError);
    const { review: stored, tester } = await storedReview(run, files, turn, reports);
    // Stored together, after every await: the help event first, as it refuses a kind outside the lock.
    recordHelp(run, { source: "review", removed: stored.removed });
    const byHand = (run.byHand ??= {});
    byHand.reviews = [...(byHand.reviews ?? []), stored].slice(-limits.reviews);
    if (stored.removed) byHand.removedTotal = (byHand.removedTotal ?? 0) + stored.removed;
    run.reports = { ...run.reports, reviewer: reviewMarkdown(stored), tester };
    await ctx.store.save();
  });
}
