import type { Express } from "express";
import { z } from "zod";
import { modelSettingsSchema } from "../models.js";
import type { RouteDeps } from "./types.js";

const modelSettingsInput = z.object(modelSettingsSchema).strict();

/** The model, effort and web access shared by every project. */
export function registerModelSettingsRoutes(
  app: Express,
  { insights }: RouteDeps,
) {
  app.get("/api/model-settings", async (_req, res) =>
    res.json({ settings: await insights.getModelSettings() }),
  );
  app.put("/api/model-settings", async (req, res) => {
    const selected = modelSettingsInput.parse(req.body);
    res.json({ settings: await insights.setModelSettings(selected) });
  });
}
