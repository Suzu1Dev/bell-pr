import type { Express } from "express";
import { z } from "zod";
import { PasswordlessSudo, sudoPasswordSchema } from "../sudo.js";
import type { RouteDeps } from "./types.js";

/** Same-origin checks and JSON error handling are installed by createApp. */
export function registerSudoRoutes(app: Express, { options }: RouteDeps) {
  const sudo = options.sudo ?? new PasswordlessSudo();
  app.get("/api/system/sudo", async (_req, res) => res.json({ sudo: await sudo.status() }));
  app.post("/api/system/sudo", async (req, res) => {
    const { password } = sudoPasswordSchema.parse(req.body);
    res.json({ sudo: await sudo.enable(password) });
  });
  app.delete("/api/system/sudo", async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    res.json({ sudo: await sudo.disable() });
  });
}
