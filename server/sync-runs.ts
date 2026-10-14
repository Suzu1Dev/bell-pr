/**
 * Moving a run onto the latest commit of its target branch. An unpublished
 * run is re-based in its checkout and can be undone; a published PR takes
 * the target branch in as a sync round, pushed later as one merge commit.
 * Conflicts stay as markers that block approval and publishing until they
 * are resolved, by hand or by one writable agent whose result the person
 * reviews like any change.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git, redact } from "./process.js";
import { AppError, withRunLocale, type Run } from "./types.js";
import { activeFollowUp, type FollowUpRound } from "../shared/followups.js";
import {
  checkoutTreeOnto,
  conflictJsonSchema,
  conflictsWithoutMarkers,
  filesWithConflictMarkers,
  labelConflictMarkers,
  mergeCommits,
  parseConflictResult,
  snapshotCheckout,
} from "./sync.js";
import { fetchBranchCommit } from "./repositories.js";
import {
  adoptRemoteCommits,
  assertRemoteHead,
  remoteBranchHead,
  restoreAgentHead,
  worktreeDirty,
} from "./pr-branch.js";
import { runAgent } from "./run-executor.js";
import { contributionContext } from "./prompts/team.js";
import { conflictPrompt } from "./prompts/sync.js";
import { log } from "./log.js";
import { logged, parseAgentOutput } from "./run-events.js";
import { currentLocale, shuttingDown, sm } from "./i18n/index.js";
import type { WorkbenchContext } from "./workbench.js";

const now = () => new Date().toISOString();
const newId = () => randomUUID();
/** What a sync records about its conflicts, on a run or on a PR's sync round. */
type ConflictHolder = {
  conflicts: string[];
  unresolved?: string[];
  report?: string;
  resolutions?: { path: string; resolution: string }[];
  resolving?: boolean;
};

/** Agents, reviews, drafts, explanations or questions still working on this run. */
export function runBusy(ctx: WorkbenchContext, id: string) {
  return (
    ctx.followUpJobs.has(id) ||
    ctx.conflictJobs.has(id) ||
    ctx.reviewJobs.has(id) ||
    [...ctx.controllers.keys()].some(
      (key) => key === id || key.endsWith(`:${id}`),
    )
  );
}

/**
 * Moves an unpublished run onto the latest commit of its target branch.
 * The checkout is saved as a local snapshot commit first, then three-way
 * merged with the new base; the result stays uncommitted on top of it, so
 * the person reviews it like any change. Conflicts are left as markers that
 * block approval until resolved, and the sync can be undone.
 */
export async function syncRun(ctx: WorkbenchContext, id: string) {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  return logged("sync", { runId: id }, () => syncRunLocked(ctx, id));
}

async function syncRunLocked(ctx: WorkbenchContext, id: string) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (run.prUrl) return syncPublishedRun(ctx, run);
    if (
      !["review", "approved", "awaiting_plan"].includes(run.status) ||
      run.publishing
    )
      throw new AppError((m) => m.run.sync.notAllowed, 409);
    if (runBusy(ctx, id)) throw new AppError((m) => m.run.sync.busy, 409);
    // A first publish that stopped after its commit, which may be on GitHub.
    if (run.publishCommit)
      throw new AppError((m) => m.run.sync.partlyPublished, 409);
    const repo = ctx.repo(run.repoId);
    const head = (
      await git(run.worktreePath, ["rev-parse", "HEAD"])
    ).stdout.trim();
    if (head !== run.baseSha)
      throw new AppError((m) => m.run.sync.baseMismatch, 409);
    // The last sync's conflicts are tracked only until the next one.
    await assertConflictsResolved(run);
    const target = await ctx.lock(`repository:${repo.id}`, () =>
      fetchBranchCommit(repo, run.baseBranch),
    );
    if (target === run.baseSha) {
      ctx.log(run, "user", sm().run.sync.upToDate({ branch: run.baseBranch }));
      await ctx.store.save();
      return { run, updated: false, conflicts: [] as string[] };
    }
    const snapshot = await snapshotCheckout(
      run.worktreePath,
      path.join(ctx.store.directory, `sync-index-${run.id}`),
    );
    const merged = await mergeCommits(
      run.worktreePath,
      target,
      snapshot,
      run.baseSha,
    );
    const unmarked = await conflictsWithoutMarkers(
      run.worktreePath,
      merged.tree,
      merged.conflicts,
    );
    if (unmarked.length)
      throw new AppError(
        (m) => m.run.sync.unmarkedRun({ files: unmarked }),
        409,
      );
    // Keeps the snapshot reachable for undo, outside every branch.
    await git(run.worktreePath, [
      "update-ref",
      `refs/bellpr/sync/${run.id}`,
      snapshot,
    ]);
    await git(run.worktreePath, [
      "update-ref",
      `refs/heads/${run.branch}`,
      target,
      head,
    ]);
    await checkoutTreeOnto(run.worktreePath, merged.tree, target);
    await labelConflictMarkers(run.worktreePath, merged.conflicts, {
      [target]: `latest ${run.baseBranch} (${target.slice(0, 7)})`,
      [snapshot]: "this contribution",
    });
    run.sync = {
      at: now(),
      from: run.baseSha,
      to: target,
      snapshot,
      conflicts: merged.conflicts,
      reviewedFingerprints: { ...run.reviewedFingerprints },
    };
    run.baseSha = target;
    if (run.status === "approved") run.status = "review";
    delete run.approvedFingerprint;
    await ctx.diff(id);
    ctx.log(
      run,
      "user",
      sm().run.sync.synced({
        branch: run.baseBranch,
        commit: target.slice(0, 7),
        conflicts: merged.conflicts,
      }),
    );
    await ctx.store.save();
    return { run, updated: true, conflicts: merged.conflicts };
  });
}

