/**
 * Group work's repositories and their boards: GET and POST
 * /api/collab/projects and, under /api/collab/projects/:project, GET tasks,
 * GET feed, POST check, POST work, POST holds/:claim/release and POST
 * holds/:claim/revoke. Registered by routes/collab.ts.
 *
 * Work can name tasks it depends on. It is held only once each of them is
 * done: its holder released it with `done`. The coordinator's own
 * dependencies wait for an integration, which group work does not make,
 * so these are kept in the side file and checked here. A done release and
 * such work take turns in their project (inOrder): between the end of the
 * hold and the done write, a task would read as ended and never done.
 *
 * Every route is a participant's. What changes something runs inside
 * host.run with its project, so the requests waiting on that board hear of
 * it. A path, a title or an id from a request is never the key of a plain
 * object: the side file's records are read through sideEntry.
 */
import type { IRouter, RequestHandler, Response } from "express";
import { z } from "zod";
import type {
  CollabAddProjectResponse,
  CollabCheckResponse,
  CollabConflict,
  CollabFileDependency,
  CollabHold,
  CollabMemberActivity,
  CollabOkResponse,
  CollabProjectsResponse,
  CollabTasksResponse,
  CollabWorkResponse,
} from "../../shared/collab.js";
import { runStatuses } from "../../shared/types.js";
import {
  boardOf,
  dependencyOf,
  dropHoldEntries,
  holdOf,
  inTheWay,
  nameOf,
  taskKey,
  taskOf,
} from "../collab-board.js";
import { collabId, sideEntry, type CollabHost } from "../collab-host.js";
import { CollabHub } from "../collab-hub.js";
import { PersonLimit } from "../collab-limits.js";
import { CollabProjects } from "../collab-projects.js";
import { adminOnly, notJoined, reasonOf, refuse } from "../collab-refusal.js";
import type { Actor } from "../coordination.js";
import { matchFileDependencies, scanRepositoryImports } from "../file-deps.js";
import { changingRuns } from "../group-local.js";
import { knownBranchTip } from "../hold-guard.js";
import { log } from "../log.js";
import { git } from "../process.js";
import { baseScopePath, claimableScope, pathsMeet } from "../scope-paths.js";
import { redact } from "../secrets.js";
import type { Store } from "../store.js";
import type { Repository } from "../types.js";

/** Stricter than the coordinator's own limits: what a person types, not what a program sends. */
export const maxPaths = 50;
export const maxPathLength = 300;
export const maxTitle = 120;
/** As many as the coordinator lets a task depend on. */
export const maxDependencies = 50;
/** Per person: 30 calls of `work` in 10 minutes, 120 of `check` in a minute. */
export const workLimit = { max: 30, windowMs: 10 * 60_000 };
export const checkLimit = { max: 120, windowMs: 60_000 };
/** Per person: feed answers BELL PR still keeps because their connections have not taken them. */
export const maxUntaken = 8;

/**
 * One line of text: a control character, or one that embeds, overrides or
 * isolates the direction of text, becomes a space. Direction marks stay.
 */
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
const checkSchema = z.strictObject({
  scopes,
  scanImports: z.boolean().optional(),
});
const dependencyBodySchema = z.strictObject({
  from: z.string().max(maxPathLength),
  to: z.string().max(maxPathLength),
  mode: z.enum(["warn", "block"]),
  note: line.pipe(z.string().max(200)).optional(),
});
const activityBodySchema = z.strictObject({
  repoId: z.string().max(64).optional(),
  view: z.enum(["group", "workspace", "changes", "review", "draft", "publish"]).optional(),
  runId: z.string().max(80).optional(),
  runTitle: line.pipe(z.string().max(180)).optional(),
  runStatus: z.enum(runStatuses).optional(),
  filePath: z.string().max(maxPathLength).optional(),
  lineStart: z.number().int().min(1).max(1_000_000).optional(),
  lineEnd: z.number().int().min(1).max(1_000_000).optional(),
});
const maxFileDependencies = 200;
const workSchema = z.strictObject({
  title: line.pipe(z.string().min(1).max(maxTitle)),
  scopes,
  /** Checked by hand, as scopes are: a longer id is no task, and is refused as one. */
  dependsOn: z.array(z.string()).optional(),
});
const releaseSchema = z.strictObject({
  fence: z.number().int().min(0),
  done: z.boolean().optional(),
});
const revokeSchema = z.strictObject({});

