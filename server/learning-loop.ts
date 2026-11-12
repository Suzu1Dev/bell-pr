import { assertSessionIdle } from "./session.js";
/**
 * The learning loop after review: feedback tags, the practice deck, the
 * plain counts and the coach debrief.
 *
 * Nothing here polls GitHub and nothing grades the person: tags, practice
 * grades and the forecast are the person's own.
 */
import type { CoachDebrief } from "../shared/coach.js";
import {
  learningCounts,
  nextPractice,
  practiceKey,
  type FeedbackTagInput,
  type LearningCounts,
  type PracticeAnswerInput,
} from "../shared/practice.js";
import type { FeedbackTag } from "../shared/understanding.js";
import { readableDebriefs, writeDebrief, type DebriefOptions } from "./coach.js";
import {
  capPractice,
  dueItems,
  practiceCandidates,
  recordPracticeAnswer,
  type PracticeSession,
} from "./practice.js";
import { AppError, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

/** Feedback tags kept on one run (`run.feedbackTags`). */
export const feedbackTagsPerRun = 100;

/**
 * PATCH /api/runs/:id/feedback-tags. A field that is absent stays as it
 * was; `null` (or an empty lesson) removes it, so a chip can be unset.
 */
export interface FeedbackTagPatch extends Omit<FeedbackTagInput, "dimension" | "predicted" | "lesson"> {
  dimension?: FeedbackTagInput["dimension"] | null;
  predicted?: boolean | null;
  lesson?: string | null;
}

/** What the learning-loop routes do; Workbench.learningLoop. */
export interface LearningLoopFacade {
  /** PATCH /api/runs/:id/feedback-tags (published runs only). */
  saveFeedbackTag(runId: string, input: FeedbackTagPatch): Promise<{ run: Run }>;
  /** GET /api/learning/practice?now=: the due items, interleaved, and when the next one is due. */
  practice(now?: string): Promise<PracticeSession>;
  /** POST /api/runs/:id/practice */
  recordPractice(runId: string, input: PracticeAnswerInput): Promise<{ run: Run }>;
  /** GET /api/learning/counts: over all runs. */
  counts(): Promise<LearningCounts>;
  /** POST /api/learning/debrief: writes and stores one. */
  debrief(repoId: string, options?: DebriefOptions): Promise<CoachDebrief>;
  /** GET /api/learning/debriefs?repoId=: stored debriefs, newest first. */
  debriefs(repoId: string): Promise<CoachDebrief[]>;
}

const now = () => new Date().toISOString();

/**
 * Merges the person's tag into `run.feedbackTags[url]`. A comment marked
 * "Surprised me" with a lesson enters the practice deck, due tomorrow; a
 * changed surprise or lesson schedules it again from the start, and once
 * it is no longer a surprise with a lesson its schedule goes.
 */
export function applyFeedbackTag(run: Run, input: FeedbackTagPatch, at: string) {
  const tags = (run.feedbackTags ??= {});
  const previous = tags[input.url];
  const tag: FeedbackTag = { ...previous, at };
  if (input.dimension === null) delete tag.dimension;
  else if (input.dimension) tag.dimension = input.dimension;
  if (input.predicted === null) delete tag.predicted;
  else if (input.predicted !== undefined) tag.predicted = input.predicted;
  if (input.lesson !== undefined) {
    const lesson = input.lesson?.trim();
    if (lesson) tag.lesson = lesson;
    else delete tag.lesson;
  }
  if (tag.dimension === undefined && tag.predicted === undefined && !tag.lesson)
    delete tags[input.url];
  else tags[input.url] = tag;
  // At most 100 tags: the ones tagged longest ago go first.
  const urls = Object.keys(tags);
  if (urls.length > feedbackTagsPerRun)
    urls
      .filter((url) => url !== input.url)
      .sort((a, b) => tags[a].at.localeCompare(tags[b].at))
      .slice(0, urls.length - feedbackTagsPerRun)
      .forEach((url) => delete tags[url]);

  const key = practiceKey("feedback", input.url);
  const current = tags[input.url];
  if (current?.predicted === false && current.lesson) {
    const changed =
      previous?.predicted !== current.predicted ||
      previous?.lesson !== current.lesson;
    if (changed || !run.practice?.[key]) {
      // Box 0, due tomorrow: the schedule of a miss, without a practice answer.
      const { box, dueAt } = nextPractice(undefined, "missed", at);
      (run.practice ??= {})[key] = { box, dueAt };
    }
  } else if (run.practice?.[key]) delete run.practice[key];
}

export function learningLoopFacade(ctx: WorkbenchContext): LearningLoopFacade {
  /** Projects whose debrief is being written; one at a time each. */
  const debriefsRunning = new Set<string>();
  return {
    saveFeedbackTag(runId, input) {
      return ctx.lock(runId, async () => {
        const run = ctx.run(runId);
        // Tags are the person's notes on feedback BELL already read: a
        // write on existing data.
        if (!run.prUrl)
          throw new AppError((m) => m.understanding.feedbackTagUnpublished, 409);
        if (!run.prFeedback?.items.some((item) => item.url === input.url))
          throw new AppError((m) => m.understanding.feedbackTagUnknown, 400);
        const at = now();
        applyFeedbackTag(run, input, at);
        const { runs, repos } = ctx.store.data;
        const live = new Set(
          practiceCandidates(runs, repos, at)
            .filter((candidate) => candidate.item.runId === run.id)
            .map((candidate) => candidate.item.key),
        );
        capPractice(run, live);
        await ctx.store.save();
        return { run };
      });
    },

    async practice(at = now()) {
      const { runs, repos } = ctx.store.data;
      return dueItems(runs, repos, at);
    },

    recordPractice(runId, input) {
      return ctx.lock(runId, async () => {
        const run = ctx.run(runId);
        assertSessionIdle(run);
        const at = now();
        const { runs, repos } = ctx.store.data;
        recordPracticeAnswer(run, practiceCandidates(runs, repos, at), input, at);
        await ctx.store.save();
        return { run };
      });
    },

    async counts() {
      return learningCounts(ctx.store.data.runs);
    },

    debrief(repoId, options = {}) {
      return writeDebrief(ctx, repoId, options, debriefsRunning);
    },

    async debriefs(repoId) {
      return readableDebriefs(ctx.repo(repoId));
    },
  };
}
