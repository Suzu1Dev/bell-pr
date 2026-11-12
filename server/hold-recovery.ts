/**
 * Recovering a run whose write turn stopped on someone else's hold
 * (docs/design/collab-write-guard.md, S2):
 *
 * - `restoreHeldPaths` ("Put these files back") restores only the checkout
 *   paths that meet someone else's active hold or the run's recorded
 *   `heldPaths` back to the run's review base tree, leaving non-conflicting
 *   edits untouched.
 * - `recheckHeldPaths` ("Check again") re-evaluates the checkout's changed
 *   paths against current holds without modifying any checkout files,
 *   returning 409 `heldByOther` while conflicts remain and clearing the
 *   hold-stop state once free.
 */
import { lstat, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { activeFollowUp, reviewBaseSha } from "../shared/followups.js";
import { assertWorkspacePresent } from "./cleanup.js";
import { safeRelativePath } from "./git.js";
import {
  changedScopes,
  heldByOtherError,
  heldByOtherKind,
  heldNotice,
  isTurnHeldByOtherMessage,
  type HoldsAsker,
} from "./hold-guard.js";
import { shuttingDown, sm } from "./i18n/index.js";
import { assertGitConfigSafe, git } from "./process.js";
import { logged } from "./run-events.js";
import { baseScopePath, comparablePath, pathsMeet } from "./scope-paths.js";
import { AppError, type DiffFile, type Run } from "./types.js";
import { walkthroughKeyPrefix } from "./walkthroughs.js";
import type { WorkbenchContext } from "./workbench-context.js";

function sessionRunning(ctx: WorkbenchContext, id: string) {
  return ctx.controllers.has(`session:${id}`) || ctx.sessionJobs.has(id);
}

/**
 * Checkout writers and checkout-reading checks that must finish before
 * restoring or rechecking held files. Isolated read-only background jobs
 * (`walkthrough:*:${id}`, `draft:${id}`, `explanations:${id}`) never write
 * `run.worktreePath` and check diff fingerprints before saving, so recovery
 * right after a session turn (`refreshAfterSession`) does not hit a 409.
 */
function holdRecoveryBusy(ctx: WorkbenchContext, id: string) {
  if (
    ctx.followUpJobs.has(id) ||
    ctx.conflictJobs.has(id) ||
    ctx.reviewJobs.has(id) ||
    sessionRunning(ctx, id)
  )
    return true;
  const backgroundReadOnly = new Set([`draft:${id}`, `explanations:${id}`]);
  return [...ctx.controllers.keys()].some(
    (key) =>
      (key === id || key.endsWith(`:${id}`)) &&
      !key.startsWith(walkthroughKeyPrefix) &&
      !backgroundReadOnly.has(key),
  );
}

/**
 * A turn that just recorded its stop may still be finishing its final
 * temp-folder cleanup and store save outside the run lock before `.finally()`
 * clears its job map entry.
 */
async function awaitSettledTurnCleanup(
  ctx: WorkbenchContext,
  id: string,
  asker?: HoldsAsker,
) {
  const run = ctx.run(id);
  ctx.holds?.assertAsker?.(run, asker);
  if (!run.sync?.resolving && !run.followUps?.some((round) => round.resolving)) {
    await ctx.conflictJobs.get(id)?.catch(() => undefined);
  }
  if (run.followUps?.at(-1)?.status !== "running") {
    await ctx.followUpJobs.get(id)?.catch(() => undefined);
  }
  if (!run.session?.running) {
    await ctx.sessionJobs.get(id)?.catch(() => undefined);
  }
}

async function assertHoldRecoveryReady(
  ctx: WorkbenchContext,
  id: string,
  asker?: HoldsAsker,
): Promise<{ run: Run; base: string; realRoot: string }> {
  const run = ctx.run(id);
  // Group caller and group liveness come first, before inspecting or touching the checkout.
  ctx.holds?.assertAsker?.(run, asker);
  ctx.holds?.conflicts(run, []);
  assertWorkspacePresent(run);
  const merged =
    run.prFeedback?.merged === true ||
    run.prFeedback?.prState?.toUpperCase() === "MERGED";
  const openRound = activeFollowUp(run.followUps);
  const allowedStatus =
    ["review", "approved", "failed"].includes(run.status) ||
    (run.status === "published" && Boolean(openRound));
  if (merged || !allowedStatus || (!run.prUrl && Boolean(run.publishCommit)))
    throw new AppError((m) => m.run.local.holdRecoveryNotAllowed, 409);
  if (run.publishing || run.session?.running || holdRecoveryBusy(ctx, id))
    throw new AppError((m) => m.run.local.holdRecoveryBusy, 409);
  const base = reviewBaseSha(run);
  if (!base || !run.worktreePath)
    throw new AppError((m) => m.run.local.holdRecoveryCheckoutMissing, 409);
  const rootInfo = await lstat(run.worktreePath).catch(() => undefined);
  if (rootInfo?.isSymbolicLink())
    throw new AppError((m) => m.run.diff.outsideWorktree, 422);
  if (!rootInfo?.isDirectory())
    throw new AppError((m) => m.run.local.holdRecoveryCheckoutMissing, 409);
  const realRoot = await realpath(run.worktreePath);
  await assertGitConfigSafe(run.worktreePath);
  await git(run.worktreePath, ["rev-parse", "--verify", `${base}^{commit}`]).catch(() => {
    throw new AppError((m) => m.run.local.holdRecoveryCheckoutMissing, 409);
  });
  if (holdRecoveryBusy(ctx, id))
    throw new AppError((m) => m.run.local.holdRecoveryBusy, 409);
  return { run, base, realRoot };
}

/**
 * Every path in `worktreePath` that differs from `base` in the working tree,
 * the staged index, or untracked files (`--no-renames` so both sides of a
 * rename are included).
 */
async function allCheckoutChanges(worktreePath: string, base: string): Promise<string[]> {
  const names = (output: string) => output.split("\0").filter(Boolean);
  const common = ["--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z"];
  const [wt, cached, untracked] = await Promise.all([
    git(worktreePath, ["diff", ...common, base, "--"]),
    git(worktreePath, ["diff", "--cached", ...common, base, "--"]),
    git(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return [
    ...new Set([
      ...names(wt.stdout),
      ...names(cached.stdout),
      ...names(untracked.stdout),
    ]),
  ].sort();
}

async function assertDirectoryEntriesTargeted(
  worktreePath: string,
  realRoot: string,
  dirPath: string,
  targetSet: ReadonlySet<string>,
): Promise<void> {
  const entries = await readdir(dirPath);
  for (const name of entries) {
    const child = path.join(dirPath, name);
    const info = await lstat(child);
    if (info.isSymbolicLink())
      throw new AppError((m) => m.run.diff.outsideWorktree, 422);
    const resolved = await realpath(child);
    if (!resolved.startsWith(realRoot + path.sep))
      throw new AppError((m) => m.run.diff.outsideWorktree, 422);
    if (info.isDirectory()) {
      await assertDirectoryEntriesTargeted(worktreePath, realRoot, child, targetSet);
    } else if (info.isFile()) {
      const rel = path.relative(worktreePath, child).split(path.sep).join("/");
      if (!targetSet.has(rel))
        throw new AppError((m) => m.run.diff.outsideWorktree, 422);
    } else {
      throw new AppError((m) => m.run.diff.outsideWorktree, 422);
    }
  }
}

/**
 * Refuses path traversal, `.git` / prototype segments, and symbolic links at
 * or above `relPath` before any checkout file or index entry is touched.
 */
async function assertPathBoundarySafe(
  worktreePath: string,
  realRoot: string,
  relPath: string,
  targetSet: ReadonlySet<string>,
): Promise<void> {
  if (!safeRelativePath(relPath))
    throw new AppError((m) => m.run.diff.outsideWorktree, 422);
  const parts = relPath.split("/");
  let current = worktreePath;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    const info = await lstat(current).catch(() => undefined);
    if (!info) break;
    if (info.isSymbolicLink())
      throw new AppError((m) => m.run.diff.outsideWorktree, 422);
    if (info.isDirectory()) {
      const resolved = await realpath(current);
      if (!resolved.startsWith(realRoot + path.sep))
        throw new AppError((m) => m.run.diff.outsideWorktree, 422);
    }
  }
  const fullPath = path.join(worktreePath, relPath);
  const leaf = await lstat(fullPath).catch(() => undefined);
  if (!leaf) return;
  if (leaf.isSymbolicLink())
    throw new AppError((m) => m.run.diff.outsideWorktree, 422);
  const resolved = await realpath(fullPath);
  if (!resolved.startsWith(realRoot + path.sep))
    throw new AppError((m) => m.run.diff.outsideWorktree, 422);
  if (leaf.isDirectory()) {
    await assertDirectoryEntriesTargeted(worktreePath, realRoot, fullPath, targetSet);
  } else if (!leaf.isFile()) {
    throw new AppError((m) => m.run.diff.outsideWorktree, 422);
  }
}

async function classifyBaseTargets(
  worktreePath: string,
  base: string,
  targets: readonly string[],
): Promise<{ inBase: string[]; notInBase: string[] }> {
  if (!targets.length) return { inBase: [], notInBase: [] };
  const listed = await git(worktreePath, [
    "--literal-pathspecs",
    "ls-tree",
    "-z",
    base,
    "--",
    ...targets,
  ]);
  const byPath = new Map<string, { mode: string; type: string }>();
  for (const record of listed.stdout.split("\0").filter(Boolean)) {
    const match = /^([0-7]+) ([a-z]+) [a-f0-9]+\t([\s\S]+)$/.exec(record);
    if (match) byPath.set(match[3], { mode: match[1], type: match[2] });
  }
  const inBase: string[] = [];
  const notInBase: string[] = [];
  for (const relPath of targets) {
    const entry = byPath.get(relPath);
    if (!entry || entry.mode === "040000") {
      notInBase.push(relPath);
    } else if ((entry.mode === "100644" || entry.mode === "100755") && entry.type === "blob") {
      inBase.push(relPath);
    } else {
      // Refuses committing or restoring symbolic links (120000) or submodules (160000).
      throw new AppError((m) => m.run.diff.outsideWorktree, 422);
    }
  }
  return { inBase, notInBase };
}

async function pruneEmptyParents(worktreePath: string, startDir: string) {
  const root = path.resolve(worktreePath);
  let dir = path.resolve(startDir);
  while (dir !== root && dir.startsWith(root + path.sep)) {
    const entries = await readdir(dir).catch(() => ["keep"]);
    if (entries.length) break;
    const removed = await rmdir(dir).then(
      () => true,
      () => false,
    );
    if (!removed) break;
    dir = path.dirname(dir);
  }
}

function clearHoldStopState(run: Run, files: readonly DiffFile[], changedDiff: boolean) {
  const round = activeFollowUp(run.followUps);
  const hadHoldStop =
    Boolean(run.heldPaths?.length) ||
    isTurnHeldByOtherMessage(run.error) ||
    isTurnHeldByOtherMessage(round?.error) ||
    isTurnHeldByOtherMessage(run.sync?.report) ||
    (round?.kind === "sync" && isTurnHeldByOtherMessage(round.report));

  delete run.heldPaths;
  if (isTurnHeldByOtherMessage(run.error)) delete run.error;
  if (round && isTurnHeldByOtherMessage(round.error)) delete round.error;
  if (run.sync && isTurnHeldByOtherMessage(run.sync.report)) delete run.sync.report;
  if (round?.kind === "sync" && isTurnHeldByOtherMessage(round.report)) delete round.report;

  const hasReviewableChanges = files.some((file) => !file.blocked);
  const teamIncomplete = Boolean(
    run.team &&
      (!run.team.tasks.length || run.team.tasks.some((task) => task.status !== "complete")),
  );
  // Only a run that a hold stopped goes back to review: any other failure keeps its status.
  if (hadHoldStop && run.status === "failed" && !teamIncomplete && hasReviewableChanges) {
    run.status = "review";
    if (run.team) run.team.phase = "complete";
    delete run.approvedFingerprint;
  } else if ((hadHoldStop || changedDiff) && run.status === "approved") {
    run.status = "review";
    delete run.approvedFingerprint;
  }
}

export async function restoreHeldPaths(
  ctx: WorkbenchContext,
  id: string,
  asker?: HoldsAsker,
): Promise<{ run: Run; restored: string[] }> {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  return logged("holds.restore", { runId: id }, async () => {
    await awaitSettledTurnCleanup(ctx, id, asker);
    return ctx.lock(id, async () => {
      const { run, base, realRoot } = await assertHoldRecoveryReady(ctx, id, asker);
      const recorded = run.heldPaths ?? [];
      const allChanged = await allCheckoutChanges(run.worktreePath, base);
      const activePaths = new Set(
        (ctx.holds?.conflicts(run, allChanged) ?? []).map(({ path: heldPath }) => heldPath),
      );
      const matchesRecorded = (candidate: string) =>
        recorded.some(
          (scope) =>
            scope === candidate ||
            (comparablePath(scope) && comparablePath(candidate) && pathsMeet(scope, candidate)),
        );
      // Only what the run page listed is put back: a file that came under a hold later is
      // recorded by the check below and answered 409, so the person confirms it first.
      const targets = allChanged.filter((candidate) =>
        recorded.length ? matchesRecorded(candidate) : activePaths.has(candidate),
      );
      const targetSet = new Set(targets);
      for (const candidate of new Set([...targets, ...recorded])) {
        await assertPathBoundarySafe(run.worktreePath, realRoot, candidate, targetSet);
      }
      const { inBase, notInBase } = await classifyBaseTargets(run.worktreePath, base, targets);

      if (notInBase.length) {
        await git(run.worktreePath, [
          "--literal-pathspecs",
          "rm",
          "-f",
          "--cached",
          "--ignore-unmatch",
          "--",
          ...notInBase,
        ]);
        for (const relPath of notInBase) {
          const fullPath = path.join(run.worktreePath, relPath);
          const info = await lstat(fullPath).catch(() => undefined);
          if (info?.isFile()) {
            await unlink(fullPath);
            await pruneEmptyParents(run.worktreePath, path.dirname(fullPath));
          }
        }
      }
      if (inBase.length) {
        for (const relPath of inBase) {
          const fullPath = path.join(run.worktreePath, relPath);
          const info = await lstat(fullPath).catch(() => undefined);
          if (info?.isDirectory()) await rmdir(fullPath);
        }
        await git(run.worktreePath, ["--literal-pathspecs", "checkout", base, "--", ...inBase]);
      }

      const files = await ctx.diff(id);
      const remainingChanges = await allCheckoutChanges(run.worktreePath, base);
      const remaining = ctx.holds?.conflicts(run, remainingChanges) ?? [];
      const restoredNotice = sm().run.local.heldPathsRestored({ files: targets });
      if (remaining.length && heldByOtherKind === "block") {
        run.heldPaths = [...new Set(remaining.map(({ path: heldPath }) => heldPath))];
        // What was put back stays on record while other files wait to be confirmed.
        if (targets.length) ctx.log(run, "system", restoredNotice, { kind: "notice" });
        await ctx.store.save();
        throw heldByOtherError("turn", remaining);
      }
      if (remaining.length) ctx.log(run, "system", heldNotice(remaining), { kind: "notice" });
      clearHoldStopState(run, files, targets.length > 0);
      ctx.log(run, "system", restoredNotice, { kind: "notice" });
      await ctx.store.save();
      return { run, restored: targets };
    });
  });
}

export async function recheckHeldPaths(
  ctx: WorkbenchContext,
  id: string,
  asker?: HoldsAsker,
): Promise<{ run: Run }> {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  return logged("holds.recheck", { runId: id }, async () => {
    await awaitSettledTurnCleanup(ctx, id, asker);
    return ctx.lock(id, async () => {
      const { run, base } = await assertHoldRecoveryReady(ctx, id, asker);
      const allPaths = await allCheckoutChanges(run.worktreePath, base);
      const fineScopes = await changedScopes(run);
      const covered = new Set(fineScopes.map((scope) => baseScopePath(scope)));
      const scopes = [...fineScopes, ...allPaths.filter((p) => !covered.has(p))];
      const held = ctx.holds?.conflicts(run, scopes) ?? [];
      if (held.length && heldByOtherKind === "block") {
        run.heldPaths = [...new Set(held.map(({ path: heldPath }) => heldPath))];
        await ctx.store.save();
        throw heldByOtherError("turn", held);
      }
      const files = await ctx.diff(id);
      if (held.length) ctx.log(run, "system", heldNotice(held), { kind: "notice" });
      clearHoldStopState(run, files, false);
      ctx.log(run, "system", sm().run.local.heldPathsRechecked, { kind: "notice" });
      await ctx.store.save();
      return { run };
    });
  });
}
