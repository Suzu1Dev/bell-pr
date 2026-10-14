/**
 * Retrying a team run from its task board: completed tasks are kept and the
 * failed ones start again in the Workbench queue (run-executor.ts). A run
 * that stopped before its plan existed plans again.
 */
import { claimReadyTasks } from "./team.js";
import { removeTaskWorktree } from "./team-workspace.js";
import { AppError, type Run } from "./types.js";
import { sm } from "./i18n/index.js";
import { queueTeamMessage } from "./run-executor.js";
import { assertWorkspacePresent } from "./cleanup.js";
import { logRunQueued } from "./run-events.js";
import type { WorkbenchContext } from "./workbench.js";

/**
 * Resumes a failed or cancelled team run instead of starting over: completed
 * tasks keep their integrated patches, failed and blocked tasks start again
 * from a fresh snapshot, and a run whose tasks are all complete only re-runs
 * integration and review. An unapproved plan returns to the approval step so
 * cancelling during approval cannot be used to skip it. A run without tasks
 * (it stopped while queued or planning) goes back to the planning phase.
 */
export async function retryTeam(
  ctx: WorkbenchContext,
  id: string,
  message?: string,
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    const team = run.team;
    if (!["failed", "cancelled"].includes(run.status) || !team)
      throw new AppError((m) => m.run.team.retryNotAllowed, 409);
    assertWorkspacePresent(run);
    if (!team.tasks.length) return retryPlanning(ctx, run, team, message);
    if (!run.baseSha) throw new AppError((m) => m.run.team.retryNotAllowed, 409);
    // A cancelled run keeps its controller until the worker has exited; the
    // controller is dropped in the same tick as a failed status, so this is
    // race-free where the job set (cleared later) is not.
    if (ctx.controllers.has(id))
      throw new AppError((m) => m.run.team.stillStopping, 409);
    ctx.assertQueueCapacity();
    const retried = team.tasks.filter(
      (task) => task.status === "failed" || task.status === "blocked",
    );
    const kept = team.tasks.filter((task) => task.status === "complete");
    // The same path is reused by the next attempt, so the old checkout has to
    // go first; its unintegrated edits are discarded with it.
    for (const task of retried)
      await ctx.lock(`repository:${run.repoId}`, () =>
        removeTaskWorktree(run, task),
      );
    for (const task of retried) {
      task.status = "pending";
      delete task.worktreePath;
      delete task.worktreeRemoved;
      delete task.baseSha;
      delete task.report;
      delete task.startedAt;
      delete task.completedAt;
      delete task.acceptsMessages;
      delete run.reports?.[task.id];
      const member = run.agents.find((agent) => agent.id === task.owner);
      if (member) {
        member.status = "waiting";
        member.detail = sm().run.agents.memberRetry;
      }
    }
    claimReadyTasks(team.tasks, 0); // Recompute ready/pending without claiming.
    delete run.error;
    if (message) {
      // sendTeamMessage stays closed for finished runs; the retry itself is
      // the only way to brief the restarted tasks (or the lead when none).
      // Queued before the approval check so a briefing is never dropped.
      if (retried.length)
        for (const task of retried)
          queueTeamMessage(ctx, run, "user", task.id, message);
      else queueTeamMessage(ctx, run, "user", "lead", message);
    }
    if (team.config.requirePlanApproval && !team.approvedAt) {
      team.phase = "awaiting_approval";
      run.status = "awaiting_plan";
      ctx.log(run, "user", sm().run.team.retryAwaitingApproval);
      await ctx.store.save();
      return run;
    }
    team.phase = "developing";
    run.status = "queued";
    ctx.log(
      run,
      "user",
      retried.length
        ? sm().run.team.retryTasks({
            kept: kept.length,
            retried: retried.length,
          })
        : kept.length === team.tasks.length
          ? sm().run.team.retryIntegration
          : sm().run.team.retryPending,
    );
    await ctx.store.save();
    logRunQueued(run, "retry");
    ctx.enqueue(id);
    return run;
  });
}

/**
 * Sends a run that has no plan back to planning: the lead plans from the
 * request again (and from the message, when there is one), and the plan
 * waits for approval as configured. The caller holds the run lock.
 */
async function retryPlanning(
  ctx: WorkbenchContext,
  run: Run,
  team: NonNullable<Run["team"]>,
  message?: string,
) {
  if (ctx.controllers.has(run.id))
    throw new AppError((m) => m.run.team.stillStopping, 409);
  ctx.assertQueueCapacity();
  delete run.error;
  delete team.approvedAt;
  team.phase = "planning";
  run.agents = run.agents.filter((agent) => !/^member-/.test(agent.id));
  // Nothing is done without a plan: every card waits again.
  for (const agent of run.agents) {
    agent.status = "waiting";
    if (agent.id === "lead") agent.detail = sm().run.agents.lead;
  }
  if (message) queueTeamMessage(ctx, run, "user", "lead", message);
  run.status = "queued";
  ctx.log(run, "user", sm().storage.recovery.retryPlanning);
  await ctx.store.save();
  logRunQueued(run, "retry");
  ctx.enqueue(run.id);
  return run;
}
