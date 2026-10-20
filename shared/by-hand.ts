/**
 * Learn by hand (DESIGN v1.2): the person writes every line, BELL's agents
 * only read, and the Lead becomes the guide. The run record's shapes
 * (`RunCore.byHand`), the frozen vocabularies, the limits and the pure
 * rules the server and the client share. The claim ("BELL's agents had no
 * write access and gave you no code for this change.") shows only while
 * `byHandClean(run)` holds, which reads the run's history, not the build.
 */
import { changeFingerprint, understandingWords, type CheckFile } from "./understanding.js";

// The vocabularies below are stored as text in state.json and frozen at
// these values: a later build may add a field, never a value. Readers
// ignore a value they do not know.

/** A guide turn: a question, a hint rung, a test failure, plan questions, chat. */
export const guideKinds = ["ask", "hint", "test", "plan", "chat"] as const;
export type GuideKind = (typeof guideKinds)[number];
/** The entry chip of a free question (DESIGN F6). */
export const askEntries = ["tooling", "project", "concept", "change"] as const;
export type AskEntry = (typeof askEntries)[number];
/** The kinds of help; a project's carve-out names some of them (DESIGN F12). */
export const allHelpKinds = ["explain", "answer", "plan", "review", "test"] as const;
export type HelpKind = (typeof allHelpKinds)[number];
/** Where a help event came from (DESIGN F13). */
export const helpSources = [
  "premise", "outline", "plan", "ask", "hint", "test", "review", "explanation", "walkthrough", "chat",
] as const;
export type HelpSource = (typeof helpSources)[number];
export const testOutcomes = ["passed", "failed", "timeout", "stopped", "error"] as const;
export type TestOutcome = (typeof testOutcomes)[number];
/** Pass, Fail or Not sure, before a test run. */
export const testPredictions = ["pass", "fail", "unsure"] as const;
export type TestPrediction = (typeof testPredictions)[number];
/** What a review finding rests on; `none` renders as a question. */
export const evidenceTypes = ["test", "rule", "pattern", "none"] as const;
export type EvidenceType = (typeof evidenceTypes)[number];
/** "I'm stuck", or the same failure three runs in a row. */
export const checkInSignals = ["button", "repeat-failure"] as const;
export type CheckInSignal = (typeof checkInSignals)[number];
/** The exits in the panel's order; `leave` hands the task to the agent team. */
export const exitKinds = ["human", "smaller", "talk", "park", "leave"] as const;
export type ExitKind = (typeof exitKinds)[number];
/** What `byHand.busy` waits for. */
export const busyKinds = ["plan", "guide", "review", "tests"] as const;
export type BusyKind = (typeof busyKinds)[number];
/** Hint rungs: R0 is local (no model call); there is no code rung. */
export const hintRungs = [0, 1, 2, 3, 4] as const;

/**
 * The write caps of the record. Persisted reads allow four times as much
 * (`lenientRead`); words count with `understandingWords`, where one CJK
 * character is one word.
 */
export const byHandLimits = {
  // The guide's outline.
  outlineSummaryChars: 1200, outlineSteps: 8, outlineTitleChars: 80, stepFiles: 8,
  readFirst: 5, readFirstWhyChars: 200,
  // The person's plan and steps.
  planSteps: 12, stepTitleChars: 120, stepHowChars: 400, stepWhyChars: 300,
  planTestsChars: 600, planUnsureChars: 600, predictionChars: 300,
  // Lists kept on the record; test runs past `testTails` keep no output.
  planQuestions: 3, thread: 40, talks: 30, tests: 10, testTails: 5,
  readyHistory: 10, reviews: 6, events: 300, checkIns: 20, exits: 20,
  // Guide entries.
  entryQuestionChars: 600, triedChars: 300, entryTextChars: 1200, askChars: 300,
  refs: 5, quotes: 3, quoteTextChars: 1200, quoteLines: 15, anchorChars: 80,
  options: 3, optionNameChars: 80, tradeoffChars: 300, leastSureChars: 300,
  // Test runs.
  commandChars: 300, expectChars: 200, tailChars: 4000, newFiles: 10,
  // The structured review.
  reviewVerifiedChars: 400, reviewChecked: 8, reviewFindings: 3,
  findingObservedChars: 400, findingWhyChars: 300, findingQuestionChars: 300,
  // A fitted run's locked rules, and the carve-out quotes of each.
  lockRules: 4, allows: 3, allowKinds: 5, quoteChars: 300,
  // Words of "what I tried" and of the why after R3 or R4; identical
  // failures before the stuck card; output lines the tail hash covers.
  attemptWords: 5, whyWords: 5, repeatFailures: 3, tailHashLines: 40,
} as const;