/**
 * Merges the latest target branch into a published PR as a sync round. The
 * merge result waits in the checkout for review like any round, and goes
 * out as one merge commit on top of the PR head, without force.
 */
async function syncPublishedRun(ctx: WorkbenchContext, run: Run) {
  if (
    run.status !== "published" ||
    run.publishing ||
    !run.publishCommit ||
    !run.headRepository
  )
    throw new AppError((m) => m.run.sync.prOnly, 409);
  if (activeFollowUp(run.followUps))
    throw new AppError((m) => m.run.sync.roundOpen, 409);
  if (runBusy(ctx, run.id)) throw new AppError((m) => m.run.sync.busy, 409);
  const head = (
    await git(run.worktreePath, ["rev-parse", "HEAD"])
  ).stdout.trim();
  if (head !== run.publishCommit || (await worktreeDirty(run)))
    throw new AppError((m) => m.run.sync.prCheckoutDiffers, 409);
  await adoptRemoteCommits(ctx, run);
  assertRemoteHead(run, await remoteBranchHead(run), run.publishCommit);
  const repo = ctx.repo(run.repoId);
  const target = await ctx.lock(`repository:${repo.id}`, () =>
    fetchBranchCommit(repo, run.baseBranch),
  );
  const contained =
    (
      await git(
        run.worktreePath,
        ["merge-base", "--is-ancestor", target, run.publishCommit],
        { allowedCodes: [0, 1] },
      )
    ).code === 0;
  if (contained) {
    ctx.log(run, "user", sm().run.sync.prUpToDate({ branch: run.baseBranch }));
    await ctx.store.save();
    return { run, updated: false, conflicts: [] as string[] };
  }
  const merged = await mergeCommits(run.worktreePath, run.publishCommit, target);
  const unmarked = await conflictsWithoutMarkers(
    run.worktreePath,
    merged.tree,
    merged.conflicts,
  );
  if (unmarked.length)
    throw new AppError(
      (m) =>
        m.run.sync.unmarkedPr({ files: unmarked, branch: run.baseBranch }),
      409,
    );
  const targetTree = (
    await git(run.worktreePath, ["rev-parse", `${target}^{tree}`])
  ).stdout.trim();
  // An empty round could never be approved, and the PR would change nothing.
  if (merged.tree === targetTree)
    throw new AppError(
      (m) => m.run.sync.nothingToMerge({ branch: run.baseBranch }),
      409,
    );
  // HEAD stays at the PR head, the parent of the merge commit. The index
  // holds the target branch, the new base the diff is read from, so files
  // the target added are not taken for files this PR deletes.
  await checkoutTreeOnto(run.worktreePath, merged.tree, target);
  await labelConflictMarkers(run.worktreePath, merged.conflicts, {
    [run.publishCommit]: "this pull request",
    [target]: `latest ${run.baseBranch} (${target.slice(0, 7)})`,
  });
  const round: FollowUpRound = {
    id: newId().slice(0, 8),
    kind: "sync",
    requestedAt: now(),
    feedbackUrls: [],
    status: "review",
    parentCommit: run.publishCommit,
    mergeParent: target,
    previousBase: run.baseSha,
    conflicts: merged.conflicts,
  };
  (run.followUps ??= []).push(round);
  // The PR's diff is now measured from the target branch it contains.
  run.baseSha = target;
  run.draft = {
    ...run.draft,
    commitMessage: `Merge branch '${run.baseBranch}' into ${run.publishedBranch ?? run.branch}`,
  };
  run.status = "review";
  delete run.approvedFingerprint;
  delete run.error;
  await ctx.diff(run.id);
  ctx.log(
    run,
    "user",
    sm().run.sync.prSynced({
      branch: run.baseBranch,
      commit: target.slice(0, 7),
      conflicts: merged.conflicts,
    }),
  );
  await ctx.store.save();
  return { run, updated: true, conflicts: merged.conflicts };
}

