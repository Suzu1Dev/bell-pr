import type { Express } from "express";
import { z } from "zod";
import type { RouteDeps } from "./types.js";

/**
 * Reading a run's code beyond its diff: the unchanged code around each
 * change, the walkthroughs of the functions that hold them, the commits of
 * a published contribution, and checking the request's premise against the
 * code.
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
  app.get("/api/runs/:id/commits", async (req, res) => {
    res.json({ commits: await workbench.commits(req.params.id) });
  });
  app.get("/api/runs/:id/commits/:sha", async (req, res) => {
    const sha = z.string().regex(/^[0-9a-f]{40,64}$/).parse(req.params.sha);
    res.json(await workbench.commit(req.params.id, sha));
  });
  app.post("/api/runs/:id/premise", async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    res.json(await workbench.checkPremise(req.params.id));
  });
}