const invalidScope = (invalid: string[] = []) =>
  refuse(400, "invalidScope", (m) => m.collab.invalidScope({ max: maxPathLength }), { invalid });

/**
 * Of these claimable scopes, those that are a symbolic link, or go through
 * one or through a submodule, on the default branch of BELL PR's clone of
 * the repository. Git records a change at its real path, never through a
 * link, and records a submodule as one entry, so a hold spelled this way
 * would protect nothing. Compared without regard to ASCII case, as holds
 * are: on a disk that does not tell case apart, ALIAS/users.ts opens the
 * link alias. None when the branch cannot be read, as before this check:
 * taking a hold writes no file. The log on the host says so.
 */
async function linkedScopes(repo: Repository | undefined, scopes: string[]) {
  const linked = new Set<string>();
  if (!repo || !scopes.length) return linked;
  const fold = (path: string) => path.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const prefixes = (scope: string) =>
    scope.split("/").map((_, n, parts) => parts.slice(0, n + 1).join("/"));
  const baseScopes = scopes.map((scope) => baseScopePath(scope));
  const asked = new Set(baseScopes.flatMap(prefixes).map(fold));
  const parents = new Set(baseScopes.flatMap((scope) => prefixes(scope).slice(0, -1)).map(fold));
  // Git's modes for a symbolic link, submodule and folder, by folded path.
  const modes = new Map<string, string>();
  // One folder level at a time, since ls-tree matches paths in their exact
  // case: the root, then each folder in Git's spelling that an asked path
  // goes through. No folder in a level is inside another, so each lists
  // its own entries.
  for (let folders = [""]; folders.length; ) {
    const next: string[] = [];
    // In parts, so no command line is longer than Windows takes.
    for (let start = 0; start < folders.length; ) {
      const batch: string[] = [];
      for (let length = 0; start < folders.length && length < 8_000; start += 1) {
        if (folders[start]) batch.push(`${folders[start]}/`);
        length += folders[start].length + 2;
      }
      const listed = await git(
        repo.path,
        [
          "--literal-pathspecs",
          "ls-tree",
          "--full-tree",
          "-z",
          "--end-of-options",
          `refs/heads/${repo.defaultBranch}`,
          // A bare "--" would list nothing; without paths, the root.
          ...(batch.length ? ["--", ...batch] : []),
        ],
        { timeoutMs: 10_000 },
      ).catch((error: unknown) => {
        log.warn("Group work could not read the repository's default branch", {
          repoId: repo.id,
          error,
        });
      });
      if (!listed) return linked;
      for (const entry of listed.stdout.split("\0")) {
        const mode = entry.slice(0, entry.indexOf(" "));
        const tab = entry.indexOf("\t");
        if (tab < 0) continue;
        const recorded = entry.slice(tab + 1);
        const folded = fold(recorded);
        if (!asked.has(folded)) continue;
        // A link wins over a folder spelled in another case: either opens.
        if (mode === "120000" || ((mode === "160000" || mode === "040000") && !modes.has(folded)))
          modes.set(folded, mode);
        if (mode === "040000" && parents.has(folded)) next.push(recorded);
      }
    }
    folders = next;
  }
  for (const scope of scopes) {
    const base = baseScopePath(scope);
    const through = prefixes(base).some((prefix, n, all) => {
      const mode = modes.get(fold(prefix));
      // A submodule itself is held as Git records it.
      return mode === "120000" || (mode === "160000" && n < all.length - 1);
    });
    // Line-range holds (#Lstart-Lend) apply only to files, never directories.
    const folderRange = scope.includes("#L") && modes.get(fold(base)) === "040000";
    if (through || folderRange) linked.add(scope);
  }
  return linked;
}

/**
 * The asked paths in the coordinator's spelling, and those that cannot be
 * held as they were sent. More than 50 paths, or one longer than 300
 * characters, is refused.
 */