// The record's shapes (DESIGN §7). Vocabulary values are stored as text.

/** The guide's outline, kept outside `team.tasks` so it is never executed. */
export interface GuidePlan {
  summary: string;
  steps: { title: string; files: string[] }[];
  readFirst?: { path: string; startLine: number; endLine: number; why: string }[];
  at: string;
  removed?: number; // code the filter removed; `dropped`: quotes or ranges dropped
  dropped?: number;
}

/** One step of the person's own plan. */
export interface ByHandStep {
  id: string;
  title: string;
  files?: string[];
  how?: string; // "What you'll do here"
  doneAt?: string;
  parkedAt?: string;
  maxRung?: number; // the highest hint rung given on the step
  why?: string; // "Why does your change for this step work?", after R3 or R4
  chosen?: { entryId: string; option: number; why: string }; // the R3 option picked
}

/** The person's plan: their steps first; the guide's outline on request. */
export interface ByHandPlan {
  steps: ByHandStep[];
  tests?: string; // "How will you test it?"
  unsure?: string; // "What are you unsure about?"
  prediction?: string; // "Which function would you change, and why?"
  savedAt: string;
  confirmedAt?: string; // "This is my plan."
  outlineAt?: string; // the outline's step names first shown
  outlineBeforeDraft?: true; // shown before a first saved step, on request
}

/** A quote BELL cut itself from the base commit (`base`) or the person's file (`change`). */
export interface GuideQuote { path: string; startLine: number; endLine: number; from: string; text: string }

/** One stored guide answer: a hint, a question, a failure explained, plan questions or chat. */
export interface GuideEntry {
  id: string;
  at: string;
  kind: string; // GuideKind
  stepId?: string;
  rung?: number;
  entry?: string; // AskEntry
  question?: string;
  tried?: string;
  text: string;
  ask?: string; // the guide's one question back
  refs?: { path: string; line: number; endLine?: number }[];
  quotes?: GuideQuote[];
  options?: { name: string; tradeoff: string }[];
  removed?: number; dropped?: number; changeFingerprint?: string; model?: string;
}

/** The last hint on a step, which the attempt gate compares against. */
export interface HintState {
  rung: number; // the highest rung given on the step so far
  at: string; fingerprint: string; testRunAt?: string; tried?: string;
}

/** One run of the person's confirmed test command, or a result they reported. */
export interface TestRun {
  at: string; command: string; changeFingerprint: string;
  outcome: string; // TestOutcome
  exitCode?: number; ms: number;
  prediction?: string; // TestPrediction
  expect?: string; // "Which test do you expect to fail?"
  outputTail?: string;
  tailHash?: string; // of the last 40 output lines
  newFiles?: string[]; // untracked files the run created
  reported?: true; // run in the person's own terminal
}

/** The guide's structured review at Ready: findings with evidence, never a fix. */
export interface ByHandReview {
  at: string; changeFingerprint: string; leastSure?: string; testRunAt?: string;
  verified: string;
  checked: string[];
  findings: {
    path: string; line?: number; observed: string;
    evidence: { type: string; path?: string; line?: number; quote?: string }; // EvidenceType
    why: string; question: string;
    dimension?: string; // TasteDimension
  }[];
  removed?: number;
}

/** Help BELL stored output for, recorded on the server when the output is stored. */
export interface HelpEvent {
  at: string;
  kind: string; // HelpKind
  source: string; // HelpSource
  rung?: number;
  stepId?: string;
  model?: string; // as the CLI reported it, else the one requested
  cli?: string; // the agent CLI, with its version when it reported one
  removed?: number;
}

/** One project rule a fitted run is fixed to, quoted verbatim when the run started. */
export interface HelpLockRule {
  kind: string; // PolicyKind: ban or area
  path: string;
  line: number;
  quote: string;
  allows: { line: number; quote: string; kinds: string[] }[]; // as PolicyFinding.allows
  source?: { registry: string; url: string; version?: string; checkedOn: string };
}

/**
 * The help set fixed when a fitted run started (DESIGN F12 condition e):
 * set only by createRun, never changed. The guide offers only these kinds.
 */
export interface HelpLock {
  kinds: string[]; // HelpKind values; always explain and answer
  at: string; // the run's start
  rulesCheckedAt: string; // contributionRules.checkedAt of the rules fitted to
  rules: HelpLockRule[];
}

