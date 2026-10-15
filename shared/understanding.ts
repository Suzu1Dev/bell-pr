/**
 * Explain it back: the run-level understanding check before approval, and
 * the per-file "try first" attempts that count toward it.
 *
 * Everything here is deterministic and offline: no model grades anything,
 * the person grades their own answers against the AI-written reference.
 * It is a commitment device, not a proctor. The server (approve and
 * publish), the workspace and the demo share these rules, so they always
 * agree on which questions are asked and whether the check passed.
 */
import type { ChangeExplanation } from "./explanations.js";
import { ciConfigPath, draftProseWords } from "./draft-checks.js";
import { parseReviewOrder } from "./review-order.js";
import {
  isDocsPath,
  isGeneratedPath,
  isLockfile,
  isTestPath,
  whitespaceOnlyPatch,
} from "./reviewability.js";

// The vocabularies below are stored as text in state.json and frozen at
// these values: a later build may add a field, never a value.

/** How sure the person was of an answer: Sure / Think so / Guessing. */
export const confidences = ["sure", "think", "guess"] as const;
export type Confidence = (typeof confidences)[number];

/** The person's own grade: Got it / Partly / Missed. */
export const selfGrades = ["got", "partly", "missed"] as const;
export type SelfGrade = (typeof selfGrades)[number];

/**
 * Where a check question comes from: a file's `selfCheck`, the fallback
 * question for a file without one, the fixed not-tested question, or a
 * per-file attempt that already answered it.
 */
export const checkItemSources = [
  "selfCheck",
  "fallback",
  "untested",
  "attempt",
] as const;
export type CheckItemSource = (typeof checkItemSources)[number];

/** For this project: Keep this approach / Prefer the other / It depends. */
export const roadChoices = ["keep", "switch", "depends"] as const;
export type RoadChoice = (typeof roadChoices)[number];

/** What a maintainer may question; "worth" is "worth the review time". */
export const tasteDimensions = [
  "scope",
  "simplicity",
  "naming",
  "conventions",
  "tests",
  "risk",
  "description",
  "worth",
] as const;
export type TasteDimension = (typeof tasteDimensions)[number];

/**
 * BELL's limits for the check. The word minimums count with
 * `draftProseWords`, where one CJK character is one word; the character
 * caps are the write caps (persisted reads allow four times as much).
 */
export const understandingLimits = {
  summaryMinWords: 15,
  answerMinWords: 3,
  correctionMinWords: 3,
  summaryChars: 1200,
  answerChars: 1000,
  correctionChars: 300,
  forecastChars: 200,
  questionChars: 1800,
  /** The road choice's guess and why, and a feedback lesson's line. */
  lineChars: 300,
  lessonChars: 200,
  /** Answered items kept on a run. */
  items: 6,
  /** Passed checks kept in `history`. */
  history: 20,
} as const;

/**
 * File questions by the changed lines of non-trivial files: none at 15 or
 * fewer, then 1, 2 and at most `maxFileQuestions`. BELL defaults after
 * Google's small-CL guidance, not measured thresholds.
 */
export const questionBuckets = [
  { upTo: 15, questions: 0 },
  { upTo: 100, questions: 1 },
  { upTo: 400, questions: 2 },
] as const;
export const maxFileQuestions = 3;

/** One answered question of the check. */
export interface UnderstandingItem {
  /** `selfCheck:<path>`, `fallback:<path>`, `attempt:<path>` or `untested`. */
  id: string;
  path?: string;
  /** The file's fingerprint when the answer was locked; file items only. */
  fingerprint?: string;
  source: CheckItemSource;
  /** The question as it was asked, in the run's language. */
  question: string;
  /** Empty when the person chose "I don't know". */
  answer: string;
  /** "I don't know": needs the confidence `guess` and counts as missed. */
  dontKnow?: boolean;
  confidence: Confidence;
  lockedAt: string;
  /** Absent until graded; the not-tested question is never graded. */
  grade?: SelfGrade;
  /** "What I had wrong", needed for Partly and Missed. */
  correction?: string;
  gradedAt?: string;
}

/** The optional last step: what the person expects the maintainer to question. */
export interface MaintainerForecast {
  dimension?: TasteDimension;
  question?: string;
  at: string;
}