async function heldScopes(asked: string[], repo: Repository | undefined) {
  if (asked.length > maxPaths)
    throw refuse(400, "tooManyScopes", (m) => m.collab.tooManyScopes({ max: maxPaths }));
  // Not repeated in the answer: a path this long is nothing a person typed.
  if (asked.some((scope) => scope.length > maxPathLength)) throw invalidScope();
  const spelled = asked.map((scope) => claimableScope(scope));
  const linked = await linkedScopes(
    repo,
    spelled.filter((scope) => scope !== undefined),
  );
  const held: string[] = [];
  const invalid: string[] = [];
  asked.forEach((scope, n) => {
    const one = spelled[n];
    if (one === undefined || linked.has(one)) invalid.push(scope);
    else held.push(one);
  });
  return { held, invalid };
}

/**
 * Runs `step` after the steps of this project given before it have
 * settled, refused or not. One queue per project; it is gone once empty.
 */
function inTurns() {
  const tails = new Map<string, Promise<void>>();
  return <T>(projectId: string, step: () => Promise<T>): Promise<T> => {
    const result = (tails.get(projectId) ?? Promise.resolve()).then(step);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(projectId, tail);
    void tail.then(() => {
      if (tails.get(projectId) === tail) tails.delete(projectId);
    });
    return result;
  };
}

