import express, { type ErrorRequestHandler } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ProjectInsightsService } from "./insights.js";
import type { Workbench } from "./workbench.js";
import { AppError } from "./types.js";
import { redact } from "./process.js";
import { DiscoveryService } from "./discovery.js";
import type { AgentSlots } from "./agent-slots.js";
import { localhostGuard, parseAllowedOrigins } from "./http-guard.js";
import type { LicenseService } from "./license.js";
import type { ApiErrorBody } from "../shared/errors.js";
import { registerAppSettingsRoutes } from "./routes/app-settings.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerDiscoveryRoutes } from "./routes/discovery.js";
import { registerDoctorRoutes } from "./routes/doctor.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerLearningRoutes } from "./routes/learning.js";
import { registerLicenseRoutes } from "./routes/license.js";
import { registerMaintenanceRoutes } from "./routes/maintenance.js";
import { registerModelSettingsRoutes } from "./routes/model-settings.js";
import { registerReposRoutes } from "./routes/repos.js";
import { registerReviewRoutes } from "./routes/review.js";
import { registerRunsRoutes } from "./routes/runs.js";
import { registerStatusRoutes } from "./routes/status.js";
import type { RouteDeps } from "./routes/types.js";

/** Masks secrets in string values, which may quote command output. */
function redactValues<T extends Record<string, unknown>>(values?: T) {
  if (!values) return undefined;
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === "string" ? redact(value) : value,
    ]),
  ) as T;
}

/**
 * The JSON body for an AppError: the message plus whatever structure it
 * carries. Details come first so they can never replace the message or
 * the code; absent fields are left out, so an error without a code still
 * sends only `{error}`.
 */
function appErrorBody(error: AppError): ApiErrorBody {
  return {
    ...redactValues(error.details),
    error: redact(error.message),
    code: error.code,
    params: redactValues(error.params),
    fixes: error.fixes,
  };
}

/**
 * How createApp is configured. Every field is optional: the server entry
 * point and tests set what they need, and later work only fills in values.
 */
export interface AppOptions {
  /** The built UI; `dist` under the working directory by default. */
  staticDirectory?: string;
  /**
   * Extra trusted origins, such as a TLS proxy in front of BELL PR: the
   * comma-separated BELLPR_ALLOWED_ORIGINS value or a list. Invalid
   * origins throw.
   */
  allowedOrigins?: string | string[];
  /** The API port, 4311 by default; its local hosts are trusted. */
  port?: number;
  /** The UI dev server port, 4310 by default; also trusted. */
  frontendPort?: number;
  /** CLI slots for analysis and discovery; the Workbench's by default. */
  agentSlots?: AgentSlots;
  /** Scales analysis and discovery timeouts; the Workbench's by default. */
  agentTimeoutScale?: number;
  /** The session secret for sign-in; passed to the guard. */
  sessionToken?: string;
  /** The plan in effect, for Pro gating; route modules get it too. */
  license?: LicenseService;
  /** The app version the API reports. */
  version?: string;
  /** Development mode, with the UI dev server in front. */
  dev?: boolean;
  /** The public URL when BELL PR is served through a proxy. */
  publicUrl?: string;
}

export function createApp(workbench: Workbench, options: AppOptions = {}) {
  const {
    port = 4311,
    frontendPort = 4310,
    staticDirectory = path.resolve("dist"),
    allowedOrigins = "",
    agentSlots = workbench.agentSlots,
    agentTimeoutScale = workbench.agentTimeoutScale,
  } = options;
  const insights = new ProjectInsightsService(workbench.store, {
    getModelCatalog: (provider) => workbench.models(provider),
    agentSlots,
    agentTimeoutScale,
  });
  const discovery = new DiscoveryService(workbench.store, {
    getModelCatalog: (provider) => workbench.models(provider),
    agentSlots,
    agentTimeoutScale,
  });
  const app = express();
  app.locals.insights = insights;
  app.locals.discovery = discovery;
  app.disable("x-powered-by");
  app.use(
    localhostGuard({
      ports: [port, frontendPort],
      allowedOrigins:
        typeof allowedOrigins === "string"
          ? parseAllowedOrigins(allowedOrigins)
          : allowedOrigins,
      sessionToken: options.sessionToken,
      publicPaths: ["/api/health", "/auth"],
    }),
  );
  app.use(express.json({ limit: "160kb", strict: true }));
  const deps: RouteDeps = {
    workbench,
    insights,
    discovery,
    agentSlots,
    options,
    license: options.license,
  };
  // No two of these routes match the same request, so the order of the
  // modules cannot change which handler answers.
  registerStatusRoutes(app, deps);
  registerDiscoveryRoutes(app, deps);
  registerReposRoutes(app, deps);
  registerModelSettingsRoutes(app, deps);
  registerRunsRoutes(app, deps);
  registerReviewRoutes(app, deps);
  // Route modules that later work fills in, in a fixed order, so none of
  // them needs to edit this list.
  registerHealthRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerMaintenanceRoutes(app, deps);
  registerLearningRoutes(app, deps);
  registerDoctorRoutes(app, deps);
  registerAppSettingsRoutes(app, deps);
  registerLicenseRoutes(app, deps);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "找不到 API。" });
  });
  if (existsSync(staticDirectory)) {
    app.use(express.static(staticDirectory, { index: false }));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(staticDirectory, "index.html"));
    });
  }
  const errors: ErrorRequestHandler = (error, req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("；"),
      });
      return;
    }
    if (error instanceof AppError) {
      res.status(error.statusCode).json(appErrorBody(error));
      return;
    }
    if (error?.type === "entity.parse.failed") {
      res.status(400).json({ error: "JSON 格式不正確。" });
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "請求內容過大。" });
      return;
    }
    // The stack only reaches the local journal; the client gets a generic message.
    console.error(
      "[BELL-PR]",
      req.method,
      req.path,
      redact(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ),
    );
    res.status(500).json({ error: "操作未完成；請檢查本機服務記錄。" });
  };
  app.use(errors);
  return app;
}
