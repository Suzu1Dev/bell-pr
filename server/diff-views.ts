/** Read-only comparisons from the contribution's recorded rounds. */
import { readDiff } from "./git.js";
import { assertGitConfigSafe, git } from "./process.js";
import { AppError, type Run } from "./types.js";

const commitSha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/** Never synchronizes review state or saves the run. */
export async function readDiffView(run: Run, roundId: string) {
  const unavailable = () =>
    new AppError((m) => m.run.diff.viewUnavailable, 404);
  if (!run.prUrl || !run.publishCommit || !run.worktreePath)
    throw unavailable();
  await assertGitConfigSafe(run.worktreePath);
  const requireCommit = async (sha: string | undefined) => {
    if (!sha || !commitSha.test(sha)) throw unavailable();
    try {
      if (
        (await git(run.worktreePath, ["cat-file", "-t", sha])).stdout.trim() !==
        "commit"
      )
        throw unavailable();
    } catch {
      throw unavailable();
    }
    return sha;
  };
  await requireCommit(run.publishCommit);
  let baseSha: string;
  let headSha: string | undefined;
  if (roundId === "all") {
    baseSha = await requireCommit(run.baseSha);
  } else if (roundId === "initial") {
    headSha = await requireCommit(
      run.followUps?.[0]?.parentCommit ?? run.publishCommit,
    );
    const parents = (
      await git(run.worktreePath, ["rev-list", "--parents", "-n", "1", headSha])
    ).stdout
      .trim()
      .split(/\s+/);
    baseSha = await requireCommit(parents[1]);
  } else {
    const round = run.followUps?.find((entry) => entry.id === roundId);
    if (!round || round.status !== "published") throw unavailable();
    baseSha = await requireCommit(round.parentCommit);
    headSha = await requireCommit(round.commit);
  }
  // Do not pass followUps: a historical base must not become the active
  // round's base, and its fingerprints must never authorize a current review.
  const files = await readDiff(
    {
      worktreePath: run.worktreePath,
      locale: run.locale,
      baseSha,
    },
    headSha,
  );
  return { files, baseSha, ...(headSha ? { headSha } : {}) };
}
