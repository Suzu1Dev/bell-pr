import type { Express } from "express";
import { z } from "zod";
import { summarizeRun } from "../../shared/runs.js";
import { splitLimits } from "../../shared/split.js";
import { contributionSettingsSchema } from "../insights.js";
import { sm } from "../i18n/index.js";
import type { RouteDeps } from "./types.js";

/**
 * Contribution runs: the list, creation, one run and cancel, plus the
 * team plan (approve and revise), team messages and retries.
 */
export function registerRunsRoutes(
  app: Express,
  { workbench, insights }: RouteDeps,
) {
  app.post("/api/runs/:id/plan/approve", async (req, res) =>
    res.json({ run: await workbench.approvePlan(req.params.id) }),
  );
  app.post("/api/runs/:id/plan/revise", async (req, res) => {
    const input = z
      .object({ feedback: z.string().trim().min(1).max(4000) })
      .parse(req.body);
    res.json({
      run: await workbench.revisePlan(req.params.id, input.feedback),
    });
  });
  app.post("/api/runs/:id/team/messages", async (req, res) => {
    const input = z
      .object({
        to: z.string().min(1).max(100),
        content: z.string().trim().min(1).max(4000),
      })
      .parse(req.body);
    res.json({ run: await workbench.sendTeamMessage(req.params.id, input) });
  });
  app.post("/api/runs/:id/team/retry", async (req, res) => {
    const { message } = z
      .object({ message: z.string().trim().min(1).max(4000).optional() })
      .strict()
      .parse(req.body ?? {});
    res.json({ run: await workbench.retryTeam(req.params.id, message) });
  });
  app.get("/api/runs", (_req, res) => {
    // Lists are polled every few seconds; the open run fetches its full record.
    res.json({ runs: workbench.store.data.runs.map(summarizeRun) });
  });
  app.post("/api/runs", async (req, res) => {
    // Not strict: an older client's extra keys are dropped. The mode is a
    // request field that only this route reads; nothing stores it but
    // createRun (DESIGN v1.2 F1).
    const { repoId, prompt, title, settings, learnByHand, byHandFit } = z
      .object({
        repoId: z.string().uuid(),
        prompt: z.string().trim().min(10).max(20_000),
        title: z.string().trim().min(1).max(180).optional(),
        settings: contributionSettingsSchema.optional(),
        learnByHand: z.boolean().optional(),
        byHandFit: z.object({ learningIssue: z.boolean() }).strict().optional(),
      })
      .refine((input) => !input.byHandFit || input.learnByHand === true, {
        error: () => sm().byHand.fitNeedsByHand,
        path: ["byHandFit"],
      })
      .parse(req.body);
    const selected = settings ?? (await insights.getSettings(repoId));
    res.status(202).json({
      run: await workbench.createRun(repoId, prompt, title, selected, {
        learnByHand: learnByHand === true,
        ...(byHandFit ? { byHandFit } : {}),
      }),
    });
  });
  app.get("/api/runs/:id", (req, res) => {
    res.json({ run: workbench.run(req.params.id) });
  });
  app.post("/api/runs/:id/cancel", async (req, res) => {
    res.json({ run: await workbench.cancel(req.params.id) });
  });
  app.post("/api/runs/:id/split", async (req, res) => {
    const input = z
      .object({
        contributions: z
          .array(
            z
              .object({
                title: z.string().trim().min(1).max(splitLimits.titleChars),
                paths: z.array(z.string().min(1).max(4096)).min(1).max(splitLimits.maxPaths),
              })
              .strict(),
          )
          .min(splitLimits.minContributions)
          .max(splitLimits.maxContributions),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(await workbench.split(req.params.id, input));
  });
}
