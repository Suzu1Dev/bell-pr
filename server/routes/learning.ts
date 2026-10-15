/**
 * The learning record across runs: GET /api/learning?cursor=.
 *
 * Owned by 3C-reliability-storage. createApp already registers this module
 * in its fixed place, before the /api 404 handler.
 */
import type { Express } from "express";
import type { LearnerNote, StoredExplanation } from "../../shared/explanations.js";
import type { RunUnderstanding } from "../../shared/understanding.js";
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
  if (!Object.keys(explanations).length && !Object.keys(notes).length)
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

export function registerLearningRoutes(app: Express, { workbench }: RouteDeps) {
  app.get("/api/learning", (req, res) => {
    const cursor = req.query.cursor;
    if (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 1024))
      throw new AppError((m) => m.storage.learning.invalidCursor, 400);
    res.json(learningPage(workbench.store.data.runs, cursor || undefined));
  });
}
