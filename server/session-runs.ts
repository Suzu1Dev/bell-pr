/** Collaborative agent turns on an unpublished contribution. */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { activeFollowUp } from "../shared/followups.js";
import { findDraftPlaceholders } from "../shared/draft-checks.js";
import { replaceDraftCheckSections } from "../shared/limitations.js";
import {
  sessionContentLimit,
  sessionMessageLimit,
  type SessionMessage,
} from "../shared/session.js";
import type { TeamCheck } from "../shared/team.js";
import { readDiff } from "./git.js";
import { git, redact } from "./process.js";
import { AppError, withRunLocale, type DiffFile, type Run } from "./types.js";
import { currentLocale, shuttingDown, sm } from "./i18n/index.js";
import { assertWorkspacePresent } from "./cleanup.js";
import { contributionContext, teamBoundaries } from "./prompts/team.js";
import { restoreAgentHead } from "./pr-branch.js";
import { runAgent } from "./run-executor.js";
import { log } from "./log.js";
import { draftFingerprint } from "./drafts.js";
import {
  parseSessionResult,
  sessionJsonSchema,
  sessionPrompt,
} from "./session.js";
import type { WorkbenchContext } from "./workbench-context.js";

const now = () => new Date().toISOString();
const newId = () => randomUUID();

/** A turn of the working session is editing this run's checkout right now. */
function sessionRunning(ctx: WorkbenchContext, id: string) {
  return ctx.controllers.has(`session:${id}`);
}

function addSessionMessage(
  run: Run,
  message: Omit<SessionMessage, "id" | "at">,
) {
  const session = (run.session ??= {
    messages: [],
    revision: 0,
    updatedAt: now(),
  });
  session.messages.push({
    id: newId().slice(0, 8),
    at: now(),
    ...message,
    content: redact(message.content).slice(0, sessionContentLimit),
  });
  if (session.messages.length > sessionMessageLimit)
    session.messages.splice(0, session.messages.length - sessionMessageLimit);
  session.updatedAt = now();
}

/**
 * One message from the person to an agent that edits and checks the
 * unpublished checkout. The turn runs in the background; the page follows
 * it through run.session and the run log. Questions the agent has come back
 * in its reply, and the answer goes into the next turn: the CLIs keep no
 * conversation between invocations.
 */
export async function startSession(
  ctx: WorkbenchContext,
  id: string,
  content: string,
) {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  const text = content.trim();
  if (!text) throw new AppError(sm().session.emptyMessage, 422);
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (run.learnByHand)
      throw new AppError((m) => m.session.byHandRefused, 409);
    assertWorkspacePresent(run);
    if (!["review", "approved"].includes(run.status) || run.publishing)
      throw new AppError(sm().session.notAllowed, 409);
    if (activeFollowUp(run.followUps))
      throw new AppError(sm().session.followUpRunning, 409);
    // Never wait for a turn that is still running: that would hold the run lock.
    // A turn that just ended may still be cleaning up outside it.
    if (!sessionRunning(ctx, id))
      await ctx.sessionJobs.get(id)?.catch(() => undefined);
    if (
      ctx.followUpJobs.has(id) ||
      ctx.conflictJobs.has(id) ||
      ctx.reviewJobs.has(id) ||
      ctx.controllers.has(id) ||
      ctx.controllers.has(`premise:${id}`) ||
      sessionRunning(ctx, id)
    )
      throw new AppError(sm().session.busy, 409);
    const before = await readDiff(run);
    const head = (
      await git(run.worktreePath, ["rev-parse", "HEAD"])
    ).stdout.trim();
    // Reviews and premise checks reserve their controller before taking the run lock.
    // Recheck after reading Git so one that arrived during that I/O cannot overlap this writer.
    if (ctx.controllers.has(id) || ctx.controllers.has(`premise:${id}`))
      throw new AppError(sm().session.busy, 409);
    if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
    const history = [...(run.session?.messages ?? [])];
    addSessionMessage(run, { role: "user", content: text });
    const session = run.session!;
    session.running = true;
    session.startedAt = now();
    session.startingHead = head;
    if (!run.agents.some((agent) => agent.id === "session"))
      run.agents.push({
        id: "session",
        name: sm().session.name,
        role: sm().session.role,
        status: "waiting",
        detail: sm().session.description,
      });
    ctx.log(run, "user", sm().session.requested({ text: text.slice(0, 200) }));
    const controller = new AbortController();
    ctx.controllers.set(`session:${id}`, controller);
    const job = withRunLocale(run, () =>
      runSessionTurn(ctx, run, text, history, before, head, controller),
    )
      .catch((error) => {
        // A final persistence failure is reported without taking down the server.
        log.error("session turn failed", { runId: id, error: String(error) });
      })
      .finally(() => {
        ctx.sessionJobs.delete(id);
        ctx.jobs.delete(job);
      });
    ctx.sessionJobs.set(id, job);
    ctx.jobs.add(job);
    await ctx.store.save();
    return run;
  });
}

