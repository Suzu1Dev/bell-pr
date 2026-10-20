/**
 * The learning record across runs (GET /api/learning?cursor=) and the
 * learning loop after review: feedback tags, the practice deck, the plain
 * counts and the coach debrief. Tags and practice grades are the person's
 * own notes on existing data. Request schemas are strict.
 *
 * createApp registers this module in its fixed place, before the /api 404
 * handler.
 */
import type { Express } from "express";
import { z } from "zod";
import type { LearnerNote, StoredExplanation } from "../../shared/explanations.js";
import { byHandSummary, type ByHandSummary } from "../../shared/by-hand.js";
import {
  confidences,
  selfGrades,
  tasteDimensions,
  understandingLimits,
  type RunUnderstanding,
} from "../../shared/understanding.js";
import { sm } from "../i18n/index.js";
import { resolveModelExecution } from "../models.js";
import { AppError, type Run } from "../types.js";
import type { RouteDeps } from "./types.js";

/** Runs per page. */
export const learningPageSize = 20;

/** One run on the learning page: its ready explanations and the person's notes. */
export interface LearningRun {
  id: string;
  repoId: string;
  title: string;
  status: Run["status"];
  createdAt: string;
  locale?: string;
  prUrl?: string;
  explanations: Record<string, StoredExplanation>;
  notes: Record<string, LearnerNote>;
  /** The run's understanding check, for the learning record's check marks. */
  understanding?: RunUnderstanding;
  /** Approved with the understanding check off. */
  understandingCheckOff?: boolean;
  /** A Learn-by-hand run, and its record's plain counts (DESIGN v1.2 F13). */
  learnByHand?: true;
  byHandSummary?: ByHandSummary;
}

/** Newest first; the id breaks ties so the order is total. */
const newestFirst = (
  a: Pick<Run, "createdAt" | "id">,
  b: Pick<Run, "createdAt" | "id">,
) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

function learningRun(run: Run): LearningRun | undefined {
  const explanations = Object.fromEntries(
    Object.entries(run.explanations ?? {}).filter(
      ([, stored]) => stored.status === "ready" && !!stored.content,
    ),
  );
  const notes = Object.fromEntries(
    Object.entries(run.notes ?? {}).filter(([, note]) => !!note.text?.trim()),
  );
  // A Learn-by-hand run is listed for its record: its explanations come only on request.
  const byHand = run.learnByHand && run.byHand;
  if (!Object.keys(explanations).length && !Object.keys(notes).length && !byHand)
    return undefined;
  return {
    id: run.id,
    repoId: run.repoId,
    title: run.title,
    status: run.status,
    createdAt: run.createdAt,
    ...(run.locale ? { locale: run.locale } : {}),
    ...(run.prUrl ? { prUrl: run.prUrl } : {}),
    explanations,
    notes,
    ...(run.understanding ? { understanding: run.understanding } : {}),
    ...(run.understandingCheckOff ? { understandingCheckOff: true } : {}),
    ...(run.learnByHand ? { learnByHand: true as const } : {}),
    ...(byHand ? { byHandSummary: byHandSummary(run) } : {}),
  };
}

/**
 * A cursor names the last run of the previous page, so a run created in
 * between neither repeats nor shifts the next page.
 */
const encodeCursor = (run: Pick<Run, "createdAt" | "id">) =>
  Buffer.from(JSON.stringify([run.createdAt, run.id])).toString("base64url");

function decodeCursor(cursor: string): Pick<Run, "createdAt" | "id"> {
  try {
    const [createdAt, id] = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as unknown[];
    if (typeof createdAt === "string" && typeof id === "string")
      return { createdAt, id };
  } catch {
    // Reported below.
  }
  throw new AppError((m) => m.storage.learning.invalidCursor, 400);
}

/** The runs that have something to learn from, 20 per page, newest first. */
export function learningPage(runs: readonly Run[], cursor?: string) {
  const after = cursor ? decodeCursor(cursor) : undefined;
  const page: LearningRun[] = [];
  let more = false;
  for (const run of [...runs].sort(newestFirst)) {
    if (after && newestFirst(run, after) <= 0) continue;
    const entry = learningRun(run);
    if (!entry) continue;
    if (page.length === learningPageSize) {
      more = true;
      break;
    }
    page.push(entry);
  }
  return {
    runs: page,
    ...(more ? { nextCursor: encodeCursor(page[page.length - 1]) } : {}),
  };
}

/** PATCH /api/runs/:id/feedback-tags: absent fields stay, `null` or an empty lesson removes one. */
export const feedbackTagSchema = z
  .object({
    url: z.string().url().max(1024),
    dimension: z.enum(tasteDimensions).nullable().optional(),
    predicted: z.boolean().nullable().optional(),
    lesson: z.string().max(understandingLimits.lessonChars).nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.dimension !== undefined ||
      input.predicted !== undefined ||
      input.lesson !== undefined,
    () => ({ message: sm().understanding.feedbackTagEmpty }),
  );

/** POST /api/runs/:id/practice: the grade and confidence only, never the answer. */
export const practiceAnswerSchema = z
  .object({
    key: z.string().min(1).max(1200),
    confidence: z.enum(confidences),
    grade: z.enum(selfGrades),
  })
  .strict();

const practiceQuerySchema = z.object({
  now: z.string().datetime({ offset: true }).optional(),
});

/** POST /api/learning/debrief */
export const debriefRequestSchema = z
  .object({ repoId: z.string().min(1).max(200) })
  .strict();

export function registerLearningRoutes(
  app: Express,
  { workbench, insights }: RouteDeps,
) {
  app.get("/api/learning", (req, res) => {
    const cursor = req.query.cursor;
    if (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 1024))
      throw new AppError((m) => m.storage.learning.invalidCursor, 400);
    res.json(learningPage(workbench.store.data.runs, cursor || undefined));
  });
  // The plain counts over every run, not only the pages above.
  app.get("/api/learning/counts", async (_req, res) => {
    res.json(await workbench.learningLoop.counts());
  });
  app.get("/api/learning/practice", async (req, res) => {
    const { now } = practiceQuerySchema.parse({ now: req.query.now });
    res.json(await workbench.learningLoop.practice(now));
  });
  app.post("/api/runs/:id/practice", async (req, res) => {
    res.json(
      await workbench.learningLoop.recordPractice(
        req.params.id,
        practiceAnswerSchema.parse(req.body),
      ),
    );
  });
  app.patch("/api/runs/:id/feedback-tags", async (req, res) => {
    res.json(
      await workbench.learningLoop.saveFeedbackTag(
        req.params.id,
        feedbackTagSchema.parse(req.body),
      ),
    );
  });
  app.post("/api/learning/debrief", async (req, res) => {
    const { repoId } = debriefRequestSchema.parse(req.body);
    // The debrief runs with the project's saved settings, as selected.
    const selected = await insights.getSettings(repoId);
    const debrief = await workbench.learningLoop.debrief(repoId, {
      model: async () => ({
        modelExecution: resolveModelExecution(
          selected,
          await workbench.models(selected.provider),
        ),
        ponytailMode: selected.ponytailMode,
      }),
    });
    res.json({ debrief });
  });
  app.get("/api/learning/debriefs", async (req, res) => {
    const { repoId } = z
      .object({ repoId: z.string().min(1).max(200) })
      .parse({ repoId: req.query.repoId });
    res.json({ debriefs: await workbench.learningLoop.debriefs(repoId) });
  });
}
