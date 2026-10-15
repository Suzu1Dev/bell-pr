/**
 * The practice deck and the plain counts on the learning page. Both are
 * Free and opt-in, and neither shows streaks, goals or points: the counts
 * are facts about the person's own records, shown only past a threshold.
 */
import {
  confidences,
  effectiveGrade,
  selfGrades,
  tasteDimensions,
  type Confidence,
  type FeedbackTag,
  type RunUnderstanding,
  type SelfGrade,
  type TasteDimension,
} from "./understanding.js";

/** Days until an item is due again, by its box (BELL defaults). */
export const ladderDays = [1, 3, 7, 21] as const;
/** The highest box; it stays at the last interval. */
export const maxPracticeBox = 4;

/** One practice item's schedule (`run.practice[key]`); answers are never stored again. */
export interface PracticeState {
  /** 0 to 4. */
  box: number;
  dueAt: string;
  lastAt?: string;
  lastGrade?: SelfGrade;
  lastConfidence?: Confidence;
}

/**
 * Where a practice item comes from: a check answer, a per-file quiz, a
 * surprising maintainer comment, a `selfCheck` never attempted, or a Pro
 * debrief drill.
 */
export type PracticeKind = "check" | "quiz" | "feedback" | "selfCheck" | "drill";

/** One due item of a practice session. */
export interface PracticeItem {
  key: string;
  runId: string;
  repoId: string;
  kind: PracticeKind;
  question: string;
  reference?: string;
  /** The person's earlier correction or lesson. */
  earlier?: string;
  path?: string;
  dimension?: TasteDimension;
  dueAt: string;
  lastGrade?: SelfGrade;
  lastConfidence?: Confidence;
  /** The run's working files still exist, so "Study it in the code" can open them. */
  codeAvailable: boolean;
}

/** The key of a practice item on its run: the kind and the item's own id (a check item id, a path, a feedback URL, a drill). */
export function practiceKey(kind: PracticeKind, id: string) {
  return `${kind}:${id}`;
}

const dayMs = 24 * 60 * 60 * 1000;

/**
 * The schedule after a practice answer: Got it moves the item up one box
 * (at most box 4), Partly keeps its box, Missed puts it back in box 0. It
 * is next due `ladderDays[min(box, 3)]` days later, so a new item (box 0)
 * graded Got it comes back in 3 days and a miss always in 1 day.
 */
export function nextPractice(
  state: Pick<PracticeState, "box"> | undefined,
  grade: SelfGrade,
  now: string,
  confidence?: Confidence,
): PracticeState {
  const current = Math.min(Math.max(Math.trunc(state?.box ?? 0), 0), maxPracticeBox);
  const box =
    grade === "got"
      ? Math.min(current + 1, maxPracticeBox)
      : grade === "partly"
        ? current
        : 0;
  const days = ladderDays[Math.min(box, ladderDays.length - 1)];
  return {
    box,
    dueAt: new Date(Date.parse(now) + days * dayMs).toISOString(),
    lastAt: now,
    lastGrade: grade,
    ...(confidence ? { lastConfidence: confidence } : {}),
  };
}

/**
 * Orders items round-robin across repositories and taste dimensions, so a
 * session mixes them instead of practising one topic in a row. Each
 * group keeps its own order (the caller's priority).
 */