/** Returns an unpublished run to the checkout and base it had before the last sync. */
export async function undoSync(ctx: WorkbenchContext, id: string) {
  return logged("sync.undo", { runId: id }, () => undoSyncLocked(ctx, id));
}

async function undoSyncLocked(ctx: WorkbenchContext, id: string) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    const sync = run.sync;
    if (
      !sync ||
      run.prUrl ||
      run.publishing ||
      !["review", "approved", "awaiting_plan"].includes(run.status)
    )
      throw new AppError((m) => m.run.sync.nothingToUndo, 409);
    if (runBusy(ctx, id)) throw new AppError((m) => m.run.sync.busyUndo, 409);
    if (run.publishCommit)
      throw new AppError((m) => m.run.sync.partlyPublished, 409);
    await git(run.worktreePath, ["rev-parse", "--verify", `${sync.snapshot}^{commit}`]);
    const head = (
      await git(run.worktreePath, ["rev-parse", "HEAD"])
    ).stdout.trim();
    if (head !== run.baseSha)
      throw new AppError((m) => m.run.sync.baseMismatchUndo, 409);
    await git(run.worktreePath, [
      "update-ref",
      `refs/heads/${run.branch}`,
      sync.from,
      head,
    ]);
    await checkoutTreeOnto(run.worktreePath, `${sync.snapshot}^{tree}`, sync.from);
    await git(run.worktreePath, ["update-ref", "-d", `refs/bellpr/sync/${run.id}`]);
    run.baseSha = sync.from;
    // Marks come back for files whose diff is the one reviewed before the sync.
    run.reviewedFingerprints = { ...(sync.reviewedFingerprints ?? {}) };
    delete run.sync;
    if (run.status === "approved") run.status = "review";
    delete run.approvedFingerprint;
    await ctx.diff(id);
    ctx.log(run, "user", sm().run.sync.undone);
    await ctx.store.save();
    return run;
  });
}

/**
 * Has one writable agent resolve the conflict markers a sync left in an
 * unpublished run. Whether markers remain is then read from the files; the
 * run returns to review either way, so the person reviews the result.
 */
export async function resolveConflicts(ctx: WorkbenchContext, id: string) {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    const target = conflictHolder(run);
    if (
      !target ||
      run.publishing ||
      !["review", "approved"].includes(run.status)
    )
      throw new AppError((m) => m.run.sync.noConflicts, 409);
    const sync = target.holder;
    if (runBusy(ctx, id))
      throw new AppError((m) => m.run.sync.busyResolve, 409);
    const open = await filesWithConflictMarkers(run.worktreePath, sync.conflicts);
    if (!open.length)
      throw new AppError((m) => m.run.sync.conflictsGone, 409);
    if (!run.agents.some((agent) => agent.id === "sync"))
      run.agents.push({
        id: "sync",
        name: "Weave",
        role: "Merge conflicts",
        status: "waiting",
        detail: sm().run.agents.sync,
      });
    sync.resolving = true;
    delete sync.report;
    delete sync.resolutions;
    run.status = "running";
    delete run.approvedFingerprint;
    delete run.error;
    ctx.log(run, "user", sm().run.sync.resolveRequested({ files: open }));
    const controller = new AbortController();
    ctx.controllers.set(id, controller);
    const job = withRunLocale(run, () =>
      runConflictResolution(ctx, run, open, controller, sync, target.head),
    )
      // Nothing awaits this job until shutdown or cancel; a failed save
      // must not become an unhandled rejection that stops the server.
      .catch((error) =>
        log.error("conflict resolution failed", {
          runId: id,
          error: String(error),
        }),
      )
      .finally(() => {
        ctx.conflictJobs.delete(id);
        ctx.jobs.delete(job);
      });
    ctx.conflictJobs.set(id, job);
    ctx.jobs.add(job);
    await ctx.store.save();
    return run;
  });
}