/** Stops the running turn; edits made so far stay in the checkout. */
export async function cancelSession(ctx: WorkbenchContext, id: string) {
  const run = ctx.run(id);
  const job = ctx.sessionJobs.get(id);
  if (!job) throw new AppError(sm().session.notRunning, 409);
  ctx.controllers.get(`session:${id}`)?.abort();
  await Promise.allSettled([job]);
  return run;
}

/**
 * Re-reads the diff so reviews, explanations, the draft state and the
 * approval see the edits, and names the paths whose diff moved this turn.
 */
async function finishSessionTurn(
  ctx: WorkbenchContext,
  run: Run,
  before: DiffFile[],
) {
  const files = await ctx.diff(run.id);
  const previous = new Map(before.map((file) => [file.path, file.fingerprint]));
  const changed = files
    .filter((file) => previous.get(file.path) !== file.fingerprint)
    .map((file) => file.path);
  const current = new Set(files.map((file) => file.path));
  for (const file of before)
    if (!current.has(file.path)) changed.push(file.path);
  if (changed.length) run.session!.revision += 1;
  return { changed: changed.sort(), files };
}

/**
 * Puts the agent's validation and limitations updates into the PR text, so what
 * the page and the publish dialog show matches what the turn established.
 * Only those existing separate sections change; the person still reads it before publishing,
 * and both versions are kept in the conversation. Nothing is written when
 * the draft has no such section, the text is unfinished, or it is the same.
 */
function applyDraftCheckUpdates(
  ctx: WorkbenchContext,
  run: Run,
  result: { validation: string; limitations: string },
) {
  const updates = {
    validation: redact(result.validation).trim(),
    limitations: redact(result.limitations).trim(),
  };
  if (
    (!updates.validation && !updates.limitations) ||
    activeFollowUp(run.followUps) ||
    !["review", "approved"].includes(run.status) ||
    Object.values(updates).some((text) => findDraftPlaceholders(text).length)
  )
    return undefined;
  const update = replaceDraftCheckSections(run.draft.body, updates);
  if (!update) return undefined;
  run.draft = { ...run.draft, body: update.body };
  ctx.log(run, "session", sm().session.draftUpdated);
  return { before: update.before, after: update.after };
}

