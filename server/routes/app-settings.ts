/**
 * App settings: GET and PUT /api/app-settings, each answering with the
 * AppSettingsView `{settings, lockedBy}`. PUT takes any of the settings
 * (null removes a saved value); unknown keys and invalid values are 400,
 * and a setting an environment variable locks is 409. New limits apply at
 * once.
 *
 * createApp registers this module in its fixed place, before the /api 404
 * handler.
 */
import type { Express } from "express";
import type { RouteDeps } from "./types.js";

export function registerAppSettingsRoutes(app: Express, { workbench }: RouteDeps) {
  app.get("/api/app-settings", (_req, res) => {
    res.json(workbench.appSettings.view());
  });
  app.put("/api/app-settings", async (req, res) => {
    res.json(await workbench.updateAppSettings(req.body));
  });
}
