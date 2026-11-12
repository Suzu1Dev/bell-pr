/**
 * Team review sign-offs (3a), developer change rationales (3b) and handoff /
 * coordination TODOs (3c) stored on `run.teamRecords` (`shared/types.ts`).
 */
import { randomBytes } from "node:crypto";
import type {
  RunTeamRecords,
  TeamFileReview,
  TeamRationaleNote,
  TeamTodoItem,
} from "../shared/types.js";
import { safeRelativePath } from "./git.js";
import { AppError, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench-context.js";

const now = () => new Date().toISOString();
const recordId = (prefix: string) => `${prefix}_${randomBytes(6).toString("hex")}`;
const maxRationales = 200;
const maxTodos = 200;
const maxReviewersPerFile = 32;

const sanitizeText = (raw: string) =>
  raw.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, (ch) =>
    ch === "\n" || ch === "\t" ? ch : " ",
  ).trim();

const sanitizeLine = (raw: string) =>
  raw.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, " ").trim();

export interface TeamActorIdentity {
  id: string;
  name: string;
  admin?: boolean;
}

function pruneEmptyTeamRecords(run: Run) {
  const tr = run.teamRecords;
  if (!tr) return;
  if (tr.fileReviews) {
    for (const [k, list] of Object.entries(tr.fileReviews)) {
      if (!list.length) delete tr.fileReviews[k];
    }
    if (!Object.keys(tr.fileReviews).length) delete tr.fileReviews;
  }
  if (tr.rationales && !tr.rationales.length) delete tr.rationales;
  if (tr.todos && !tr.todos.length) delete tr.todos;
  if (!tr.fileReviews && !tr.rationales && !tr.todos) delete run.teamRecords;
}

function ensureTeamRecords(run: Run): RunTeamRecords {
  return (run.teamRecords ??= {});
}

/** Updates a reviewer's sign-off entry in memory without acquiring the run lock. */
export function applyReviewerSignOff(
  run: Run,
  filePath: string,
  reviewed: boolean,
  fingerprint: string,
  reviewer: TeamActorIdentity,
) {
  const tr = ensureTeamRecords(run);
  const byFile = (tr.fileReviews ??= {});
  const list = (byFile[filePath] ?? []).filter((entry) => entry.reviewerId !== reviewer.id);
  if (reviewed) {
    const item: TeamFileReview = {
      reviewerId: reviewer.id,
      reviewerName: sanitizeLine(reviewer.name).slice(0, 80) || reviewer.id,
      fingerprint,
      reviewedAt: now(),
    };
    list.push(item);
    byFile[filePath] = list.slice(-maxReviewersPerFile);
  } else if (list.length) {
    byFile[filePath] = list;
  } else {
    delete byFile[filePath];
  }
  pruneEmptyTeamRecords(run);
}

/** Records or clears a teammate's review sign-off on an Agent-modified file (3a). */
export async function recordTeamFileReview(
  ctx: WorkbenchContext,
  id: string,
  input: {
    filePath: string;
    reviewed: boolean;
    fingerprint: string;
    reviewer: TeamActorIdentity;
  },
): Promise<Run> {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    const files = await ctx.diff(id);
    const file = files.find((item) => item.path === input.filePath);
    if (!file) throw new AppError((m) => m.run.review.fileNotFound, 404);
    if (file.fingerprint !== input.fingerprint)
      throw new AppError((m) => m.run.publish.fileChanged, 409);
    if (file.blocked) throw new AppError(file.blocked, 422);
    applyReviewerSignOff(run, input.filePath, input.reviewed, file.fingerprint, input.reviewer);
    await ctx.store.save();
    return run;
  });
}

/** Adds a developer rationale comment explaining why a file or region changed (3b). */
export async function addTeamRationale(
  ctx: WorkbenchContext,
  id: string,
  input: {
    filePath: string;
    lineStart?: number;
    lineEnd?: number;
    text: string;
    author: TeamActorIdentity;
  },
): Promise<Run> {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (!safeRelativePath(input.filePath))
      throw new AppError((m) => m.run.diff.unsupportedName, 422);
    const body = sanitizeText(input.text);
    if (!body) throw new AppError((m) => m.common.invalidJson, 400);
    let fingerprint: string | undefined;
    if (!run.workspaceRemovedAt) {
      const files = await ctx.diff(id).catch(() => []);
      fingerprint = files.find((f) => f.path === input.filePath)?.fingerprint;
    }
    const tr = ensureTeamRecords(run);
    const list = (tr.rationales ??= []);
    if (list.length >= maxRationales)
      throw new AppError((m) => m.run.local.teamRecordLimit, 422);
    const lineStart = input.lineStart;
    const lineEnd =
      lineStart !== undefined ? Math.max(lineStart, input.lineEnd ?? lineStart) : undefined;
    const note: TeamRationaleNote = {
      id: recordId("rat"),
      filePath: input.filePath,
      ...(lineStart !== undefined ? { lineStart } : {}),
      ...(lineEnd !== undefined ? { lineEnd } : {}),
      authorId: input.author.id,
      authorName: sanitizeLine(input.author.name).slice(0, 80) || input.author.id,
      text: body,
      ...(fingerprint ? { fingerprint } : {}),
      createdAt: now(),
    };
    list.push(note);
    await ctx.store.save();
    return run;
  });
}