/** `RunCore.byHand`: what a Learn-by-hand run records. Every field is optional. */
export interface ByHandRecord {
  guidePlan?: GuidePlan;
  plan?: ByHandPlan;
  planQuestions?: GuideEntry[];
  thread?: GuideEntry[]; // oldest first; the oldest go past 40
  hints?: Record<string, HintState>; // by step id
  talks?: { stepId?: string; at: string }[]; // R0 uses
  tests?: TestRun[];
  ready?: { at: string; changeFingerprint: string; leastSure?: string; review: boolean };
  readyHistory?: { at: string; changeFingerprint: string; review: boolean }[];
  reviews?: ByHandReview[];
  events?: HelpEvent[];
  agentWrites?: number; // writes the canary saw; any withdraws the claim
  removedTotal?: number; // code the filter removed, in all
  checkIns?: { stepId?: string; signal: string; choice?: string; at: string }[];
  exits?: { stepId?: string; exit: string; at: string }[];
  leftAt?: string; // handed to the agent team
  busy?: { kind: string; since: string }; // BusyKind; cleared on finish and at startup
  helpLock?: HelpLock;
}

/** What the rules below read of a run; the server and client runs both fit. */
export interface ByHandRunFacts {
  learnByHand?: true;
  byHand?: ByHandRecord;
  createdAt: string;
  agents: readonly { id: string }[];
  team?: { tasks: readonly unknown[] };
  followUps?: readonly { kind?: string; resolutions?: readonly unknown[] }[];
  sync?: { resolutions?: readonly unknown[] };
}

/** The roster of an LBH run: the guide (lead), the reviewer and the test analyst. */
export const byHandRoster = ["lead", "reviewer", "tester"] as const;

/** Why a run's history withdraws the claim (not persisted). */
export type ByHandUncleanReason = "agent-writes" | "agents" | "tasks" | "rounds" | "resolutions";

/**
 * Whether the run's history backs the claim: no write the canary saw, no
 * agent outside the guide, reviewer and test analyst (teammates, the
 * conflict agent `sync` and the round agent `followup` are never removed
 * from `run.agents`), no team task, no round other than a sync (an absent
 * kind is a review round), and no conflict resolution on a round or on
 * the run's sync.
 */
export function byHandClean(run: ByHandRunFacts): { clean: true } | { clean: false; reason: ByHandUncleanReason } {
  const unclean = (reason: ByHandUncleanReason) => ({ clean: false as const, reason });
  if ((run.byHand?.agentWrites ?? 0) > 0) return unclean("agent-writes");
  const roster: readonly string[] = byHandRoster;
  if (run.agents.some((agent) => !roster.includes(agent.id))) return unclean("agents");
  if (run.team?.tasks.length) return unclean("tasks");
  if ((run.followUps ?? []).some((round) => round.kind !== "sync")) return unclean("rounds");
  const resolved = [run.sync, ...(run.followUps ?? [])].some((holder) => holder?.resolutions !== undefined);
  if (resolved) return unclean("resolutions");
  return { clean: true };
}

/** True when the run is an LBH run and its current change is the version marked ready (DESIGN §4). */
export function readyNow(
  run: Pick<ByHandRunFacts, "learnByHand" | "byHand">,
  files: readonly Pick<CheckFile, "path" | "fingerprint">[],
) {
  return !!run.learnByHand && run.byHand?.ready?.changeFingerprint === changeFingerprint(files);
}

const helpBySource: Record<string, HelpKind> = {
  premise: "explain", explanation: "explain", walkthrough: "explain",
  ask: "answer", chat: "answer", outline: "plan", plan: "plan", review: "review", test: "test",
};

/**
 * The kind of help one stored output gives (DESIGN F13): the orientation,
 * explanations, walkthroughs and R2 explain; questions, R1 and chat answer;
 * R3, R4, the outline and plan questions plan; the review reviews; a
 * failure explained is test help. Undefined for a source this build does
 * not know.
 */
export function helpKindOf(source: string, rung?: number): HelpKind | undefined {
  if (source === "hint") return (rung ?? 1) >= 3 ? "plan" : rung === 2 ? "explain" : "answer";
  return Object.hasOwn(helpBySource, source) ? helpBySource[source] : undefined;
}

/** The kinds of help the run used, in vocabulary order; unknown kinds are ignored. */
export function helpKinds(run: Pick<ByHandRunFacts, "byHand">): HelpKind[] {
  const used = new Set((run.byHand?.events ?? []).map((event) => event.kind));
  return allHelpKinds.filter((kind) => used.has(kind));
}

/**
 * Whether the run may get help of this kind: always without a lock; in a
 * run fitted to a project's rules, only the kinds fixed when it started.
 */