/** One passed check, kept after the change moves on or the check restarts. */
export interface UnderstandingHistoryEntry {
  passedAt: string;
  /** Questions answered, the not-tested one included. */
  questions: number;
  /** Answers graded Partly or Missed, "I don't know" included. */
  misses: number;
  /** Misses answered at Sure or Think so. */
  confidentMisses: number;
  /** From opening the check to passing it; absent when not measured. */
  seconds?: number;
  /** The follow-up round the check was taken for. */
  round?: string;
}

/**
 * The run's understanding check (`run.understanding`). Every field is
 * optional; runs from older builds have none and are held to the check
 * when they are approved or published.
 */
export interface RunUnderstanding {
  /** The person's own explanation of the change, with the change it described. */
  summary?: {
    text: string;
    changeFingerprint: string;
    at: string;
    /** When the person last said "Still accurate" or edited it after the change moved. */
    confirmedAt?: string;
  };
  items?: UnderstandingItem[];
  passedAt?: string;
  /** `changeFingerprint` of the files the check passed on. */
  passedFingerprint?: string;
  /**
   * Each changed file's fingerprint when the check last passed. A re-check
   * after the change moved (a follow-up round, a sync, an edit) asks only
   * about the files that differ. Absent until the first pass and after
   * Start over.
   */
  passedFiles?: Record<string, string>;
  /** When the person opened the check (sent with the answers), for its local timing. */
  startedAt?: string;
  forecast?: MaintainerForecast;
  history?: UnderstandingHistoryEntry[];
}

/**
 * A per-file "try first" attempt (`run.attempts[path]`): the quiz answered
 * before the reveal and the road choice. Attempts never change review
 * state; a quiz at the file's current fingerprint can count toward the
 * check.
 */
export interface FileAttempt {
  /** The file version the attempt was made on. */
  fingerprint: string;
  quiz?: {
    answer?: string;
    confidence?: Confidence;
    grade?: SelfGrade;
    /** "Show answer" with an empty field: a one-click skip. */
    skipped?: boolean;
    at: string;
  };
  road?: {
    /** "Before you look: how else could this be done?" */
    guess?: string;
    choice?: RoadChoice;
    why?: string;
    at: string;
  };
}

/** The person's tag on one piece of maintainer feedback (`run.feedbackTags[url]`). */
export interface FeedbackTag {
  dimension?: TasteDimension;
  /** true: "Saw it coming"; false: "Surprised me". */
  predicted?: boolean;
  /** "Lesson for next time", for a surprise. */
  lesson?: string;
  at: string;
}

/** What the check needs to know of one changed file (server and client diffs both fit). */
export interface CheckFile {
  path: string;
  fingerprint: string;
  additions: number;
  deletions: number;
  patch?: string;
  /** Why the file is held back; its patch is then a message, not a diff. */
  blocked?: string;
  status?: string;
}

/** A question the check asks now, with the reference the person compares against. */
export interface PlannedItem {
  id: string;
  source: CheckItemSource;
  path?: string;
  fingerprint?: string;
  question: string;
  /** AI-written; absent when there is none ("compare with the diff yourself"). */
  reference?: string;
}

export type MissingPart =
  | "summary"
  | "summary-confirm"
  | "answer"
  | "grade"
  | "correction";

/** GET /api/runs/:id/understanding */
export interface UnderstandingView {
  /** False only while the person has turned the check off. */
  required: boolean;
  /** The environment variable that keeps the check on, when one does. */
  lockedBy?: string;
  passed: boolean;
  /** The change moved since the summary was written; it needs confirming. */
  stale: boolean;
  plan: PlannedItem[];
  record?: RunUnderstanding;
  missing: { part: MissingPart; itemId?: string }[];
  /** `changeFingerprint` of the current files; writes send it back. */
  changeFingerprint: string;
}

/** PUT /api/runs/:id/understanding/answers: "Lock my answers". */
export interface UnderstandingAnswersInput {
  /** Required while no summary is recorded; a recorded one changes through the summary route. */
  summary?: string;
  items: {
    id: string;
    answer: string;
    confidence: Confidence;
    dontKnow?: boolean;
  }[];
  changeFingerprint: string;
  /** When the check panel opened (ISO time), for the local timing. */
  openedAt?: string;
}

/** PUT /api/runs/:id/understanding/grades */
export interface UnderstandingGradesInput {
  items: { id: string; grade: SelfGrade; correction?: string }[];
  forecast?: MaintainerForecastInput;
}

/** POST /api/runs/:id/understanding/summary: "Still accurate", or an edit. */
export interface UnderstandingSummaryInput {
  changeFingerprint: string;
  text?: string;
}

