/**
 * Group work's repositories and their boards: GET and POST
 * /api/collab/projects and, under /api/collab/projects/:project, GET feed,
 * POST check, POST work, POST holds/:claim/release and POST
 * holds/:claim/revoke. Registered by routes/collab.ts.
 *
 * Every route is a participant's. What changes something runs inside
 * host.run with its project, so the requests waiting on that board hear of
 * it. A path, a title or an id from a request is never the key of a plain
 * object: the side file's records are read through sideEntry.
 */
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import type {
  CollabAddProjectResponse,
  CollabCheckResponse,
  CollabConflict,
  CollabOkResponse,
  CollabProjectsResponse,
  CollabWorkResponse,
} from "../../shared/collab.js";
import { boardOf, holdOf, inTheWay, nameOf, taskKey } from "../collab-board.js";
import { collabId, sideEntry, type CollabHost } from "../collab-host.js";
import { CollabHub } from "../collab-hub.js";
import { PersonLimit } from "../collab-limits.js";
import { CollabProjects } from "../collab-projects.js";
import { adminOnly, reasonOf, refuse } from "../collab-refusal.js";
import type { Actor } from "../coordination.js";
import { claimableScope } from "../scope-paths.js";
import type { Store } from "../store.js";

/** Stricter than the coordinator's own limits: what a person types, not what a program sends. */
export const maxPaths = 50;
export const maxPathLength = 300;
export const maxTitle = 120;
/** Per person: 30 calls of `work` in 10 minutes, 120 of `check` in a minute. */
export const workLimit = { max: 30, windowMs: 10 * 60_000 };
export const checkLimit = { max: 120, windowMs: 60_000 };

/** One line of text: a control or bidirectional-override character becomes a space. */
const line = z
  .string()
  .transform((text) => text.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, " ").trim());
/** Checked by hand (heldScopes), so a refusal names its reason and the paths it is about. */
const scopes = z.array(z.string());
const addSchema = z.strictObject({ repoId: z.string().max(64) });
const feedSchema = z.object({
  epoch: z.string().max(64).optional(),
  version: z.coerce.number().int().min(0).optional(),
  seen: z.coerce.number().int().min(0).optional(),
  wait: z.coerce.number().int().min(0).max(25).default(0),
});
const checkSchema = z.strictObject({ scopes });
const workSchema = z.union([
  z.strictObject({
    title: line.pipe(z.string().min(1).max(maxTitle)),
    scopes,
    runId: z.string().max(64).optional(),
  }),
  z.strictObject({ taskId: z.string().max(64), scopes }),
]);
const releaseSchema = z.strictObject({ fence: z.number().int().min(0) });
const revokeSchema = z.strictObject({ reason: line.pipe(z.string().max(500)).optional() });

const invalidScope = (invalid: string[] = []) =>
  refuse(400, "invalidScope", (m) => m.collab.invalidScope({ max: maxPathLength }), { invalid });

/**
 * The asked paths in the coordinator's spelling, and those that cannot be
 * held as they were sent. More than 50 paths, or one longer than 300
 * characters, is refused.
 */
function heldScopes(asked: string[]) {
  if (asked.length > maxPaths)
    throw refuse(400, "tooManyScopes", (m) => m.collab.tooManyScopes({ max: maxPaths }));
  // Not repeated in the answer: a path this long is nothing a person typed.
  if (asked.some((scope) => scope.length > maxPathLength)) throw invalidScope();
  const held: string[] = [];
  const invalid: string[] = [];
  for (const scope of asked) {
    const spelled = claimableScope(scope);
    if (spelled === undefined) invalid.push(scope);
    else held.push(spelled);
  }
  return { held, invalid };
}

