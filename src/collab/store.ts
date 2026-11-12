/**
 * What the Group page (#/group) shows: where group work stands, the group's
 * repositories and the board of the chosen one, which its feed keeps current
 * (a long poll). One store per open page: `open` starts the requests and
 * `close` ends every one of them, with their timers.
 */
import type {
  CollabAddProjectResponse,
  CollabBoard,
  CollabBoardTodo,
  CollabFeedResponse,
  CollabFileDependency,
  CollabHold,
  CollabInfo,
  CollabJoinResponse,
  CollabMemberActivity,
  CollabProject,
  CollabProjectsResponse,
} from "../../shared/collab";
import { api, ApiError, deviceInfoStorageKey, deviceTokenStorageKey, send } from "../api";
import { keepParticipantToken, participantToken } from "./participant";

export interface GroupState {
  /** GET /api/collab; undefined until it answered. */
  info?: CollabInfo;
  /** The server's sentence when it no longer knew this participant. */
  refused?: string;
  /** The group's repositories; undefined until they are known. */
  projects?: CollabProject[];
  /** For an admin: the repositories of this instance that can be added. */
  addable?: CollabProjectsResponse["addable"];
  /** The id of the chosen repository. */
  project?: string;
  people: CollabBoard["people"];
  /** Oldest first, as the server gave them; undefined until a board arrived. */
  held?: CollabHold[];
  /** Cross-file dependency rules of the chosen repository. */
  dependencies?: CollabFileDependency[];
  /** Open coordination TODOs across active runs of the chosen repository. */
  openTodos?: CollabBoardTodo[];
  /** Live member activity across the group. */
  activities?: CollabMemberActivity[];
  /** The ids of the people looking at this board now. */
  present: string[];
  /** What the last board brought and took away; empty for the first board of a repository or of an epoch. */
  added: CollabHold[];
  ended: CollabHold[];
  link: "live" | "polling" | "reconnecting";
  /** When the board was last confirmed: the host's clock, or this one's when nothing had changed. */
  asOf?: string | number;
}

/** The `reason` of a refusal of group work. */
export const reasonOf = (error: unknown) =>
  error instanceof ApiError ? error.details.reason : undefined;

/** Seconds to wait after the first, second, third and every later failure. */
const backoff = [1, 2, 5, 15];

/** Resolves after `ms`, or at once when the page stops asking. */
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

/** `next` with the objects of `previous` wherever nothing changed, and `previous` itself when nothing did. */
function keep<T>(previous: T[], next: T[], idOf: (item: T) => string): T[] {
  const known = new Map(previous.map((item) => [idOf(item), item]));
  const kept = next.map((item) => {
    const old = known.get(idOf(item));
    return old !== undefined && JSON.stringify(old) === JSON.stringify(item) ? old : item;
  });
  return kept.length === previous.length && kept.every((item, index) => item === previous[index])
    ? previous
    : kept;
}

function saveAuthResult(result: CollabJoinResponse) {
  keepParticipantToken(result.token);
  if (result.deviceToken) {
    try {
      localStorage.setItem(
        deviceInfoStorageKey,
        JSON.stringify({ id: result.deviceId ?? result.id, name: result.name }),
      );
      localStorage.setItem(deviceTokenStorageKey, result.deviceToken);
    } catch {
      // Storage may be unavailable in private browsing or tests.
    }
  }
}

