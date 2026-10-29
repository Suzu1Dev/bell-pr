import express, { type ErrorRequestHandler, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ProjectInsightsService } from "./insights.js";
import type { Workbench } from "./workbench.js";
import { AppError } from "./types.js";
import { redact } from "./secrets.js";
import { DiscoveryService } from "./discovery.js";
import type { AgentSlots } from "./agent-slots.js";
import { localhostGuard, parseAllowedOrigins } from "./http-guard.js";
import type { ApiErrorBody } from "../shared/errors.js";
import { formatters, htmlLang, parseLocale } from "../shared/i18n/locale.js";
import { defaultStaticDir } from "./config.js";
import { currentLocale, sm, withLocale } from "./i18n/index.js";
import { log } from "./log.js";
import { setAgentDataDirectory } from "./sandbox.js";
import { registerAppSettingsRoutes } from "./routes/app-settings.js";
import { registerDiscoveryRoutes } from "./routes/discovery.js";
import { registerDoctorRoutes } from "./routes/doctor.js";
import { registerFollowUpsRoutes } from "./routes/follow-ups.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerLearningRoutes } from "./routes/learning.js";
import { registerMaintenanceRoutes } from "./routes/maintenance.js";
import { registerModelSettingsRoutes } from "./routes/model-settings.js";
import { registerReadingRoutes } from "./routes/reading.js";
import { registerReposRoutes } from "./routes/repos.js";
import { registerReviewRoutes } from "./routes/review.js";
import { registerRunsRoutes } from "./routes/runs.js";
import { registerStatusRoutes } from "./routes/status.js";
import { registerSyncRoutes } from "./routes/sync.js";
import type { RouteDeps } from "./routes/types.js";
import { registerUnderstandingRoutes } from "./routes/understanding.js";
import { registerContributionRoutes } from "./routes/contribution.js";
import { registerByHandRoutes } from "./routes/by-hand.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerSudoRoutes } from "./routes/sudo.js";
import type { PasswordlessSudo } from "./sudo.js";

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
  sudo?: PasswordlessSudo;
  /**
   * The built UI: the dist/ folder next to the server code by default, not
   * the working directory.
   */
  staticDirectory?: string;
  /**
   * Extra trusted origins, such as a TLS proxy in front of BELL PR: the
   * comma-separated BELLPR_ALLOWED_ORIGINS value or a list. Invalid
   * origins throw.
   */
  allowedOrigins?: string | string[];
  /** The API port, 4311 by default; its local hosts are trusted. */
  port?: number;
  /** The UI dev server port, 4310 by default; trusted only in `dev`. */
  frontendPort?: number;
  /** CLI slots for analysis and discovery; the Workbench's by default. */
  agentSlots?: AgentSlots;
  /**
   * Scales analysis and discovery timeouts. By default the Workbench's,
   * read for each agent call so a changed app setting applies.
   */
  agentTimeoutScale?: number;
  /** The app version the API reports. */
  version?: string;
  /**
   * Operating system for Linux-only routes. This process by default.
   * Tests pass another value; the server entry does not.
   */
  platform?: NodeJS.Platform;
  /** Development mode, with the UI dev server in front. Off by default. */
  dev?: boolean;
  /**
   * The public URL when BELL PR is served through a proxy; its origin is
   * trusted like an allowed origin.
   */
  publicUrl?: string;
  /**
   * The install's API token. When set, /api except GET and HEAD
   * /api/health requires it. `readApiToken` is read per request so
   * rotation applies at once.
   */
  apiToken?: string;
  readApiToken?: () => string | undefined;
}

