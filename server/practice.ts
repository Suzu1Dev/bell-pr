/**
 * The practice deck on the server (DESIGN §5.6): the due items, built from
 * the person's own records on every run, and the schedule after an answer.
 *
 * - Only grades and confidences are stored (`run.practice`), never what the
 *   person typed (deferred.md item 5); the answer stays in the browser.
 * - Nothing here is a target: no streaks, goals or points.
 * - Vocabularies are stored as text, so a value a later build wrote and
 *   this build does not know is ignored, never shown.
 */
import { sm } from "./i18n/index.js";
import { AppError, type Repository, type Run } from "./types.js";
import type { CoachDebrief } from "../shared/coach.js";
import {
  interleave,
  nextPractice,
  practiceKey,
  type PracticeAnswerInput,
  type PracticeItem,
  type PracticeKind,
  type PracticeState,
} from "../shared/practice.js";
import {
  confidences,
  creditedQuiz,
  effectiveGrade,
  isConfidentMiss,
  selfGrades,
  tasteDimensions,
  type Confidence,
  type SelfGrade,
  type UnderstandingItem,
} from "../shared/understanding.js";

/** Items in one practice session (DESIGN §5.6). */
export const practiceSessionSize = 5;
/** Practice schedules kept on one run (`run.practice`). */
export const practiceKeysPerRun = 40;

/**
 * The deck's sources, most useful first. DESIGN §5.6 orders confident
 * misses, surprising maintainer comments, never-attempted self-checks and
 * debrief drills; the other misses (graded Partly or Missed at Guessing)
 * come right after the comments.
 */
const tiers = {
  confidentMiss: 0,
  surprise: 1,
  miss: 2,
  selfCheck: 3,
  drill: 4,
} as const;

/** A possible item with its place in the deck and its stored schedule. */
export interface PracticeCandidate {
  item: PracticeItem;
  tier: number;
  /** Absent while the item was never scheduled: it is due now. */
  state?: PracticeState;
}

/** GET /api/learning/practice */
export interface PracticeSession {
  /** At most 5 due items, interleaved across projects and taste dimensions. */
  items: PracticeItem[];
  /** When the next item that is not due yet becomes due; absent when none is waiting. */
  nextDueAt?: string;
}

const known = <T extends string>(values: readonly T[], value: unknown): value is T =>
  values.includes(value as T);
const time = (value: string | undefined) => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};
const iso = (milliseconds: number) => new Date(milliseconds).toISOString();
const missed = (grade: SelfGrade | undefined) =>
  grade === "partly" || grade === "missed";

/** A stored schedule this build can use; anything else counts as never scheduled. */
function usableState(state: PracticeState | undefined): PracticeState | undefined {
  if (!state || time(state.dueAt) === undefined) return undefined;
  return state;
}

/** The explanation card of `path`, when it is ready for the file version `fingerprint`. */
function readyCard(run: Run, path: string | undefined, fingerprint?: string) {
  const stored = path ? run.explanations?.[path] : undefined;
  if (stored?.status !== "ready" || !stored.content) return undefined;
  if (fingerprint && stored.fingerprint !== fingerprint) return undefined;
  return stored.content;
}

/**
 * What the person compared a check answer with: the file's self-check
 * answer, or for a fallback question the card's summary and reason, as the
 * check showed them. Absent once the explanation moved on.
 */
function checkReference(run: Run, item: UnderstandingItem) {
  const card = readyCard(run, item.path, item.fingerprint);
  if (item.source === "fallback") return card ? `${card.summary}\n\n${card.reason}` : undefined;
  if (card?.selfCheck?.question === item.question) return card.selfCheck.answer;
  // A walkthrough unit's "Check yourself" asked for a file without one (D1).
  const walkthrough = item.path ? run.walkthroughs?.[item.path] : undefined;
  if (walkthrough?.status !== "ready" || walkthrough.fingerprint !== item.fingerprint) return undefined;
  return walkthrough.content?.functions.find((unit) => unit.selfCheck?.question === item.question)?.selfCheck
    .answer;
}

/** True once the run reached approval, so its explanations describe a finished change. */
function approvedOnce(run: Run) {
  return run.status === "approved" || run.status === "published" || !!run.prUrl;
}

/** The id of a debrief drill in its practice key, `drill:<at>:<index>`. */
export function drillId(debrief: Pick<CoachDebrief, "at">, index: number) {
  return `${debrief.at}:${index}`;
}

