/**
 * Group work's host: this data directory's coordinator (coordination.ts)
 * and the side file beside it, `collab.json`, which keeps what the
 * coordinator does not: the group's id, people's names, the repositories'
 * names and the tasks' titles.
 *
 * startServer makes one when BELL PR starts with --group, once the strict
 * lock is held. It is `notSetUp` until the person at the host sets group
 * work up, `ready` while the coordinator and the side file are both usable,
 * and `stopped` otherwise. Stopped stays stopped and nothing is recreated:
 * a restart of BELL PR reads both files again.
 */
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import type { CollabState, CollabStatus } from "../shared/collab.js";
import { reasonOf, refuse } from "./collab-refusal.js";
import { dataPaths } from "./config.js";
import { Coordinator, type CoordinatorOptions } from "./coordination.js";
import { writeDurable } from "./fs-atomic.js";
import { log } from "./log.js";
import { lenientRead } from "./persisted-schema.js";
import { AppError } from "./types.js";

const stamp = z.string().max(40).optional();
/** collab.json as written. Every field is optional, for older and newer builds. */
const sideSchema = z.strictObject({
  /** Random, set at setup; a browser keys its stored participant token by it. */
  groupId: z.string().max(64).optional(),
  setUpAt: stamp,
  /** By participant id. `admin` is for display; permissions use the coordinator's role. */
  people: z
    .record(
      z.string().max(64),
      z.strictObject({
        name: z.string().max(40).optional(),
        joinedAt: stamp,
        admin: z.literal(true).optional(),
        removedAt: stamp,
        /** The paired device they joined from, when it was one. */
        deviceId: z.string().max(64).optional(),
      }),
    )
    .optional(),
  /** The group's repositories, by project id. The name stays when BELL PR forgets the repository. */
  projects: z
    .record(
      z.string().max(64),
      z.strictObject({
        name: z.string().max(200).optional(),
        repoId: z.string().max(64).optional(),
        addedAt: stamp,
      }),
    )
    .optional(),
  /** What the coordinator does not keep of a task, by "<project id>/<task id>". */
  tasks: z
    .record(z.string().max(140), z.strictObject({ title: z.string().max(120).optional() }))
    .optional(),
});
const sideReadSchema = lenientRead(sideSchema);
export type CollabSide = z.infer<typeof sideSchema>;

export interface CollabHost {
  status(): CollabStatus;
  /** The coordinator, or the 503 refusal unless group work is ready. */
  coordinator(): Coordinator;
  /** The side file as last written. */
  side(): CollabSide;
  /** Changes the side file: one change at a time, written whole before it shows in side(). */
  saveSide(change: (draft: CollabSide) => void): Promise<void>;
  /** Creates coordination.json and collab.json: 409 `exists` when ready, 409 `missing` when stopped. */
  setUp(): Promise<void>;
  /** Runs a change; close() waits for it, and listeners hear of it once it has landed. */
  run<T>(work: () => Promise<T>, projectId?: string): Promise<T>;
  /**
   * Called after each change, with its project when it has one, and once
   * when group work stops. Returns how to stop listening.
   */
  onChange(listener: (projectId?: string) => void): () => void;
  /** Refuses new work, tells the listeners, and waits for the work in flight. */
  close(): Promise<void>;
}

/** The refusal of a group request while group work is not ready. */
export function collabNotReady(state: Exclude<CollabState, "ready">) {
  return refuse(503, state, (m) => m.collab[state]);
}

/** A side-file record's entry for an id; own keys only, so no id reaches Object.prototype. */
export function sideEntry<T>(record: Record<string, T> | undefined, id: string): T | undefined {
  return record && Object.hasOwn(record, id) ? record[id] : undefined;
}

/** A generated id the coordinator accepts: a person (`m-`), a project (`p-`) or a task (`t-`). */
export const collabId = (prefix: "m" | "p" | "t") => `${prefix}-${randomBytes(5).toString("hex")}`;

/** The side file: undefined when there is none, "damaged" when it cannot be used. */
async function readSide(file: string): Promise<CollabSide | "damaged" | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : "damaged";
  }
  try {
    return sideReadSchema.parse(JSON.parse(text));
  } catch {
    return "damaged";
  }
}

