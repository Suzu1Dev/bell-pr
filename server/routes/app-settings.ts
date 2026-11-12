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
import { refuse } from "../collab-refusal.js";
import type { RouteDeps } from "./types.js";

export function registerAppSettingsRoutes(
  app: Express,
  { workbench, options }: RouteDeps,
) {
  app.get("/api/app-settings", (_req, res) => {
    res.json(workbench.appSettings.view());
  });
  app.put("/api/app-settings", async (req, res) => {
    // Only the person at the host computer may turn BELL PR Group on or off.
    if (
      req.body &&
      typeof req.body === "object" &&
      !Array.isArray(req.body) &&
      (req.body as Record<string, unknown>).groupWork !== undefined &&
      res.locals.deviceId !== undefined
    )
      throw refuse(403, "hostOnly", (m) => m.collab.hostOnly);
    const previousGroup = workbench.appSettings.get().groupWork;
    const view = await workbench.updateAppSettings(req.body);
    const nextGroup = Boolean(view.settings.groupWork);
    if (options.onGroupWorkChange && nextGroup !== Boolean(previousGroup)) {
      try {
        await options.onGroupWorkChange(nextGroup);
      } catch (error) {
        await workbench
          .updateAppSettings({ groupWork: previousGroup ?? null })
          .catch(() => undefined);
        throw error;
      }
    }
    res.json(view);
  });
}