/** The newest run of `runIds` that still exists; a debrief drill's schedule lives on it. */
export function drillHost(runs: readonly Run[], debrief: Pick<CoachDebrief, "runIds">) {
  return runs
    .filter((run) => debrief.runIds.includes(run.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
}

/**
 * Every item the person's records hold now, due or not, with its stored
 * schedule. The question texts BELL writes (feedback and drills) follow
 * the request's locale; questions saved with a run keep the run's.
 */
export function practiceCandidates(
  runs: readonly Run[],
  repos: readonly Repository[],
  at: string,
): PracticeCandidate[] {
  const messages = sm().understanding;
  const nowMs = time(at) ?? Date.now();
  const candidates: PracticeCandidate[] = [];
  const add = (
    run: Run,
    tier: number,
    kind: PracticeKind,
    id: string,
    fields: Pick<PracticeItem, "question" | "reference" | "earlier" | "path" | "dimension">,
    since: string | undefined,
    original: { grade?: SelfGrade; confidence?: Confidence } = {},
  ) => {
    const question = fields.question.trim();
    if (!question) return;
    const key = practiceKey(kind, id);
    const state = usableState(run.practice?.[key]);
    // The last practice answer, else the record the item came from.
    const lastGrade = [state?.lastGrade, original.grade].find((grade) =>
      known(selfGrades, grade),
    );
    const lastConfidence = [state?.lastConfidence, original.confidence].find(
      (confidence) => known(confidences, confidence),
    );
    candidates.push({
      tier,
      ...(state ? { state } : {}),
      item: {
        key,
        runId: run.id,
        repoId: run.repoId,
        kind,
        question,
        ...(fields.reference?.trim() ? { reference: fields.reference } : {}),
        ...(fields.earlier?.trim() ? { earlier: fields.earlier } : {}),
        ...(fields.path ? { path: fields.path } : {}),
        ...(known(tasteDimensions, fields.dimension) ? { dimension: fields.dimension } : {}),
        // An item never scheduled is due now; it shows when it came up.
        dueAt: state?.dueAt ?? iso(Math.min(time(since) ?? nowMs, nowMs)),
        ...(lastGrade ? { lastGrade } : {}),
        ...(lastConfidence ? { lastConfidence } : {}),
        codeAvailable: !run.workspaceRemovedAt,
      },
    });
  };

  for (const run of runs) {
    const items = run.understanding?.items ?? [];
    // Answers of the check graded Partly or Missed ("I don't know" too).
    // The not-tested question is never graded, and a credited quiz is
    // practised as the quiz below.
    for (const item of items) {
      if (item.source === "untested" || item.source === "attempt") continue;
      const grade = effectiveGrade(item);
      if (!missed(grade)) continue;
      add(
        run,
        isConfidentMiss(item) ? tiers.confidentMiss : tiers.miss,
        "check",
        item.id,
        {
          question: item.question,
          reference: checkReference(run, item),
          earlier: item.correction,
          path: item.path,
        },
        item.gradedAt ?? item.lockedAt,
        { grade, confidence: item.confidence },
      );
    }

    // Per-file quizzes graded Partly or Missed, asked again with the
    // self-check they answered. A quiz the check credited counts with the
    // grade and correction it has there, and keeps the question the check
    // stored once the file's explanation moved on (a later round changed
    // the file).
    for (const [path, attempt] of Object.entries(run.attempts ?? {})) {
      const quiz = creditedQuiz(run, path);
      if (!quiz || quiz.skipped) continue;
      const credited = items.find(
        (item) => item.id === `attempt:${path}` && item.fingerprint === attempt.fingerprint,
      );
      const grade = credited ? effectiveGrade(credited) : quiz.grade;
      const confidence = credited?.confidence ?? quiz.confidence;
      // A walkthrough unit's answer is practised with the unit's own question (D1).
      const check = quiz.unit
        ? quiz.question
          ? { question: quiz.question, answer: quiz.reference }
          : undefined
        : readyCard(run, path, attempt.fingerprint)?.selfCheck;
      const question = check?.question ?? credited?.question;
      if (!missed(grade) || !question) continue;
      add(
        run,
        confidence && isConfidentMiss({ grade, confidence })
          ? tiers.confidentMiss
          : tiers.miss,
        "quiz",
        path,
        {
          question,
          reference: check?.answer,
          earlier: credited?.correction,
          path,
        },
        credited?.gradedAt ?? quiz.at,
        { grade, confidence },
      );
    }

    // Maintainer comments the person marked "Surprised me", with the lesson
    // they wrote. The maintainer's words are the reference.
    for (const [url, tag] of Object.entries(run.feedbackTags ?? {})) {
      if (tag.predicted !== false || !tag.lesson?.trim()) continue;
      const comment = run.prFeedback?.items.find((item) => item.url === url);
      add(
        run,
        tiers.surprise,
        "feedback",
        url,
        {
          question: comment?.path
            ? messages.practiceFeedbackFileQuestion({ path: comment.path, title: run.title })
            : messages.practiceFeedbackQuestion({ title: run.title }),
          reference: comment?.body,
          earlier: tag.lesson,
          path: comment?.path,
          dimension: tag.dimension,
        },
        tag.at,
      );
    }

    // Self-check questions of an approved or published run that the person
    // never attempted: no quiz answer and not asked in the check.
    if (approvedOnce(run))
      for (const [path, stored] of Object.entries(run.explanations ?? {})) {
        const check = readyCard(run, path)?.selfCheck;
        if (!check) continue;
        const attempt = run.attempts?.[path];
        const quiz =
          attempt?.fingerprint === stored.fingerprint ? attempt.quiz : undefined;
        const tried =
          !!quiz && !quiz.skipped && (!!quiz.answer?.trim() || !!quiz.grade);
        const asked = items.some(
          (item) =>
            item.path === path &&
            item.fingerprint === stored.fingerprint &&
            (item.source === "selfCheck" || item.source === "attempt"),
        );
        if (tried || asked) continue;
        add(
          run,
          tiers.selfCheck,
          "selfCheck",
          path,
          { question: check.question, reference: check.answer, path },
          stored.generatedAt ?? run.createdAt,
        );
      }
  }

  // Coach debrief drills, kept on the newest run the debrief read, so every
  // key lives on exactly one run.
  for (const repo of repos)
    for (const debrief of repo.debriefs ?? []) {
      const host = drillHost(runs, debrief);
      if (!host) continue;
      (debrief.drills ?? []).forEach((drill, index) =>
        add(
          host,
          tiers.drill,
          "drill",
          drillId(debrief, index),
          {
            question: messages.practiceDrillQuestion({
              context: drill.context,
              optionA: drill.optionA,
              optionB: drill.optionB,
              question: drill.question,
            }),
            reference: drill.reveal,
            dimension: debrief.recurring?.dimension,
          },
          debrief.at,
        ),
      );
    }
  return candidates;
}

/** True when the item is due at `nowMs`: never scheduled, or its time has come. */
function isDue(candidate: PracticeCandidate, nowMs: number) {
  return !candidate.state || time(candidate.state.dueAt)! <= nowMs;
}

/**
 * One practice session at `at`, and when the next item becomes due.
 *
 * - The session takes the most useful due items: by source (see `tiers`),
 *   then the longest waiting. Items of equal use are taken round-robin
 *   across projects and taste dimensions, so one project does not crowd
 *   out the others.
 * - The 5 taken are shown interleaved the same way (Kornell & Bjork 2008),
 *   so consecutive items change topic where they can.
 */
export function dueItems(
  runs: readonly Run[],
  repos: readonly Repository[],
  at: string,
): PracticeSession {
  const nowMs = time(at) ?? Date.now();
  const candidates = practiceCandidates(runs, repos, at);
  const due = candidates
    .filter((candidate) => isDue(candidate, nowMs))
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        time(a.item.dueAt)! - time(b.item.dueAt)! ||
        a.item.key.localeCompare(b.item.key),
    );
  const byTier = Object.values(tiers).flatMap((tier) =>
    interleave(
      due
        .filter((candidate) => candidate.tier === tier)
        .map((candidate) => candidate.item),
    ),
  );
  const waiting = candidates
    .filter((candidate) => !isDue(candidate, nowMs))
    .map((candidate) => time(candidate.state!.dueAt)!);
  return {
    items: interleave(byTier.slice(0, practiceSessionSize)),
    ...(waiting.length ? { nextDueAt: iso(Math.min(...waiting)) } : {}),
  };
}

/**
 * Keeps at most `practiceKeysPerRun` schedules on the run: schedules of
 * items that are gone go first, then the ones practised (or scheduled)
 * longest ago.
 */
export function capPractice(run: Run, live: ReadonlySet<string>) {
  const practice = run.practice;
  if (!practice) return;
  const entries = Object.entries(practice);
  if (entries.length <= practiceKeysPerRun) return;
  const last = (state: PracticeState) => time(state.lastAt) ?? time(state.dueAt) ?? 0;
  entries
    .sort(
      ([keyA, a], [keyB, b]) =>
        Number(live.has(keyA)) - Number(live.has(keyB)) || last(a) - last(b),
    )
    .slice(0, entries.length - practiceKeysPerRun)
    .forEach(([key]) => delete practice[key]);
}

/**
 * Records one practice answer on its run: the grade and confidence move
 * the item along the ladder (shared/practice.ts nextPractice). The key must
 * be an item of this run now; the answer text never reaches the server.
 */
export function recordPracticeAnswer(
  run: Run,
  candidates: readonly PracticeCandidate[],
  input: PracticeAnswerInput,
  at: string,
) {
  const own = candidates.filter((candidate) => candidate.item.runId === run.id);
  if (!own.some((candidate) => candidate.item.key === input.key))
    throw new AppError((m) => m.understanding.practiceKeyUnknown, 404);
  const practice = (run.practice ??= {});
  practice[input.key] = nextPractice(
    usableState(practice[input.key]),
    input.grade,
    at,
    input.confidence,
  );
  capPractice(run, new Set(own.map((candidate) => candidate.item.key)));
  return practice[input.key];
}
