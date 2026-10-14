import type { Express } from "express";
import { z } from "zod";
import type { Repository } from "../types.js";
import type { RouteDeps } from "./types.js";

/**
 * Repositories: the list and import, updating BELL's own clone, project
 * analysis (insights and more recommendations), recommendation preferences
 * and per-project settings.
 */
export function registerReposRoutes(
  app: Express,
  { workbench, insights }: RouteDeps,
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
  app.post("/api/repos/:id/insights", async (req, res) =>
    res.json(await insights.generate(req.params.id)),
  );
  app.post("/api/repos/:id/insights/recommendations", async (req, res) =>
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
  app.put("/api/repos/:id/settings", async (req, res) =>
    res.json({ settings: await insights.setSettings(req.params.id, req.body) }),
  );
}
