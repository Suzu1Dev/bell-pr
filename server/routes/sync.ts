import type { Express } from "express";
import { participantHeader } from "../coordination-routes.js";
import type { RouteDeps } from "./types.js";

/**
 * Syncing a run onto the latest commit of its target branch: the sync
 * itself (a published PR gets a sync round), undoing an unpublished run's
 * sync, and an agent resolving the conflicts a sync left.
 */
export function registerSyncRoutes(app: Express, { workbench, options }: RouteDeps) {
  app.post("/api/runs/:id/sync", async (req, res) => {
    const asker = options.collab
      ? { participant: req.get(participantHeader), deviceId: res.locals.deviceId }
      : undefined;
    res.json(await workbench.syncRun(req.params.id, asker));
  });
  app.post("/api/runs/:id/sync/resolve", async (req, res) => {
    res.json({ run: await workbench.resolveConflicts(req.params.id) });
  });
  app.post("/api/runs/:id/sync/undo", async (req, res) => {
    res.json({ run: await workbench.undoSync(req.params.id) });
  });
}