export async function removeTeamRationale(
  ctx: WorkbenchContext,
  id: string,
  noteId: string,
  actor: TeamActorIdentity,
): Promise<Run> {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    const list = run.teamRecords?.rationales;
    const index = list?.findIndex((item) => item.id === noteId) ?? -1;
    if (!list || index < 0) throw new AppError((m) => m.common.notFound, 404);
    if (!actor.admin && list[index].authorId !== actor.id)
      throw new AppError((m) => m.collab.adminOnly, 403);
    list.splice(index, 1);
    pruneEmptyTeamRecords(run);
    await ctx.store.save();
    return run;
  });
}

/** Adds a coordination or handoff TODO item on a run or file (3c). */
export async function addTeamTodo(
  ctx: WorkbenchContext,
  id: string,
  input: {
    filePath?: string;
    text: string;
    assigneeId?: string;
    assigneeName?: string;
    author: TeamActorIdentity;
  },
): Promise<Run> {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (input.filePath && !safeRelativePath(input.filePath))
      throw new AppError((m) => m.run.diff.unsupportedName, 422);
    const body = sanitizeText(input.text);
    if (!body) throw new AppError((m) => m.common.invalidJson, 400);
    const tr = ensureTeamRecords(run);
    const list = (tr.todos ??= []);
    if (list.length >= maxTodos)
      throw new AppError((m) => m.run.local.teamRecordLimit, 422);
    const assigneeName = input.assigneeName ? sanitizeLine(input.assigneeName).slice(0, 80) : undefined;
    const item: TeamTodoItem = {
      id: recordId("todo"),
      ...(input.filePath ? { filePath: input.filePath } : {}),
      text: body,
      authorId: input.author.id,
      authorName: sanitizeLine(input.author.name).slice(0, 80) || input.author.id,
      ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
      ...(assigneeName ? { assigneeName } : {}),
      done: false,
      createdAt: now(),
    };
    list.push(item);
    await ctx.store.save();
    return run;
  });
}

export async function updateTeamTodo(
  ctx: WorkbenchContext,
  id: string,
  todoId: string,
  input: {
    done?: boolean;
    text?: string;
    assigneeId?: string | null;
    assigneeName?: string | null;
    actor: TeamActorIdentity;
  },
): Promise<Run> {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    const item = run.teamRecords?.todos?.find((entry) => entry.id === todoId);
    if (!item) throw new AppError((m) => m.common.notFound, 404);
    if (input.text !== undefined) {
      const cleaned = sanitizeText(input.text);
      if (!cleaned) throw new AppError((m) => m.common.invalidJson, 400);
      item.text = cleaned;
    }
    if (input.assigneeId !== undefined) {
      if (input.assigneeId === null || !input.assigneeId) delete item.assigneeId;
      else item.assigneeId = input.assigneeId;
    }
    if (input.assigneeName !== undefined) {
      const cleaned = input.assigneeName ? sanitizeLine(input.assigneeName).slice(0, 80) : "";
      if (!cleaned) delete item.assigneeName;
      else item.assigneeName = cleaned;
    }
    if (input.done !== undefined) {
      item.done = input.done;
      if (input.done) {
        item.doneBy = sanitizeLine(input.actor.name).slice(0, 80) || input.actor.id;
        item.doneAt = now();
      } else {
        delete item.doneBy;
        delete item.doneAt;
      }
    }
    await ctx.store.save();
    return run;
  });
}

export async function removeTeamTodo(
  ctx: WorkbenchContext,
  id: string,
  todoId: string,
  actor: TeamActorIdentity,
): Promise<Run> {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    const list = run.teamRecords?.todos;
    const index = list?.findIndex((entry) => entry.id === todoId) ?? -1;
    if (!list || index < 0) throw new AppError((m) => m.common.notFound, 404);
    if (!actor.admin && list[index].authorId !== actor.id && list[index].assigneeId !== actor.id)
      throw new AppError((m) => m.collab.adminOnly, 403);
    list.splice(index, 1);
    pruneEmptyTeamRecords(run);
    await ctx.store.save();
    return run;
  });
}