/** PUT /api/runs/:id/forecast */
export interface MaintainerForecastInput {
  dimension?: TasteDimension;
  question?: string;
}

/** PATCH /api/runs/:id/attempts */
export interface FileAttemptInput {
  filePath: string;
  fingerprint: string;
  quiz?: {
    answer?: string;
    confidence?: Confidence;
    grade?: SelfGrade;
    skipped?: boolean;
  };
  road?: { guess?: string; choice?: RoadChoice; why?: string };
}

/**
 * Files that get no question: lockfiles, generated output (by name or the
 * project's `linguist-generated` patterns), whitespace-only changes, and
 * documentation changes of 3 lines or fewer. There is no rename rule: BELL
 * reads diffs with `--no-renames`, so a rename is a deletion plus an
 * addition.
 */
export function isTrivialFile(
  file: CheckFile,
  generated: readonly string[] = [],
) {
  if (isLockfile(file.path) || isGeneratedPath(file.path, generated))
    return true;
  if (whitespaceOnlyPatch(file.patch)) return true;
  return isDocsPath(file.path) && file.additions + file.deletions <= 3;
}

/** Added plus removed lines of the non-trivial files. */
export function changedLines(
  files: readonly CheckFile[],
  generated: readonly string[] = [],
) {
  return files
    .filter((file) => !isTrivialFile(file, generated))
    .reduce((total, file) => total + file.additions + file.deletions, 0);
}

/** How many file questions the check asks for this many changed lines. */
export function checkQuestionCount(lines: number) {
  return (
    questionBuckets.find((bucket) => lines <= bucket.upTo)?.questions ??
    maxFileQuestions
  );
}

/** "What did you not test, and why?" is asked whenever a non-docs source file changed. */
export function needsUntestedQuestion(
  files: readonly CheckFile[],
  generated: readonly string[] = [],
) {
  return files.some(
    (file) =>
      !isTrivialFile(file, generated) &&
      !isDocsPath(file.path) &&
      !isTestPath(file.path),
  );
}

const fnvOffset = 0xcbf29ce484222325n;
const fnvPrime = 0x100000001b3n;
const mask64 = 0xffffffffffffffffn;

/**
 * The fingerprint of the whole change: FNV-1a 64-bit, as 16 hex digits, of
 * the sorted `path:fingerprint` lines. Synchronous so the client, the demo
 * and the server compute it alike; it identifies a version of the change
 * and is not security-relevant.
 */
export function changeFingerprint(
  files: readonly Pick<CheckFile, "path" | "fingerprint">[],
) {
  const text = files
    .map((file) => `${file.path}:${file.fingerprint}`)
    .sort()
    .join("\n");
  let hash = fnvOffset;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * fnvPrime) & mask64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Paragraphs (split on blank lines) of a report that mention the path or its basename. */
export function reportMentionCount(report: string, filePath: string) {
  const basename = filePath.split("/").pop() || filePath;
  return report
    .split(/\n\s*\n/)
    .filter(
      (paragraph) =>
        paragraph.includes(filePath) || paragraph.includes(basename),
    ).length;
}

/** The reports the ranking reads: the Reviewer's and the Test analyst's. */
type Reports = Record<string, string | undefined>;

/**
 * The non-trivial files, riskiest first: CI configuration, then files the
 * Reviewer or Test analyst report mentions (the Lead's integration summary
 * names every file, so it does not count), source before tests, larger
 * changes first, then the suggested review order and the path.
 */
export function pickCheckFiles<T extends CheckFile>({
  files,
  reports,
  reviewOrder,
  generated,
}: {
  files: readonly T[];
  reports?: Reports;
  /** Paths in the suggested order; read from the Lead's report when absent. */
  reviewOrder?: readonly string[];
  generated?: readonly string[];
}): T[] {
  const order =
    reviewOrder ??
    parseReviewOrder(reports?.implementer ?? "").map((entry) => entry.path);
  const reviewText = [reports?.reviewer, reports?.tester].filter(
    (report): report is string => !!report,
  );
  const rank = (file: T) => {
    const position = order.indexOf(file.path);
    return [
      ciConfigPath(file.path) ? 0 : 1,
      reviewText.some((report) => reportMentionCount(report, file.path) > 0)
        ? 0
        : 1,
      isTestPath(file.path) ? 1 : 0,
      -(file.additions + file.deletions),
      position < 0 ? order.length : position,
    ];
  };
  return files
    .filter((file) => !isTrivialFile(file, generated))
    .map((file) => ({ file, key: rank(file) }))
    .sort((a, b) => {
      for (let index = 0; index < a.key.length; index++)
        if (a.key[index] !== b.key[index]) return a.key[index] - b.key[index];
      return a.file.path.localeCompare(b.file.path);
    })
    .map(({ file }) => file);
}

