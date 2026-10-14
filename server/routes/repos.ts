import type { Express } from "express";
import { z } from "zod";
import { clampContributionSettings } from "../../shared/plans.js";
import { contributionSettingsSchema } from "../insights.js";
import { fixedLicense, requirePro } from "../license.js";
import type { Repository } from "../types.js";
import type { RouteDeps } from "./types.js";

/**
 * Repositories: the list and import, updating BELL's own clone, project
 * analysis (insights and more recommendations), recommendation preferences
 * and per-project settings. More recommendations are Pro; analysis and
 * settings need Pro only for web access or a Pro-only effort, and the team
 * size is lowered to what the plan allows instead of refused.
 */
export function registerReposRoutes(
  app: Express,
  { workbench, insights, license = fixedLicense("free") }: RouteDeps,
) {
  // `updatable` tells the UI whether BELL owns the clone; it is not stored.
  const presentRepo = (repo: Repository) => ({
    ...repo,
    updatable: workbench.managedClone(repo),
  });
  app.get("/api/repos", (_req, res) => {
    res.json({ repos: workbench.store.data.repos.map(presentRepo) });
  });
  app.post("/api/repos", async (req, res) => {
    const { source } = z
      .object({ source: z.string().trim().min(1).max(4096) })
      .parse(req.body);
    res
      .status(201)
      .json({ repo: presentRepo(await workbench.importRepository(source)) });
  });
  app.post("/api/repos/:id/update", async (req, res) => {
    const result = await workbench.updateRepository(req.params.id);
    res.json({ ...result, repo: presentRepo(result.repo) });
  });
  app.get("/api/repos/:id/insights", async (req, res) =>
    res.json(await insights.get(req.params.id)),
  );
  app.post("/api/repos/:id/insights", async (req, res) => {
    // The analysis runs with the saved model settings, as selected.
    license.assertModelEntitlement(await insights.getModelSettings());
    res.json(await insights.generate(req.params.id));
  });
  app.post(
    "/api/repos/:id/insights/recommendations",
    requirePro(license, "moreRecommendations"),
    async (req, res) =>
      res.json(await insights.generateMore(req.params.id, req.body)),
  );
  app.put("/api/repos/:id/insights/preferences", async (req, res) =>
    res.json({
      recommendationPreferences: await insights.setRecommendationPreferences(
        req.params.id,
        req.body,
      ),
    }),
  );
  app.get("/api/repos/:id/settings", async (req, res) =>
    res.json({ settings: await insights.getSettings(req.params.id) }),
  );
  // The UI saves the whole settings object, so a team size above the plan
  // is lowered and reported (clamped, clampedFrom), never refused: a 402
  // here would block unrelated changes on Free.
  app.put("/api/repos/:id/settings", async (req, res) => {
    const selected = contributionSettingsSchema.parse(req.body);
    license.assertModelEntitlement(selected);
    const { settings, clamped } = clampContributionSettings(
      selected,
      license.entitlements(),
    );
    const saved = await insights.setSettings(req.params.id, settings);
    res.json(
      clamped
        ? { settings: saved, clamped, clampedFrom: selected.maxTeammates }
        : { settings: saved },
    );
  });
}
