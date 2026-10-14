/**
 * A published run's checkout and its PR branch on GitHub, for follow-up
 * rounds and PR syncs: what GitHub's branch holds, taking over commits
 * pushed there outside BELL, and putting the checkout back on the PR branch
 * when a writable agent moved it. BELL never force-pushes, so every round
 * builds on the commit GitHub has.
 */
import { randomUUID } from "node:crypto";
import { command, git } from "./process.js";
import { parseGitHubSource } from "./git.js";
import { prNumberOf } from "./pr-feedback.js";
import { AppError, type Run } from "./types.js";
import { fetchBranchCommit, networkConfig } from "./repositories.js";
import { sm } from "./i18n/index.js";
import type { WorkbenchContext } from "./workbench.js";

const now = () => new Date().toISOString();
const newId = () => randomUUID();

/** Tracked changes or new files in the run's checkout compared with HEAD. */
export async function worktreeDirty(run: Run) {
  return !!(
    await git(run.worktreePath, [
      "status",
      "--porcelain",
      "--untracked-files=all",
    ])
  ).stdout.trim();
}

/** The commit GitHub's PR branch points at now; empty when the branch is gone. */
export async function remoteBranchHead(run: Run) {
  const branch = run.publishedBranch ?? run.branch;
  const output = (
    await git(
      run.worktreePath,
      [
        ...networkConfig,
        "ls-remote",
        "--",
        `https://github.com/${run.headRepository}.git`,
        `refs/heads/${branch}`,
      ],
      { timeoutMs: 60_000 },
    )
  ).stdout;
  return /^([0-9a-f]{40,64})\s/m.exec(output)?.[1] ?? "";
}

/**
 * Whether the PR on GitHub contains `commit`, also when its branch moved on
 * or was deleted after a merge. Errors propagate, so callers refuse rather
 * than guess.
 */
export async function prHasCommit(
  ctx: WorkbenchContext,
  run: Run,
  commit: string,
) {
  if ((await remoteBranchHead(run).catch(() => "")) === commit) return true;
  const source = parseGitHubSource(ctx.repo(run.repoId).url);
  const number = source ? prNumberOf(run.prUrl, source.url) : undefined;
  if (!source || !number)
    throw new AppError((m) => m.run.followUp.pushUnknown, 502);
  const commits = (
    await command(
      "gh",
      [
        "api",
        `repos/${source.fullName}/pulls/${number}/commits`,
        "--paginate",
        "--jq",
        ".[].sha",
      ],
      { timeoutMs: 30_000 },
    )
  ).stdout
    .split("\n")
    .map((line) => line.trim());
  return commits.includes(commit);
}

/** BELL never force-pushes, so it can only build on the commit GitHub has. */
export function assertRemoteHead(
  run: Run,
  remoteHead: string,
  expected: string,
) {
  if (remoteHead === expected) return;
  const branch = run.publishedBranch ?? run.branch;
  throw new AppError(
    (m) =>
      remoteHead
        ? m.run.followUp.remoteMoved({ branch })
        : m.run.followUp.remoteMissing({ branch }),
    409,
  );
}

/**
 * Takes over commits pushed to the PR branch outside BELL (a suggestion
 * applied on GitHub, "Update branch", a maintainer's push) when they build
 * on BELL's last push: the checkout moves to GitHub's head and the PR's
 * diff base becomes where it meets the target branch. Their changes are
 * reviewed with the next round. Rewritten history is refused.
 */
export async function adoptRemoteCommits(ctx: WorkbenchContext, run: Run) {
  const remoteHead = await remoteBranchHead(run);
  if (!remoteHead || remoteHead === run.publishCommit) return false;
  const branch = run.publishedBranch ?? run.branch;
  await git(
    run.worktreePath,
    [
      ...networkConfig,
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      `https://github.com/${run.headRepository}.git`,
      `refs/heads/${branch}`,
    ],
    { timeoutMs: 120_000 },
  );
  const fetched = (
    await git(run.worktreePath, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"])
  ).stdout.trim();
  const builds =
    (
      await git(
        run.worktreePath,
        ["merge-base", "--is-ancestor", run.publishCommit!, fetched],
        { allowedCodes: [0, 1] },
      )
    ).code === 0;
  if (!builds)
    throw new AppError(
      (m) => m.run.followUp.historyRewritten({ branch }),
      409,
    );
  const repo = ctx.repo(run.repoId);
  const target = await ctx.lock(`repository:${repo.id}`, () =>
    fetchBranchCommit(repo, run.baseBranch),
  );
  const base = (
    await git(run.worktreePath, ["merge-base", fetched, target])
  ).stdout.trim();
  const count = Number(
    (
      await git(run.worktreePath, [
        "rev-list",
        "--count",
        `${run.publishCommit}..${fetched}`,
      ])
    ).stdout.trim(),
  );
  // The checkout is clean (callers check), so moving it loses nothing.
  await git(run.worktreePath, ["reset", "-q", "--hard", fetched]);
  (run.followUps ??= []).push({
    id: newId().slice(0, 8),
    kind: "sync",
    requestedAt: now(),
    feedbackUrls: [],
    status: "published",
    parentCommit: run.publishCommit!,
    commit: fetched,
    publishedAt: now(),
    adopted: true,
    report: sm().run.followUp.adoptedReport({ commits: count }),
  });
  run.publishCommit = fetched;
  run.baseSha = base;
  ctx.log(
    run,
    "system",
    sm().run.followUp.adopted({ branch, commits: count }),
  );
  await ctx.store.save();
  return true;
}

/**
 * Puts the run's branch back on `commit` if a writable agent committed,
 * reset or switched branches despite the prompt. Its final files stay in
 * the checkout as uncommitted changes, so they are reviewed like any edit.
 */
export async function restoreAgentHead(run: Run, commit: string) {
  const ref = (
    await git(run.worktreePath, ["symbolic-ref", "-q", "HEAD"], {
      allowedCodes: [0, 1],
    })
  ).stdout.trim();
  const head = (
    await git(run.worktreePath, ["rev-parse", "HEAD"])
  ).stdout.trim();
  if (ref === `refs/heads/${run.branch}` && head === commit) return false;
  if (ref !== `refs/heads/${run.branch}`)
    await git(run.worktreePath, [
      "symbolic-ref",
      "HEAD",
      `refs/heads/${run.branch}`,
    ]);
  await git(run.worktreePath, ["reset", "-q", "--mixed", commit]);
  return true;
}