/** What the check reads of a stored or demo explanation. */
export interface CheckExplanation {
  fingerprint?: string;
  status?: string;
  content?: ChangeExplanation;
}

/** The file's explanation card, when it is ready for this version of the file. */
function readyCard(
  file: CheckFile,
  explanations: Record<string, CheckExplanation | undefined> = {},
) {
  const stored = explanations[file.path];
  if (file.blocked || stored?.status !== "ready" || !stored.content)
    return undefined;
  if (stored.fingerprint && stored.fingerprint !== file.fingerprint)
    return undefined;
  return stored.content;
}

/** Words as the check counts them (`draftProseWords`: one CJK character is one word). */
export function understandingWords(text = "") {
  return text.trim() ? draftProseWords(text) : 0;
}
const words = understandingWords;

/**
 * True when a per-file quiz counts toward the check: answered before the
 * reveal at the file's current fingerprint, with enough words, a
 * confidence and a grade, not skipped, and not a near-copy of the answer.
 */
export function creditedAttempt(
  attempt: FileAttempt | undefined,
  file: Pick<CheckFile, "fingerprint">,
  reference?: string,
) {
  const quiz = attempt?.quiz;
  if (!attempt || !quiz) return false;
  return (
    attempt.fingerprint === file.fingerprint &&
    !quiz.skipped &&
    !!quiz.confidence &&
    !!quiz.grade &&
    words(quiz.answer) >= understandingLimits.answerMinWords &&
    !looksCopied(quiz.answer ?? "", reference ? [reference] : [])
  );
}

/** The files a check asks about: those changed since the last pass, or all of them. */
export function checkScope<T extends CheckFile>(
  files: readonly T[],
  record?: RunUnderstanding,
): T[] {
  const passed = record?.passedFiles;
  return passed
    ? files.filter((file) => passed[file.path] !== file.fingerprint)
    : [...files];
}

/**
 * The questions the check asks now, file questions first, then the fixed
 * not-tested question. Files are counted and picked within the check's
 * scope (see checkScope). Answers already locked for a file at its current
 * fingerprint keep their slot, so a late explanation or a new review
 * report never swaps a question the person answered. A credited attempt
 * fills its file's slot; an attempt on a file that was not picked changes
 * nothing.
 */
export function planCheck({
  files,
  explanations,
  attempts,
  reports,
  reviewOrder,
  generated,
  record,
  questions,
}: {
  files: readonly CheckFile[];
  explanations?: Record<string, CheckExplanation | undefined>;
  attempts?: Record<string, FileAttempt | undefined>;
  reports?: Reports;
  reviewOrder?: readonly string[];
  generated?: readonly string[];
  record?: RunUnderstanding;
  /** The run's language: the fallback question for a file, and the not-tested question. */
  questions: { fallback: (path: string) => string; untested: string };
}): PlannedItem[] {
  const scope = checkScope(files, record);
  const slots = checkQuestionCount(changedLines(scope, generated));
  const ranked = pickCheckFiles({ files: scope, reports, reviewOrder, generated });
  const locked = new Map(
    (record?.items ?? [])
      .filter((item) => item.path)
      .map((item) => [item.path!, item]),
  );
  const keep = ranked.filter(
    (file) => locked.get(file.path)?.fingerprint === file.fingerprint,
  );
  const picked = [
    ...keep.slice(0, slots),
    ...ranked.filter((file) => !keep.includes(file)),
  ].slice(0, slots);
  const plan: PlannedItem[] = ranked
    .filter((file) => picked.includes(file))
    .map((file) => {
      const card = readyCard(file, explanations);
      const check = card?.selfCheck;
      const fallbackReference = card
        ? `${card.summary}\n\n${card.reason}`
        : undefined;
      const base = { path: file.path, fingerprint: file.fingerprint };
      const kept = keep.includes(file) ? locked.get(file.path) : undefined;
      if (kept)
        return {
          ...base,
          id: kept.id,
          source: kept.source,
          question: kept.question,
          reference:
            kept.source === "fallback" ? fallbackReference : check?.answer,
        };
      if (check && creditedAttempt(attempts?.[file.path], file, check.answer))
        return {
          ...base,
          id: `attempt:${file.path}`,
          source: "attempt",
          question: check.question,
          reference: check.answer,
        };
      if (check)
        return {
          ...base,
          id: `selfCheck:${file.path}`,
          source: "selfCheck",
          question: check.question,
          reference: check.answer,
        };
      return {
        ...base,
        id: `fallback:${file.path}`,
        source: "fallback",
        question: questions.fallback(file.path),
        reference: fallbackReference,
      };
    });
  if (needsUntestedQuestion(scope, generated)) {
    const kept = record?.items?.find((item) => item.id === "untested");
    const tester = reports?.tester?.trim();
    plan.push({
      id: "untested",
      source: "untested",
      question: kept?.question ?? questions.untested,
      ...(tester ? { reference: tester } : {}),
    });
  }
  return plan;
}

