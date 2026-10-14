/**
 * GET /api/health: the product name and version, reachable without
 * signing in (a public path of the guard), for `bell-pr open`, the
 * "already running" check of a second start and container health checks.
 */
import type { Express } from "express";
import { product } from "../../shared/product.js";
import { version } from "../build-info.js";
import type { RouteDeps } from "./types.js";

export function registerHealthRoutes(app: Express, { options }: RouteDeps) {
  app.get("/api/health", (_req, res) => {
    res.json({ name: product.npmPackage, version: options.version ?? version });
  });
}
