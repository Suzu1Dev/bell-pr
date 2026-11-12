import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  overridableCheckIds,
  overrideReasonLimits,
} from "../../shared/contribution.js";
import { runDraftSchema } from "../drafts.js";
import { learningExport } from "../learning-export.js";
import { publishChecks, resumesPublish } from "../publish.js";
import { currentLocale, sm } from "../i18n/index.js";
import { participantHeader } from "../coordination-routes.js";
import { notJoined } from "../collab-refusal.js";
import type { CollabHub } from "../collab-hub.js";
import { holdGuard } from "../hold-guard.js";
import { participantOf } from "./collab.js";
import type { TeamActorIdentity } from "../team-records.js";
import type { RouteDeps } from "./types.js";

// The commit message is passed to git verbatim, so newline is the only control character allowed.
const commitMessageField = runDraftSchema.shape.commitMessage;

/**
 * Reviewing a run's changes and publishing them: the learning export, the
 * diff, chat and explanations, the PR draft, notes, per-file review and the
 * review rerun, approval, maintainer feedback and publishing.
 */
export function registerReviewRoutes(
  app: Express,
  { workbench, options }: RouteDeps,
) {
  // The group's write guard, only with --group: who is asking is the
  // participant token if the request sends one, else the device it comes from.
  const holds = (req: Request, res: Response) =>
    options.collab
      ? holdGuard(options.collab, {
          participant: req.get(participantHeader),
          deviceId: res.locals.deviceId,
        })
      : undefined;

  const optionalReviewer = (req: Request, res: Response): TeamActorIdentity | undefined => {
    if (!options.collab || options.collab.status().state !== "ready") return undefined;
    const token = req.get(participantHeader);
    if (token !== undefined) {
      const found = participantOf(options.collab, token);
      return found
        ? {
            id: found.actor.id,
            name: found.person.name ?? found.actor.id,
            admin: found.actor.role === "admin",
          }
        : undefined;
    }
    const matches = Object.entries(options.collab.side().people ?? {}).filter(
      ([, p]) => !p.removedAt && !p.disabledAt && p.deviceId === res.locals.deviceId,
    );
    if (matches.length === 1) {
      const [id, person] = matches[0];
      return { id, name: person.name ?? id, admin: Boolean(person.admin) };
    }
    return undefined;
  };

  const requireTeamActor = (
    req: Request,
    res: Response,
    fallbackName?: string,
  ): TeamActorIdentity => {
    if (options.collab && options.collab.status().state === "ready") {
      const token = req.get(participantHeader);
      if (token !== undefined) {
        const found = participantOf(options.collab, token);
        if (!found) throw notJoined();
        return {
          id: found.actor.id,
          name: found.person.name ?? found.actor.id,
          admin: found.actor.role === "admin",
        };
      }
      const matches = Object.entries(options.collab.side().people ?? {}).filter(
        ([, p]) => !p.removedAt && !p.disabledAt && p.deviceId === res.locals.deviceId,
      );
      if (matches.length >= 1) {
        const [id, person] = matches[0];
        return { id, name: person.name ?? id, admin: Boolean(person.admin) };
      }
      if (res.locals.deviceId === undefined) {
        return { id: "host", name: fallbackName?.trim() || sm().collab.atHostName, admin: true };
      }
      throw notJoined();
    }
    return {
      id: "local",
      name: fallbackName?.trim() || sm().collab.soloAuthorName,
      admin: true,
    };
  };

  const notifyCollabTodoChange = (req: Request, repoId: string) => {
    if (!options.collab || options.collab.status().state !== "ready") return;
    const hub = req.app.locals.collabHub as CollabHub | undefined;
    if (!hub) return;
    for (const [projectId, project] of Object.entries(options.collab.side().projects ?? {})) {
      if (project.repoId === repoId) hub.changed(projectId);
    }
  };
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
  app.get("/api/runs/:id/diff-view", async (req, res) => {
    const { round } = z
      .object({ round: z.string().min(1).max(100) })
      .strict()
      .parse(req.query);
    res.json(await workbench.diffView(req.params.id, round));
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
    // The stored GitHub facts only: the dialog never waits on GitHub.
    const repo = workbench.store.data.repos.find(
      (value) => value.id === run.repoId,
    );
    const checks = await publishChecks(
      run,
      files,
      workbench.store.directory,
      currentLocale(),
      { repo, runs: workbench.store.data.runs },
    );
    const guard = holds(req, res);
    if (guard) {
      const holdChecks = guard.preflight(run, files);
      checks.push(...holdChecks);
      if (!holdChecks.some((check) => check.id === "holds-unknown"))
        checks.push(...(await guard.confirms(run, repo, workbench.store.data.runs, files)));
    }
    // After an attempt that pushed but recorded no PR, GitHub's open count
    // may include the PR that attempt opened. publish() records that PR
    // before its checks and still refuses with this block when there is no
    // such PR, so the block does not keep Send off here.
    res.json({
      checks: resumesPublish(run)
        ? checks.filter((check) => check.id !== "pacing-max")
        : checks,
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
        optionalReviewer(req, res),
      ),
    });
  });
  app.post("/api/runs/:id/team-review", async (req, res) => {
    const { filePath, reviewed, fingerprint, reviewerName } = z
      .strictObject({
        filePath: z.string().min(1).max(1024),
        reviewed: z.boolean(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        reviewerName: z.string().max(80).optional(),
      })
      .parse(req.body);
    const reviewer = requireTeamActor(req, res, reviewerName);
    res.json({
      run: await workbench.teamFileReview(req.params.id, {
        filePath,
        reviewed,
        fingerprint,
        reviewer,
      }),
    });
  });
  app.post("/api/runs/:id/team-rationales", async (req, res) => {
    const body = z
      .strictObject({
        filePath: z.string().min(1).max(1024),
        lineStart: z.number().int().min(1).max(1_000_000).optional(),
        lineEnd: z.number().int().min(1).max(1_000_000).optional(),
        text: z.string().trim().min(1).max(2000),
        authorName: z.string().max(80).optional(),
      })
      .parse(req.body);
    const author = requireTeamActor(req, res, body.authorName);
    const run = await workbench.addTeamRationale(req.params.id, {
      filePath: body.filePath,
      lineStart: body.lineStart,
      lineEnd: body.lineEnd,
      text: body.text,
      author,
    });
    res.status(201).json({ run });
  });
  app.delete("/api/runs/:id/team-rationales/:noteId", async (req, res) => {
    const actor = requireTeamActor(req, res);
    const run = await workbench.removeTeamRationale(req.params.id, req.params.noteId, actor);
    res.json({ run });
  });
  app.post("/api/runs/:id/team-todos", async (req, res) => {
    const body = z
      .strictObject({
        filePath: z.string().min(1).max(1024).optional(),
        text: z.string().trim().min(1).max(1000),
        assigneeId: z.string().max(80).optional(),
        assigneeName: z.string().max(80).optional(),
        authorName: z.string().max(80).optional(),
      })
      .parse(req.body);
    const author = requireTeamActor(req, res, body.authorName);
    const run = await workbench.addTeamTodo(req.params.id, {
      filePath: body.filePath,
      text: body.text,
      assigneeId: body.assigneeId,
      assigneeName: body.assigneeName,
      author,
    });
    notifyCollabTodoChange(req, run.repoId);
    res.status(201).json({ run });
  });
  app.patch("/api/runs/:id/team-todos/:todoId", async (req, res) => {
    const body = z
      .strictObject({
        done: z.boolean().optional(),
        text: z.string().trim().min(1).max(1000).optional(),
        assigneeId: z.union([z.string().max(80), z.null()]).optional(),
        assigneeName: z.union([z.string().max(80), z.null()]).optional(),
        authorName: z.string().max(80).optional(),
      })
      .parse(req.body);
    const actor = requireTeamActor(req, res, body.authorName);
    const run = await workbench.updateTeamTodo(req.params.id, req.params.todoId, {
      done: body.done,
      text: body.text,
      assigneeId: body.assigneeId,
      assigneeName: body.assigneeName,
      actor,
    });
    notifyCollabTodoChange(req, run.repoId);
    res.json({ run });
  });
  app.delete("/api/runs/:id/team-todos/:todoId", async (req, res) => {
    const actor = requireTeamActor(req, res);
    const run = await workbench.removeTeamTodo(req.params.id, req.params.todoId, actor);
    notifyCollabTodoChange(req, run.repoId);
    res.json({ run });
  });
  app.post("/api/runs/:id/approve", async (req, res) => {
    const { draft } = z
      .object({
        draft: z.object({
          // May be empty: approve() answers 422 prTextRequired, as for a Learn-by-hand run's
          // PR title, which starts empty (DESIGN v1.2 F11).
          title: z.string().max(180),
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
  // nothing polls it and nothing is ever posted back to GitHub. Reading
  // feedback is separate from the AI follow-up rounds on it (follow-ups.ts).
  app.post("/api/runs/:id/pr/feedback", async (req, res) => {
    res.json({ run: await workbench.fetchPrFeedback(req.params.id) });
  });
  app.post("/api/runs/:id/publish/recover", async (req, res) => {
    const { commit } = z
      .object({ commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/) })
      .strict()
      .parse(req.body);
    res.json({ run: await workbench.recoverPublish(req.params.id, commit) });
  });
  app.post("/api/runs/:id/publish", async (req, res) => {
    const { fingerprint, acknowledged, overrides, rulesDigest } = z
      .object({
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        // Preflight item ids the person confirmed in the publish dialog.
        acknowledged: z.array(z.string().max(40)).max(16).optional(),
        // The digest of the quoted confirm's words (`by-hand-rules`) the person ticked.
        rulesDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        // Blocks lifted with the person's own reason; only someone else's
        // pull request for the same issue can be lifted.
        overrides: z
          .array(
            z
              .object({
                id: z.enum(overridableCheckIds),
                reason: z
                  .string()
                  .trim()
                  .min(overrideReasonLimits.min)
                  .max(overrideReasonLimits.max),
              })
              .strict(),
          )
          .max(4)
          .optional(),
      })
      .parse(req.body);
    res.json({
      run: await workbench.publish(
        req.params.id,
        fingerprint,
        acknowledged,
        overrides,
        rulesDigest,
        holds(req, res),
      ),
    });
  });
}