export function createApp(workbench: Workbench, options: AppOptions = {}) {
  const {
    port = 4311,
    frontendPort = 4310,
    dev = false,
    staticDirectory = defaultStaticDir(),
    allowedOrigins = "",
    agentSlots = workbench.agentSlots,
    agentTimeoutScale = () => workbench.agentTimeoutScale,
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
  // Agents are denied reading BELL's data directory outside their own checkout.
  setAgentDataDirectory(workbench.store.directory);
  app.disable("x-powered-by");
  // req.secure and req.ip follow X-Forwarded-* only from a proxy on this
  // machine, such as a TLS terminator in front of BELL PR.
  app.set("trust proxy", "loopback");
  // Each request runs in its own locale: X-Bell-Locale, then ?locale=, then
  // the server default. Everything the request starts inherits it.
  app.use((req, _res, next) => {
    withLocale(
      parseLocale(req.get("x-bell-locale")) ??
        parseLocale(String(req.query.locale ?? "")) ??
        currentLocale(),
      next,
    );
  });
  const configuredOrigins =
    typeof allowedOrigins === "string"
      ? parseAllowedOrigins(allowedOrigins)
      : allowedOrigins;
  app.use(
    localhostGuard({
      // The Vite dev server's port is trusted in development only.
      ports: dev ? [port, frontendPort] : [port],
      // An empty entry throws, so the public origin is added only when set.
      allowedOrigins: [
        ...new Set(
          options.publicUrl
            ? [...configuredOrigins, new URL(options.publicUrl).origin]
            : configuredOrigins,
        ),
      ],
      ...(options.apiToken !== undefined ? { apiToken: options.apiToken } : {}),
      ...(options.readApiToken ? { readApiToken: options.readApiToken } : {}),
    }),
  );
  app.use(express.json({ limit: "160kb", strict: true }));
  const deps: RouteDeps = {
    workbench,
    insights,
    discovery,
    agentSlots,
    options,
  };
  // No two of these routes match the same request, so the order of the
  // modules cannot change which handler answers.
  registerStatusRoutes(app, deps);
  registerDiscoveryRoutes(app, deps);
  registerReposRoutes(app, deps);
  registerModelSettingsRoutes(app, deps);
  registerRunsRoutes(app, deps);
  registerReviewRoutes(app, deps);
  registerReadingRoutes(app, deps);
  registerSyncRoutes(app, deps);
  registerFollowUpsRoutes(app, deps);
  // Route modules that later work fills in, in a fixed order, so none of
  // them needs to edit this list.
  registerHealthRoutes(app, deps);
  registerMaintenanceRoutes(app, deps);
  registerLearningRoutes(app, deps);
  registerDoctorRoutes(app, deps);
  registerAppSettingsRoutes(app, deps);
  registerUnderstandingRoutes(app, deps);
  registerContributionRoutes(app, deps);
  registerByHandRoutes(app, deps);
  registerSessionRoutes(app, deps);
  if ((options.platform ?? process.platform) === "linux") registerSudoRoutes(app, deps);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: sm().common.notFound });
  });
  const indexFile = path.join(staticDirectory, "index.html");
  if (existsSync(indexFile)) {
    // Hashed bundles never change; a missing one is a 404, not the app page.
    app.use(
      "/assets",
      express.static(path.join(staticDirectory, "assets"), {
        index: false,
        immutable: true,
        maxAge: "1y",
      }),
      (_req, res) => {
        res.status(404).end();
      },
    );
    // The page itself is revalidated, so an update reaches every browser.
    const noCache = (res: Response, file: string) => {
      if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    };
    app.use(
      express.static(staticDirectory, { index: false, setHeaders: noCache }),
    );
    app.get("/{*splat}", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(indexFile, { cacheControl: false });
    });
  } else {
    // Started from source without `npm run build`: say so instead of a 404.
    app.get("/{*splat}", (_req, res) => {
      const messages = sm().cli.start;
      res
        .status(503)
        .setHeader("Cache-Control", "no-store")
        .type("html")
        .send(
          `<!doctype html><html lang="${htmlLang(currentLocale())}"><head><meta charset="utf-8"><title>${messages.uiMissingTitle}</title></head><body><p>${messages.uiMissingPage}</p></body></html>`,
        );
    });
  }
  const errors: ErrorRequestHandler = (error, req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: formatters(currentLocale()).list(
          // An issue with the whole body (a wrong type, an unknown key of a
          // strict object) has no path to name.
          error.issues.map((issue) =>
            issue.path.length
              ? `${issue.path.join(".")}: ${issue.message}`
              : issue.message,
          ),
          { type: "unit" },
        ),
      });
      return;
    }
    if (error instanceof AppError) {
      if (error.statusCode >= 500)
        log.error("Request failed", {
          method: req.method,
          path: req.path,
          status: error.statusCode,
          error: redact(error.message),
        });
      res.status(error.statusCode).json(appErrorBody(error));
      return;
    }
    if (error?.type === "entity.parse.failed") {
      res.status(400).json({ error: sm().common.invalidJson });
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: sm().common.payloadTooLarge });
      return;
    }
    // The stack only reaches the local log; the client gets a generic message.
    log.error("Request failed", {
      method: req.method,
      path: req.path,
      status: 500,
      error: redact(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ),
    });
    res.status(500).json({ error: sm().common.internalError });
  };
  app.use(errors);
  return app;
}
