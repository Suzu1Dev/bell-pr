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
import { AppError, type Run } from "./types.js";
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
import { contributionContext, teamBoundaries } from "./prompts/team.js";
import { conflictPrompt } from "./prompts/sync.js";
import { log } from "./log.js";
import type { WorkbenchContext } from "./workbench.js";

const now = () => new Date().toISOString();
const newId = () => randomUUID();
/** A first publish that stopped after making its commit, which may already be on GitHub. */
export const partlyPublished =
  "先前的發佈已建立提交，可能已推送到 GitHub，因此不能再同步或復原同步；請從最新版本建立新工作。";
const unmarkedConflicts = (files: string[]) =>
  `這些檔案的衝突無法用衝突標記表示（一邊刪除、另一邊修改，或兩邊都改了二進位檔），BELL 不會替你選邊：${files.join("、")}。`;
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
  if (ctx.stopping()) throw new AppError("服務正在關閉，請稍後重試。", 503);
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (run.prUrl) return syncPublishedRun(ctx, run);
    if (
      !["review", "approved", "awaiting_plan"].includes(run.status) ||
      run.publishing
    )
      throw new AppError(
        "只有審閱中、已核准或等待計畫核准的工作可以同步到最新目標分支。",
        409,
      );
    if (runBusy(ctx, id))
      throw new AppError(
        "這個工作還有 Agent、審查或解說在進行；請等它完成再同步。",
        409,
      );
    if (run.publishCommit) throw new AppError(partlyPublished, 409);
    const repo = ctx.repo(run.repoId);
    const head = (
      await git(run.worktreePath, ["rev-parse", "HEAD"])
    ).stdout.trim();
    if (head !== run.baseSha)
      throw new AppError("工作分支的提交和記錄的基準不一致，已停止同步。", 409);
    // The last sync's conflicts are tracked only until the next one.
    await assertConflictsResolved(run);
    const target = await ctx.lock(`repository:${repo.id}`, () =>
      fetchBranchCommit(repo, run.baseBranch),
    );
    if (target === run.baseSha) {
      ctx.log(run, "user", `已確認 ${run.baseBranch} 沒有新提交，工作已是最新。`);
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
        `${unmarkedConflicts(unmarked)}工作沒有變動；可以先把這次對它們的修改或刪除還原，同步後再重做。`,
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
      merged.conflicts.length
        ? `已同步到 ${run.baseBranch} 最新版本（${target.slice(0, 7)}），${merged.conflicts.length} 個檔案有衝突需要解決：${merged.conflicts.join("、")}。`
        : `已同步到 ${run.baseBranch} 最新版本（${target.slice(0, 7)}），沒有衝突；改到的檔案需要重新審閱。`,
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
    throw new AppError("只有已送出的 PR 可以同步目標分支。", 409);
  if (activeFollowUp(run.followUps))
    throw new AppError("這個 PR 已有一輪修正在進行；完成或放棄後再同步。", 409);
  if (runBusy(ctx, run.id))
    throw new AppError(
      "這個工作還有 Agent、審查或解說在進行；請等它完成再同步。",
      409,
    );
  const head = (
    await git(run.worktreePath, ["rev-parse", "HEAD"])
  ).stdout.trim();
  if (head !== run.publishCommit || (await worktreeDirty(run)))
    throw new AppError(
      "工作目錄和已推送的 PR 內容不一致；請先還原工作目錄裡的修改再同步。",
      409,
    );
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
    ctx.log(run, "user", `已確認 PR 已包含 ${run.baseBranch} 的最新版本。`);
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
      `${unmarkedConflicts(unmarked)}PR 沒有變動；請在本機用 git 把 ${run.baseBranch} 合併進 PR 分支並推送，BELL 之後會接續這些提交。`,
      409,
    );
  const targetTree = (
    await git(run.worktreePath, ["rev-parse", `${target}^{tree}`])
  ).stdout.trim();
  // An empty round could never be approved, and the PR would change nothing.
  if (merged.tree === targetTree)
    throw new AppError(
      `${run.baseBranch} 已經包含這個 PR 的全部修改，合併後沒有差異，所以沒有同步；PR 沒有變動，可以考慮關閉它。`,
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
    merged.conflicts.length
      ? `已把 ${run.baseBranch} 最新版本（${target.slice(0, 7)}）合併進 PR，${merged.conflicts.length} 個檔案有衝突需要解決：${merged.conflicts.join("、")}。`
      : `已把 ${run.baseBranch} 最新版本（${target.slice(0, 7)}）合併進 PR，沒有衝突；審閱後會推送一個合併 commit。`,
  );
  await ctx.store.save();
  return { run, updated: true, conflicts: merged.conflicts };
}

