import type { Express } from "express";
import { z } from "zod";
import { fixedLicense } from "../license.js";
import { modelSettingsSchema } from "../models.js";
import type { RouteDeps } from "./types.js";

const modelSettingsInput = z.object(modelSettingsSchema).strict();

/**
 * The model, effort and web access shared by every project. Saving web
 * access or a Pro-only effort needs Pro; reading never does.
 */
export function registerModelSettingsRoutes(
  app: Express,
  { insights, license = fixedLicense("free") }: RouteDeps,
) {
  app.get("/api/model-settings", async (_req, res) =>
    res.json({ settings: await insights.getModelSettings() }),
  );
  app.put("/api/model-settings", async (req, res) => {
    const selected = modelSettingsInput.parse(req.body);
    license.assertModelEntitlement(selected);
    res.json({ settings: await insights.setModelSettings(selected) });
  });
}
