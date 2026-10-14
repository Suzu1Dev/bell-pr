import type { Express } from "express";
import type { RouteDeps } from "./types.js";

/**
 * Syncing a run onto the latest commit of its target branch: the sync
 * itself (a published PR gets a sync round), undoing an unpublished run's
 * sync, and an agent resolving the conflicts a sync left.
 */
export function registerSyncRoutes(app: Express, { workbench }: RouteDeps) {
  app.post("/api/runs/:id/sync", async (req, res) => {
    res.json(await workbench.syncRun(req.params.id));
  });
  app.post("/api/runs/:id/sync/resolve", async (req, res) => {
    res.json({ run: await workbench.resolveConflicts(req.params.id) });
  });
  app.post("/api/runs/:id/sync/undo", async (req, res) => {
    res.json({ run: await workbench.undoSync(req.params.id) });
  });
}
