import type { Express } from "express";
import { z } from "zod";
import { testReasonLimits } from "../contribution-facts.js";
import { parseGitHubIssueUrl } from "../git.js";
import { sm } from "../i18n/index.js";
import type { RouteDeps } from "./types.js";

/** The task dialog's issue link: empty, or a GitHub issue page (as `contributionSettings.issueUrl`). */
const checkQuerySchema = z
  .object({
    issue: z
      .string()
      .trim()
      .max(400)
      .refine((value) => !value || parseGitHubIssueUrl(value) !== null, () => ({
        message: sm().analysis.insights.issueUrlInvalid,
      }))
      .optional(),
  })
  .strict();

/**
 * One line per weakened-test item, by its id (`WeakenedTest.id`, the path
 * and line). An empty line removes that item's reason; ids the change no
 * longer has are dropped.
 */
const testReasonsSchema = z
  .object({
    reasons: z.record(
      z.string().min(1).max(1100),
      z.string().max(testReasonLimits.chars),
    ),
  })
  .strict()
  .refine((value) => Object.keys(value.reasons).length <= 100);

const emptySchema = z.object({}).strict();

/**
 * The respect routes (DESIGN §10): the project's rules card, the task
 * dialog's issue and pacing facts, refreshing a run's facts and the
 * weakened-test reasons, through Workbench.contribution. None is gated by
 * plan: the respect checks are the same on every plan. GitHub is read only
 * by the refresh and check routes, never by the GET of the stored rules.
 */
export function registerContributionRoutes(app: Express, { workbench }: RouteDeps) {
  app.get("/api/repos/:id/contribution-rules", async (req, res) => {
    res.json({ rules: (await workbench.contribution.rules(req.params.id)) ?? null });
  });
  app.post("/api/repos/:id/contribution-rules/refresh", async (req, res) => {
    emptySchema.parse(req.body ?? {});
    res.json({
      rules: (await workbench.contribution.refreshRules(req.params.id)) ?? null,
    });
  });
  app.get("/api/repos/:id/contribution-check", async (req, res) => {
    const { issue } = checkQuerySchema.parse(req.query);
    res.json({ facts: await workbench.contribution.check(req.params.id, issue || undefined) });
  });
  app.post("/api/runs/:id/contribution-facts/refresh", async (req, res) => {
    emptySchema.parse(req.body ?? {});
    res.json(await workbench.contribution.refreshRun(req.params.id));
  });
  app.put("/api/runs/:id/test-reasons", async (req, res) => {
    const { reasons } = testReasonsSchema.parse(req.body);
    res.json(await workbench.contribution.saveTestReasons(req.params.id, reasons));
  });
}
