import type { Express } from "express";
import { z } from "zod";
import { agentProviders } from "../../shared/models.js";
import { version } from "../build-info.js";
import { AppError } from "../types.js";
import type { RouteDeps } from "./types.js";

/**
 * CLI readiness, the doctor report seen the way /api/status always
 * answered (which agent CLIs are installed and signed in, the GitHub
 * account, and whether every required check passed), with the run limits,
 * what a start had to repair in state.json, and the version; and the model
 * catalogs.
 */
export function registerStatusRoutes(
  app: Express,
  { workbench, options }: RouteDeps,
) {
  app.get("/api/status", async (_req, res) => {
    // The CLI checks share the doctor's 10-second probe results.
    const recovery = workbench.store.recovery;
    res.json({
      ...(await workbench.status()),
      limits: workbench.limits,
      ...(recovery ? { recovery } : {}),
      version: options.version ?? version,
    });
  });
  app.get("/api/models", async (req, res) => {
    // Without a provider the Codex catalog is returned, as before.
    const provider = z
      .enum(agentProviders)
      .default("codex")
      .safeParse(req.query.provider);
    if (!provider.success)
      throw new AppError((m) => m.common.unsupportedProvider, 400);
    res.json(await workbench.models(provider.data));
  });
}
