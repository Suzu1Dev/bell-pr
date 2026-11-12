/**
 * GET /api/health: the product name and version, reachable without
 * signing in (a public path of the guard), for `bell-pr open`, the
 * "already running" check of a second start and container health checks.
 */
import type { Express } from "express";
import { product } from "../../shared/product.js";
import { version } from "../build-info.js";
import { apiListenerProof } from "../api-token.js";
import type { RouteDeps } from "./types.js";

export function registerHealthRoutes(app: Express, { options }: RouteDeps) {
  app.get("/api/health", (req, res) => {
    let proof: string | undefined;
    if (typeof req.query.challenge === "string") {
      const token = options.readApiToken?.() ?? options.apiToken;
      if (token && req.socket.localAddress && req.socket.localPort)
        proof = apiListenerProof(token, req.query.challenge, req.socket.localAddress, req.socket.localPort);
    }
    res.json({ name: product.npmPackage, version: options.version ?? version, ...(proof ? { proof } : {}) });
  });
}
