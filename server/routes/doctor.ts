/**
 * Environment checks: GET /api/doctor returns the DoctorReport, and
 * `?refresh=1` probes again instead of reusing results up to 10 seconds
 * old (the setup checklist's "Re-check").
 *
 * createApp registers this module in its fixed place, before the /api 404
 * handler.
 */
import type { Express } from "express";
import { version } from "../build-info.js";
import type { DoctorAppInfo } from "../doctor.js";
import type { RouteDeps } from "./types.js";

/** What the app check reports besides the limits: version, port and plan. */
export function doctorAppInfo({ options, license }: RouteDeps): DoctorAppInfo {
  return {
    version: options.version ?? version,
    ...(options.port ? { port: options.port } : {}),
    ...(license ? { plan: license.summary().plan } : {}),
  };
}

export function registerDoctorRoutes(app: Express, deps: RouteDeps) {
  app.get("/api/doctor", async (req, res) => {
    const refresh = String(req.query.refresh ?? "");
    res.json(
      await deps.workbench.doctor({
        force: refresh === "1" || refresh === "true",
        app: doctorAppInfo(deps),
      }),
    );
  });
}
