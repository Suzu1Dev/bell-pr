/**
 * Follow-up commits of a published Learn-by-hand run, made and pushed by
 * the person with their own Git from the run's folder (DESIGN v1.2 F2; the
 * by-hand follow-up round is v1.2.1). BELL takes them over at the next
 * feedback read (server/learning.ts) and before a PR sync
 * (server/sync-runs.ts), through the same `adoptRemoteCommits` that takes
 * over commits pushed on GitHub: it records an adopted sync round (no new
 * field or value), which never changes `byHandClean` or the help record.
 * BELL takes the commits over; it doesn't check or review them.
 *
 * Nothing happens unless the run's folder is still there, clean, on the
 * run's own branch, and its HEAD is past the last pushed commit. BELL
 * adopts only when that HEAD builds on the last push and is exactly the PR
 * branch's head on GitHub (the person pushed), and when the fetched head is
 * still that HEAD or builds on it; the folder then stays as it is, or moves
 * on to that head without a change saved meanwhile. It never resets local
 * commits or saved changes away: unpushed commits, a branch that moved on
 * without them (also while BELL looked), a dirty checkout, another branch
 * or a detached HEAD, or rewritten history leave everything as it is, with
 * a notice on the feedback read, or a refusal before a sync. Agent runs are
 * never touched.
 */
import { activeFollowUp } from "../shared/followups.js";
import { sm } from "./i18n/index.js";
import { adoptRemoteCommits, remoteBranchHead, worktreeDirty } from "./pr-branch.js";
import { git, redact } from "./process.js";
import { AppError, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

/** What a takeover found: adopted, nothing to do, or why it left the commits where they are. */
export type TakeoverOutcome = "adopted" | "none" | "dirty" | "elsewhere" | "unpushed" | "behind" | "rewritten";

/** Whether `ancestor` is an ancestor of (or the same commit as) `commit` in the run's checkout. */
async function contains(run: Run, ancestor: string, commit: string) {
  const result = await git(run.worktreePath, ["merge-base", "--is-ancestor", ancestor, commit], {
    allowedCodes: [0, 1],
  });
  return result.code === 0;
}

/** Whether the run's folder is on the run's own branch (not another branch, not a detached HEAD). */
async function onRunBranch(run: Run) {
  const ref = await git(run.worktreePath, ["symbolic-ref", "-q", "HEAD"], { allowedCodes: [0, 1] });
  return ref.stdout.trim() === `refs/heads/${run.branch}`;
}

/** Looks at the run's checkout and GitHub's PR branch, and adopts only what the person pushed. */
async function takeOver(ctx: WorkbenchContext, run: Run, again = false): Promise<TakeoverOutcome> {
  if (!run.learnByHand || run.status !== "published" || run.publishing || run.workspaceRemovedAt) return "none";
  if (!run.publishCommit || !run.headRepository || activeFollowUp(run.followUps)) return "none";
  const head = (await git(run.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
  if (head === run.publishCommit) return "none";
  if (await worktreeDirty(run)) return "dirty";
  // Only the run's own branch is the pull request's, never another branch or a detached HEAD.
  if (!(await onRunBranch(run))) return "elsewhere";
  const remote = await remoteBranchHead(run);
  if (!(await contains(run, run.publishCommit, head)))
    // A force push that rewrote what BELL pushed; a local rewrite not pushed is left alone.
    return remote === head ? "rewritten" : "none";
  if (remote === head)
    try {
      return (await adoptRemoteCommits(ctx, run, { expectedHead: head })) ? "adopted" : "none";
    } catch (error) {
      // GitHub's branch (or the folder) moved while BELL looked, and nothing moved here: what they
      // hold now decides, once.
      if (again || !(error instanceof AppError && error.statusCode === 409)) throw error;
      return takeOver(ctx, run, true);
    }
  if (!remote) return "unpushed";
  // The folder only adds commits to what GitHub's branch has: they wait for a push. Otherwise the
  // branch has commits the folder lacks (a pull comes first).
  const known = (await git(run.worktreePath, ["cat-file", "-e", `${remote}^{commit}`], { allowedCodes: [0, 1, 128] })).code === 0;
  return known && (await contains(run, remote, head)) ? "unpushed" : "behind";
}

/** The person's own words for a takeover that left the commits where they are. */
function notice(run: Run, outcome: TakeoverOutcome) {
  const messages = sm().byHand.flow.takeover;
  if (outcome === "dirty") return messages.commitFirst;
  if (outcome === "elsewhere") return messages.switchBack({ branch: run.branch });
  if (outcome === "unpushed") return messages.pushFirst;
  if (outcome === "behind") return messages.pullFirst;
  if (outcome === "rewritten") return sm().run.followUp.historyRewritten({ branch: run.publishedBranch ?? run.branch });
  return undefined;
}

/**
 * Takes over the commits a published Learn-by-hand run's person pushed
 * from its folder. On a feedback read (the default) nothing refuses: a
 * notice is logged and the read goes on, also when GitHub can't be
 * reached. Before a PR sync (`refuse`), the same cases refuse with 409,
 * rewritten history with the existing `historyRewritten` refusal.
 */
export async function takeOverOwnCommits(
  ctx: WorkbenchContext,
  run: Run,
  options: { refuse?: boolean } = {},
): Promise<TakeoverOutcome> {
  let outcome: TakeoverOutcome;
  try {
    outcome = await takeOver(ctx, run);
  } catch (error) {
    if (options.refuse) throw error;
    ctx.log(run, "system", redact(error instanceof Error ? error.message : String(error)), { kind: "notice" });
    return "none";
  }
  if (outcome === "adopted") {
    // The adopted round and its log line say what was taken over in Learn-by-hand words:
    // the person's own pushed commits, never "reviewed with the next round".
    const round = run.followUps!.at(-1)!;
    const commits = Number(
      (await git(run.worktreePath, ["rev-list", "--count", `${round.parentCommit}..${round.commit}`])).stdout.trim(),
    );
    const generic = sm().run.followUp.adopted({ branch: run.publishedBranch ?? run.branch, commits });
    round.report = sm().byHand.flow.takeover.adopted({ commits });
    const logged = run.logs.at(-1);
    if (logged?.message === generic) logged.message = round.report;
    else ctx.log(run, "system", round.report);
    await ctx.store.save();
  }
  const message = notice(run, outcome);
  if (message && options.refuse) throw new AppError(message, 409);
  if (message) ctx.log(run, "system", message, { kind: "notice" });
  return outcome;
}
