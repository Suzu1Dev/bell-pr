/**
 * The repositories BELL works on: importing a GitHub clone or a local
 * checkout, updating BELL's own clone, the latest commit of a branch, and
 * the Git worktree each run works in.
 */
import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { command, git } from "./process.js";
import { parseGitHubSource } from "./git.js";
import { AppError, type Repository, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

const now = () => new Date().toISOString();
const newId = () => randomUUID();
const json = <T>(value: string) => JSON.parse(value) as T;
/** Git network options: credentials come from gh, and local file and ext transports are refused. */
export const networkConfig = [
  "-c",
  "credential.helper=",
  "-c",
  "credential.helper=!gh auth git-credential",
  "-c",
  "protocol.file.allow=never",
  "-c",
  "protocol.ext.allow=never",
];

export async function importRepository(
  ctx: WorkbenchContext,
  source: string,
) {
  return ctx.lock("imports", async () => {
    const github = parseGitHubSource(source);
    let repositoryPath: string;
    let metadata:
      | {
          defaultBranchRef?: { name: string };
          primaryLanguage?: { name: string };
        }
      | undefined;
    if (github) {
      const existing = ctx.store.data.repos.find(
        (repo) =>
          repo.fullName.toLowerCase() === github.fullName.toLowerCase(),
      );
      if (existing) return existing;
      const root = path.join(ctx.store.directory, "repositories");
      await mkdir(root, { recursive: true, mode: 0o700 });
      repositoryPath = path.join(
        root,
        `${github.owner}-${github.name}-${newId().slice(0, 8)}`,
      );
      await git(
        root,
        [
          ...networkConfig,
          "clone",
          "--no-recurse-submodules",
          "--",
          `${github.url}.git`,
          repositoryPath,
        ],
        { timeoutMs: 180_000, maxBytes: 1_000_000 },
      );
      try {
        metadata = json(
          (
            await command(
              "gh",
              [
                "repo",
                "view",
                github.fullName,
                "--json",
                "defaultBranchRef,primaryLanguage",
              ],
              { timeoutMs: 20_000 },
            )
          ).stdout,
        );
      } catch {
        /* Git works for public repositories without GitHub authentication. */
      }
    } else {
      if (!path.isAbsolute(source))
        throw new AppError(
          "請輸入 GitHub HTTPS URL 或本機 Repository 的絕對路徑。",
        );
      repositoryPath = await realpath(source);
      const root = (
        await git(repositoryPath, ["rev-parse", "--show-toplevel"])
      ).stdout.trim();
      repositoryPath = await realpath(root);
    }
    const existing = ctx.store.data.repos.find(
      (repo) => repo.path === repositoryPath,
    );
    if (existing) return existing;
    const isBare = (
      await git(repositoryPath, ["rev-parse", "--is-bare-repository"])
    ).stdout.trim();
    if (isBare === "true")
      throw new AppError("請選擇有工作目錄的 Repository。");
    await git(repositoryPath, ["rev-parse", "--verify", "HEAD"]);
    let remote = github;
    if (!remote) {
      try {
        remote = parseGitHubSource(
          (
            await git(repositoryPath, ["remote", "get-url", "origin"])
          ).stdout.trim(),
        );
      } catch {
        /* A local-only repository may have no origin. */
      }
    }
    let defaultBranch = metadata?.defaultBranchRef?.name;
    if (!defaultBranch) {
      try {
        defaultBranch = (
          await git(repositoryPath, [
            "symbolic-ref",
            "--short",
            "refs/remotes/origin/HEAD",
          ])
        ).stdout
          .trim()
          .replace(/^origin\//, "");
      } catch {
        defaultBranch = (
          await git(repositoryPath, ["symbolic-ref", "--short", "HEAD"])
        ).stdout.trim();
      }
    }
    await git(repositoryPath, [
      "check-ref-format",
      "--branch",
      defaultBranch,
    ]);
    const name = remote?.name ?? path.basename(repositoryPath);
    const repo: Repository = {
      id: newId(),
      name,
      owner: remote?.owner ?? "local",
      fullName: remote?.fullName ?? `local/${name}`,
      path: repositoryPath,
      defaultBranch,
      url: remote?.url ?? "",
      language: metadata?.primaryLanguage?.name,
    };
    ctx.store.data.repos.unshift(repo);
    await ctx.store.save();
    return repo;
  });
}

/**
 * BELL's own clone of a GitHub repository, which it may update. A local
 * import is the person's checkout and is never changed.
 */
export function managedClone(directory: string, repo: Repository) {
  return (
    !!repo.url &&
    repo.path.startsWith(path.join(directory, "repositories") + path.sep)
  );
}

/**
 * The latest commit of `branch`: fetched from GitHub, or the local branch
 * for a repository without one. FETCH_HEAD is shared by the clone, so
 * callers hold the repository lock.
 */
export async function fetchBranchCommit(
  repo: Repository,
  branch: string,
  signal?: AbortSignal,
) {
  if (!repo.url)
    return (
      await git(
        repo.path,
        ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`],
        { signal },
      )
    ).stdout.trim();
  await git(
    repo.path,
    [
      ...networkConfig,
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      `${repo.url}.git`,
      `refs/heads/${branch}`,
    ],
    { signal, timeoutMs: 120_000 },
  );
  return (
    await git(repo.path, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"], {
      signal,
    })
  ).stdout.trim();
}

/**
 * Moves BELL's clone to the latest default branch, so the project overview
 * and analysis describe the current project. New runs fetch the latest
 * base on their own; existing runs keep their worktrees.
 */
export async function updateRepository(ctx: WorkbenchContext, id: string) {
  const repo = ctx.repo(id);
  if (!managedClone(ctx.store.directory, repo))
    throw new AppError(
      "這是你本機的 repository，BELL 不會更動它；請在終端機自行 git pull 後再重新分析。",
      409,
    );
  return ctx.lock(`repository:${repo.id}`, async () => {
    const from = (
      await git(repo.path, ["rev-parse", "--verify", "HEAD"])
    ).stdout.trim();
    const to = await fetchBranchCommit(repo, repo.defaultBranch);
    if (
      (
        await git(repo.path, [
          "status",
          "--porcelain",
          "--untracked-files=no",
        ])
      ).stdout.trim()
    )
      throw new AppError(
        "BELL 的專案副本有未預期的修改，已停止更新；請檢查後再試。",
        409,
      );
    if (from !== to)
      // An ignored local file in the way stops the update instead of being overwritten.
      await git(repo.path, [
        "checkout",
        "-q",
        "--no-overwrite-ignore",
        "-B",
        repo.defaultBranch,
        to,
      ]);
    repo.updatedAt = now();
    await ctx.store.save();
    return { repo, from, to, updated: from !== to };
  });
}

/**
 * Pins the run's base commit, fetched from GitHub when the repository has a
 * remote, and adds the run's worktree on its own branch. The caller holds the
 * repository lock.
 */
export async function createRunWorktree(
  run: Run,
  repo: Repository,
  signal: AbortSignal,
) {
  run.baseSha = await fetchBranchCommit(repo, run.baseBranch, signal);
  await mkdir(path.dirname(run.worktreePath), {
    recursive: true,
    mode: 0o700,
  });
  await git(
    repo.path,
    [
      "worktree",
      "add",
      "-b",
      run.branch,
      run.worktreePath,
      run.baseSha,
    ],
    { signal, timeoutMs: 60_000 },
  );
}