export function helpAllowed(run: Pick<ByHandRunFacts, "byHand">, kind: HelpKind | undefined) {
  const lock = run.byHand?.helpLock;
  return !lock || (!!kind && lock.kinds.includes(kind));
}

/** The same words, ignoring case, punctuation and spacing. */
const sameWords = (a = "", b = "") => {
  const plain = (text: string) =>
    text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
  return plain(a) === plain(b);
};

/**
 * The attempt gate (DESIGN F6): since the last hint on this step, the
 * change moved, a BELL test run finished, or the person says what they
 * tried in at least 5 words, differently from last time. Without an
 * earlier hint on the step there is nothing to wait for.
 */
export function attemptSince(
  hintState: HintState | undefined,
  input: {
    fingerprint: string; // the current change's
    tests?: readonly Pick<TestRun, "at" | "reported">[];
    tried?: string;
    previousTried?: string;
  },
) {
  if (!hintState || input.fingerprint !== hintState.fingerprint) return true;
  const since = Date.parse(hintState.at);
  if ((input.tests ?? []).some((test) => !test.reported && Date.parse(test.at) > since))
    return true;
  const tried = input.tried?.trim() ?? "";
  return (
    understandingWords(tried) >= byHandLimits.attemptWords &&
    !sameWords(tried, input.previousTried ?? hintState.tried)
  );
}

/** A rung may be at most one above the highest given on the step; there is no rung past 4. */
export function nextRungAllowed(hintState: HintState | undefined, rung: number) {
  return Number.isInteger(rung) && rung >= 1 && rung <= 4 && rung <= (hintState?.rung ?? 0) + 1;
}

/** After R3 or R4 on a step, marking it done needs the person's own why. */
export function needsWhy(step: Pick<ByHandStep, "maxRung">) {
  return (step.maxRung ?? 0) >= 3;
}

/**
 * The same failure three BELL test runs in a row: the latest three runs BELL
 * ran (not reported ones) failed with the same exit code and the same hash
 * of their last 40 output lines.
 */
export function repeatFailure(tests: readonly TestRun[] | undefined) {
  const latest = (tests ?? [])
    .filter((test) => !test.reported)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-byHandLimits.repeatFailures);
  if (latest.length < byHandLimits.repeatFailures) return false;
  const [first] = latest;
  return latest.every(
    (test) =>
      test.outcome !== "passed" &&
      test.exitCode !== undefined &&
      test.exitCode === first.exitCode &&
      !!test.tailHash &&
      test.tailHash === first.tailHash,
  );
}

/** Plain counts for the run record (DESIGN §16); never a score. */
export interface ByHandSummary {
  helps: Partial<Record<HelpKind, number>>; // help events per kind
  hintRequests: number; // R0 uses plus hint answers
  lowRungRequests: number; // of those, answered at R0 or R1
  highestRungs: { stepId: string; rung: number }[]; // per step with a hint
  predictions: { judged: number; right: number; unsure: number }; // first per change
  namedTests: number; // failing runs whose output names the expected test
  readyVersions: number;
  reviewFindings: number[]; // per review
  removedAnswers: number; // answers the filter removed code from
  removedTotal: number;
  outlineBeforeDraft: boolean;
  exits: number;
  left: boolean;
  fittedKinds?: string[]; // a fitted run's help kinds
}

