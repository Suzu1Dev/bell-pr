import type { Express } from "express";
import { z } from "zod";
import { sessionInputLimit } from "../../shared/session.js";
import { setupTurnLimit } from "../../shared/setup-needs.js";
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
  // The setup items a Full access run's person ticked, by command; the server
  // takes only commands stored on the run's own setup lists.
  app.post("/api/runs/:id/session/setup", async (req, res) => {
    const { commands } = z
      .object({
        commands: z.array(z.string().trim().min(1).max(300)).min(1).max(setupTurnLimit),
      })
      .strict()
      .parse(req.body);
    res.json({ run: await workbench.startSetupSession(req.params.id, commands) });
  });
  app.post("/api/runs/:id/session/cancel", async (req, res) => {
    res.json({ run: await workbench.cancelSession(req.params.id) });
  });
}
