/**
 * App settings: GET and PUT /api/app-settings.
 *
 * Owned by 4A-environment-doctor-and-settings, which adds the routes.
 * createApp already registers this module in its fixed place, before the
 * /api 404 handler.
 */
import type { Express } from "express";
import type { RouteDeps } from "./types.js";

export function registerAppSettingsRoutes(_app: Express, _deps: RouteDeps) {}
