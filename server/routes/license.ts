/**
 * Licensing: GET, PUT and DELETE /api/license and POST /api/license/trial.
 * Each answers `{license}`, the LicenseSummary after the change, and a
 * change lets the Workbench apply the new limits at once (queued runs
 * start when the plan allows more).
 */
import type { Express } from "express";
import { z } from "zod";
import type { LicenseSummary } from "../../shared/plans.js";
import { fixedLicense } from "../license.js";
import { AppError } from "../types.js";
import type { RouteDeps } from "./types.js";

export function registerLicenseRoutes(
  app: Express,
  // Without a license service the plan is Free (fail closed).
  { workbench, license = fixedLicense("free") }: RouteDeps,
) {
  const changed = (summary: LicenseSummary) => {
    workbench.entitlementsChanged();
    return { license: summary };
  };
  /** A plan the embedding code fixed cannot change through the API. */
  const fixed = () =>
    new AppError((m) => m.license.fixedPlan, 409, {
      code: "license_env_locked",
    });

  app.get("/api/license", (_req, res) => {
    res.json({ license: license.summary() });
  });
  app.put("/api/license", async (req, res) => {
    const { key } = z
      .object({ key: z.string().max(2048) })
      .strict()
      .parse(req.body);
    if (!license.activate) throw fixed();
    res.json(changed(await license.activate(key)));
  });
  // The client sends Content-Type: application/json, which the guard
  // requires on every DELETE; the body is ignored.
  app.delete("/api/license", async (_req, res) => {
    if (!license.deactivate) throw fixed();
    res.json(changed(await license.deactivate()));
  });
  app.post("/api/license/trial", async (_req, res) => {
    if (!license.startTrial) throw fixed();
    res.json(changed(await license.startTrial()));
  });
}
