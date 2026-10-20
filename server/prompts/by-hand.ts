/**
 * Prompt builders of a Learn-by-hand run (DESIGN v1.2 §9.1). STUBS with
 * final signatures: W2B writes the prompts and pins them in
 * server/prompts/fixtures/by-hand-prompts.json; until then each returns a
 * minimal fixed prompt. Every builder treats the repository, the issue,
 * test output and the person's text as data, never instructions, and sets
 * the output language only through server/prompt-language.ts.
 *
 * - `byHandPlanPrompt`: the lead's read-only orientation turn (orientation
 *   schema): the problem and impact, step names with files and never how,
 *   read-first ranges at base, and the premise check.
 * - `planQuestionsPrompt`: up to three questions on the person's plan,
 *   which it sees instead of the outline.
 * - `guidePrompt`: one guide turn (guide schema): an ask by entry, a hint
 *   rung R1-R4, a failure explained, or the per-file chat after Ready.
 * - `byHandReviewerPrompt`, `byHandTesterPrompt`: the structured review at
 *   Ready (reviewer schema; the test analyst answers in text).
 */
import type {
  AskEntry,
  ByHandPlan,
  ByHandReview,
  ByHandStep,
  GuideEntry,
  GuideKind,
  TestRun,
} from "../../shared/by-hand.js";
import type { Locale } from "../../shared/i18n/locale.js";
import { respondIn } from "../prompt-language.js";
import type { contributionContext } from "./team.js";

/** The run as prompts read it (the request and its contribution settings). */
export type PromptRun = Parameters<typeof contributionContext>[0];

/** The shared preamble's first line; W2B writes the rest (DESIGN v1.2 §9.1). */
const guideRole =
  "You are BELL's guide in a Learn-by-hand run. The person writes every line of this change; you only read.";

/** The lead's orientation turn, before the person plans. */
export function byHandPlanPrompt(locale: Locale, run: PromptRun): string {
  void run;
  return `${guideRole} ${respondIn(locale)}`;
}

/** Questions on the person's plan (never the guide's outline). */
export function planQuestionsPrompt(
  locale: Locale,
  input: { run: PromptRun; plan: ByHandPlan },
): string {
  void input;
  return `${guideRole} ${respondIn(locale)}`;
}

/** What one guide turn sees: never the guide's own outline. */
export interface GuidePromptInput {
  run: PromptRun;
  kind: GuideKind;
  /** The hint rung, 1-4. */
  rung?: number;
  /** The entry chip of a free question. */
  entry?: AskEntry;
  plan?: ByHandPlan;
  step?: ByHandStep;
  question?: string;
  tried?: string;
  /** The person's current diff of the step's files, at most 40 kB. */
  diff: string;
  /** The last test run's output tail, at most 4 kB. */
  testTail?: string;
  /** The last entries of this step, at most 4. */
  history: GuideEntry[];
}

/** One guide turn: ask, hint, a failure explained, or chat after Ready. */
export function guidePrompt(locale: Locale, input: GuidePromptInput): string {
  void input;
  return `${guideRole} ${respondIn(locale)}`;
}

/** What the reviewer and the test analyst see at Ready. */
export interface ByHandReviewPromptInput {
  run: PromptRun;
  /** The person's change. */
  diff: string;
  plan?: ByHandPlan;
  /** "What are you least sure about?" */
  leastSure?: string;
  /** The last BELL test run at the ready version. */
  lastTest?: TestRun;
  /** The review of an earlier version, for a second review. */
  previous?: ByHandReview;
}

/** The reviewer at Ready: evidence or a question, never a fix. */
export function byHandReviewerPrompt(locale: Locale, input: ByHandReviewPromptInput): string {
  void input;
  return `${guideRole} ${respondIn(locale)}`;
}

/** The test analyst at Ready: faults in words, never test code. */
export function byHandTesterPrompt(locale: Locale, input: ByHandReviewPromptInput): string {
  void input;
  return `${guideRole} ${respondIn(locale)}`;
}
