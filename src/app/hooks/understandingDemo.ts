/**
 * The Explain-it-back check of the sample run, in the browser. It applies
 * the same rules as the server (shared/understanding.ts) to the record the
 * demo keeps on its run (`run.understanding`, `run.attempts`), so the
 * sample asks the same questions and passes the same way, without a
 * request. The functions are pure: they return a new record and never
 * change the run they get.
 *
 * Load this module lazily: the rules bring the Markdown tooling of the PR
 * checks with them.
 */
import type { ChangeExplanation } from "../../../shared/explanations";
import { activeFollowUp } from "../../../shared/followups";
import {
  changeFingerprint,
  planCheck,
  recordPass,
  understandingLimits,
  understandingStatus,
  type CheckExplanation,
  type CheckFile,
  type FileAttempt,
  type FileAttemptInput,
  type MaintainerForecastInput,
  type PlannedItem,
  type RunUnderstanding,
  type UnderstandingAnswersInput,
  type UnderstandingGradesInput,
  type UnderstandingItem,
  type UnderstandingView,
} from "../../../shared/understanding";
import type { DiffFile, Run } from "../../types";

/** The question texts in the UI language (the server's own words, from the workspace dictionary). */
export interface CheckQuestions {
  fallback: (path: string) => string;
  untested: string;
}

/** A sample file has no fingerprint; its path stands in for one, as in the demo tests. */
export function demoCheckFiles(files: readonly DiffFile[]): CheckFile[] {
  return files.map((file) => ({
    path: file.path,
    fingerprint: file.fingerprint ?? file.path,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
    ...(file.blocked ? { blocked: file.blocked } : {}),
    status: file.status,
  }));
}

/** Each file's explanation as the check reads it: ready once the sample shows it. */
function explanations(files: readonly DiffFile[]) {
  return Object.fromEntries(
    files.map((file): [string, CheckExplanation] => [
      file.path,
      {
        fingerprint: file.fingerprint ?? file.path,
        status: file.explanation ? "ready" : (file.explanationStatus ?? "unavailable"),
        ...(file.explanation ? { content: file.explanation } : {}),
      },
    ]),
  );
}

function cards(files: readonly DiffFile[]): ChangeExplanation[] {
  return files.flatMap((file) => (file.explanation ? [file.explanation] : []));
}

/** The run takes the check while it waits for review or approval, as on the server. */
export function checkOpen(run: Pick<Run, "status" | "publishing">) {
  return ["review", "approved"].includes(run.status) && !run.publishing;
}

function plan(run: Run, files: readonly DiffFile[], questions: CheckQuestions) {
  return planCheck({
    files: demoCheckFiles(files),
    explanations: explanations(files),
    attempts: run.attempts,
    reports: run.reports,
    record: run.understanding,
    questions,
  });
}

/** GET /api/runs/:id/understanding, for the sample run. */
export function demoUnderstandingView(
  run: Run,
  files: readonly DiffFile[],
  { required, questions }: { required: boolean; questions: CheckQuestions },
): UnderstandingView {
  const record = run.understanding;
  if (!checkOpen(run))
    return {
      required,
      passed: !!record?.passedAt,
      stale: false,
      plan: [],
      ...(record ? { record } : {}),
      missing: [],
      changeFingerprint: "",
    };
  const planned = plan(run, files, questions);
  const checkFiles = demoCheckFiles(files);
  return {
    ...understandingStatus({
      record,
      plan: planned,
      files: checkFiles,
      required,
      cards: cards(files),
    }),
    plan: planned,
    ...(record ? { record } : {}),
    changeFingerprint: changeFingerprint(checkFiles),
  };
}

