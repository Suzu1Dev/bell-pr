import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  ProjectInsightsService,
  contributionSettingsSchema,
} from "./insights.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import { AppError } from "./types.js";
import { redact } from "./process.js";
import { DiscoveryService } from "./discovery.js";
import { agentProviders } from "../shared/models.js";

export function parseAllowedOrigins(value = ""): string[] {
  if (!value.trim()) return [];
  return value.split(",").map((entry) => {
    const value = entry.trim();
    try {
      const url = new URL(value);
      if (
        !/^https?:\/\/[^/?#\\\s@*]+$/i.test(value) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.hostname.includes("*") ||
        value.endsWith(":") ||
        url.port === "0"
      )
        throw new Error("Invalid origin");
      return url.origin;
    } catch {
      throw new Error(
        "BELLPR_ALLOWED_ORIGINS must contain comma-separated HTTP(S) origins without credentials, paths, queries, fragments, or wildcards.",
      );
    }
  });
}

export function localhostGuard(
  ports: number[],
  configuredOrigins = "",
): RequestHandler {
  const localHosts = new Set(
    ports.flatMap((port) => [
      `localhost:${port}`,
      `127.0.0.1:${port}`,
      `[::1]:${port}`,
    ]),
  );
  const localOrigins = new Set([...localHosts].map((host) => `http://${host}`));
  const allowedOrigins = new Set(parseAllowedOrigins(configuredOrigins));
  const allowedHosts = new Set([
    ...localHosts,
    ...[...allowedOrigins].map((origin) => new URL(origin).host),
  ]);
  return (req, res, next) => {
    const host = (req.headers.host ?? "").toLowerCase();
    if (!allowedHosts.has(host)) {
      res.status(403).json({ error: "不允許此服務網址。" });
      return;
    }
    const origin = req.get("origin");
    if (
      (origin &&
        !(
          (localHosts.has(host) && localOrigins.has(origin)) ||
          (allowedOrigins.has(origin) && new URL(origin).host === host)
        )) ||
      req.get("sec-fetch-site") === "cross-site"
    ) {
      res.status(403).json({ error: "不允許跨來源請求。" });
      return;
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.is("application/json")
    ) {
      res.status(415).json({ error: "變更操作必須使用 application/json。" });
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    if (req.path.startsWith("/api/"))
      res.setHeader("Cache-Control", "no-store");
    next();
  };
}

export function createApp(
  workbench: Workbench,
  {
    port = 4311,
    frontendPort = 4310,
    staticDirectory = path.resolve("dist"),
    allowedOrigins = "",
  } = {},
) {
  const insights = new ProjectInsightsService(workbench.store, {
    getModelCatalog: (provider) => workbench.models(provider),
  });
  const discovery = new DiscoveryService(workbench.store, {
    getModelCatalog: (provider) => workbench.models(provider),
  });
  const app = express();
  app.locals.insights = insights;
  app.locals.discovery = discovery;
  app.disable("x-powered-by");
  app.use(localhostGuard([port, frontendPort], allowedOrigins));
  app.use(express.json({ limit: "160kb", strict: true }));
  app.get("/api/status", async (_req, res) => {
    res.json(await workbench.status());
  });
  app.get("/api/models", async (req, res) => {
    // Without a provider the Codex catalog is returned, as before.
    const provider = z
      .enum(agentProviders)
      .default("codex")
      .safeParse(req.query.provider);
    if (!provider.success)
      throw new AppError("不支援這個 Agent 類型。", 400);
    res.json(await workbench.models(provider.data));
  });
  app.get("/api/discovery", async (_req, res) => {
    res.json(await discovery.get());
  });
  app.post("/api/discovery", async (req, res) => {
    res.status(202).json(await discovery.start(req.body));
  });
  app.post("/api/discovery/cancel", async (_req, res) => {
    res.json(await discovery.cancel());
  });
  app.get("/api/repos", (_req, res) => {
    res.json({ repos: workbench.store.data.repos });
  });
  app.post("/api/repos", async (req, res) => {
    const { source } = z
      .object({ source: z.string().trim().min(1).max(4096) })
      .parse(req.body);
    res.status(201).json({ repo: await workbench.importRepository(source) });
  });
  app.get("/api/repos/:id/insights", async (req, res) =>
    res.json(await insights.get(req.params.id)),
  );
  app.post("/api/repos/:id/insights", async (req, res) =>
    res.json(await insights.generate(req.params.id)),
  );
  app.post("/api/repos/:id/insights/recommendations", async (req, res) =>
    res.json(await insights.generateMore(req.params.id, req.body)),
  );
  app.put("/api/repos/:id/insights/preferences", async (req, res) =>
    res.json({
      recommendationPreferences: await insights.setRecommendationPreferences(
        req.params.id,
        req.body,
      ),
    }),
  );
  app.get("/api/model-settings", async (_req, res) =>
    res.json({ settings: await insights.getModelSettings() }),
  );
  app.put("/api/model-settings", async (req, res) =>
    res.json({ settings: await insights.setModelSettings(req.body) }),
  );
  app.get("/api/repos/:id/settings", async (req, res) =>
    res.json({ settings: await insights.getSettings(req.params.id) }),
  );
  app.put("/api/repos/:id/settings", async (req, res) =>
    res.json({ settings: await insights.setSettings(req.params.id, req.body) }),
  );
  app.post("/api/runs/:id/plan/approve", async (req, res) =>
    res.json({ run: await workbench.approvePlan(req.params.id) }),
  );
  app.post("/api/runs/:id/team/messages", async (req, res) => {
    const input = z
      .object({
        to: z.string().min(1).max(100),
        content: z.string().trim().min(1).max(4000),
      })
      .parse(req.body);
    res.json({ run: await workbench.sendTeamMessage(req.params.id, input) });
  });
  app.get("/api/runs", (_req, res) => {
    res.json({ runs: workbench.store.data.runs });
  });
  app.post("/api/runs", async (req, res) => {
    const { repoId, prompt, title, settings } = z
      .object({
        repoId: z.string().uuid(),
        prompt: z.string().trim().min(10).max(20_000),
        title: z.string().trim().min(1).max(180).optional(),
        settings: contributionSettingsSchema.optional(),
      })
      .parse(req.body);
    res.status(202).json({
      run: await workbench.createRun(
        repoId,
        prompt,
        title,
        settings ?? (await insights.getSettings(repoId)),
      ),
    });
  });
  app.get("/api/runs/:id", (req, res) => {
    res.json({ run: workbench.run(req.params.id) });
  });
  app.post("/api/runs/:id/cancel", async (req, res) => {
    res.json({ run: await workbench.cancel(req.params.id) });
  });
  app.get("/api/runs/:id/diff", async (req, res) => {
    const files = await workbench.lock(req.params.id, () =>
      workbench.diff(req.params.id),
    );
    res.json({ files });
  });
  app.post("/api/runs/:id/chat", async (req, res) => {
    const { filePath, question } = z
      .object({
        filePath: z.string().min(1).max(1024),
        question: z.string().trim().min(1).max(8000),
      })
      .parse(req.body);
    res.json({
      answer: await workbench.chat(req.params.id, filePath, question),
    });
  });
  app.post("/api/runs/:id/explanations", async (req, res) => {
    const options = z
      .object({
        retry: z.boolean().optional(),
        filePath: z.string().min(1).max(1024).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(await workbench.explanations(req.params.id, options));
  });
  app.post("/api/runs/:id/draft/prepare", async (req, res) => {
    const options = z
      .object({ refresh: z.boolean().optional() })
      .strict()
      .parse(req.body);
    res.json(await workbench.prepareDraft(req.params.id, options));
  });
  app.patch("/api/runs/:id/draft", async (req, res) => {
    const draft = z
      .object({
        title: z.string().trim().min(1).max(180),
        body: z.string().max(60_000),
      })
      .parse(req.body);
    res.json({ run: await workbench.draft(req.params.id, draft) });
  });
  app.post("/api/runs/:id/review", async (req, res) => {
    const { filePath, reviewed, fingerprint } = z
      .object({
        filePath: z.string().min(1).max(1024),
        reviewed: z.boolean(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(req.body);
    res.json({
      run: await workbench.review(
        req.params.id,
        filePath,
        reviewed,
        fingerprint,
      ),
    });
  });
  app.post("/api/runs/:id/approve", async (req, res) => {
    const { draft } = z
      .object({
        draft: z.object({
          title: z.string().min(1).max(180),
          body: z.string().max(60_000),
        }),
      })
      .parse(req.body);
    res.json({ run: await workbench.approve(req.params.id, draft) });
  });
  app.post("/api/runs/:id/publish", async (req, res) => {
    const { fingerprint } = z
      .object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(req.body);
    res.json({ run: await workbench.publish(req.params.id, fingerprint) });
  });
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
      res.status(error.statusCode).json({ error: redact(error.message) });
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

async function main() {
  const port = Number(process.env.BELLPR_PORT ?? 4311);
  const frontendPort = Number(process.env.BELLPR_FRONTEND_PORT ?? 4310);
  if (
    ![port, frontendPort].every(
      (value) => Number.isInteger(value) && value >= 1024 && value <= 65535,
    )
  )
    throw new Error(
      "BELLPR_PORT / BELLPR_FRONTEND_PORT must be between 1024 and 65535.",
    );
  const allowedOrigins = process.env.BELLPR_ALLOWED_ORIGINS ?? "";
  parseAllowedOrigins(allowedOrigins);
  const store = new Store(
    path.resolve(process.env.BELLPR_DATA_DIR ?? ".bellpr"),
  );
  await store.initialize();
  const workbench = new Workbench(store);
  const app = createApp(workbench, { port, frontendPort, allowedOrigins });
  const server = app.listen(port, "127.0.0.1", () =>
    console.log(`BELL-PR → http://127.0.0.1:${port}`),
  );
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const stopped = Promise.all([
      workbench.shutdown(),
      app.locals.insights.shutdown(),
      app.locals.discovery.shutdown(),
    ]);
    server.close(() => {
      void stopped.finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      redact(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ),
    );
    process.exitCode = 1;
  });
}
