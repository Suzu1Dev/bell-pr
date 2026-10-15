/**
 * The learning loop after review: feedback tags, the practice deck, the
 * plain counts and the Pro coach debrief.
 *
 * L1 stub with the final signatures; L2A fills it in and adds the routes.
 * Until then every method answers 501.
 */
import type { CoachDebrief } from "../shared/coach.js";
import type {
  FeedbackTagInput,
  LearningCounts,
  PracticeAnswerInput,
  PracticeItem,
} from "../shared/practice.js";
import { AppError, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

/** What the learning-loop routes do; Workbench.learningLoop. */
export interface LearningLoopFacade {
  /** PATCH /api/runs/:id/feedback-tags (published runs only). */
  saveFeedbackTag(runId: string, input: FeedbackTagInput): Promise<{ run: Run }>;
  /** GET /api/learning/practice: the due items, interleaved. */
  practice(): Promise<PracticeItem[]>;
  /** POST /api/runs/:id/practice */
  recordPractice(runId: string, input: PracticeAnswerInput): Promise<{ run: Run }>;
  /** GET /api/learning/counts: over all runs, never gated. */
  counts(): Promise<LearningCounts>;
  /** POST /api/learning/debrief (Pro, coachDebrief). */
  debrief(repoId: string): Promise<CoachDebrief>;
  /** GET /api/learning/debriefs?repoId=: stored debriefs, never gated. */
  debriefs(repoId: string): Promise<CoachDebrief[]>;
}

const notImplemented = () =>
  Promise.reject(new AppError((m) => m.understanding.notImplemented, 501));

export function learningLoopFacade(_ctx: WorkbenchContext): LearningLoopFacade {
  return {
    saveFeedbackTag: notImplemented,
    practice: notImplemented,
    recordPractice: notImplemented,
    counts: notImplemented,
    debrief: notImplemented,
    debriefs: notImplemented,
  };
}
