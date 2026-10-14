import type { Express } from "express";
import { z } from "zod";
import { runDraftSchema } from "../drafts.js";
import { learningExport } from "../learning-export.js";
import { publishChecks } from "../publish.js";
import { currentLocale } from "../i18n/index.js";
import type { RouteDeps } from "./types.js";

// The commit message is passed to git verbatim, so newline is the only control character allowed.
const commitMessageField = runDraftSchema.shape.commitMessage;

/**
 * Reviewing a run's changes and publishing them: the learning export, the
 * diff, chat and explanations, the PR draft, notes, per-file review and the
 * review rerun, approval, maintainer feedback and publishing.
 */
export function registerReviewRoutes(app: Express, { workbench }: RouteDeps) {
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
    // aiDisclosure turns the PR's AI-assistance line on or off; absent keeps the saved choice.
    const draft = runDraftSchema.parse(req.body);
    res.json({ run: await workbench.draft(req.params.id, draft) });
  });
  // Every check publishing runs, with the facts only the server has (local
  // paths, CI files among the changes, the commit e-mail), so the publish
  // dialog can show and confirm the same list.
  app.get("/api/runs/:id/preflight", async (req, res) => {
    const run = workbench.run(req.params.id);
    const files = await workbench.lock(req.params.id, () =>
      workbench.diff(req.params.id),
    );
    res.json({
      checks: await publishChecks(
        run,
        files,
        workbench.store.directory,
        currentLocale(),
      ),
    });
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
          // A stored message can come from an agent, so approval checks it like an edit.
          commitMessage: commitMessageField,
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
}