export function createGroupStore() {
  let state: GroupState = { people: [], present: [], added: [], ended: [], link: "live" };
  const listeners = new Set<() => void>();
  let loop: AbortController | undefined;
  /** The page has left: a request of its that ends later starts nothing again. */
  let closed = false;
  /** Where the feed stands for the board in hand. */
  let cursor: Pick<CollabFeedResponse, "epoch" | "version" | "seen"> | undefined;

  function set(patch: Partial<GroupState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  /** The board in hand goes, with its place in the feed: nothing stale is shown. */
  function drop(patch: Partial<GroupState>) {
    cursor = undefined;
    set({
      people: [],
      held: undefined,
      dependencies: undefined,
      openTodos: undefined,
      activities: undefined,
      present: [],
      added: [],
      ended: [],
      asOf: undefined,
      ...patch,
    });
  }

  /**
   * A request of group work, as this participant. When the server no longer
   * knows them the join card shows, with its sentence; the token stays.
   */
  async function call<T>(path: string, options?: RequestInit): Promise<T> {
    try {
      return await api<T>(`/collab${path}`, {
        ...options,
        headers: { "x-bell-participant": participantToken() },
      });
    } catch (error) {
      if (reasonOf(error) === "notJoined" && !options?.signal?.aborted) {
        loop?.abort();
        drop({
          refused: (error as ApiError).message,
          info: state.info && { ...state.info, me: undefined },
        });
      }
      throw error;
    }
  }

  function took(answer: CollabFeedResponse): Partial<GroupState> {
    // Marks are for a change within one repository and one epoch only.
    const before = cursor?.epoch === answer.epoch ? state.held : undefined;
    cursor = { epoch: answer.epoch, version: answer.version, seen: answer.seen };
    const patch: Partial<GroupState> = {
      asOf: answer.asOf,
      present: keep(state.present, answer.present, (id) => id),
      ...(answer.activities !== undefined || state.activities !== undefined
        ? { activities: keep(state.activities ?? [], answer.activities ?? [], (item) => item.id) }
        : {}),
    };
    if (!answer.board) return patch;
    const held = keep(state.held ?? [], answer.board.held, (hold) => hold.claimId);
    const missing = (from: CollabHold[]) => (hold: CollabHold) =>
      !from.some((other) => other.claimId === hold.claimId);
    return {
      ...patch,
      people: keep(state.people, answer.board.people, (person) => person.id),
      held,
      ...(answer.board.dependencies !== undefined || state.dependencies !== undefined
        ? {
            dependencies: keep(
              state.dependencies ?? [],
              answer.board.dependencies ?? [],
              (dep) => dep.id,
            ),
          }
        : {}),
      ...(answer.board.openTodos !== undefined || state.openTodos !== undefined
        ? {
            openTodos: keep(
              state.openTodos ?? [],
              answer.board.openTodos ?? [],
              (todo) => todo.id,
            ),
          }
        : {}),
      added: before ? held.filter(missing(before)) : [],
      ended: before ? before.filter(missing(held)) : [],
    };
  }

  async function follow(signal: AbortSignal) {
    let failures = 0;
    // Requests left that do not wait, after the server had no place for one that does.
    let polls = 0;
    const fail = () => pause(backoff[Math.min(failures++, 3)] * 1000, signal);
    /** The feed waits up to 25 s and nothing else waits: a request still open after 40 is given up, as a failure. */
    const ask = <T>(path: string) => {
      const request = new AbortController();
      const giveUp = () => request.abort();
      const limit = setTimeout(giveUp, 40_000);
      signal.addEventListener("abort", giveUp);
      return call<T>(path, { signal: request.signal }).finally(() => {
        clearTimeout(limit);
        signal.removeEventListener("abort", giveUp);
      });
    };
    while (!signal.aborted) {
      try {
        if (!state.info?.me) {
          const info = await ask<CollabInfo>("");
          if (signal.aborted) return;
          if (info.state !== "ready") {
            drop({ info });
            await fail();
            continue;
          }
          set({ info });
          // The join card or the host card: `join` starts this again.
          if (!info.me) return;
        }
        if (!state.projects?.some((project) => project.id === state.project)) {
          const { projects, addable } = await ask<CollabProjectsResponse>("/projects");
          if (signal.aborted) return;
          const chosen = projects.find((project) => project.id === state.project) ?? projects[0];
          // With no repository yet a list only adds to what can be added: it leaves out one that
          // is being copied, and the choice in the card must not change under the person.
          // shortcut: one that can no longer be added (deleted here, say) stays offered until a
          // reload and its add is refused; take the list whole once it marks those being copied.
          const known = (chosen ? undefined : state.addable) ?? [];
          drop({
            projects,
            addable: addable && [
              ...known,
              ...addable.filter((repo) => !known.some((old) => old.repoId === repo.repoId)),
            ],
            project: chosen?.id,
            // An answer: what failed before it no longer shows as "Reconnecting".
            link: "live",
          });
          if (!chosen) {
            // None yet: asked again, for the one an admin adds meanwhile.
            await pause(10_000, signal);
            continue;
          }
        }
        const query = new URLSearchParams({ wait: polls ? "0" : "25" });
        if (cursor) {
          query.set("epoch", cursor.epoch);
          query.set("version", String(cursor.version));
          query.set("seen", String(cursor.seen));
        }
        const answer = await ask<CollabFeedResponse | undefined>(
          `/projects/${encodeURIComponent(state.project!)}/feed?${query}`,
        );
        if (signal.aborted) return;
        failures = 0;
        set({ ...(answer ? took(answer) : { asOf: Date.now() }), link: polls ? "polling" : "live" });
        if (polls) {
          polls -= 1;
          await pause(10_000, signal);
        }
      } catch (error) {
        if (signal.aborted) return;
        const reason = reasonOf(error);
        if (reason === "tooManyWaiters") {
          // One that does not wait is asked instead, every 10 s also when it is refused, and a waiting one again after a minute.
          if (polls) await pause(10_000, signal);
          polls = 6;
          set({ link: "polling" });
          continue;
        }
        if (reason === "unknownProject") drop({ projects: undefined, project: undefined });
        else if (reason !== undefined && (error as ApiError).status === 503)
          // Group work is not ready any more: GET /api/collab says where it stands.
          drop({
            info: state.info && {
              ...state.info,
              state: reason === "notSetUp" ? reason : "stopped",
              me: undefined,
            },
          });
        else set({ link: "reconnecting" });
        await fail();
      }
    }
  }

  /** Starts the requests again, unless the page has left. */
  function restart() {
    loop?.abort();
    if (closed) return;
    loop = new AbortController();
    void follow(loop.signal);
  }

  function resetAfterAuth(result: CollabJoinResponse) {
    saveAuthResult(result);
    // The card goes at once, so a second press cannot send the used code again. Maybe as
    // another person: the repositories, and which ones can be added, are asked for again.
    set({ info: undefined, refused: undefined, projects: undefined, addable: undefined, link: "live" });
    restart();
  }

  async function join(code: string, credentials?: { username?: string; password?: string }) {
    const body =
      credentials?.username && credentials.password
        ? { code, username: credentials.username, password: credentials.password }
        : { code };
    const result = await api<CollabJoinResponse>("/collab/join", send("POST", body));
    resetAfterAuth(result);
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get: () => state,
    call,
    open() {
      closed = false;
      restart();
    },
    close() {
      closed = true;
      loop?.abort();
    },
    choose(project: string) {
      drop({ project });
      restart();
    },
    /** Asks for the whole board again. */
    reload() {
      cursor = undefined;
      restart();
    },
    join,
    async login(username: string, password: string) {
      const result = await api<CollabJoinResponse>(
        "/collab/auth/login",
        send("POST", { username, password }),
      );
      resetAfterAuth(result);
    },
    async loginTailscale(code?: string) {
      const result = await api<CollabJoinResponse>(
        "/collab/auth/tailscale",
        send("POST", code ? { code } : {}),
      );
      resetAfterAuth(result);
    },
    /** At the host or remote bootstrap: initializes group work when needed and joins as admin. */
    async start(name: string, credentials?: { username?: string; password?: string }) {
      const payload =
        credentials?.username && credentials.password
          ? { name, username: credentials.username, password: credentials.password }
          : { name };
      const result = await api<CollabJoinResponse>("/collab/bootstrap", send("POST", payload));
      resetAfterAuth(result);
    },
    /** Adds a repository of this instance to the group and shows its board; can take minutes. */
    async add(repoId: string) {
      const { project } = await call<CollabAddProjectResponse>("/projects", send("POST", { repoId }));
      // The list is asked again: it has this repository, and what else came while it was copied.
      // An answer: what failed before it no longer shows as "Reconnecting".
      drop({ projects: undefined, addable: undefined, project: project.id, link: "live" });
      restart();
    },
  };
}