/**
 * Lower case, punctuation and symbols as spaces, whitespace collapsed. A
 * CJK character stands apart as a word of its own, as `draftProseWords`
 * counts it, so text without spaces is compared character by character.
 */
function normalized(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
      " $& ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Scripts written without spaces, where `normalized` makes each character a word. */
const unspaced = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * How long a stretch of a reference must be to count as copied: shorter
 * ones are what a person who remembers the change writes anyway ("the
 * HttpError is thrown right away", or six Chinese characters for "is
 * thrown at once"). One CJK character is one word, so its bar is higher.
 */
const copyMinWords = { spaced: 8, unspaced: 12 } as const;

/**
 * A near-copy of an AI-written text: after normalising case, whitespace
 * and punctuation, the text appears word for word in a reference (texts of
 * 8 or more words, 12 or more CJK characters, so a short answer that
 * recalls the reference's wording is not called a copy), or a reference of
 * 8 or more words appears word for word in the text. A CJK character
 * counts as one word, so a copied part of a Chinese sentence is found as
 * well.
 */
export function looksCopied(text: string, references: readonly string[]) {
  const own = normalized(text);
  if (!own) return false;
  const long =
    words(own) >=
    (unspaced.test(own) ? copyMinWords.unspaced : copyMinWords.spaced);
  return references.some((reference) => {
    const other = normalized(reference);
    if (!other) return false;
    return (
      (long && ` ${other} `.includes(` ${own} `)) ||
      (words(other) >= 8 && ` ${own} `.includes(` ${other} `))
    );
  });
}

/** Missed or Partly at Sure or Think so: the most useful kind of miss. */
export function isConfidentMiss(
  item: Pick<UnderstandingItem, "grade" | "dontKnow" | "confidence">,
) {
  const grade = item.dontKnow ? "missed" : item.grade;
  return (
    (grade === "partly" || grade === "missed") &&
    (item.confidence === "sure" || item.confidence === "think")
  );
}

/** The grade an item counts with: "I don't know" is always Missed. */
export function effectiveGrade(
  item: Pick<UnderstandingItem, "grade" | "dontKnow">,
): SelfGrade | undefined {
  return item.dontKnow ? "missed" : item.grade;
}

/** Every text field of an explanation card, for the near-copy test of the summary. */
export function cardTexts(card: ChangeExplanation) {
  return [
    card.summary,
    card.reason,
    card.concept,
    card.tip,
    card.alternatives,
    card.example?.scenario,
    card.example?.before,
    card.example?.after,
    card.selfCheck?.question,
    card.selfCheck?.answer,
  ].filter((text): text is string => !!text?.trim());
}

/**
 * Whether one answer is acceptable: "I don't know" with the confidence
 * Guessing, or enough words that are not a near-copy of the reference,
 * with a confidence.
 */
export function validAnswer(
  item: Pick<UnderstandingItem, "answer" | "dontKnow" | "confidence">,
  reference?: string,
) {
  if (!confidences.includes(item.confidence)) return false;
  if (item.dontKnow) return item.confidence === "guess" && !item.answer.trim();
  return (
    words(item.answer) >= understandingLimits.answerMinWords &&
    !looksCopied(item.answer, reference ? [reference] : [])
  );
}

/** A summary with enough words that is not a near-copy of any explanation card. */
export function validSummary(
  text: string,
  cards: readonly ChangeExplanation[] = [],
) {
  return (
    words(text) >= understandingLimits.summaryMinWords &&
    !looksCopied(text, cards.flatMap(cardTexts))
  );
}

/** A Partly or Missed answer's correction is long enough. */
export function validCorrection(text?: string) {
  return words(text) >= understandingLimits.correctionMinWords;
}

/**
 * Where the check stands for the current files, by the pass rule: the
 * summary meets its minimum, is not a near-copy of a card and describes
 * the current change; every planned question has an acceptable answer
 * recorded at the file's current fingerprint; every gradable answer has a
 * grade; every Partly or Missed answer has a correction.
 */
export function understandingStatus({
  record,
  plan,
  files,
  required,
  cards = [],
}: {
  record?: RunUnderstanding;
  plan: readonly PlannedItem[];
  files: readonly Pick<CheckFile, "path" | "fingerprint">[];
  required: boolean;
  /** The ready explanation cards of the run. */
  cards?: readonly ChangeExplanation[];
}): Pick<UnderstandingView, "required" | "passed" | "stale" | "missing"> {
  const current = changeFingerprint(files);
  const fingerprints = new Map(files.map((file) => [file.path, file.fingerprint]));
  const missing: UnderstandingView["missing"] = [];
  const summary = record?.summary;
  const stale = !!summary && summary.changeFingerprint !== current;
  if (!summary || !validSummary(summary.text, cards))
    missing.push({ part: "summary" });
  else if (stale) missing.push({ part: "summary-confirm" });
  for (const planned of plan) {
    const item = record?.items?.find((entry) => entry.id === planned.id);
    const fresh =
      !item?.path || fingerprints.get(item.path) === item.fingerprint;
    if (!item || !fresh || !validAnswer(item, planned.reference)) {
      missing.push({ part: "answer", itemId: planned.id });
      continue;
    }
    if (planned.source === "untested") continue;
    const grade = effectiveGrade(item);
    if (!grade) missing.push({ part: "grade", itemId: planned.id });
    else if (grade !== "got" && !validCorrection(item.correction))
      missing.push({ part: "correction", itemId: planned.id });
  }
  return { required, passed: !missing.length, stale, missing };
}

/**
 * Brings a record up to date with the current files: answers about a file
 * whose fingerprint changed (or that left the diff) are dropped, and once
 * the change moves past the version the check passed on, the pass ends.
 * The summary and the not-tested answer are kept; the summary then needs
 * confirming, and the re-check asks only about the files that changed.
 * Returns whether anything changed.
 */
export function synchronizeUnderstandingRecord(
  record: RunUnderstanding | undefined,
  files: readonly Pick<CheckFile, "path" | "fingerprint">[],
) {
  if (!record) return false;
  let changed = false;
  const current = new Map(files.map((file) => [file.path, file.fingerprint]));
  const passedOn = record.passedFingerprint;
  const moved = !!passedOn && passedOn !== changeFingerprint(files);
  const items = (record.items ?? []).filter(
    (item) => !item.path || current.get(item.path) === item.fingerprint,
  );
  if (record.items && items.length !== record.items.length) {
    record.items = items;
    changed = true;
  }
  if (moved) {
    delete record.passedAt;
    delete record.passedFingerprint;
    delete record.startedAt;
    changed = true;
  }
  return changed;
}

/**
 * Records a pass on the current files: the time, the change and each
 * file's fingerprint (the scope of a later re-check), and one history
 * entry with the counts and the time taken since the check opened.
 */
export function recordPass(
  record: RunUnderstanding,
  {
    files,
    plan,
    now,
    round,
  }: {
    files: readonly Pick<CheckFile, "path" | "fingerprint">[];
    plan: readonly PlannedItem[];
    now: string;
    round?: string;
  },
) {
  const asked = plan
    .map((planned) => record.items?.find((item) => item.id === planned.id))
    .filter((item): item is UnderstandingItem => !!item);
  const misses = asked.filter((item) => {
    const grade = effectiveGrade(item);
    return grade === "partly" || grade === "missed";
  });
  const started = record.startedAt ? Date.parse(record.startedAt) : NaN;
  const seconds = Math.round((Date.parse(now) - started) / 1000);
  record.passedAt = now;
  record.passedFingerprint = changeFingerprint(files);
  record.passedFiles = Object.fromEntries(
    files.map((file) => [file.path, file.fingerprint]),
  );
  record.history = [
    ...(record.history ?? []),
    {
      passedAt: now,
      questions: asked.length,
      misses: misses.length,
      confidentMisses: misses.filter(isConfidentMiss).length,
      ...(Number.isFinite(seconds) && seconds >= 0 ? { seconds } : {}),
      ...(round ? { round } : {}),
    },
  ].slice(-understandingLimits.history);
  delete record.startedAt;
  return record;
}
