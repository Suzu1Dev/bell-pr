import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { readDiff } from "./git.js";
import { assertGitConfigSafe, git } from "./process.js";
import { AppError, type Run } from "./types.js";
import { cancelled } from "./i18n/index.js";
import { scopeContains } from "./team.js";
import type { TeamTask } from "../shared/team.js";

/**
 * Checks that a teammate's checkout is still a worktree of the run's
 * repository before any Git command runs in it: its `.git` must be a plain
 * file holding exactly `gitdir: <common>/worktrees/<name>`, and Git's own
 * record of that worktree must point back at it. An agent that rewrote the
 * pointer could otherwise make BELL run Git against another repository.
 */
export async function assertTeammateWorktree(run: Run, worktreePath: string) {
  const forged = () => new AppError((m) => m.security.worktreeForged, 409);
  const common = path.resolve(
    run.worktreePath,
    (
      await git(run.worktreePath, ["rev-parse", "--git-common-dir"])
    ).stdout.trim(),
  );
  const pointerPath = path.join(worktreePath, ".git");
  const metadata = await lstat(pointerPath).catch(() => undefined);
  if (!metadata?.isFile()) throw forged();
  const pointer = /^gitdir: ([^\n]+)\n?$/.exec(
    await readFile(pointerPath, "utf8"),
  )?.[1];
  if (!pointer) throw forged();
  // Git writes a relative pointer when worktree.useRelativePaths is set.
  const target = path.resolve(worktreePath, pointer);
  const name = path.basename(target);
  const canonical = (value: string) => realpath(value).catch(() => undefined);
  const [parent, worktrees] = await Promise.all([
    canonical(path.dirname(target)),
    canonical(path.join(common, "worktrees")),
  ]);
  if (!name || name === "." || name === ".." || !parent || parent !== worktrees)
    throw forged();
  // Git's own record of the worktree points back at this checkout.
  const back = await readFile(path.join(target, "gitdir"), "utf8").catch(
    () => "",
  );
  const [expected, actual] = await Promise.all([
    canonical(pointerPath),
    back.trim()
      ? canonical(path.resolve(target, back.trim()))
      : Promise.resolve(undefined),
  ]);
  if (!expected || expected !== actual) throw forged();
}

/** A temporary Git object captures integrated predecessors without advancing the review branch. */
export async function createTeamSnapshot(
  run: Run,
  directory: string,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new AppError(cancelled(), 409);
  await assertGitConfigSafe(run.worktreePath);
  const files = await readDiff(run);
  if (signal?.aborted) throw new AppError(cancelled(), 409);
  if (!files.length) return run.baseSha;
  if (files.some((file) => file.blocked))
    throw new AppError((m) => m.run.integration.snapshotBlocked, 422);
  const indexPath = path.join(directory, `team-index-${randomUUID()}`);
  const env = {
    ...process.env,
    GIT_INDEX_FILE: indexPath,
    GIT_TERMINAL_PROMPT: "0",
  };
  try {
    await git(run.worktreePath, ["read-tree", run.baseSha], { env, signal });
    await git(
      run.worktreePath,
      ["--literal-pathspecs", "add", "--", ...files.map((file) => file.path)],
      { env, signal },
    );
    const tree = (
      await git(run.worktreePath, ["write-tree"], { env, signal })
    ).stdout.trim();
    return (
      await git(
        run.worktreePath,
        [
          "-c",
          "user.name=BELL PR",
          "-c",
          "user.email=bell-pr@localhost.invalid",
          "commit-tree",
          tree,
          "-p",
          run.baseSha,
        ],
        {
          env,
          signal,
          input: "BELL PR local team snapshot (unpublished)\n",
        },
      )
    ).stdout.trim();
  } finally {
    await rm(indexPath, { force: true });
    await rm(`${indexPath}.lock`, { force: true });
  }
}

/**
 * Drops a teammate's isolated checkout once it is no longer needed: after its
 * patch was integrated, or before a failed task starts over at the same path.
 * Teammates never commit, so the worktree is always dirty and needs --force.
 * Callers hold the repository lock; a directory already deleted by hand only
 * leaves a stale registration, which prune clears.
 */
export async function removeTaskWorktree(run: Run, task: TeamTask) {
  if (!task.worktreePath) return;
  try {
    await git(run.worktreePath, [
      "worktree",
      "remove",
      "--force",
      task.worktreePath,
    ]);
  } catch {
    await rm(task.worktreePath, { recursive: true, force: true });
    await git(run.worktreePath, ["worktree", "prune"]);
  }
  task.worktreeRemoved = true;
}

/**
 * Only a task's declared, reviewable changes may enter the human-review
 * workspace. Returns the repository-relative paths that were applied so the
 * run can record which files each task really changed.
 */
export async function integrateTeamTask(
  run: Run,
  task: TeamTask,
  signal?: AbortSignal,
): Promise<string[]> {
  if (signal?.aborted) throw new AppError(cancelled(), 409);
  if (!task.worktreePath || !task.baseSha)
    throw new AppError((m) => m.run.integration.noWorktree, 422);
  await assertGitConfigSafe(run.worktreePath);
  await assertTeammateWorktree(run, task.worktreePath);
  const head = (
    await git(task.worktreePath, ["rev-parse", "HEAD"], { signal })
  ).stdout.trim();
  if (head !== task.baseSha)
    throw new AppError((m) => m.run.integration.gitStateChanged, 422);
  const files = await readDiff({
    worktreePath: task.worktreePath,
    baseSha: task.baseSha,
  });
  if (signal?.aborted) throw new AppError(cancelled(), 409);
  for (const file of files) {
    if (!task.files.some((scope) => scopeContains(scope, file.path)))
      throw new AppError(
        (m) => m.run.integration.outOfScope({ path: file.path }),
        422,
      );
    if (
      file.blocked ||
      /^(?:old|new|new file|deleted file) mode 120000$/m.test(file.patch)
    )
      throw new AppError(
        (m) => m.run.integration.needsManualHandling({ path: file.path }),
        422,
      );
  }
  if (!files.length) return [];
  const patch = files.map((file) => file.patch).join("\n");
  await git(
    run.worktreePath,
    ["apply", "--check", "--whitespace=nowarn", "-"],
    { input: patch, signal },
  );
  await git(run.worktreePath, ["apply", "--whitespace=nowarn", "-"], {
    input: patch,
    signal,
  });
  return files.map((file) => file.path);
}