/** Records the pass once the rule holds for the current files. */
function settle(
  run: Run,
  record: RunUnderstanding,
  files: readonly DiffFile[],
  questions: CheckQuestions,
  at: string,
) {
  const next: Run = { ...run, understanding: record };
  const planned = plan(next, files, questions);
  const checkFiles = demoCheckFiles(files);
  const status = understandingStatus({
    record,
    plan: planned,
    files: checkFiles,
    required: true,
    cards: cards(files),
  });
  if (status.passed && record.passedFingerprint !== changeFingerprint(checkFiles))
    recordPass(record, {
      files: checkFiles,
      plan: planned,
      now: at,
      round: activeFollowUp(run.followUps)?.id,
    });
  return record;
}

const clone = (record?: RunUnderstanding): RunUnderstanding =>
  record ? structuredClone(record) : {};

/** When the check opened, within the last 2 hours, as the server stores it. */
function startedAt(openedAt: string | undefined, at: string) {
  const time = Date.parse(at);
  const opened = openedAt ? Date.parse(openedAt) : NaN;
  if (!Number.isFinite(opened)) return at;
  const twoHours = 2 * 60 * 60 * 1000;
  return new Date(Math.min(time, Math.max(time - twoHours, opened))).toISOString();
}

/**
 * "Lock my answers": the summary (unless one is recorded), the answers to
 * the open questions, and every credited try-first answer, which the
 * client never sends itself.
 */
export function demoLockAnswers(
  run: Run,
  files: readonly DiffFile[],
  input: Omit<UnderstandingAnswersInput, "changeFingerprint">,
  questions: CheckQuestions,
  at: string,
): RunUnderstanding {
  const record = clone(run.understanding);
  const planned = plan(run, files, questions);
  const locked = new Set((record.items ?? []).map((item) => item.id));
  const byId = new Map(planned.map((item) => [item.id, item]));
  const credited = planned.flatMap((item): UnderstandingItem[] => {
    const quiz = run.attempts?.[item.path ?? ""]?.quiz;
    if (item.source !== "attempt" || locked.has(item.id) || !quiz?.confidence || !quiz.grade)
      return [];
    return [
      {
        id: item.id,
        path: item.path,
        fingerprint: item.fingerprint,
        source: "attempt",
        question: item.question,
        answer: (quiz.answer ?? "").trim(),
        confidence: quiz.confidence,
        lockedAt: at,
        grade: quiz.grade,
        gradedAt: quiz.at,
      },
    ];
  });
  const answered = input.items.flatMap((answer): UnderstandingItem[] => {
    const item = byId.get(answer.id);
    if (!item || locked.has(item.id) || item.source === "attempt") return [];
    return [
      {
        id: item.id,
        ...(item.path ? { path: item.path, fingerprint: item.fingerprint } : {}),
        source: item.source,
        question: item.question.slice(0, understandingLimits.questionChars),
        answer: answer.dontKnow ? "" : answer.answer.trim(),
        ...(answer.dontKnow ? { dontKnow: true } : {}),
        confidence: answer.confidence,
        lockedAt: at,
        ...(answer.dontKnow && item.source !== "untested"
          ? { grade: "missed" as const, gradedAt: at }
          : {}),
      },
    ];
  });
  const summary = input.summary?.trim();
  if (!record.summary && summary)
    record.summary = {
      text: summary,
      changeFingerprint: changeFingerprint(demoCheckFiles(files)),
      at,
    };
  const current = new Set(planned.map((item) => item.id));
  let items = [...(record.items ?? []), ...credited, ...answered];
  while (items.length > understandingLimits.items) {
    const index = items.findIndex((item) => !current.has(item.id));
    if (index < 0) break;
    items = items.filter((_, position) => position !== index);
  }
  record.items = items;
  record.startedAt ??= startedAt(input.openedAt, at);
  return settle(run, record, files, questions, at);
}

