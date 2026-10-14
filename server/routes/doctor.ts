/**
 * Environment checks: GET /api/doctor returns the DoctorReport.
 *
 * Owned by 4A-environment-doctor-and-settings, which adds the routes.
 * createApp already registers this module in its fixed place, before the
 * /api 404 handler.
 */
import type { Express } from "express";
import type { RouteDeps } from "./types.js";

export function registerDoctorRoutes(_app: Express, _deps: RouteDeps) {}