/** Registers the routes and returns the hub, so a removal can end a removed person's waiting requests. */
export function registerCollabBoardRoutes(
  app: IRouter,
  host: CollabHost,
  { store, participant }: { store: Store; participant: RequestHandler },
) {
  const projects = new CollabProjects(host, store);
  const hub = new CollabHub((projectId, actor) =>
    JSON.stringify(
      boardOf(host.coordinator().project(actor, projectId), host.side(), {
        runs: store.data.runs,
      }),
    ),
  );
  const works = new PersonLimit(workLimit.max, workLimit.windowMs);
  const checks = new PersonLimit(checkLimit.max, checkLimit.windowMs);
  /** Feed answers that have not left BELL PR yet, by participant id. */
  const untaken = new Map<string, Set<Response>>();
  /**
   * A release with `done`, from the end of the hold to the done write, and
   * work that names tasks, from its check to its hold: one at a time in a
   * project. Other work and releases read no done time and do not wait.
   */
  const inOrder = inTurns();

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
  /** BELL PR's repository entry for a group project, if still registered. */
  const repoOf = (projectId: string) => {
    const { repoId } = projectOf(projectId);
    return store.data.repos.find((repo) => repo.id === repoId);
  };
  /** The paths of a hold in this repository, as heldScopes answers. */
  const scopesOf = (projectId: string, asked: string[]) => heldScopes(asked, repoOf(projectId));
  /** Other people's unfinished runs of `repo` whose files or plans meet `scopes`. */
  const changingFor = (
    repo: Repository | undefined,
    actor: Actor,
    scopes: readonly string[],
    baseSha?: string,
  ) => {
    if (!repo || !scopes.length) return Promise.resolve([]);
    const side = host.side();
    return changingRuns(
      { runs: store.data.runs, repo, directory: store.directory, baseSha },
      scopes,
      (run) => {
        const active = (run.owners ?? []).filter((id) => {
          const person = sideEntry(side.people, id);
          return person && !person.removedAt && !person.disabledAt;
        });
        if (active.includes(actor.id)) return "self";
        return active.map((id) => nameOf(side, id));
      },
    );
  };

  app.get("/api/collab/projects", participant, async (_req, res) => {
    const body: CollabProjectsResponse = {
      projects: projects.list(),
      addable: await projects.addable(),
    };
    const storage = await projects.storage();
    if (storage) body.storage = storage;
    res.json(body);
  });

  app.post("/api/collab/projects", participant, async (req, res) => {
    const { repoId } = addSchema.parse(req.body);
    const body: CollabAddProjectResponse = { project: await projects.add(repoId) };
    res.status(201).json(body);
  });

  app.get<{ project: string }>("/api/collab/projects/:project/tasks", participant, (req, res) => {
    const projectId = req.params.project;
    projectOf(projectId);
    const actor = res.locals.actor as Actor;
    const view = host.coordinator().project(actor, projectId);
    const side = host.side();
    const active = new Set(
      view.claims.filter((claim) => claim.status === "held").map((claim) => claim.taskId),
    );
    const body: CollabTasksResponse = {
      tasks: view.tasks.flatMap((task) => {
        const saved = taskOf(side, projectId, task.id);
        const status = saved?.doneAt ? "done" : active.has(task.id) ? "held" : undefined;
        return status ? [{ ...dependencyOf(side, projectId, task.id), status }] : [];
      }),
    };
    res.json(body);
  });

  app.get<{ project: string }>("/api/collab/projects/:project/feed", participant, (req, res) => {
    const question = feedSchema.parse(req.query);
    const projectId = req.params.project;
    projectOf(projectId);
    const actor = res.locals.actor as Actor;
    // A connection that asks and never reads would fill the memory with boards.
    const kept = untaken.get(actor.id) ?? new Set<Response>();
    untaken.set(actor.id, kept);
    // An answer whose connection went away before it left never finishes.
    for (const answer of kept) if (answer.req.socket.destroyed) kept.delete(answer);
    if (kept.size >= maxUntaken)
      throw refuse(429, "tooManyWaiters", (m) => m.collab.tooManyWaiters);
    const gone = hub.ask({ projectId, actor, ...question }, (body) => {
      // Answered because group work is stopping: the connection ends with the answer.
      if (host.status().state !== "ready") res.set("Connection", "close");
      if (body === undefined) res.status(204).end();
      else {
        kept.add(res);
        res.once("finish", () => kept.delete(res));
        res.type("json").send(body);
      }
    });
    // Also when the client went away before any answer: its place is free again.
    res.on("close", gone);
  });

  app.post<{ project: string }>("/api/collab/projects/:project/check", participant, async (req, res) => {
    const actor = res.locals.actor as Actor;
    pace(checks, actor);
    const body = checkSchema.parse(req.body);
    const projectId = req.params.project;
    const { held, invalid } = await scopesOf(projectId, body.scopes);
    const repo = repoOf(projectId);
    const tip = held.length ? await knownBranchTip(repo, store.data.runs) : undefined;
    const changing = await changingFor(repo, actor, held, tip);
    const side = host.side();
    const view = host.coordinator().project(actor, projectId);
    const manualDeps: CollabFileDependency[] = Object.entries(
      sideEntry(side.fileDeps, projectId) ?? {},
    ).map(([id, dep]) => ({
      id,
      from: dep.from,
      to: dep.to,
      mode: dep.mode,
      createdBy: dep.createdBy,
      createdByName: nameOf(side, dep.createdBy),
      createdAt: dep.createdAt,
      ...(dep.note ? { note: dep.note } : {}),
    }));
    const detectedImports =
      body.scanImports && repo && held.length ? await scanRepositoryImports(repo.path) : [];
    const dependencyHits = held.length
      ? matchFileDependencies({
          askedScopes: held,
          heldClaims: view.claims
            .filter((claim) => claim.status === "held")
            .map((claim) => ({
              claimId: claim.id,
              holderId: claim.holder,
              holderName: nameOf(side, claim.holder),
              title: taskOf(side, projectId, claim.taskId)?.title ?? claim.taskId,
              scopes: claim.scopes,
            })),
          excludeHolderIds: new Set([actor.id]),
          manualDeps,
          detectedImports,
        })
      : [];
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
      changing,
      ...(dependencyHits.length ? { dependencyHits } : {}),
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
      const { held, invalid } = await scopesOf(projectId, body.scopes);
      if (invalid.length || !held.length) throw invalidScope(invalid);
      if ((body.dependsOn?.length ?? 0) > maxDependencies)
        throw refuse(400, "tooManyDependencies", (m) =>
          m.collab.tooManyDependencies({ max: maxDependencies }),
        );
      const repo = repoOf(projectId);
      const holdBase = await knownBranchTip(repo, store.data.runs);
      const dependsOn = [...new Set(body.dependsOn ?? [])];
      const take = async () => {
        const coordinator = host.coordinator();
        /**
         * 400 `dependencyUnknown` for a named task this repository does not
         * have, 409 `dependencyPending` while one is not done. A task can
         * name only tasks made before it, and what it names never changes,
         * so dependencies never form a cycle; a task that is done stays done.
         */
        const refuseWaiting = () => {
          if (!dependsOn.length) return;
          const view = coordinator.project(actor, projectId);
          const unknown = dependsOn.filter((id) => !view.tasks.some((task) => task.id === id));
          if (unknown.length)
            throw refuse(400, "dependencyUnknown", (m) => m.collab.dependencyUnknown, { unknown });
          const side = host.side();
          const pending = dependsOn
            .filter((id) => !taskOf(side, projectId, id)?.doneAt)
            .map((id) => ({
              ...dependencyOf(side, projectId, id),
              held: view.claims.some((claim) => claim.status === "held" && claim.taskId === id),
            }));
          if (pending.length)
            throw refuse(409, "dependencyPending", (m) => m.collab.dependencyPending, { pending });
        };
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
        refuseWaiting();
        refuseMeeting();
        {
          const side = host.side();
          const view = coordinator.project(actor, projectId);
          const blockDeps: CollabFileDependency[] = Object.entries(
            sideEntry(side.fileDeps, projectId) ?? {},
          )
            .filter(([, dep]) => dep.mode === "block")
            .map(([id, dep]) => ({
              id,
              from: dep.from,
              to: dep.to,
              mode: dep.mode,
              createdBy: dep.createdBy,
              createdByName: nameOf(side, dep.createdBy),
              createdAt: dep.createdAt,
              ...(dep.note ? { note: dep.note } : {}),
            }));
          if (blockDeps.length) {
            const dependencyHits = matchFileDependencies({
              askedScopes: held,
              heldClaims: view.claims
                .filter((claim) => claim.status === "held")
                .map((claim) => ({
                  claimId: claim.id,
                  holderId: claim.holder,
                  holderName: nameOf(side, claim.holder),
                  title: taskOf(side, projectId, claim.taskId)?.title ?? claim.taskId,
                  scopes: claim.scopes,
                })),
              excludeHolderIds: new Set([actor.id]),
              manualDeps: blockDeps,
              detectedImports: [],
            });
            if (dependencyHits.length)
              throw refuse(
                409,
                "dependencyBlocked",
                (m) => m.collab.dependencyBlocked,
                { dependencyHits },
              );
          }
        }
        const taskId = collabId("t");
        const key = taskKey(projectId, taskId);
        await coordinator.defineTask(actor, projectId, { id: taskId });
        await host.saveSide((draft) => {
          (draft.tasks ??= {})[key] = {
            title: body.title,
            ...(dependsOn.length ? { dependsOn } : {}),
          };
        });
        try {
          const claim = await coordinator.claim(actor, projectId, { taskId, scopes: held });
          const removed = () => Boolean(sideEntry(host.side().people, actor.id)?.removedAt);
          if (!removed() && holdBase) {
            await host.saveSide((draft) => {
              if (sideEntry(draft.people, actor.id)?.removedAt) return;
              const stillHeld = coordinator
                .claimsForHost(projectId)
                .some((item) => item.id === claim.id && item.status === "held");
              if (stillHeld) (draft.holds ??= {})[key] = holdBase;
            });
          }
          // Removed while this was under way, after the removal looked for their holds.
          if (removed()) {
            await coordinator
              .release(actor, projectId, claim.id, { fence: claim.fence })
              .catch((error) => {
                // An admin's revoke was there first.
                if (reasonOf(error) !== "ended") throw error;
              });
            if (sideEntry(host.side().holds, key) !== undefined)
              await host.saveSide((draft) => dropHoldEntries(draft, [key])).catch(() => undefined);
            throw notJoined();
          }
          return holdOf(host.side(), projectId, claim);
        } catch (error) {
          // Someone took a path in between. The same answer; the task made above
          // stays in the record.
          if (reasonOf(error) === "conflict") refuseMeeting();
          throw error;
        }
      };
      const hold = await host.run(
        () => (dependsOn.length ? inOrder(projectId, take) : take()),
        projectId,
      );
      const changing = await changingFor(repo, actor, held, holdBase);
      const answer: CollabWorkResponse = { hold, changing };
      res.status(201).json(answer);
    },
  );

  app.post<{ project: string; claim: string }>(
    "/api/collab/projects/:project/holds/:claim/release",
    participant,
    async (req, res) => {
      const { fence, done } = releaseSchema.parse(req.body);
      const { project, claim } = req.params;
      projectOf(project);
      const actor = res.locals.actor as Actor;
      const release = async () => {
        const ended = await host.coordinator().release(actor, project, claim, { fence });
        const key = taskKey(project, ended.taskId);
        if (!done) {
          if (sideEntry(host.side().holds, key) !== undefined)
            await host.saveSide((draft) => dropHoldEntries(draft, [key]));
          return;
        }
        // After the release: a write that fails leaves the task not done, never done and held.
        try {
          await host.saveSide((draft) => {
            const tasks = (draft.tasks ??= {});
            tasks[key] = { ...sideEntry(tasks, key), doneAt: ended.updatedAt };
            dropHoldEntries(draft, [key]);
          });
        } catch (error) {
          // A refusal, such as group work that stopped, says so itself.
          if (reasonOf(error) !== undefined) throw error;
          log.error("Group work could not save that a task is done", {
            project,
            task: ended.taskId,
            error: redact(error instanceof Error ? error.message : String(error)),
          });
          throw refuse(500, "doneNotSaved", (m) => m.collab.doneNotSaved);
        }
      };
      await host.run(() => (done ? inOrder(project, release) : release()), project);
      const answer: CollabOkResponse = { ok: true };
      res.json(answer);
    },
  );

  app.post<{ project: string; claim: string }>(
    "/api/collab/projects/:project/holds/:claim/revoke",
    participant,
    async (req, res) => {
      revokeSchema.parse(req.body);
      const actor = res.locals.actor as Actor;
      if (actor.role !== "admin") throw adminOnly();
      const { project, claim } = req.params;
      projectOf(project);
      await host.run(async () => {
        const ended = await host.coordinator().revoke(actor, project, claim, {});
        const key = taskKey(project, ended.taskId);
        if (sideEntry(host.side().holds, key) !== undefined)
          await host.saveSide((draft) => dropHoldEntries(draft, [key]));
      }, project);
      const answer: CollabOkResponse = { ok: true };
      res.json(answer);
    },
  );

  app.get<{ project: string }>(
    "/api/collab/projects/:project/dependencies",
    participant,
    async (req, res) => {
      const projectId = req.params.project;
      projectOf(projectId);
      const side = host.side();
      const dependencies: CollabFileDependency[] = Object.entries(
        sideEntry(side.fileDeps, projectId) ?? {},
      )
        .map(([id, dep]) => ({
          id,
          from: dep.from,
          to: dep.to,
          mode: dep.mode,
          createdBy: dep.createdBy,
          createdByName: nameOf(side, dep.createdBy),
          createdAt: dep.createdAt,
          ...(dep.note ? { note: dep.note } : {}),
        }))
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      const scan = req.query.scan === "1" || req.query.scan === "true";
      const repo = scan ? repoOf(projectId) : undefined;
      const detectedImports = repo ? await scanRepositoryImports(repo.path) : undefined;
      res.json({
        dependencies,
        ...(detectedImports ? { detectedImports } : {}),
      });
    },
  );

  app.post<{ project: string }>(
    "/api/collab/projects/:project/dependencies",
    participant,
    async (req, res) => {
      const actor = res.locals.actor as Actor;
      pace(works, actor);
      const body = dependencyBodySchema.parse(req.body);
      const projectId = req.params.project;
      const { held, invalid } = await scopesOf(projectId, [body.from, body.to]);
      if (invalid.length || held.length !== 2) throw invalidScope(invalid);
      const [from, to] = held;
      if (pathsMeet(from, to)) throw invalidScope([body.from, body.to]);
      const dependency = await host.run(async () => {
        const current = sideEntry(host.side().fileDeps, projectId) ?? {};
        const duplicate = Object.entries(current).find(
          ([, dep]) =>
            (dep.from.toLowerCase() === from.toLowerCase() &&
              dep.to.toLowerCase() === to.toLowerCase()) ||
            (dep.from.toLowerCase() === to.toLowerCase() &&
              dep.to.toLowerCase() === from.toLowerCase()),
        );
        if (!duplicate && Object.keys(current).length >= maxFileDependencies)
          throw refuse(400, "tooManyDependencies", (m) =>
            m.collab.tooManyDependencies({ max: maxFileDependencies }),
          );
        const id = duplicate ? duplicate[0] : collabId("d");
        const createdAt = new Date().toISOString();
        const note = body.note?.trim() || undefined;
        await host.saveSide((draft) => {
          const map = ((draft.fileDeps ??= {})[projectId] ??= {});
          map[id] = {
            from,
            to,
            mode: body.mode,
            createdBy: actor.id,
            createdAt,
            ...(note ? { note } : {}),
          };
        });
        const side = host.side();
        return {
          id,
          from,
          to,
          mode: body.mode,
          createdBy: actor.id,
          createdByName: nameOf(side, actor.id),
          createdAt,
          ...(note ? { note } : {}),
        } satisfies CollabFileDependency;
      }, projectId);
      res.status(201).json({ dependency });
    },
  );

  app.delete<{ project: string; depId: string }>(
    "/api/collab/projects/:project/dependencies/:depId",
    participant,
    async (req, res) => {
      const actor = res.locals.actor as Actor;
      const { project: projectId, depId } = req.params;
      projectOf(projectId);
      await host.run(async () => {
        const existing = sideEntry(sideEntry(host.side().fileDeps, projectId), depId);
        if (!existing) throw refuse(404, "unknownDependency", (m) => m.collab.unknownDependency);
        if (actor.role !== "admin" && existing.createdBy !== actor.id) throw adminOnly();
        await host.saveSide((draft) => {
          const map = sideEntry(draft.fileDeps, projectId);
          if (!map) return;
          delete map[depId];
          if (!Object.keys(map).length && draft.fileDeps) {
            delete draft.fileDeps[projectId];
            if (!Object.keys(draft.fileDeps).length) delete draft.fileDeps;
          }
        });
      }, projectId);
      res.json({ ok: true });
    },
  );

  app.post("/api/collab/activity", participant, (req, res) => {
    const actor = res.locals.actor as Actor;
    const body = activityBodySchema.parse(req.body);
    const side = host.side();
    const filePath = body.filePath ? baseScopePath(claimableScope(body.filePath) ?? "") || undefined : undefined;
    const lineStart = body.lineStart;
    const lineEnd =
      lineStart !== undefined
        ? Math.max(lineStart, body.lineEnd ?? lineStart)
        : undefined;
    const entry: CollabMemberActivity = {
      id: actor.id,
      name: nameOf(side, actor.id),
      updatedAt: new Date().toISOString(),
      ...(body.repoId ? { repoId: body.repoId } : {}),
      ...(body.view ? { view: body.view } : {}),
      ...(body.runId ? { runId: body.runId } : {}),
      ...(body.runTitle ? { runTitle: body.runTitle } : {}),
      ...(body.runStatus ? { runStatus: body.runStatus } : {}),
      ...(filePath ? { filePath } : {}),
      ...(lineStart !== undefined ? { lineStart } : {}),
      ...(lineEnd !== undefined ? { lineEnd } : {}),
    };
    const projectIds = body.repoId
      ? Object.entries(side.projects ?? {})
          .filter(([, p]) => p.repoId === body.repoId)
          .map(([id]) => id)
      : undefined;
    hub.reportActivity(entry, projectIds?.length ? projectIds : undefined);
    res.json({ ok: true });
  });

  app.get("/api/collab/activity", participant, (req, res) => {
    const actor = res.locals.actor as Actor;
    const repoId = typeof req.query.repoId === "string" ? req.query.repoId.slice(0, 64) : undefined;
    const activities = hub.activities(repoId);
    const holds: (CollabHold & { holderName: string })[] = [];
    const dependencies: CollabFileDependency[] = [];
    if (repoId) {
      const side = host.side();
      const coordinator = host.coordinator();
      for (const [projectId, project] of Object.entries(side.projects ?? {})) {
        if (project.repoId !== repoId) continue;
        for (const claim of coordinator.project(actor, projectId).claims) {
          if (claim.status !== "held") continue;
          holds.push({
            ...holdOf(side, projectId, claim),
            holderName: nameOf(side, claim.holder),
          });
        }
        for (const [id, dep] of Object.entries(sideEntry(side.fileDeps, projectId) ?? {})) {
          dependencies.push({
            id,
            from: dep.from,
            to: dep.to,
            mode: dep.mode,
            createdBy: dep.createdBy,
            createdByName: nameOf(side, dep.createdBy),
            createdAt: dep.createdAt,
            ...(dep.note ? { note: dep.note } : {}),
          });
        }
      }
    }
    res.json({
      asOf: new Date().toISOString(),
      activities,
      ...(repoId ? { holds, dependencies } : {}),
    });
  });

  return hub;
}
