import type { Express } from "express";
import { fixedLicense, requirePro } from "../license.js";
import type { RouteDeps } from "./types.js";

/**
 * GitHub-wide contribution discovery: the current job, start and cancel.
 * Starting one is Pro; reading the results and cancelling stay open on
 * every plan.
 */
export function registerDiscoveryRoutes(
  app: Express,
  { discovery, license = fixedLicense("free") }: RouteDeps,
) {
  app.get("/api/discovery", async (_req, res) => {
    res.json(await discovery.get());
  });
  app.post("/api/discovery", requirePro(license, "discovery"), async (req, res) => {
    res.status(202).json(await discovery.start(req.body));
  });
  app.post("/api/discovery/cancel", async (_req, res) => {
    res.json(await discovery.cancel());
  });
}
