/**
 * The Explain-it-back check on the server, which is its authority:
 * approve() and publish() refuse with `understanding_check_required` until
 * the check passed for the current files, unless the person turned it off.
 * The pass rule lives in shared/understanding.ts, so the workspace and the
 * demo apply the same one; no model grades anything.
 *
 * The routes (server/routes/understanding.ts) are never gated by plan, and
 * the per-file attempts never change review state.
 */
import type { ChangeExplanation } from "../shared/explanations.js";
import { activeFollowUp } from "../shared/followups.js";
import { parseLocale } from "../shared/i18n/locale.js";
import {
  cardTexts,
  changeFingerprint,
  looksCopied,
  planCheck,
  recordPass,
  synchronizeUnderstandingRecord,
  understandingLimits,
  understandingStatus,
  understandingWords,
  validCorrection,
  type FileAttemptInput,
  type MaintainerForecastInput,
  type PlannedItem,
  type RunUnderstanding,
  type UnderstandingAnswersInput,
  type UnderstandingGradesInput,
  type UnderstandingItem,
  type UnderstandingSummaryInput,
  type UnderstandingView,
} from "../shared/understanding.js";
import { legacyRunLocale } from "./git.js";
import { sm, withLocale } from "./i18n/index.js";
import { AppError, type DiffFile, type Repository, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

let skipSource: (() => boolean | undefined) | undefined;
let testOverride: boolean | undefined;

/**
 * Sets where the "turn the understanding check off" choice comes from,
 * such as the app settings (activateAppSettings). Without a source, or
 * when it returns anything but true or throws, the check is required.
 * Call it without an argument to remove the source.
 */
export function setSkipUnderstandingCheckSource(fn?: () => boolean | undefined) {
  skipSource = fn;
}

/**
 * For tests of other behaviour only: true skips the check, false requires
 * it, no argument removes the override. It is read before the source, so
 * a Workbench created in the test (which activates its app settings) does
 * not undo it. No environment variable, setting or route reaches it, so
 * nothing in the product can turn the check off this way.
 */
export function skipUnderstandingCheckInTests(skip?: boolean) {
  testOverride = skip;
}

/** True unless the person turned the check off. */
export function understandingRequired() {
  if (testOverride !== undefined) return !testOverride;
  try {
    return skipSource?.() !== true;
  } catch {
    return true;
  }
}

/** The questions are worded in the run's language, like everything the run saves. */
function inRunLocale<T>(run: Pick<Run, "locale">, fn: () => T): T {
  return withLocale(parseLocale(run.locale) ?? legacyRunLocale, fn);
}

/** The explanation cards that are ready for the current version of their file. */
function readyCards(run: Run, files: readonly DiffFile[]): ChangeExplanation[] {
  return files.flatMap((file) => {
    const stored = run.explanations?.[file.path];
    return stored?.status === "ready" &&
      stored.content &&
      stored.fingerprint === file.fingerprint
      ? [stored.content]
      : [];
  });
}

/** The check's questions for the run's current files, in the run's language. */
export function planUnderstanding(
  run: Run,
  files: readonly DiffFile[],
  repo?: Repository,
): PlannedItem[] {
  return inRunLocale(run, () => {
    const messages = sm().understanding;
    return planCheck({
      files,
      explanations: run.explanations,
      attempts: run.attempts,
      reports: run.reports,
      generated: repo?.contributionRules?.generated,
      record: run.understanding,
      questions: {
        fallback: (path) => messages.fallbackQuestion({ path }),
        untested: messages.untestedQuestion,
      },
    });
  });
}

function evaluate(run: Run, files: readonly DiffFile[], repo?: Repository) {
  const plan = planUnderstanding(run, files, repo);
  const required = understandingRequired();
  const status = understandingStatus({
    record: run.understanding,
    plan,
    files,
    required,
    cards: readyCards(run, files),
  });
  return { plan, status };
}

/**
 * Whether the check is required now and whether it passed for `files`.
 * When it is required and has not passed, it refuses with 409
 * `understanding_check_required`; the message follows the request's
 * locale. approve() and publish() call it right after the Reviewed ticks.
 */
export function assertUnderstood(
  run: Run,
  files: readonly DiffFile[],
  repo?: Repository,
): { required: boolean; passed: boolean } {
  const { status } = evaluate(run, files, repo);
  if (status.required && !status.passed)
    throw new AppError((m) => m.run.publish.understandingRequired, 409, {
      code: "understanding_check_required",
    });
  return { required: status.required, passed: status.passed };
}

/**
 * Brings the check up to date with the run's files, next to
 * synchronizeReview: answers about a changed file are dropped, a pass on
 * an older version of the change ends (the summary stays and needs
 * confirming), and attempts on files that left the diff go.
 */
export function synchronizeUnderstanding(run: Run, files: readonly DiffFile[]) {
  synchronizeUnderstandingRecord(run.understanding, files);
  if (run.attempts) {
    const paths = new Set(files.map((file) => file.path));
    for (const path of Object.keys(run.attempts))
      if (!paths.has(path)) delete run.attempts[path];
  }
}

/** What the routes do; Workbench.understanding. */
export interface UnderstandingFacade {
  /** GET /api/runs/:id/understanding */
  status(id: string): Promise<UnderstandingView>;
  /** PUT …/understanding/answers: "Lock my answers". */
  saveAnswers(
    id: string,
    input: UnderstandingAnswersInput,
  ): Promise<{ run: Run; understanding: UnderstandingView }>;
  /** PUT …/understanding/grades, with the optional forecast. */
  saveGrades(
    id: string,
    input: UnderstandingGradesInput,
  ): Promise<{ run: Run; understanding: UnderstandingView }>;
  /** POST …/understanding/summary: "Still accurate", or an edit. */
  confirmSummary(
    id: string,
    input: UnderstandingSummaryInput,
  ): Promise<{ run: Run; understanding: UnderstandingView }>;
  /** DELETE …/understanding: Start over; passed checks stay in history. */
  restart(id: string): Promise<{ run: Run; understanding: UnderstandingView }>;
  /** PUT /api/runs/:id/forecast */
  saveForecast(id: string, input: MaintainerForecastInput): Promise<{ run: Run }>;
  /** PATCH /api/runs/:id/attempts */
  saveAttempt(id: string, input: FileAttemptInput): Promise<{ run: Run }>;
}

const now = () => new Date().toISOString();
const twoHoursMs = 2 * 60 * 60 * 1000;

/** When the check opened: the client's time, within the last 2 hours. */
function openedAt(value: string | undefined, at: string) {
  const time = Date.parse(at);
  const opened = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(opened)) return at;
  return new Date(Math.min(time, Math.max(time - twoHoursMs, opened))).toISOString();
}