/** `options` are the coordinator's: the data directory and its lock; tests also lower its limits. */
export async function openCollabHost(options: CoordinatorOptions): Promise<CollabHost> {
  const paths = dataPaths(options.dataDir);
  let side: CollabSide = {};
  let coordinator: Coordinator | undefined;
  /** Why group work stopped; set once. */
  let stopped: string | undefined;
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const inFlight = new Set<Promise<void>>();
  const listeners = new Set<(projectId?: string) => void>();

  const notify = (projectId?: string) => {
    for (const listener of listeners) {
      try {
        listener(projectId);
      } catch (error) {
        log.warn("A group work listener failed", { error });
      }
    }
  };

  const stop = (reason: string, error?: unknown) => {
    if (stopped !== undefined) return;
    stopped = reason;
    log.warn("Group work stopped", { reason, error });
    // Once whoever found out is done: a listener asks for the state itself.
    queueMicrotask(() => notify());
  };

  const read = await readSide(paths.collab);
  if (read === "damaged" || (read?.setUpAt && !read.groupId)) stop("sideDamaged");
  else if (read?.setUpAt) {
    side = read;
    try {
      coordinator = await Coordinator.open(options);
    } catch (error) {
      stop(reasonOf(error) ?? "damaged", error);
    }
  } else {
    side = read ?? {};
    // coordination.json without the side file that names its people.
    if (await stat(paths.coordination).then(() => true, () => false)) stop("sideMissing");
  }

  /** The state, whatever close() did: work in flight still finishes after it. */
  const live = (): CollabStatus => {
    if (stopped === undefined && coordinator) {
      // Ready only under the lock: it can go between two writes.
      if (!options.lock.holds()) stop("notSingleWriter");
      // A usable coordinator answers 401 to no token; a broken one its 503.
      try {
        coordinator.authenticate(undefined);
      } catch (error) {
        if (!(error instanceof AppError) || error.statusCode !== 401)
          stop(reasonOf(error) ?? "unavailable", error);
      }
    }
    if (stopped !== undefined) return { state: "stopped", reason: stopped };
    return { state: coordinator ? "ready" : "notSetUp" };
  };
  const status = (): CollabStatus => (closed ? { state: "stopped", reason: "closed" } : live());

  const serialize = <T>(step: () => Promise<T>): Promise<T> => {
    const result = queue.then(step);
    queue = result.catch(() => undefined);
    return result;
  };

  const writeSide = async (next: CollabSide) => {
    const text = `${JSON.stringify(sideSchema.parse(next), null, 2)}\n`;
    // As the coordinator does before each write: only the lock's holder writes.
    if (!options.lock.holds()) {
      stop("notSingleWriter");
      throw collabNotReady("stopped");
    }
    await writeDurable(paths.collab, text);
    side = next;
  };

  return {
    status,
    coordinator() {
      const { state } = live();
      if (state !== "ready") throw collabNotReady(state);
      return coordinator!;
    },
    side: () => side,
    saveSide: (change) =>
      serialize(async () => {
        // A stopped group writes nothing: a missing side file is not made again.
        const { state } = live();
        if (state !== "ready") throw collabNotReady(state);
        const draft = structuredClone(side);
        change(draft);
        await writeSide(draft);
      }),
    setUp: () =>
      serialize(async () => {
        const { state } = status();
        if (state === "ready")
          throw refuse(409, "exists", (m) => m.coordination.store.exists);
        if (state === "stopped") throw refuse(409, "missing", (m) => m.collab.stopped);
        const created = await Coordinator.create(options);
        try {
          await writeSide({
            ...side,
            groupId: `g-${randomBytes(8).toString("hex")}`,
            setUpAt: new Date().toISOString(),
          });
        } catch (error) {
          // coordination.json exists now, and no side file says whose it is.
          stop("sideMissing", error);
          throw error;
        }
        coordinator = created;
      }),
    run<T>(work: () => Promise<T>, projectId?: string): Promise<T> {
      if (closed) return Promise.reject(collabNotReady("stopped"));
      const result = (async () => {
        try {
          return await work();
        } finally {
          // Also after a refusal: part of the work may have landed.
          notify(projectId);
        }
      })();
      const settled = result.then(
        () => undefined,
        () => undefined,
      );
      inFlight.add(settled);
      void settled.then(() => inFlight.delete(settled));
      return result;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close() {
      if (!closed) {
        closed = true;
        notify();
      }
      await Promise.all(inFlight);
      await queue;
    },
  };
}