/** The run record's counts (DESIGN §16), from the stored facts only. */
export function byHandSummary(run: Pick<ByHandRunFacts, "byHand">): ByHandSummary {
  const record = run.byHand ?? {};
  const helps: Partial<Record<HelpKind, number>> = {};
  for (const event of record.events ?? []) {
    const kind = allHelpKinds.find((known) => known === event.kind);
    if (kind) helps[kind] = (helps[kind] ?? 0) + 1;
  }
  const hints = (record.thread ?? []).filter((entry) => entry.kind === "hint");
  const talks = record.talks ?? [];
  const highest = new Map<string, number>();
  const raise = (stepId: string | undefined, rung: number | undefined) => {
    if (stepId && rung !== undefined && rung > (highest.get(stepId) ?? -1)) highest.set(stepId, rung);
  };
  for (const entry of hints) raise(entry.stepId, entry.rung);
  for (const step of record.plan?.steps ?? []) raise(step.id, step.maxRung);
  // Only the first prediction after each new change counts: re-runs at the
  // same version are nearly free to predict.
  const predictions = { judged: 0, right: 0, unsure: 0 };
  let namedTests = 0;
  const predicted = new Set<string>();
  const runs = [...(record.tests ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const test of runs) {
    if (!test.prediction || predicted.has(test.changeFingerprint)) continue;
    predicted.add(test.changeFingerprint);
    if (test.prediction === "unsure") predictions.unsure++;
    else if (test.prediction === "pass" || test.prediction === "fail") {
      predictions.judged++;
      if (test.outcome === (test.prediction === "pass" ? "passed" : "failed")) predictions.right++;
    }
    const expect = test.expect?.trim();
    if (test.outcome === "failed" && expect && test.outputTail?.includes(expect)) namedTests++;
  }
  const answers = [...(record.thread ?? []), ...(record.planQuestions ?? [])];
  return {
    helps,
    hintRequests: talks.length + hints.length,
    lowRungRequests: talks.length + hints.filter((entry) => (entry.rung ?? 1) <= 1).length,
    highestRungs: [...highest].map(([stepId, rung]) => ({ stepId, rung })),
    predictions,
    namedTests,
    readyVersions: new Set([...(record.readyHistory ?? []), ...(record.ready ? [record.ready] : [])]
      .map((ready) => ready.changeFingerprint)).size,
    reviewFindings: (record.reviews ?? []).map((review) => review.findings.length),
    removedAnswers:
      answers.filter((entry) => (entry.removed ?? 0) > 0).length +
      (record.reviews ?? []).filter((review) => (review.removed ?? 0) > 0).length,
    removedTotal: record.removedTotal ?? 0,
    outlineBeforeDraft: !!record.plan?.outlineBeforeDraft,
    exits: (record.exits ?? []).length,
    left: !!record.leftAt,
    ...(record.helpLock ? { fittedKinds: [...record.helpLock.kinds] } : {}),
  };
}

/**
 * The respect checks' Learn-by-hand input (`DraftPreflightInput.learnByHand`),
 * the same at both server callers and both client mirrors: present only
 * for an LBH run whose history is clean, so an unclean run gets the agent
 * run's outcome and copy. `createdAt` only where publishing is checked
 * (`publishChecks`), so "rules read during this run" is never asked at
 * approval.
 */
export function byHandPreflight(run: ByHandRunFacts, now: string, options: { createdAt?: boolean } = {}) {
  if (!run.learnByHand || !byHandClean(run).clean) return undefined;
  const helpLock = run.byHand?.helpLock;
  return {
    helps: helpKinds(run),
    ...(helpLock ? { helpLock } : {}),
    ...(options.createdAt ? { createdAt: run.createdAt } : {}),
    now,
  };
}

// The bodies of the Learn-by-hand routes, which server/routes/by-hand.ts
// checks strictly, and what its reads answer.
/** PUT /api/runs/:id/by-hand/plan */
export type ByHandPlanInput = {
  steps: { id?: string; title: string; files?: string[]; how?: string }[];
  tests?: string; unsure?: string; prediction?: string;
};
/** POST /api/runs/:id/by-hand/plan/reveal */
export type ByHandRevealInput = { mode: "names" | "compare" };
/** PATCH /api/runs/:id/by-hand/steps/:stepId */
export type ByHandStepInput = {
  done?: boolean; parked?: boolean; why?: string; talked?: true;
  chosen?: { entryId: string; option: number; why: string };
};
/** POST /api/runs/:id/by-hand/guide */
export type ByHandGuideInput = {
  kind: "ask" | "hint" | "test"; stepId?: string; rung?: number; entry?: AskEntry;
  question?: string; tried?: string; path?: string; startLine?: number; endLine?: number;
};
/** POST /api/runs/:id/by-hand/check-ins */
export type ByHandCheckInInput = { stepId?: string; signal: CheckInSignal; choice?: ExitKind };
/** PUT /api/repos/:id/test-command */
export type TestCommandInput = { command: string };
/** POST /api/runs/:id/by-hand/tests */
export type ByHandTestInput = { prediction?: TestPrediction; expect?: string };
/** POST /api/runs/:id/by-hand/tests/report */
export type ByHandTestReportInput = { outcome: "passed" | "failed"; output?: string };
/** POST /api/runs/:id/by-hand/ready */
export type ByHandReadyInput = { changeFingerprint: string; leastSure?: string; review: boolean };

/**
 * GET /api/runs/:id/by-hand/test-command: BELL's suggestion from the
 * project's files (never from model output; empty when none fits) and the
 * command the person confirmed for the project (`Repository.testCommand`).
 */
export type TestCommandView = { suggestion: string; confirmed?: { command: string; confirmedAt: string } };
/** GET /api/runs/:id/by-hand/tests/live: the running job's tail, at most 64 kB. */
export type LiveTests = { running: boolean; tail: string; startedAt?: string };
/** GET /api/runs/:id/by-hand/template: the project's PR templates, verbatim. */
export type ByHandTemplate = { path: string; content: string };