export function interleave<T extends Pick<PracticeItem, "repoId" | "dimension">>(
  items: readonly T[],
): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = `${item.repoId}\u0000${item.dimension ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const queues = [...groups.values()];
  const result: T[] = [];
  while (result.length < items.length)
    for (const queue of queues) {
      const next = queue.shift();
      if (next) result.push(next);
    }
  return result;
}

/** What learningCounts reads of a run. */
export interface CountedRun {
  status: string;
  createdAt: string;
  understanding?: RunUnderstanding;
  understandingCheckOff?: boolean;
  feedbackTags?: Record<string, FeedbackTag>;
}

/**
 * The plain counts of the learning page and Settings → Learning, over all
 * runs, each with the total its threshold needs. The page decides when a
 * count is shown (for example "When you said Sure, you were right 14 of
 * 18 times" after 20 graded answers); nothing here is a target.
 */
export interface LearningCounts {
  /** Every run. */
  runs: number;
  /** Runs that reached approval (approved or published). */
  approved: number;
  /** Runs whose understanding check passed at least once. */
  explainedBack: number;
  /** Runs approved with the understanding check off. */
  checkOff: number;
  /** Graded check answers (the not-tested question is never graded). */
  graded: number;
  /** Graded answers by the confidence given, and how many were Got it. */
  byConfidence: Record<Confidence, { graded: number; got: number }>;
  /** Maintainer comments tagged "Saw it coming", of those tagged either way. */
  forecastHits: { hits: number; of: number };
  /**
   * Taste dimensions tagged on maintainer comments: the tagged comments,
   * the recent runs (up to 10) with any tag, and in how many of those
   * runs each dimension came up, most frequent first.
   */
  feedback: {
    tagged: number;
    prs: number;
    dimensions: { dimension: TasteDimension; prs: number }[];
  };
  /** The median time of the last 10 timed checks, in seconds, and how many were timed. */
  checkSeconds: { timed: number; median?: number };
}

const known = <T extends string>(values: readonly T[], value: unknown): value is T =>
  values.includes(value as T);

export function learningCounts(runs: readonly CountedRun[]): LearningCounts {
  const byConfidence = Object.fromEntries(
    confidences.map((confidence) => [confidence, { graded: 0, got: 0 }]),
  ) as LearningCounts["byConfidence"];
  let graded = 0;
  let hits = 0;
  let predicted = 0;
  let tagged = 0;
  const timed: { at: string; seconds: number }[] = [];
  for (const run of runs) {
    for (const item of run.understanding?.items ?? []) {
      if (item.source === "untested") continue;
      const grade = effectiveGrade(item);
      if (!known(selfGrades, grade) || !known(confidences, item.confidence))
        continue;
      graded++;
      byConfidence[item.confidence].graded++;
      if (grade === "got") byConfidence[item.confidence].got++;
    }
    for (const entry of run.understanding?.history ?? [])
      if (typeof entry.seconds === "number" && entry.seconds >= 0)
        timed.push({ at: entry.passedAt, seconds: entry.seconds });
    for (const tag of Object.values(run.feedbackTags ?? {})) {
      if (tag.dimension || tag.predicted !== undefined) tagged++;
      if (tag.predicted === undefined) continue;
      predicted++;
      if (tag.predicted) hits++;
    }
  }
  const recent = runs
    .filter((run) =>
      Object.values(run.feedbackTags ?? {}).some((tag) =>
        known(tasteDimensions, tag.dimension),
      ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);
  const dimensions = tasteDimensions
    .map((dimension) => ({
      dimension,
      prs: recent.filter((run) =>
        Object.values(run.feedbackTags ?? {}).some(
          (tag) => tag.dimension === dimension,
        ),
      ).length,
    }))
    .filter((entry) => entry.prs > 0)
    .sort((a, b) => b.prs - a.prs);
  const lastTen = timed
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-10)
    .map((entry) => entry.seconds)
    .sort((a, b) => a - b);
  const middle = Math.floor(lastTen.length / 2);
  const median = !lastTen.length
    ? undefined
    : lastTen.length % 2
      ? lastTen[middle]
      : Math.round((lastTen[middle - 1] + lastTen[middle]) / 2);
  return {
    runs: runs.length,
    approved: runs.filter((run) => ["approved", "published"].includes(run.status))
      .length,
    explainedBack: runs.filter((run) => run.understanding?.history?.length).length,
    checkOff: runs.filter((run) => run.understandingCheckOff).length,
    graded,
    byConfidence,
    forecastHits: { hits, of: predicted },
    feedback: { tagged, prs: recent.length, dimensions },
    checkSeconds: {
      timed: timed.length,
      ...(median === undefined ? {} : { median }),
    },
  };
}
