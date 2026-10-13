import express, { type ErrorRequestHandler } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ProjectInsightsService,
  contributionSettingsSchema,
} from "./insights.js";
import type { Workbench } from "./workbench.js";
import { AppError } from "./types.js";
import { redact } from "./process.js";
import { DiscoveryService } from "./discovery.js";
import type { AgentSlots } from "./agent-slots.js";
import { learningExport } from "./learning-export.js";
import { localhostGuard, parseAllowedOrigins } from "./http-guard.js";
import { summarizeRun } from "../shared/runs.js";
import { agentProviders } from "../shared/models.js";
import { validBranchName } from "../shared/drafts.js";

// The commit message is passed to git verbatim, so newline is the only control character allowed.
const commitMessageField = z
  .string()
  .trim()
  .max(4000)
  .refine((value) => !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(value), {
    message: "提交訊息只能包含文字與換行。",
  });

// The GitHub branch is pushed as a refspec; empty means the run's own branch.
const publishBranchField = z
  .string()
  .trim()
  .max(100)
  .refine((value) => !value || validBranchName(value), {
    message:
      "GitHub 分支名稱只能用英數字與 . _ - /，不能有 ..，也不能以 . 或 .lock 結尾。",
  });

export function createApp(
  workbench: Workbench,
  {
    port = 4311,
    frontendPort = 4310,
    staticDirectory = path.resolve("dist"),
    allowedOrigins = "",
    agentSlots = workbench.agentSlots,
    agentTimeoutScale = workbench.agentTimeoutScale,
  }: {
    port?: number;
    frontendPort?: number;
    staticDirectory?: string;
    allowedOrigins?: string;
    agentSlots?: AgentSlots;
    agentTimeoutScale?: number;
  } = {},
) {
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
      allowedOrigins: parseAllowedOrigins(allowedOrigins),
      publicPaths: ["/api/health", "/auth"],
    }),
  );
  app.use(express.json({ limit: "160kb", strict: true }));
  app.get("/api/status", async (_req, res) => {
    // CLI checks stay behind the 10-second cache; the limits are static config.
    res.json({ ...(await workbench.status()), limits: workbench.limits });
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
  app.post("/api/runs/:id/plan/revise", async (req, res) => {
    const input = z
      .object({ feedback: z.string().trim().min(1).max(4000) })
      .parse(req.body);
    res.json({
      run: await workbench.revisePlan(req.params.id, input.feedback),
    });
  });
  app.post("/api/runs/:id/team/messages", async (req, res) => {
    const input = z
      .object({
        to: z.string().min(1).max(100),
        content: z.string().trim().min(1).max(4000),
      })
      .parse(req.body);
    res.json({ run: await workbench.sendTeamMessage(req.params.id, input) });
  });
  app.post("/api/runs/:id/team/retry", async (req, res) => {
    const { message } = z
      .object({ message: z.string().trim().min(1).max(4000).optional() })
      .strict()
      .parse(req.body ?? {});
    res.json({ run: await workbench.retryTeam(req.params.id, message) });
  });
  app.get("/api/runs", (_req, res) => {
    // Lists are polled every few seconds; the open run fetches its full record.
    res.json({ runs: workbench.store.data.runs.map(summarizeRun) });
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
  app.get("/api/runs/:id/export.md", (req, res) => {
    const run = workbench.run(req.params.id);
    const repo = workbench.store.data.repos.find(
      (value) => value.id === run.repoId,
    );
    res.type("text/markdown");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="bell-learning-${run.id}.md"`,
    );
    res.send(learningExport(run, repo));
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
        commitMessage: commitMessageField.optional(),
        publishBranch: publishBranchField.optional(),
      })
      .parse(req.body);
    res.json({ run: await workbench.draft(req.params.id, draft) });
  });
  app.patch("/api/runs/:id/notes", async (req, res) => {
    const { filePath, text } = z
      .object({
        filePath: z.string().min(1).max(1024),
        text: z.string().max(2000),
      })
      .parse(req.body);
    res.json({ run: await workbench.saveNote(req.params.id, filePath, text) });
  });
  app.post("/api/runs/:id/review/rerun", async (req, res) => {
    res.json({ run: await workbench.rerunReview(req.params.id) });
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
          commitMessage: z.string().max(4000).optional(),
          publishBranch: z.string().max(100).optional(),
        }),
      })
      .parse(req.body);
    res.json({ run: await workbench.approve(req.params.id, draft) });
  });
  // Button-triggered read of the published PR's reviews, comments and CI;
  // nothing polls it and nothing is ever posted back to GitHub.
  app.post("/api/runs/:id/pr/feedback", async (req, res) => {
    res.json({ run: await workbench.fetchPrFeedback(req.params.id) });
  });
  app.post("/api/runs/:id/publish", async (req, res) => {
    const { fingerprint, acknowledged } = z
      .object({
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        // Preflight item ids the person confirmed in the publish dialog.
        acknowledged: z.array(z.string().max(40)).max(16).optional(),
      })
      .parse(req.body);
    res.json({
      run: await workbench.publish(req.params.id, fingerprint, acknowledged),
    });
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