async function runSessionTurn(
  ctx: WorkbenchContext,
  run: Run,
  message: string,
  history: SessionMessage[],
  before: DiffFile[],
  head: string,
  controller: AbortController,
) {
  let temporary: string | undefined;
  let refreshDraft = false;
  const checks: TeamCheck[] = [];
  let changedFiles: string[] = [];
  let succeeded = false;
  try {
    temporary = await mkdtemp(path.join(os.tmpdir(), "bell-session-"));
    const outputSchema = path.join(temporary, "session-schema.json");
    await writeFile(outputSchema, JSON.stringify(sessionJsonSchema), {
      mode: 0o600,
    });
    const answer = await runAgent(
      ctx,
      run,
      "session",
      sessionPrompt({
        boundaries: teamBoundaries(
          currentLocale(),
          run.modelExecution?.agentAccess === "full",
        ),
        contributionContext: contributionContext(run),
        baseBranch: run.baseBranch,
        draft: run.draft,
        changedFiles: before.map(({ path, status, additions, deletions }) => ({
          path,
          status,
          additions,
          deletions,
        })),
        reports: {
          reviewer: run.reports?.reviewer,
          tester: run.reports?.tester,
        },
        history,
        message,
        provider: run.modelExecution?.provider,
        agentAccess: run.modelExecution?.agentAccess,
      }),
      controller.signal,
      false,
      { outputSchema, checks },
    );
    const result = parseSessionResult(answer);
    await ctx.lock(run.id, async () => {
      await restoreAgentHead(run, head);
      // Before the diff is re-read, so an approval of the old text is withdrawn with it.
      const draftUpdate = applyDraftCheckUpdates(ctx, run, result);
      const finished = await finishSessionTurn(ctx, run, before);
      changedFiles = finished.changed;
      addSessionMessage(run, {
        role: "agent",
        content: result.reply,
        ...(changedFiles.length ? { changedFiles } : {}),
        ...(result.questions.length ? { questions: result.questions } : {}),
        // Commands the application saw run, not the agent's own list.
        ...(checks.length ? { checks } : {}),
        ...(result.notRun.length ? { notRun: result.notRun } : {}),
        ...(result.setup.length ? { setup: result.setup } : {}),
        ...(draftUpdate ? { draftUpdate } : {}),
      });
      if (changedFiles.length || checks.length || draftUpdate) {
        markDraftRefreshing(run, finished.files);
        refreshDraft = true;
      }
      succeeded = true;
    });
  } catch (error) {
    await ctx.lock(run.id, async () => {
      const reason = controller.signal.aborted
        ? sm().session.stopped
        : redact(error instanceof Error ? error.message : sm().session.failed);
      await restoreAgentHead(run, head).catch(() => undefined);
      // Edits made before the failure stay; the pages see them like any edit.
      const finished = await finishSessionTurn(ctx, run, before).catch(
        () => undefined,
      );
      changedFiles = finished?.changed ?? [];
      addSessionMessage(run, {
        role: "agent",
        failed: true,
        content: changedFiles.length
          ? sm().session.editsKept({ reason })
          : reason,
        ...(changedFiles.length ? { changedFiles } : {}),
        ...(checks.length ? { checks } : {}),
      });
      if (finished && (changedFiles.length || checks.length)) {
        markDraftRefreshing(run, finished.files);
        refreshDraft = true;
      }
      ctx.log(run, "system", reason);
    });
  } finally {
    // runAgent keeps a non-isolated role's raw answer as a report; the conversation lives in run.session.
    // Drop it before running=false is published, so anything that sees the turn end never reads it.
    delete run.reports?.session;
    const session = run.session;
    if (session) {
      session.running = false;
      delete session.startedAt;
      delete session.startingHead;
    }
    const agent = run.agents.find((value) => value.id === "session");
    if (agent) {
      agent.status = succeeded ? "complete" : "failed";
      agent.detail = succeeded
        ? sm().session.waiting
        : sm().session.interrupted;
    }
    if (ctx.controllers.get(`session:${run.id}`) === controller)
      ctx.controllers.delete(`session:${run.id}`);
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await ctx.store.save();
  }
  if (refreshDraft) refreshAfterSession(ctx, run.id, changedFiles.length > 0);
}

/**
 * The PR suggestion is keyed by the diff, so a turn that only ran checks
 * leaves it looking current while its Limitations are out of date. Marking
 * it as being written now also keeps the page polling until it lands.
 */
function markDraftRefreshing(run: Run, files: DiffFile[]) {
  run.draftPreparation = {
    ...run.draftPreparation,
    status: "generating",
    fingerprint: draftFingerprint(run, files),
  };
  delete run.draftPreparation.error;
}

/**
 * Brings what the pages show up to date with what the turn did: explanations
 * of changed files, and a new PR suggestion that reads the turn's evidence.
 * Both discard their result when the diff moves on, so a quick next turn
 * simply starts them again.
 */
function refreshAfterSession(
  ctx: WorkbenchContext,
  id: string,
  explanations: boolean,
) {
  if (ctx.stopping()) return;
  const job = (async () => {
    // A suggestion already being written read older evidence: let it end, then write another.
    await ctx.draftJobs.get(id)?.catch(() => undefined);
    await Promise.allSettled([
      explanations ? ctx.explanations(id) : undefined,
      ctx.prepareRunDraft(id, { refresh: true }).catch(() => {
        // It never started (a newer turn took over): say so instead of leaving it "generating".
        const preparation = ctx.run(id).draftPreparation;
        if (preparation?.status === "generating" && !ctx.draftJobs.has(id)) {
          preparation.status = "stale";
          preparation.error = sm().session.draftStale;
        }
      }),
    ]);
  })().finally(() => ctx.jobs.delete(job));
  ctx.jobs.add(job);
}
