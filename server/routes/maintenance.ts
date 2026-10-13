/**
 * Storage maintenance: cleanup, GET /api/storage and GET /api/diagnostics.
 *
 * Owned by 3C-reliability-storage, which adds the routes. createApp already
 * registers this module in its fixed place, before the /api 404 handler.
 */
import type { Express } from "express";
import type { RouteDeps } from "./types.js";

export function registerMaintenanceRoutes(_app: Express, _deps: RouteDeps) {}
