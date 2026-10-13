import type { Express } from "express";
import type { RouteDeps } from "./types.js";

/** The model, effort and web access shared by every project. */
export function registerModelSettingsRoutes(
  app: Express,
  { insights }: RouteDeps,
) {
  app.get("/api/model-settings", async (_req, res) =>
    res.json({ settings: await insights.getModelSettings() }),
  );
  app.put("/api/model-settings", async (req, res) =>
    res.json({ settings: await insights.setModelSettings(req.body) }),
  );
}
