/**
 * Licensing: GET, PUT and DELETE /api/license and POST /api/license/trial.
 *
 * Owned by 4B-licensing, which adds the routes. createApp already registers
 * this module in its fixed place, before the /api 404 handler.
 */
import type { Express } from "express";
import type { RouteDeps } from "./types.js";

export function registerLicenseRoutes(_app: Express, _deps: RouteDeps) {}