/** The check is taken while the run waits for review or approval, never while it publishes. */
function assertOpen(run: Run) {
  if (!["review", "approved"].includes(run.status) || run.publishing)
    throw new AppError((m) => m.understanding.notOpen, 409);
}

export function understandingFacade(
  ctx: WorkbenchContext,
  options: {
    /** The environment variable that locks the check on, if one does. */
    lockedBy?: () => string | undefined;
  } = {},
): UnderstandingFacade {
  const repoOf = (run: Run) =>
    ctx.store.data.repos.find((repo) => repo.id === run.repoId);

  function view(run: Run, files: readonly DiffFile[]): UnderstandingView {
    const { plan, status } = evaluate(run, files, repoOf(run));
    const lockedBy = options.lockedBy?.();
    return {
      ...status,
      ...(lockedBy ? { lockedBy } : {}),
      plan,
      ...(run.understanding ? { record: run.understanding } : {}),
      changeFingerprint: changeFingerprint(files),
    };
  }

  /** Records the pass once the rule holds for the current files. */
  function settle(run: Run, files: readonly DiffFile[], at: string) {
    const record = run.understanding;
    if (!record) return;
    const { plan, status } = evaluate(run, files, repoOf(run));
    if (!status.passed || record.passedFingerprint === changeFingerprint(files))
      return;
    recordPass(record, {
      files,
      plan,
      now: at,
      round: activeFollowUp(run.followUps)?.id,
    });
  }

  /** Runs `task` on an open run under its lock, with the current files. */
  function write<T>(
    id: string,
    task: (run: Run, files: DiffFile[]) => T,
  ): Promise<T> {
    return ctx.lock(id, async () => {
      const run = ctx.run(id);
      assertOpen(run);
      const files = await ctx.diff(id);
      const result = task(run, files);
      await ctx.store.save();
      return result;
    });
  }

  const assertCurrent = (files: readonly DiffFile[], fingerprint: string) => {
    if (fingerprint !== changeFingerprint(files))
      throw new AppError((m) => m.understanding.changed, 409);
  };

  return {
    async status(id) {
      return ctx.lock(id, async () => {
        const run = ctx.run(id);
        // A run that cannot take the check (yet, or any more) shows its record.
        if (!["review", "approved"].includes(run.status) || run.publishing || run.workspaceRemovedAt)
          return {
            required: understandingRequired(),
            ...(options.lockedBy?.() ? { lockedBy: options.lockedBy!() } : {}),
            passed: !!run.understanding?.passedAt,
            stale: false,
            plan: [],
            ...(run.understanding ? { record: run.understanding } : {}),
            missing: [],
            changeFingerprint: "",
          };
        return view(run, await ctx.diff(id));
      });
    },

    saveAnswers(id, input) {
      return write(id, (run, files) => {
        assertCurrent(files, input.changeFingerprint);
        const at = now();
        const record: RunUnderstanding = run.understanding ?? {};
        const plan = planUnderstanding(run, files, repoOf(run));
        const cards = readyCards(run, files);
        const locked = new Set((record.items ?? []).map((item) => item.id));
        const seen = new Set<string>();
        for (const item of input.items) {
          const planned = plan.find((entry) => entry.id === item.id);
          if (!planned || seen.has(item.id))
            throw new AppError((m) => m.understanding.unknownQuestion, 422);
          seen.add(item.id);
          if (locked.has(item.id) || planned.source === "attempt")
            throw new AppError((m) => m.understanding.alreadyLocked, 409);
        }
        const open = plan.filter(
          (planned) => !locked.has(planned.id) && planned.source !== "attempt",
        );
        if (open.some((planned) => !seen.has(planned.id)))
          throw new AppError((m) => m.understanding.answerAll, 422);
        const summary = input.summary?.trim();
        if (record.summary && input.summary !== undefined)
          throw new AppError((m) => m.understanding.summaryLocked, 409);
        if (!record.summary) {
          if (!summary)
            throw new AppError((m) => m.understanding.summaryRequired, 422);
          if (understandingWords(summary) < understandingLimits.summaryMinWords)
            throw new AppError(
              (m) => m.understanding.summaryShort({ min: understandingLimits.summaryMinWords }),
              422,
            );
          if (looksCopied(summary, cards.flatMap(cardTexts)))
            throw new AppError((m) => m.understanding.summaryCopied, 422);
        }
        for (const item of input.items) {
          const planned = plan.find((entry) => entry.id === item.id)!;
          if (item.dontKnow) {
            if (item.confidence !== "guess" || item.answer.trim())
              throw new AppError((m) => m.understanding.dontKnow, 422);
            continue;
          }
          if (understandingWords(item.answer) < understandingLimits.answerMinWords)
            throw new AppError(
              (m) => m.understanding.answerShort({ min: understandingLimits.answerMinWords }),
              422,
            );
          if (planned.reference && looksCopied(item.answer, [planned.reference]))
            throw new AppError((m) => m.understanding.answerCopied, 422);
        }
        const credited = plan.filter(
          (planned) => planned.source === "attempt" && !locked.has(planned.id),
        );
        // Nothing left to lock: a second lock needs Start over.
        if (record.summary && !input.items.length && !credited.length)
          throw new AppError((m) => m.understanding.alreadyLocked, 409);
        const added: UnderstandingItem[] = [
          ...credited.flatMap((planned): UnderstandingItem[] => {
            const quiz = run.attempts?.[planned.path!]?.quiz;
            if (!quiz?.confidence || !quiz.grade) return [];
            return [
              {
                id: planned.id,
                path: planned.path,
                fingerprint: planned.fingerprint,
                source: "attempt",
                question: planned.question.slice(0, understandingLimits.questionChars),
                answer: (quiz.answer ?? "").trim(),
                confidence: quiz.confidence,
                lockedAt: at,
                grade: quiz.grade,
                gradedAt: quiz.at,
              },
            ];
          }),
          ...input.items.map((item): UnderstandingItem => {
            const planned = plan.find((entry) => entry.id === item.id)!;
            return {
              id: planned.id,
              ...(planned.path ? { path: planned.path, fingerprint: planned.fingerprint } : {}),
              source: planned.source,
              question: planned.question.slice(0, understandingLimits.questionChars),
              answer: item.dontKnow ? "" : item.answer.trim(),
              ...(item.dontKnow ? { dontKnow: true } : {}),
              confidence: item.confidence,
              lockedAt: at,
              // "I don't know" counts as missed; there is nothing to compare.
              ...(item.dontKnow && planned.source !== "untested"
                ? { grade: "missed" as const, gradedAt: at }
                : {}),
            };
          }),
        ];
        if (!record.summary)
          record.summary = { text: summary!, changeFingerprint: changeFingerprint(files), at };
        // At most 6 answers: answers from earlier checks outside this plan go first.
        const planned = new Set(plan.map((entry) => entry.id));
        let items = [...(record.items ?? []), ...added];
        while (items.length > understandingLimits.items) {
          const index = items.findIndex((item) => !planned.has(item.id));
          if (index < 0) break;
          items = items.filter((_, position) => position !== index);
        }
        record.items = items;
        record.startedAt ??= openedAt(input.openedAt, at);
        run.understanding = record;
        settle(run, files, at);
        return { run, understanding: view(run, files) };
      });
    },

    saveGrades(id, input) {
      return write(id, (run, files) => {
        const at = now();
        const record = run.understanding;
        const passed =
          !!record?.passedFingerprint &&
          record.passedFingerprint === changeFingerprint(files);
        if (input.items.length && passed)
          throw new AppError((m) => m.understanding.alreadyPassed, 409);
        for (const grade of input.items) {
          const item = record?.items?.find((entry) => entry.id === grade.id);
          if (!item)
            throw new AppError((m) => m.understanding.notAnswered, 409);
          if (item.source === "untested")
            throw new AppError((m) => m.understanding.notGradable, 422);
          if (item.dontKnow && grade.grade !== "missed")
            throw new AppError((m) => m.understanding.dontKnowMissed, 422);
          if (grade.correction?.trim() && !validCorrection(grade.correction))
            throw new AppError(
              (m) => m.understanding.correctionShort({ min: understandingLimits.correctionMinWords }),
              422,
            );
        }
        for (const grade of input.items) {
          const item = record!.items!.find((entry) => entry.id === grade.id)!;
          item.grade = grade.grade;
          item.gradedAt = at;
          const correction = grade.correction?.trim();
          if (correction) item.correction = correction;
          else if (grade.correction !== undefined) delete item.correction;
        }
        if (input.forecast) applyForecast(run, input.forecast, at);
        settle(run, files, at);
        return { run, understanding: view(run, files) };
      });
    },

    confirmSummary(id, input) {
      return write(id, (run, files) => {
        assertCurrent(files, input.changeFingerprint);
        const record = run.understanding;
        if (!record?.summary)
          throw new AppError((m) => m.understanding.noSummary, 409);
        const current = changeFingerprint(files);
        if (record.passedFingerprint === current && input.text !== undefined)
          throw new AppError((m) => m.understanding.alreadyPassed, 409);
        const at = now();
        const text = input.text?.trim();
        if (input.text !== undefined) {
          if (understandingWords(text) < understandingLimits.summaryMinWords)
            throw new AppError(
              (m) => m.understanding.summaryShort({ min: understandingLimits.summaryMinWords }),
              422,
            );
          if (looksCopied(text!, readyCards(run, files).flatMap(cardTexts)))
            throw new AppError((m) => m.understanding.summaryCopied, 422);
          record.summary.text = text!;
        }
        record.summary.changeFingerprint = current;
        record.summary.confirmedAt = at;
        settle(run, files, at);
        return { run, understanding: view(run, files) };
      });
    },

    restart(id) {
      return write(id, (run, files) => {
        const record = run.understanding;
        if (record) {
          // Passed checks stay in history; everything else starts over.
          delete record.summary;
          delete record.items;
          delete record.passedAt;
          delete record.passedFingerprint;
          delete record.passedFiles;
          delete record.startedAt;
        }
        return { run, understanding: view(run, files) };
      });
    },

    saveForecast(id, input) {
      return write(id, (run) => {
        applyForecast(run, input, now());
        return { run };
      });
    },

    saveAttempt(id, input) {
      return write(id, (run, files) => {
        const file = files.find((value) => value.path === input.filePath);
        if (!file) throw new AppError((m) => m.run.review.fileNotFound, 404);
        if (file.fingerprint !== input.fingerprint)
          throw new AppError((m) => m.run.publish.fileChanged, 409);
        const at = now();
        const attempts = (run.attempts ??= {});
        const previous = attempts[file.path];
        const attempt =
          previous?.fingerprint === file.fingerprint
            ? previous
            : { fingerprint: file.fingerprint };
        if (input.quiz) {
          const quiz = input.quiz;
          if (quiz.skipped && quiz.answer?.trim())
            throw new AppError((m) => m.understanding.attemptSkipped, 422);
          const prior = attempt.quiz;
          // A graded or skipped quiz is final: the answer came before the reveal.
          if (
            prior &&
            (prior.grade || prior.skipped) &&
            (["answer", "confidence", "skipped"] as const).some(
              (key) => quiz[key] !== undefined && (quiz[key] ?? "") !== (prior[key] ?? ""),
            )
          )
            throw new AppError((m) => m.understanding.attemptLocked, 409);
          if (prior?.grade && quiz.grade && quiz.grade !== prior.grade)
            throw new AppError((m) => m.understanding.attemptLocked, 409);
          attempt.quiz = {
            ...prior,
            ...defined({
              answer: quiz.answer?.trim(),
              confidence: quiz.confidence,
              grade: quiz.grade,
              skipped: quiz.skipped,
            }),
            at,
          };
        }
        if (input.road)
          attempt.road = {
            ...attempt.road,
            ...defined({
              guess: input.road.guess?.trim(),
              choice: input.road.choice,
              why: input.road.why?.trim(),
            }),
            at,
          };
        attempts[file.path] = attempt;
        return { run };
      });
    },
  };
}

/** The fields of `value` that are set. */
function defined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== ""),
  ) as Partial<T>;
}

/** Saves the forecast; an empty one removes it. */
function applyForecast(run: Run, input: MaintainerForecastInput, at: string) {
  const question = input.question?.trim();
  const record = (run.understanding ??= {});
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
