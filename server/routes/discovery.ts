import type { Express } from "express";
import type { RouteDeps } from "./types.js";

/** GitHub-wide contribution discovery: the current job, start and cancel. */
export function registerDiscoveryRoutes(
  app: Express,
  { discovery }: RouteDeps,
) {
  app.get("/api/discovery", async (_req, res) => {
    res.json(await discovery.get());
  });
  app.post("/api/discovery", async (req, res) => {
    res.status(202).json(await discovery.start(req.body));
  });
  app.post("/api/discovery/cancel", async (_req, res) => {
    res.json(await discovery.cancel());
  });
}
