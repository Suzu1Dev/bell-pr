/**
 * What the person does with a team's plan and its work in progress: approve
 * the plan, send it back to the lead with feedback, or message the team.
 * An approved or revised plan goes back to the Workbench queue; a
 * Learn-by-hand run's confirmed plan starts the person's own turn instead.
 */
import { maxPlanRevisions } from "../shared/team.js";
import { planOverlaps } from "./group-local.js";
import { sm } from "./i18n/index.js";
import { redact } from "./process.js";
import { enterPhase, logRunQueued } from "./run-events.js";
import { queueTeamMessage } from "./run-executor.js";
import { AppError, type Run } from "./types.js";
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

/**
 * The titles of the other contributions whose files meet `run`'s plan,
 * once the person confirmed them: `digest` is the one GET
 * /api/runs/:id/overlaps returned with them. Without it, or for overlaps
 * or a plan that changed since, it is a 409.
 */
async function confirmedOverlaps(ctx: WorkbenchContext, run: Run, digest?: string) {
  const { overlaps, digest: current } = await planOverlaps(ctx, run);
  const titles = overlaps.map((overlap) => overlap.title);
  if (titles.length && digest !== current)
    throw new AppError(
      (m) => (digest ? m.run.local.overlapChanged : m.run.local.planOverlap({ titles })),
      409,
    );
  return titles;
}

/**
 * Approves an agent team's plan, or confirms a Learn-by-hand run's plan.
 * When other contributions of the project change files the plan covers,
 * the person approves with the digest of the overlaps they saw.
 */
export async function approvePlan(
  ctx: WorkbenchContext,
  id: string,
  options: { overlapDigest?: string } = {},
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (run.learnByHand) return confirmByHandPlan(ctx, run, options.overlapDigest);
    const waiting = () => run.status === "awaiting_plan" && !!run.team?.tasks.length;
    if (!waiting()) throw new AppError((m) => m.run.queue.noPlanToApprove, 409);
    const titles = await confirmedOverlaps(ctx, run, options.overlapDigest);
    // A Stop does not take the run lock, so it may have come during the check.
    if (!waiting() || !run.team) throw new AppError((m) => m.run.queue.noPlanToApprove, 409);
    run.team.approvedAt = now();
    run.team.phase = "developing";
    run.status = "queued";
    ctx.log(run, "user", sm().run.queue.planApproved);
    if (titles.length) ctx.log(run, "user", sm().run.local.approvedOverlap({ titles }), { kind: "notice" });
    await ctx.store.save();
    logRunQueued(run, "plan_approved");
    ctx.enqueue(id);
    return run;
  });
}

/**
 * "This is my plan" in a Learn-by-hand run (DESIGN v1.2 F3): it needs at
 * least one step the person wrote, and starts their turn to write the
 * change. Nothing is queued: no agent writes, and the guide's outline is
 * never executed (`team.tasks` stays as it is). The steps' files are
 * checked against the person's other contributions like an agent plan.
 * The caller holds the run lock.
 */
async function confirmByHandPlan(ctx: WorkbenchContext, run: Run, overlapDigest?: string) {
  if (run.status !== "awaiting_plan" || !run.team)
    throw new AppError((m) => m.run.queue.noPlanToApprove, 409);
  if (!run.byHand?.plan?.steps.length)
    throw new AppError((m) => m.byHand.flow.stepFirst, 409);
  const titles = await confirmedOverlaps(ctx, run, overlapDigest);
  // A Stop does not take the run lock, so it may have come during the check.
  const team = run.team;
  const plan = run.byHand?.plan;
  if (run.status !== "awaiting_plan" || !team)
    throw new AppError((m) => m.run.queue.noPlanToApprove, 409);
  if (!plan?.steps.length)
    throw new AppError((m) => m.byHand.flow.stepFirst, 409);
  const at = now();
  plan.confirmedAt = at;
  team.approvedAt = at;
  enterPhase(run, team, "developing");
  run.status = "review";
  ctx.log(run, "user", sm().byHand.flow.yourTurn);
  if (titles.length) ctx.log(run, "user", sm().run.local.approvedOverlap({ titles }), { kind: "notice" });
  await ctx.store.save();
  return run;
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
    // Learn by hand: the plan is the person's, and a revision would erase the run's history.
    if (run.learnByHand)
      throw new AppError((m) => m.byHand.flow.reviseRefused, 409);
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