/** Registers the routes and returns the hub, so a removal can end a removed person's waiting requests. */
export function registerCollabBoardRoutes(
  app: Express,
  host: CollabHost,
  { store, participant }: { store: Store; participant: RequestHandler },
) {
  const projects = new CollabProjects(host, store);
  const hub = new CollabHub((projectId, actor) =>
    JSON.stringify(boardOf(host.coordinator().project(actor, projectId), host.side())),
  );
  const works = new PersonLimit(workLimit.max, workLimit.windowMs);
  const checks = new PersonLimit(checkLimit.max, checkLimit.windowMs);

  host.onChange((projectId) => {
    if (host.status().state === "ready") hub.changed(projectId);
    else {
      // Group work is stopping: no waiting request and no copy under way holds it up.
      hub.close();
      projects.stop();
    }
  });

  /** Counts a person's call: 429 `slowDown` once they are over the limit. */
  const pace = (limit: PersonLimit, actor: Actor) => {
    const retryAfter = limit.take(actor.id);
    if (retryAfter !== undefined)
      throw refuse(429, "slowDown", (m) => m.collab.slowDown({ seconds: retryAfter }), {
        retryAfter,
      });
  };
  /** The group's repository with this id, or 404 `unknownProject`. */
  const projectOf = (id: string) => {
    const project = sideEntry(host.side().projects, id);
    if (!project) throw refuse(404, "unknownProject", (m) => m.collab.unknownProject);
    return project;
  };

  app.get("/api/collab/projects", participant, async (_req, res) => {
    const body: CollabProjectsResponse = { projects: projects.list() };
    if ((res.locals.actor as Actor).role === "admin") {
      body.addable = await projects.addable();
      const storage = await projects.storage();
      if (storage) body.storage = storage;
    }
    res.json(body);
  });

  app.post("/api/collab/projects", participant, async (req, res) => {
    const { repoId } = addSchema.parse(req.body);
    if ((res.locals.actor as Actor).role !== "admin") throw adminOnly();
    const body: CollabAddProjectResponse = { project: await projects.add(repoId) };
    res.status(201).json(body);
  });

  app.get<{ project: string }>("/api/collab/projects/:project/feed", participant, (req, res) => {
    const question = feedSchema.parse(req.query);
    const projectId = req.params.project;
    projectOf(projectId);
    const gone = hub.ask({ projectId, actor: res.locals.actor as Actor, ...question }, (body) => {
      // Answered because group work is stopping: the connection ends with the answer.
      if (host.status().state !== "ready") res.set("Connection", "close");
      if (body === undefined) res.status(204).end();
      else res.type("json").send(body);
    });
    // Also when the client went away before any answer: its place is free again.
    res.on("close", gone);
  });

  app.post<{ project: string }>("/api/collab/projects/:project/check", participant, (req, res) => {
    const actor = res.locals.actor as Actor;
    pace(checks, actor);
    const body = checkSchema.parse(req.body);
    const projectId = req.params.project;
    projectOf(projectId);
    const { held, invalid } = heldScopes(body.scopes);
    const side = host.side();
    const view = host.coordinator().project(actor, projectId);
    const answer: CollabCheckResponse = {
      asOf: new Date().toISOString(),
      invalid,
      meets: inTheWay(view, held).map(({ claim, scope }) => {
        const hold = holdOf(side, projectId, claim);
        return {
          scope,
          claimId: hold.claimId,
          taskId: hold.taskId,
          title: hold.title,
          holder: nameOf(side, hold.holder),
        };
      }),
    };
    res.json(answer);
  });

  app.post<{ project: string }>(
    "/api/collab/projects/:project/work",
    participant,
    async (req, res) => {
      const actor = res.locals.actor as Actor;
      pace(works, actor);
      const body = workSchema.parse(req.body);
      const projectId = req.params.project;
      const project = projectOf(projectId);
      const { held, invalid } = heldScopes(body.scopes);
      if (invalid.length || !held.length) throw invalidScope(invalid);
      if ("runId" in body && body.runId !== undefined) {
        const run = store.data.runs.find((candidate) => candidate.id === body.runId);
        if (!run || run.repoId !== project.repoId)
          throw refuse(400, "unknownRun", (m) => m.collab.unknownRun);
      }
      const hold = await host.run(async () => {
        const coordinator = host.coordinator();
        /** 409 `conflict`, with who holds what, when a held path is in the way. */
        const refuseMeeting = () => {
          const side = host.side();
          const conflicts: CollabConflict[] = inTheWay(
            coordinator.project(actor, projectId),
            held,
          ).map(({ claim, scope }) => ({
            scope,
            holder: nameOf(side, claim.holder),
            title: holdOf(side, projectId, claim).title,
            since: claim.createdAt,
          }));
          if (conflicts.length)
            throw refuse(409, "conflict", (m) => m.collab.conflict, { conflicts });
        };
        // Asked first, so a refusal makes nothing.
        refuseMeeting();
        let taskId: string;
        if ("taskId" in body) taskId = body.taskId;
        else {
          taskId = collabId("t");
          await coordinator.defineTask(actor, projectId, { id: taskId });
          await host.saveSide((draft) => {
            (draft.tasks ??= {})[taskKey(projectId, taskId)] = {
              title: body.title,
              ...(body.runId === undefined ? {} : { runId: body.runId }),
              createdAt: new Date().toISOString(),
            };
          });
        }
        try {
          const claim = await coordinator.claim(actor, projectId, { taskId, scopes: held });
          return holdOf(host.side(), projectId, claim);
        } catch (error) {
          // Someone took a path in between. The same answer; a task made above
          // stays on the board, free to take.
          if (reasonOf(error) === "conflict") refuseMeeting();
          throw error;
        }
      }, projectId);
      const answer: CollabWorkResponse = { hold };
      res.status(201).json(answer);
    },
  );

  app.post<{ project: string; claim: string }>(
    "/api/collab/projects/:project/holds/:claim/release",
    participant,
    async (req, res) => {
      const { fence } = releaseSchema.parse(req.body);
      const { project, claim } = req.params;
      projectOf(project);
      const actor = res.locals.actor as Actor;
      await host.run(() => host.coordinator().release(actor, project, claim, { fence }), project);
      const answer: CollabOkResponse = { ok: true };
      res.json(answer);
    },
  );

  app.post<{ project: string; claim: string }>(
    "/api/collab/projects/:project/holds/:claim/revoke",
    participant,
    async (req, res) => {
      const { reason } = revokeSchema.parse(req.body);
      const actor = res.locals.actor as Actor;
      if (actor.role !== "admin") throw adminOnly();
      const { project, claim } = req.params;
      projectOf(project);
      await host.run(
        () => host.coordinator().revoke(actor, project, claim, reason ? { reason } : {}),
        project,
      );
      const answer: CollabOkResponse = { ok: true };
      res.json(answer);
    },
  );

  return hub;
}
