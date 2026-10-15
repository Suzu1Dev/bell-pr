/**
 * The repositories BELL works on: importing a GitHub clone or a local
 * checkout, updating BELL's own clone, the latest commit of a branch, and
 * the Git worktree each run works in.
 */
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { command, git, gitNetwork } from "./process.js";
import {
  assertRefName,
  normalizeRepositorySource,
  parseGitHubSource,
} from "./git.js";
import { setupError } from "./cli-errors.js";
import { AppError, type Repository, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";
import { log } from "./log.js";
import { refreshRepositoryRules } from "./contribution-facts.js";

const now = () => new Date().toISOString();
const newId = () => randomUUID();
const json = <T>(value: string) => JSON.parse(value) as T;
/** How long a GitHub clone may take before the import gives up. */
const cloneTimeoutMs = 600_000;
/**
 * The folder name of BELL's clone of a local checkout. It starts with a
 * digest of the checkout's path, so importing the same checkout again finds
 * the clone made before.
 */
function localClonePrefix(sourcePath: string) {
  const name = path.basename(sourcePath).replace(/[^A-Za-z0-9._-]/g, "_");
  const digest = createHash("sha256").update(sourcePath).digest("hex");
  return `local-${name.slice(0, 40)}-${digest.slice(0, 12)}-`;
}

/**
 * Clones a local checkout into BELL's data directory, so runs never add
 * worktrees or branches to the person's own repository. Only commits are
 * copied (no hard links, no submodules, none of the checkout's hooks or
 * configuration). Every local branch comes along, so a run can start from
 * any of them. With a GitHub origin the clone's origin becomes that GitHub
 * repository; without one the clone keeps no remote at all.
 */
async function cloneLocalCheckout(
  sourcePath: string,
  destination: string,
  remoteUrl: string | undefined,
) {
  await git(
    path.dirname(destination),
    [
      "clone",
      "--no-hardlinks",
      "--no-recurse-submodules",
      "--quiet",
      "--",
      sourcePath,
      destination,
    ],
    { timeoutMs: 180_000, maxBytes: 1_000_000 },
  );
  try {
    const head = (
      await git(destination, ["symbolic-ref", "-q", "--short", "HEAD"], {
        allowedCodes: [0, 1],
      })
    ).stdout.trim();
    // One update for every branch the checkout has besides the one cloned.
    const updates = (
      await git(destination, [
        "for-each-ref",
        "--format=%(objectname) %(refname:strip=3)",
        "refs/remotes/origin/",
      ])
    ).stdout
      .split("\n")
      .map((line) => /^([0-9a-f]{40,64}) (.+)$/.exec(line.trim()))
      .filter(
        (match): match is RegExpExecArray =>
          !!match && match[2] !== "HEAD" && match[2] !== head,
      )
      .map(([, commit, branch]) => `create refs/heads/${branch} ${commit}\n`);
    if (updates.length)
      await git(destination, ["update-ref", "--stdin"], {
        input: updates.join(""),
      });
    if (remoteUrl)
      await git(destination, ["remote", "set-url", "origin", `${remoteUrl}.git`]);
    else await git(destination, ["remote", "remove", "origin"]);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Clones a GitHub repository in full. A partial clone (`--filter`) would
 * fetch old file contents later through plain git, without gh's
 * credentials (private repositories fail) and from sandboxed agents that
 * have no network (`git log -p` and `git blame` fail). A clone that takes
 * longer than `timeoutMs` stops with 504 `clone_timeout`, whose advice is
 * to clone it yourself and import the path; a failed clone leaves nothing
 * behind.
 */
export async function cloneGitHubRepository(
  root: string,
  url: string,
  destination: string,
  timeoutMs = cloneTimeoutMs,
) {
  try {
    await gitNetwork(
      root,
      [
        "clone",
        "--no-recurse-submodules",
        "--",
        `${url}.git`,
        destination,
      ],
      { timeoutMs, maxBytes: 1_000_000 },
    );
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    // command() stops a command that runs too long with a 504.
    if (error instanceof AppError && error.statusCode === 504 && !error.code)
      throw setupError("clone_timeout", 504, { url, cause: error });
    throw error;
  }
}

/** The settings that make a clone partial; `--get-regexp` lower-cases keys. */
const partialCloneSettings =
  "^(remote\\..+\\.(promisor|partialclonefilter)|extensions\\.partialclone)$";
/** Clones this process already tried to complete, so a failure is not retried on every run. */
const completionTried = new Set<string>();

/**
 * 1.0.0-beta.0 builds cloned GitHub projects partially
 * (`--filter=blob:none`), so Git fetched old file contents on demand
 * through plain git: without gh's credentials, and not at all from a
 * sandboxed agent. Such a clone fetches every object once, by URL through
 * gh, and stops being partial. If something is still missing (a branch of
 * BELL's that GitHub no longer has), the settings go back, so Git can still
 * fetch it on demand. A failure leaves the clone as it was. The caller
 * holds the repository lock.
 */
export async function completePartialClone(
  ctx: WorkbenchContext,
  repo: Repository,
  signal?: AbortSignal,
) {
  if (!managedClone(ctx.store.directory, repo) || completionTried.has(repo.path))
    return;
  const listed = (
    await git(repo.path, ["config", "--local", "--get-regexp", partialCloneSettings], {
      allowedCodes: [0, 1],
      signal,
    })
  ).stdout.trim();
  if (!listed || !parseGitHubSource(repo.url)) return;
  completionTried.add(repo.path);
  const settings = listed.split("\n").map((line) => {
    const space = line.indexOf(" ");
    return space < 0 ? [line, ""] : [line.slice(0, space), line.slice(space + 1)];
  });
  const unsetAll = async () => {
    for (const key of new Set(settings.map(([key]) => key)))
      await git(repo.path, ["config", "--local", "--unset-all", key], {
        allowedCodes: [0, 5],
      });
  };
  let changed = false;
  let partial = true;
  try {
    await gitNetwork(
      repo.path,
      [
        "fetch",
        "--refetch",
        "--prune",
        "--no-tags",
        "--no-recurse-submodules",
        `${repo.url}.git`,
        "+refs/heads/*:refs/remotes/origin/*",
      ],
      { signal, timeoutMs: cloneTimeoutMs },
    );
    changed = true;
    await unsetAll();
    // Without the settings, a missing object fails here instead of being fetched.
    partial =
      (
        await git(repo.path, ["rev-list", "--objects", "--all", "--quiet"], {
          allowedCodes: [0, 128],
          timeoutMs: cloneTimeoutMs,
          signal,
        })
      ).code !== 0;
    if (partial) log.warn("repo.clone_left_partial", { repoId: repo.id });
    else log.info("repo.clone_completed", { repoId: repo.id });
  } catch (error) {
    if (signal?.aborted) {
      completionTried.delete(repo.path);
      throw error;
    }
    log.warn("repo.clone_completion_failed", { repoId: repo.id, error });
  } finally {
    // Unless every object is here, Git keeps fetching on demand.
    if (changed && partial) {
      await unsetAll();
      for (const [key, value] of settings)
        await git(repo.path, ["config", "--local", "--add", key, value]);
    }
  }
}

/**
 * The real path of the local folder `source` names. A path that does not
 * exist or is not a folder is a mistake in the input (400), not a failure.
 */
async function localFolder(source: string) {
  try {
    const folder = await realpath(source);
    if ((await stat(folder)).isDirectory()) return folder;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
  }
  throw new AppError((m) => m.run.repos.pathMissing({ path: source }));
}

/**
 * The top folder of the working tree `folder` is in. Git's own "not a git
 * repository" (its raw stderr) becomes a 400 that names `source`; any other
 * failure, such as a missing git with its setup code, is kept.
 */
async function workingTreeOf(folder: string, source: string) {
  try {
    return (await git(folder, ["rev-parse", "--show-toplevel"])).stdout.trim();
  } catch (error) {
    const stderr = error instanceof AppError ? error.details?.stderr : undefined;
    if (typeof stderr === "string" && /not a git repository/i.test(stderr))
      throw new AppError(
        (m) => m.run.repos.notGitRepository({ path: source }),
        400,
        { cause: error },
      );
    throw error;
  }
}

/** The branch origin's HEAD names, else the branch checked out. */
async function defaultBranchOf(directory: string) {
  try {
    return (
      await git(directory, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
    ).stdout
      .trim()
      .replace(/^origin\//, "");
  } catch {
    return (
      await git(directory, ["symbolic-ref", "--short", "HEAD"])
    ).stdout.trim();
  }
}

export async function importRepository(
  ctx: WorkbenchContext,
  input: string,
) {
  // owner/repo, github.com/… without a scheme, repository pages and ~/.
  const source = normalizeRepositorySource(input, os.homedir());
  return ctx.lock("imports", async () => {
    const github = parseGitHubSource(source);
    let repositoryPath: string;
    let metadata:
      | {
          defaultBranchRef?: { name: string };
          primaryLanguage?: { name: string };
        }
      | undefined;
    let remote = github;
    let defaultBranch: string | undefined;
    /** A local-only project is named after the person's checkout, not BELL's clone. */
    let localName: string | undefined;
    const root = path.join(ctx.store.directory, "repositories");
    if (github) {
      const existing = ctx.store.data.repos.find(
        (repo) =>
          repo.fullName.toLowerCase() === github.fullName.toLowerCase(),
      );
      if (existing) return existing;
      await mkdir(root, { recursive: true, mode: 0o700 });
      repositoryPath = path.join(
        root,
        `${github.owner}-${github.name}-${newId().slice(0, 8)}`,
      );
      await cloneGitHubRepository(root, github.url, repositoryPath);
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
      defaultBranch = metadata?.defaultBranchRef?.name;
    } else {
      if (!path.isAbsolute(source))
        throw new AppError((m) => m.run.repos.importSource);
      const checkout = await realpath(
        await workingTreeOf(await localFolder(source), source),
      );
      // Imported by an earlier build, which worked in the checkout itself.
      const legacy = ctx.store.data.repos.find((repo) => repo.path === checkout);
      if (legacy) return legacy;
      const isBare = (
        await git(checkout, ["rev-parse", "--is-bare-repository"])
      ).stdout.trim();
      if (isBare === "true") throw new AppError((m) => m.run.repos.bare);
      await git(checkout, ["rev-parse", "--verify", "HEAD"]);
      try {
        remote = parseGitHubSource(
          (await git(checkout, ["remote", "get-url", "origin"])).stdout.trim(),
        );
      } catch {
        /* A local-only repository may have no origin. */
      }
      const prefix = path.join(root, localClonePrefix(checkout));
      const origin = remote;
      // A checkout of a GitHub project is that project, however it was imported.
      const existing = ctx.store.data.repos.find((repo) =>
        origin
          ? repo.fullName.toLowerCase() === origin.fullName.toLowerCase()
          : repo.path.startsWith(prefix),
      );
      if (existing) return existing;
      // The checkout's view of its origin, before the clone replaces it.
      defaultBranch = await defaultBranchOf(checkout);
      await mkdir(root, { recursive: true, mode: 0o700 });
      localName = path.basename(checkout);
      repositoryPath = `${prefix}${newId().slice(0, 8)}`;
      await cloneLocalCheckout(checkout, repositoryPath, remote?.url);
      // Like a GitHub import, the clone starts on the default branch.
      const head = (
        await git(repositoryPath, ["symbolic-ref", "-q", "--short", "HEAD"], {
          allowedCodes: [0, 1],
        })
      ).stdout.trim();
      const hasDefault =
        (
          await git(
            repositoryPath,
            ["rev-parse", "--verify", "-q", `refs/heads/${defaultBranch}`],
            { allowedCodes: [0, 1] },
          )
        ).code === 0;
      if (head !== defaultBranch && hasDefault)
        await git(repositoryPath, ["checkout", "-q", defaultBranch, "--"]);
    }
    defaultBranch ||= await defaultBranchOf(repositoryPath);
    await git(repositoryPath, [
      "check-ref-format",
      "--branch",
      defaultBranch,
    ]);
    const name = remote?.name ?? localName ?? path.basename(repositoryPath);
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
    // The project's own rules from its files; GitHub's facts (the door)
    // only for a GitHub import: a local folder runs no gh at import.
    const rules = await projectRules(ctx, repo, { network: !!github });
    if (rules) repo.contributionRules = rules;
    ctx.store.data.repos.unshift(repo);
    await ctx.store.save();
    return repo;
  });
}

/**
 * The "Before you contribute" facts of a project (contribution-facts.ts),
 * read at import and at Update project. They never fail either one.
 */
async function projectRules(
  ctx: WorkbenchContext,
  repo: Repository,
  options: { network?: boolean } = {},
) {
  try {
    return await refreshRepositoryRules(ctx, repo, options);
  } catch (error) {
    log.warn("repo.rules_failed", { repoId: repo.id, error });
    return undefined;
  }
}

/**
 * BELL's own clone of a GitHub repository, which it may update: a GitHub
 * import, or a local checkout of a GitHub project, cloned at import. A
 * local-only project has nothing to update from, and a checkout imported by
 * an earlier build is the person's own and is never changed.
 */
export function managedClone(directory: string, repo: Repository) {
  return !!repo.url && insideRepositories(directory, repo.path);
}

/** True for a clone BELL made under `<dataDir>/repositories`. */
function insideRepositories(directory: string, repoPath: string) {
  return repoPath.startsWith(path.join(directory, "repositories") + path.sep);
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
  assertRefName(branch);
  if (!repo.url)
    return (
      await git(
        repo.path,
        ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`],
        { signal },
      )
    ).stdout.trim();
  if (!parseGitHubSource(repo.url))
    throw new AppError((m) => m.security.invalidRemote, 409);
  await gitNetwork(
    repo.path,
    [
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
      (m) =>
        insideRepositories(ctx.store.directory, repo.path)
          ? m.run.repos.localNotUpdated
          : m.run.repos.checkoutNotUpdated,
      409,
    );
  const result = await ctx.lock(`repository:${repo.id}`, async () => {
    await completePartialClone(ctx, repo);
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
      throw new AppError((m) => m.run.repos.cloneChanged, 409);
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
  // Read again for the updated project, outside the repository lock so
  // GitHub's answers never hold up its runs.
  await ctx.lock(`contribution-rules:${repo.id}`, async () => {
    const rules = await projectRules(ctx, repo);
    if (rules && ctx.store.data.repos.includes(repo)) {
      repo.contributionRules = rules;
      await ctx.store.save();
    }
  });
  return result;
}

/** True when `child` lies strictly inside `parent`. */
function inside(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/**
 * A project that an earlier build imported from a local checkout works in
 * the person's own repository (`repo.path` is the checkout). Before a new
 * run adds its worktree, such a project moves to a BELL clone of that
 * checkout under <data>/repositories, so the run adds no worktree or
 * branch there. While another of its runs still has a worktree in the
 * person's repository, the project stays: those runs fetch and sync
 * through it, and keep working where they are. Returns whether it moved.
 * The caller holds the repository lock.
 */
export async function adoptLegacyCheckout(
  ctx: WorkbenchContext,
  repo: Repository,
  run: Run,
) {
  const root = path.join(ctx.store.directory, "repositories");
  if (inside(root, repo.path)) return false;
  for (const other of ctx.store.data.runs) {
    if (
      other.repoId !== repo.id ||
      other.id === run.id ||
      !other.worktreePath ||
      other.workspaceRemovedAt
    )
      continue;
    const present = await lstat(other.worktreePath).then(
      () => true,
      () => false,
    );
    if (present) return false;
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const destination = path.join(
    root,
    `${localClonePrefix(repo.path)}${newId().slice(0, 8)}`,
  );
  await cloneLocalCheckout(repo.path, destination, repo.url || undefined);
  log.info("repo.moved_to_clone", { repoId: repo.id });
  repo.path = destination;
  await ctx.store.save();
  return true;
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
  assertRefName(run.branch);
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
