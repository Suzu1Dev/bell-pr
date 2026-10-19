import type { Express } from "express";
import { z } from "zod";
import type { RouteDeps } from "./types.js";

/**
 * Reading a run's code beyond its diff: the unchanged code around each
 * change and the walkthroughs of the functions that hold them. Reading is
 * learning, so these routes are open on every plan.
 */
export function registerReadingRoutes(app: Express, { workbench }: RouteDeps) {
  app.get("/api/runs/:id/context", async (req, res) => {
    const { path: filePath, fingerprint, base } = z
      .object({
        path: z.string().min(1).max(1024),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        base: z.string().regex(/^[a-f0-9]{40,64}$/),
      })
      .strict()
      .parse(req.query);
    res.json(
      await workbench.contextLines(req.params.id, filePath, fingerprint, base),
    );
  });
  app.post("/api/runs/:id/walkthroughs", async (req, res) => {
    const { filePath, retry } = z
      .object({
        filePath: z.string().min(1).max(1024),
        retry: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    res.json(await workbench.walkthrough(req.params.id, filePath, retry));
  });
}
