/**
 * Checks a finished run's premise again, or for the first time on a run
 * made before premise checks: one read-only lead turn reads the code and
 * treats the team's plan and reports as claims to confirm. A changed
 * verdict has the run's walkthroughs and explanations the person has not
 * answered from made again. In a Learn-by-hand run it waits for Ready, and
 * what the agent wrote is filtered before it is stored.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { practiceKey } from "../shared/practice.js";
import { keepAnsweredWalkthroughs } from "../shared/understanding.js";
import { assertHelpAllowed } from "./by-hand-record.js";
import { assertReady } from "./by-hand.js";
import { filteredError } from "./by-hand-filter.js";
import { changeFilter, recordStoredHelp } from "./learning.js";
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
import { walkthroughKeyPrefix } from "./walkthroughs.js";
import type { WorkbenchContext } from "./workbench.js";

/** Statuses whose work is finished enough to check against. */
const finishedStatuses: Run["status"][] = [
  "review",
  "approved",
  "published",
  "failed",
  "cancelled",
];

/**
 * Drops the explanations a changed verdict should have made again. One the
 * person already answered from at its file's version keeps its card: a
 * try-first answer or approach, an Explain-it-back answer, or a practice
 * grade on its self-check. A remade card would put a new question (and a
 * new reference answer) in place of the one they answered.
 */
export function dropUnansweredExplanations(
  run: Pick<Run, "explanations" | "attempts" | "understanding" | "practice">,
) {
  const explanations = run.explanations;
  if (!explanations) return;
  for (const [file, stored] of Object.entries(explanations)) {
    const answered =
      run.attempts?.[file]?.fingerprint === stored.fingerprint ||
      !!run.understanding?.items?.some(
        (item) => item.path === file && item.fingerprint === stored.fingerprint,
      ) ||
      !!run.practice?.[practiceKey("selfCheck", file)];
    if (!answered) delete explanations[file];
  }
}

export async function checkPremise(ctx: WorkbenchContext, id: string) {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  const run = ctx.run(id);
  const team = run.team;
  if (!team || !finishedStatuses.includes(run.status) || run.publishing)
    throw new AppError((m) => m.run.premise.tooEarly, 409);
  // Walkthroughs written in the background do not hold it up; a changed
  // verdict stops them and has them written again.
  if (runBusy(ctx, id, { walkthroughs: false }))
    throw new AppError((m) => m.run.premise.busy, 409);
  const controller = new AbortController();
  // Ends with the run id, so runBusy sees it and shutdown stops it.
  const key = `premise:${id}`;
  ctx.controllers.set(key, controller);
  let temporary: string | undefined;
  try {
    const files = await ctx.lock(id, () => ctx.diff(id));
    // Learn by hand: nothing is checked before Ready (F5); the premise is `explain` help.
    assertReady(run, files);
    if (run.learnByHand) assertHelpAllowed(run, "explain");
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
      ).catch((error) => {
        // Learn by hand: what the agent may have written in its error is filtered (F7).
        throw run.learnByHand ? filteredError(error) : error;
      });
      let value: unknown;
      try {
        value = JSON.parse(jsonText(answer));
      } catch {
        throw new AppError((m) => m.run.premise.incomplete, 422);
      }
      return premiseCheck((value as { premise?: unknown } | null)?.premise);
    });
    return await ctx.lock(id, async () => {
      // Learn by hand: the agent read the checkout, so a version edited
      // since Ready gets nothing (F5); its statement and evidence are
      // filtered (F7) and recorded as help.
      if (run.learnByHand) {
        const read = await ctx.diff(id);
        assertReady(run, read);
        if (premise) {
          const filter = await changeFilter(run, read);
          premise.statement = filter.text(premise.statement);
          premise.evidence = filter.text(premise.evidence);
          recordStoredHelp(run, "premise", filter.removed);
        }
      }
      // Only the verdict counts: an agent rarely words its evidence the same
      // way twice, and the new wording is stored either way.
      const changed =
        (premise?.verdict ?? null) !== (team.premise?.verdict ?? null);
      if (premise) team.premise = premise;
      else delete team.premise;
      if (changed) {
        // Made with the old verdict, or none; they are made again with this
        // one, except what the person already answered from.
        dropUnansweredExplanations(run);
        keepAnsweredWalkthroughs(run);
        for (const [key, walkthrough] of ctx.controllers)
          if (key.startsWith(walkthroughKeyPrefix) && key.endsWith(`:${id}`))
            walkthrough.abort();
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