/** "Save my grades", with the optional forecast. */
export function demoSaveGrades(
  run: Run,
  files: readonly DiffFile[],
  input: UnderstandingGradesInput,
  questions: CheckQuestions,
  at: string,
): RunUnderstanding {
  const record = clone(run.understanding);
  for (const grade of input.items) {
    const item = record.items?.find((entry) => entry.id === grade.id);
    if (!item || item.source === "untested") continue;
    item.grade = item.dontKnow ? "missed" : grade.grade;
    item.gradedAt = at;
    const correction = grade.correction?.trim();
    if (correction) item.correction = correction;
    else delete item.correction;
  }
  if (input.forecast) applyForecast(record, input.forecast, at);
  return settle(run, record, files, questions, at);
}

/** "Still accurate", or an edited summary, after the change moved. */
export function demoConfirmSummary(
  run: Run,
  files: readonly DiffFile[],
  text: string | undefined,
  questions: CheckQuestions,
  at: string,
): RunUnderstanding {
  const record = clone(run.understanding);
  if (!record.summary) return record;
  if (text !== undefined) record.summary.text = text.trim();
  record.summary.changeFingerprint = changeFingerprint(demoCheckFiles(files));
  record.summary.confirmedAt = at;
  return settle(run, record, files, questions, at);
}

/** Start over: passed checks stay in history; everything else is cleared. */
export function demoRestart(run: Run): RunUnderstanding {
  const { history, forecast } = clone(run.understanding);
  return { ...(history ? { history } : {}), ...(forecast ? { forecast } : {}) };
}

/** The forecast alone (PUT /api/runs/:id/forecast); an empty one removes it. */
export function demoSaveForecast(
  run: Run,
  input: MaintainerForecastInput,
  at: string,
): RunUnderstanding {
  const record = clone(run.understanding);
  applyForecast(record, input, at);
  return record;
}

function applyForecast(
  record: RunUnderstanding,
  input: MaintainerForecastInput,
  at: string,
) {
  const question = input.question?.trim();
  if (!input.dimension && !question) {
    delete record.forecast;
    return;
  }
  record.forecast = {
    ...(input.dimension ? { dimension: input.dimension } : {}),
    ...(question ? { question } : {}),
    at,
  };
}

/**
 * A try-first attempt on a sample file (PATCH /api/runs/:id/attempts). As
 * on the server, a graded or skipped quiz stays as it was answered.
 */
export function demoSaveAttempt(
  run: Run,
  file: DiffFile,
  input: Pick<FileAttemptInput, "quiz" | "road">,
  at: string,
): Record<string, FileAttempt> {
  const fingerprint = file.fingerprint ?? file.path;
  const attempts = structuredClone(run.attempts ?? {});
  const previous = attempts[file.path];
  const attempt: FileAttempt =
    previous?.fingerprint === fingerprint ? previous : { fingerprint };
  const set = <T extends object>(value: T) =>
    Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== undefined && item !== ""),
    ) as Partial<T>;
  if (input.quiz && !(attempt.quiz?.grade || attempt.quiz?.skipped))
    attempt.quiz = {
      ...attempt.quiz,
      ...set({ ...input.quiz, answer: input.quiz.answer?.trim() }),
      at,
    };
  else if (input.quiz?.grade && attempt.quiz && !attempt.quiz.grade)
    attempt.quiz = { ...attempt.quiz, grade: input.quiz.grade, at };
  if (input.road)
    attempt.road = {
      ...attempt.road,
      ...set({
        guess: input.road.guess?.trim(),
        choice: input.road.choice,
        why: input.road.why?.trim(),
      }),
      at,
    };
  attempts[file.path] = attempt;
  return attempts;
}

/**
 * Whether the sample may be approved now: the check passed for the
 * sample's files, or the person turned it off. `required` is false while
 * the setting is off.
 */
export function demoGate(
  run: Run,
  files: readonly DiffFile[],
  required: boolean,
  questions: CheckQuestions = { fallback: (path) => path, untested: "" },
): { required: boolean; passed: boolean } {
  const view = demoUnderstandingView(run, files, { required, questions });
  return { required, passed: view.passed };
}

export type { PlannedItem };
