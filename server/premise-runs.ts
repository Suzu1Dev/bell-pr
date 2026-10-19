/**
 * Checks a finished run's premise again, or for the first time on a run
 * made before premise checks: one read-only lead turn reads the code and
 * treats the team's plan and reports as claims to confirm. A changed
 * verdict has the run's explanations and walkthroughs made again.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { currentLocale, shuttingDown, sm } from "./i18n/index.js";
import { premiseCheckPrompt } from "./prompts/premise.js";
import { contributionContext } from "./prompts/team.js";
import { runAgent } from "./run-executor.js";
import { runBusy } from "./sync-runs.js";
import {
  jsonText,
  premiseCheck,
  premiseJsonSchema,
  reviewDiffContext,
} from "./team.js";
import { AppError, withRunLocale, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

/** Statuses whose work is finished enough to check against. */
const finishedStatuses: Run["status"][] = [
  "review",
  "approved",
  "published",
  "failed",
  "cancelled",
];

export async function checkPremise(ctx: WorkbenchContext, id: string) {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  const run = ctx.run(id);
  const team = run.team;
  if (!team || !finishedStatuses.includes(run.status) || run.publishing)
    throw new AppError((m) => m.run.premise.tooEarly, 409);
  if (runBusy(ctx, id)) throw new AppError((m) => m.run.premise.busy, 409);
  const controller = new AbortController();
  // Ends with the run id, so runBusy sees it and shutdown stops it.
  const key = `premise:${id}`;
  ctx.controllers.set(key, controller);
  let temporary: string | undefined;
  try {
    const files = await ctx.lock(id, () => ctx.diff(id));
    temporary = await mkdtemp(path.join(os.tmpdir(), "bell-premise-"));
    const outputSchema = path.join(temporary, "premise-schema.json");
    await writeFile(
      outputSchema,
      JSON.stringify({
        type: "object",
        properties: { premise: premiseJsonSchema },
        required: ["premise"],
        additionalProperties: false,
      }),
      { mode: 0o600 },
    );
    // The run's agent and its log follow the run's language.
    const premise = await withRunLocale(run, async () => {
      const answer = await runAgent(
        ctx,
        run,
        "premise",
        premiseCheckPrompt({
          locale: currentLocale(),
          contributionContext: contributionContext(run),
          findings: {
            plan: team.planSummary.slice(0, 6_000),
            integration: run.reports?.implementer?.slice(0, 8_000) ?? null,
            review: run.reports?.reviewer?.slice(0, 6_000) ?? null,
            testAnalysis: run.reports?.tester?.slice(0, 6_000) ?? null,
          },
          diffContext: reviewDiffContext(files),
        }),
        controller.signal,
        true,
        // Isolated: offline, out of the team inbox and the reports; it still reads this checkout.
        { outputSchema, isolated: true },
      );
      let value: unknown;
      try {
        value = JSON.parse(jsonText(answer));
      } catch {
        throw new AppError((m) => m.run.premise.incomplete, 422);
      }
      return premiseCheck((value as { premise?: unknown } | null)?.premise);
    });
    return await ctx.lock(id, async () => {
      const changed =
        JSON.stringify(premise ?? null) !== JSON.stringify(team.premise ?? null);
      if (premise) team.premise = premise;
      else delete team.premise;
      if (changed) {
        // Made with the old verdict, or none; they are made again with this one.
        delete run.explanations;
        delete run.walkthroughs;
      }
      withRunLocale(run, () =>
        ctx.log(
          run,
          "user",
          premise
            ? sm().run.premise.checked({ verdict: premise.verdict, changed })
            : sm().run.premise.noAssumption,
        ),
      );
      const current = await ctx.diff(id);
      await ctx.store.save();
      return { run, premise: premise ?? null, files: current };
    });
  } finally {
    if (ctx.controllers.get(key) === controller) ctx.controllers.delete(key);
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