async function runConflictResolution(
  ctx: WorkbenchContext,
  run: Run,
  files: string[],
  controller: AbortController,
  holder: ConflictHolder,
  head: string,
) {
  let temporary: string | undefined;
  let resolved = false;
  const started = Date.now();
  log.info("sync.resolve.started", { runId: run.id, files: files.length });
  try {
    temporary = await mkdtemp(path.join(os.tmpdir(), "bell-conflicts-"));
    const outputSchema = path.join(temporary, "conflict-schema.json");
    await writeFile(outputSchema, JSON.stringify(conflictJsonSchema), {
      mode: 0o600,
    });
    const answer = await runAgent(
      ctx,
      run,
      "sync",
      conflictPrompt({
        // The run's locale: resolveConflicts runs this job under withRunLocale.
        locale: currentLocale(),
        contributionContext: contributionContext(run),
        task: { title: run.title, prompt: run.prompt },
        baseBranch: run.baseBranch,
        conflicts: files,
      }),
      controller.signal,
      false,
      { outputSchema },
    );
    const result = parseAgentOutput(run, "conflict-resolution", () =>
      parseConflictResult(answer, files),
    );
    await ctx.lock(run.id, async () => {
      const moved = await restoreSyncHead(run, head);
      const open = await filesWithConflictMarkers(run.worktreePath, holder.conflicts);
      resolved = !open.length;
      holder.report = [
        result.summary,
        moved ? sm().run.sync.agentCommitted : "",
        open.length ? sm().run.sync.markersLeft({ files: open }) : "",
      ]
        .filter(Boolean)
        .join("\n");
      holder.resolutions = result.resolutions;
      await ctx.diff(run.id);
      run.status = "review";
      ctx.log(
        run,
        "system",
        resolved
          ? sm().run.sync.resolved
          : sm().run.sync.stillConflicted({ files: open }),
      );
    });
  } catch (error) {
    await ctx.lock(run.id, async () => {
      await restoreSyncHead(run, head).catch(() => undefined);
      holder.report = controller.signal.aborted
        ? sm().run.sync.stopped
        : sm().run.sync.failed({
            reason: redact(
              error instanceof Error
                ? error.message
                : sm().run.sync.incompleteReason,
            ),
          });
      await ctx.diff(run.id).catch(() => undefined);
      run.status = "review";
      ctx.log(run, "system", holder.report ?? sm().run.sync.incomplete);
    });
  } finally {
    holder.resolving = false;
    const agent = run.agents.find((value) => value.id === "sync");
    if (agent) {
      agent.status = resolved ? "complete" : "failed";
      agent.detail = resolved
        ? sm().run.agents.syncResolved
        : sm().run.agents.syncUnresolved;
    }
    if (ctx.controllers.get(run.id) === controller)
      ctx.controllers.delete(run.id);
    if (temporary) await rm(temporary, { recursive: true, force: true });
    (resolved ? log.info : log.warn)(
      resolved ? "sync.resolve.finished" : "sync.resolve.failed",
      {
        runId: run.id,
        cancelled: controller.signal.aborted,
        durationMs: Date.now() - started,
      },
    );
    await ctx.store.save();
  }
}

/**
 * Puts HEAD back after a conflict agent moved it. The index returns to the
 * base the diff is read from, which for a PR's sync round is not HEAD.
 */
async function restoreSyncHead(run: Run, head: string) {
  const moved = await restoreAgentHead(run, head);
  if (moved) await git(run.worktreePath, ["read-tree", run.baseSha]);
  return moved;
}

/**
 * The sync whose conflicts are open: an unpublished run's, or a published
 * PR's sync round, with the commit its checkout must sit on.
 */
function conflictHolder(
  run: Run,
): { holder: ConflictHolder; head: string } | undefined {
  if (!run.prUrl)
    return run.sync ? { holder: run.sync, head: run.baseSha } : undefined;
  const round = activeFollowUp(run.followUps);
  return round?.kind === "sync" && round.conflicts
    ? { holder: round as ConflictHolder, head: round.parentCommit }
    : undefined;
}

/** Approval and publishing wait until a sync's conflicts are resolved. */
export async function assertConflictsResolved(run: Run) {
  const conflicts = conflictHolder(run)?.holder.conflicts ?? [];
  const open = conflicts.length
    ? await filesWithConflictMarkers(run.worktreePath, conflicts)
    : [];
  if (open.length)
    throw new AppError((m) => m.run.sync.conflictsOpen({ files: open }), 409);
}

/** Lets the page show which conflicts are left after edits outside BELL. */
export async function refreshConflicts(run: Run) {
  const conflict = conflictHolder(run);
  if (conflict)
    conflict.holder.unresolved = await filesWithConflictMarkers(
      run.worktreePath,
      conflict.holder.conflicts,
    );
}
