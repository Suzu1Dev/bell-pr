import type { Express } from "express";
import { z } from "zod";
import { sessionInputLimit } from "../../shared/session.js";
import type { RouteDeps } from "./types.js";

export function registerSessionRoutes(app: Express, { workbench }: RouteDeps) {
  app.post("/api/runs/:id/session/messages", async (req, res) => {
    const { content } = z
      .object({
        content: z.string().trim().min(1).max(sessionInputLimit),
      })
      .strict()
      .parse(req.body);
    res.json({ run: await workbench.startSession(req.params.id, content) });
  });
  app.post("/api/runs/:id/session/cancel", async (req, res) => {
    res.json({ run: await workbench.cancelSession(req.params.id) });
  });
}
