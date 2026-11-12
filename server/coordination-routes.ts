/**
 * HTTP for project coordination (coordination.ts). Every request names its
 * participant with a token in the `x-bell-participant` header, and the
 * coordinator alone decides who that is: a body never says who is asking,
 * and a body with any key it does not expect (an `owner`, a `holder`) is
 * refused.
 *
 * Not mounted by createApp yet; docs/multiuser-collaboration.md lists
 * what has to come first.
 */
import express, { type ErrorRequestHandler, type Response } from "express";
import { z } from "zod";
import { formatters } from "../shared/i18n/locale.js";
import { type Actor, type Coordinator, maxScopes } from "./coordination.js";
import { currentLocale, sm } from "./i18n/index.js";
import { log } from "./log.js";
import { redact } from "./secrets.js";
import { AppError } from "./types.js";

/** The header a participant token travels in; never the app's own API token. */
export const participantHeader = "x-bell-participant";

const fence = z.number().int().min(1);
const commit = z.string().max(64);
const scopes = z.array(z.string().max(1024)).min(1).max(maxScopes);
const reason = z.string().max(500).optional();
const bodies = {
  task: z.strictObject({
    id: z.string().max(64),
    dependsOn: z.array(z.string().max(64)).max(50).optional(),
  }),
  fail: z.strictObject({ reason }),
  reopen: z.strictObject({ reason }),
  claim: z.strictObject({ taskId: z.string().max(64), scopes }),
  expand: z.strictObject({ fence, scopes }),
  release: z.strictObject({ fence }),
  revoke: z.strictObject({ reason }),
  authorize: z.strictObject({ fence, paths: z.array(z.string().max(4096)).max(1000) }),
  integrate: z.strictObject({ fence, base: commit, commit }),
  adopt: z.strictObject({ sha: commit }),
  settle: z.strictObject({
    claimId: z.string().max(64),
    fence,
    from: commit,
    to: commit,
    startedAt: z.string().max(64),
    head: commit,
  }),
};

const actorOf = (res: Response): Actor => res.locals.actor as Actor;

export function coordinationRouter(coordinator: Coordinator) {
  const router = express.Router();
  // Who is asking is settled before a body is even read.
  router.use((req, res, next) => {
    res.locals.actor = coordinator.authenticate(req.get(participantHeader));
    next();
  });
  router.use(express.json({ limit: "160kb", strict: true }));
  router.get("/projects/:project", (req, res) => {
    res.json({ project: coordinator.project(actorOf(res), req.params.project) });
  });
  router.post("/projects/:project/tasks", async (req, res) => {
    const body = bodies.task.parse(req.body);
    res.status(201).json({ task: await coordinator.defineTask(actorOf(res), req.params.project, body) });
  });
  router.post("/projects/:project/tasks/:task/fail", async (req, res) => {
    const body = bodies.fail.parse(req.body ?? {});
    res.json({
      task: await coordinator.failTask(actorOf(res), req.params.project, req.params.task, body),
    });
  });
  router.post("/projects/:project/tasks/:task/reopen", async (req, res) => {
    const body = bodies.reopen.parse(req.body ?? {});
    res.json({
      task: await coordinator.reopenTask(actorOf(res), req.params.project, req.params.task, body),
    });
  });
  router.post("/projects/:project/claims", async (req, res) => {
    const body = bodies.claim.parse(req.body);
    res.status(201).json({ claim: await coordinator.claim(actorOf(res), req.params.project, body) });
  });
  router.post("/projects/:project/claims/:claim/expand", async (req, res) => {
    const body = bodies.expand.parse(req.body);
    res.json({
      claim: await coordinator.expand(actorOf(res), req.params.project, req.params.claim, body),
    });
  });
  router.post("/projects/:project/claims/:claim/release", async (req, res) => {
    const body = bodies.release.parse(req.body);
    res.json({
      claim: await coordinator.release(actorOf(res), req.params.project, req.params.claim, body),
    });
  });
  router.post("/projects/:project/claims/:claim/revoke", async (req, res) => {
    const body = bodies.revoke.parse(req.body ?? {});
    res.json({
      claim: await coordinator.revoke(actorOf(res), req.params.project, req.params.claim, body),
    });
  });
  router.post("/projects/:project/claims/:claim/authorize", (req, res) => {
    const body = bodies.authorize.parse(req.body);
    res.json({
      authorized: coordinator.authorize(actorOf(res), req.params.project, {
        claimId: req.params.claim,
        ...body,
      }),
    });
  });
  router.post("/projects/:project/claims/:claim/integrate", async (req, res) => {
    const body = bodies.integrate.parse(req.body);
    res.json(await coordinator.integrate(actorOf(res), req.params.project, req.params.claim, body));
  });
  router.post("/projects/:project/baseline/adopt", async (req, res) => {
    const body = bodies.adopt.parse(req.body);
    res.json({ project: await coordinator.adoptBaseline(actorOf(res), req.params.project, body) });
  });
  router.post("/projects/:project/recovery/settle", async (req, res) => {
    const body = bodies.settle.parse(req.body);
    res.json({ project: await coordinator.settleRecovery(actorOf(res), req.params.project, body) });
  });
  router.use(errors);
  return router;
}

/** The app's error bodies (app.ts), with `reason` from the coordinator's details. */
const errors: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      reason: "invalidRequest",
      error: formatters(currentLocale()).list(
        error.issues.map((issue) =>
          issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
        ),
        { type: "unit" },
      ),
    });
    return;
  }
  if (error instanceof AppError) {
    if (error.statusCode >= 500)
      log.error("Coordination request failed", {
        method: req.method,
        path: req.path,
        status: error.statusCode,
        error: redact(error.message),
      });
    res.status(error.statusCode).json({ ...error.details, error: redact(error.message) });
    return;
  }
  if (error?.type === "entity.parse.failed") {
    res.status(400).json({ reason: "invalidRequest", error: sm().common.invalidJson });
    return;
  }
  if (error?.type === "entity.too.large") {
    res.status(413).json({ reason: "invalidRequest", error: sm().common.payloadTooLarge });
    return;
  }
  log.error("Coordination request failed", {
    method: req.method,
    path: req.path,
    status: 500,
    error: redact(error instanceof Error ? (error.stack ?? error.message) : String(error)),
  });
  res.status(500).json({ error: sm().common.internalError });
};
