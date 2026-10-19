/**
 * What the person does with a team's plan and its work in progress: approve
 * the plan, send it back to the lead with feedback, or message the team.
 * An approved or revised plan goes back to the Workbench queue.
 */
import { maxPlanRevisions } from "../shared/team.js";
import { sm } from "./i18n/index.js";
import { redact } from "./process.js";
import { logRunQueued } from "./run-events.js";
import { queueTeamMessage } from "./run-executor.js";
import { AppError } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

const now = () => new Date().toISOString();

export async function sendTeamMessage(
  ctx: WorkbenchContext,
  id: string,
  input: { to: string; content: string },
) {
  return ctx.lock(`team-message:${id}`, async () => {
    const run = ctx.run(id);
    if (!["queued", "running", "awaiting_plan"].includes(run.status))
      throw new AppError((m) => m.run.queue.teamStopped, 409);
    queueTeamMessage(
      ctx,
      run,
      "user",
      input.to,
      input.content,
    );
    await ctx.store.save();
    return run;
  });
}

export async function approvePlan(ctx: WorkbenchContext, id: string) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (run.status !== "awaiting_plan" || !run.team?.tasks.length)
      throw new AppError((m) => m.run.queue.noPlanToApprove, 409);
    run.team.approvedAt = now();
    run.team.phase = "developing";
    run.status = "queued";
    ctx.log(run, "user", sm().run.queue.planApproved);
    await ctx.store.save();
    logRunQueued(run, "plan_approved");
    ctx.enqueue(id);
    return run;
  });
}

/**
 * Sends back to the lead a plan the person did not approve. The planning
 * branch of executeRun() runs again with the feedback attached; there is no
 * second planning path. Messages queued to tasks of the old plan stay in the
 * inbox under their old task ids and are not forwarded.
 */
export async function revisePlan(
  ctx: WorkbenchContext,
  id: string,
  feedback: string,
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    const team = run.team;
    if (run.status !== "awaiting_plan" || !team?.tasks.length)
      throw new AppError((m) => m.run.queue.noPlanToApprove, 409);
    const content = redact(feedback.trim());
    if (!content || content.length > 4000)
      throw new AppError((m) => m.run.queue.feedbackLength, 400);
    const revisions = (team.planRevisions ??= []);
    if (revisions.length >= maxPlanRevisions)
      throw new AppError(
        (m) => m.run.queue.revisionLimit({ max: maxPlanRevisions }),
        409,
      );
    revisions.push({
      feedback: content,
      previousSummary: team.planSummary,
      previousTasks: team.tasks.map(({ id, title, files, dependsOn }) => ({
        id,
        title,
        files,
        dependsOn,
      })),
      createdAt: now(),
    });
    // The planning branch inserts one agent per member of the new plan;
    // the old members must go first or they would be listed twice.
    run.agents = run.agents.filter((agent) => !/^member-/.test(agent.id));
    team.tasks = [];
    team.planSummary = "";
    // The check belonged to the plan sent back; the new plan makes its own.
    delete team.premise;
    team.phase = "planning";
    run.status = "queued";
    ctx.log(
      run,
      "user",
      sm().run.queue.planSentBack({
        revision: revisions.length,
        max: maxPlanRevisions,
      }),
    );
    await ctx.store.save();
    logRunQueued(run, "plan_revised");
    ctx.enqueue(id);
    return run;
  });
}
