/**
 * GET /api/health: the product name and version, reachable without
 * signing in, for the command line and container health checks.
 *
 * Owned by 3A-packaging-runtime, which adds the routes. createApp already
 * registers this module in its fixed place, before the /api 404 handler.
 */
import type { Express } from "express";
import type { RouteDeps } from "./types.js";

export function registerHealthRoutes(_app: Express, _deps: RouteDeps) {}
