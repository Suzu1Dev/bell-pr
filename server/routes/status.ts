import type { Express } from "express";
import { z } from "zod";
import { agentProviders } from "../../shared/models.js";
import { AppError } from "../types.js";
import type { RouteDeps } from "./types.js";

/** CLI readiness with the configured limits, and the model catalogs. */
export function registerStatusRoutes(app: Express, { workbench }: RouteDeps) {
  app.get("/api/status", async (_req, res) => {
    // CLI checks stay behind the 10-second cache; the limits are static config.
    res.json({ ...(await workbench.status()), limits: workbench.limits });
  });
  app.get("/api/models", async (req, res) => {
    // Without a provider the Codex catalog is returned, as before.
    const provider = z
      .enum(agentProviders)
      .default("codex")
      .safeParse(req.query.provider);
    if (!provider.success)
      throw new AppError("不支援這個 Agent 類型。", 400);
    res.json(await workbench.models(provider.data));
  });
}
