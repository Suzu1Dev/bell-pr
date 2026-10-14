/**
 * Storage maintenance: freeing a run's files, deleting a run, a project or
 * all data.
 *
 * Owned by 3C-reliability-storage. createApp already registers this module
 * in its fixed place, before the /api 404 handler.
 */
import type { Express } from "express";
import { AppError } from "../types.js";
import type { RouteDeps } from "./types.js";

export function registerMaintenanceRoutes(app: Express, deps: RouteDeps) {
  const { workbench, discovery } = deps;
  app.delete("/api/runs/:id/workspace", async (req, res) => {
    res.json({ run: await workbench.removeWorkspace(req.params.id) });
  });
  app.delete("/api/runs/:id", async (req, res) => {
    res.json(await workbench.removeRun(req.params.id));
  });
  app.delete("/api/repos/:id", async (req, res) => {
    res.json(await workbench.removeRepository(req.params.id));
  });
  app.post("/api/data/erase", async (req, res) => {
    const confirm = (req.body as { confirm?: unknown } | undefined)?.confirm;
    if (confirm !== "ERASE")
      throw new AppError((m) => m.storage.erase.confirm, 400);
    // An unreadable discovery file is erased too; only a running search waits.
    const job = await discovery.get().then(
      (result) => result.job,
      () => undefined,
    );
    if (job?.status === "running")
      throw new AppError((m) => m.storage.erase.busy, 409);
    res.json(await workbench.eraseAll(confirm));
  });
}