/** Returns an unpublished run to the checkout and base it had before the last sync. */
export async function undoSync(ctx: WorkbenchContext, id: string) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    const sync = run.sync;
    if (
      !sync ||
      run.prUrl ||
      run.publishing ||
      !["review", "approved", "awaiting_plan"].includes(run.status)
    )
      throw new AppError("目前沒有可以復原的同步。", 409);
    if (runBusy(ctx, id))
      throw new AppError(
        "這個工作還有 Agent、審查或解說在進行；請等它完成再復原。",
        409,
      );
    if (run.publishCommit) throw new AppError(partlyPublished, 409);
    await git(run.worktreePath, ["rev-parse", "--verify", `${sync.snapshot}^{commit}`]);
    const head = (
      await git(run.worktreePath, ["rev-parse", "HEAD"])
    ).stdout.trim();
    if (head !== run.baseSha)
      throw new AppError("工作分支的提交和記錄的基準不一致，已停止復原。", 409);
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
    ctx.log(run, "user", "已復原同步，工作回到同步前的內容與基準。");
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
  if (ctx.stopping()) throw new AppError("服務正在關閉，請稍後重試。", 503);
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    const target = conflictHolder(run);
    if (
      !target ||
      run.publishing ||
      !["review", "approved"].includes(run.status)
    )
      throw new AppError("目前沒有需要解決的同步衝突。", 409);
    const sync = target.holder;
    if (runBusy(ctx, id))
      throw new AppError(
        "這個工作還有 Agent、審查或解說在進行；請等它完成再解衝突。",
        409,
      );
    const open = await filesWithConflictMarkers(run.worktreePath, sync.conflicts);
    if (!open.length)
      throw new AppError("衝突標記都已解決，不需要再請 Agent 處理。", 409);
    if (!run.agents.some((agent) => agent.id === "sync"))
      run.agents.push({
        id: "sync",
        name: "Weave",
        role: "Merge conflicts",
        status: "waiting",
        detail: "解決同步後的合併衝突",
      });
    sync.resolving = true;
    delete sync.report;
    delete sync.resolutions;
    run.status = "running";
    delete run.approvedFingerprint;
    delete run.error;
    ctx.log(run, "user", `要求 Agent 解決 ${open.length} 個檔案的合併衝突：${open.join("、")}。`);
    const controller = new AbortController();
    ctx.controllers.set(id, controller);
    const job = runConflictResolution(
      ctx,
      run,
      open,
      controller,
      sync,
      target.head,
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
  const committedNote =
    "Agent 自行建立了 commit 或切換了分支；已還原，修改保留在工作目錄供你審閱。";
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
        boundaries: teamBoundaries,
        contributionContext: contributionContext(run),
        task: { title: run.title, prompt: run.prompt },
        baseBranch: run.baseBranch,
        conflicts: files,
      }),
      controller.signal,
      false,
      { outputSchema },
    );
    const result = parseConflictResult(answer, files);
    await ctx.lock(run.id, async () => {
      const moved = await restoreSyncHead(run, head);
      const open = await filesWithConflictMarkers(run.worktreePath, holder.conflicts);
      resolved = !open.length;
      holder.report = [
        result.summary,
        moved ? committedNote : "",
        open.length ? `仍有衝突標記：${open.join("、")}。` : "",
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
          ? "Agent 已解決合併衝突，請逐檔審閱這些檔案。"
          : `Agent 處理後仍有衝突標記：${open.join("、")}；可以自行修改，或再請 Agent 處理。`,
      );
    });
  } catch (error) {
    await ctx.lock(run.id, async () => {
      await restoreSyncHead(run, head).catch(() => undefined);
      holder.report = controller.signal.aborted
        ? "已停止解衝突；已改的檔案保留，可以自行完成，或再請 Agent 處理。"
        : `${redact(error instanceof Error ? error.message : "解衝突未完成")}；已改的檔案保留，可以自行完成，或再請 Agent 處理。`;
      await ctx.diff(run.id).catch(() => undefined);
      run.status = "review";
      ctx.log(run, "system", holder.report ?? "解衝突未完成。");
    });
  } finally {
    holder.resolving = false;
    const agent = run.agents.find((value) => value.id === "sync");
    if (agent) {
      agent.status = resolved ? "complete" : "failed";
      agent.detail = resolved ? "衝突已解決，等待審閱" : "仍有衝突或已中斷";
    }
    if (ctx.controllers.get(run.id) === controller)
      ctx.controllers.delete(run.id);
    if (temporary) await rm(temporary, { recursive: true, force: true });
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
    throw new AppError(
      `這些檔案還有合併衝突標記：${open.join("、")}。請先解決衝突（也可以請 Agent 解決）。`,
      409,
    );
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
