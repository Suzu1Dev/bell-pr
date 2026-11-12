/**
 * Group work API shapes (/api/collab), shared by the server, the CLI and
 * the Group page. A request carries the app token as every other request
 * does, and says who is asking within the group with a participant token
 * (`bpc_…`) in the `x-bell-participant` header.
 */
import type { RunStatus, TeamTodoItem } from "./types.js";

/** Where group work stands on this instance. Never persisted. */
export type CollabState = "notSetUp" | "ready" | "stopped";

/** At most this many people are saved as one run's owners (`Run.owners`); a device rarely has more than a few. */
export const maxRunOwners = 100;

/** `collab` in GET /api/status; absent when BELL PR runs without --group. */
export interface CollabStatus {
  state: CollabState;
  /** Why it stopped: a stable word, not a sentence. */
  reason?: string;
}

/** GET /api/collab/auth/status → 200 (public when group work is enabled). */
export interface CollabAuthStatus {
  enabled: boolean;
  state: CollabState;
  hasAccounts?: boolean;
  tailscaleAvailable?: boolean;
  tailscaleLogin?: string;
  tailscaleName?: string;
}

/** GET /api/collab → 200. */
export interface CollabInfo extends CollabStatus {
  groupId?: string;
  /** The request came with the install token: the person at the host. */
  host: boolean;
  tailscaleAvailable?: boolean;
  tailscaleLogin?: string;
  /** Who the participant token belongs to; absent when missing, unknown or removed. */
  me?: { id: string; name: string; admin?: true; username?: string; tailscaleLogin?: string };
}

/** POST /api/collab/setup → 201. */
export interface CollabSetupResponse {
  state: "ready";
  groupId: string;
}

/** POST /api/collab/invites → 201. The code is shown only here, once. */
export interface CollabInviteResponse {
  code: string;
  /** ISO 8601. */
  expiresAt: string;
}

/** POST /api/collab/join → 201. The token is given only here, again for a code made for oneself. */
export interface CollabJoinResponse {
  groupId: string;
  id: string;
  name: string;
  admin?: true;
  username?: string;
  tailscaleLogin?: string;
  token: string;
  /** Returned when joining/signing in from an unpaired remote browser over VPN/Tailscale. */
  deviceId?: string;
  deviceToken?: string;
}

/** A member record shown in the Admin management view (GET /api/collab/people). */
export interface CollabMemberRecord {
  id: string;
  name: string;
  admin?: true;
  username?: string;
  tailscaleLogin?: string;
  joinedAt?: string;
  disabled?: true;
  removed?: true;
  heldCount: number;
}

/** Cross-file dependency rule between two paths in a repository (1c). */
export type CollabDependencyMode = "warn" | "block";

export interface CollabFileDependency {
  id: string;
  /** Dependent file or folder path (changes here rely on `to`). */
  from: string;
  /** Prerequisite / upstream file or folder path. */
  to: string;
  mode: CollabDependencyMode;
  note?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}

export interface CollabDetectedImport {
  from: string;
  to: string;
}

/** A cross-file dependency hit when checking or taking a hold. */
export interface CollabDependencyHit {
  askedPath: string;
  heldPath: string;
  holder: string;
  title: string;
  claimId: string;
  mode: CollabDependencyMode;
  autoDetected?: true;
  note?: string;
}

/** Live member presence & progress activity (2). */
export interface CollabMemberActivity {
  id: string;
  name: string;
  projectId?: string;
  repoId?: string;
  view?: "group" | "workspace" | "changes" | "review" | "draft" | "publish";
  runId?: string;
  runTitle?: string;
  runStatus?: RunStatus;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  updatedAt: string;
}

/** Open coordination TODO surfaced on the repository's group board (3c). */
export interface CollabBoardTodo extends TeamTodoItem {
  runId: string;
  runTitle: string;
}

/** POST /api/collab/people/:id/remove → 200. */
export interface CollabRemoveResponse {
  /** Holds of that person that were revoked. */
  revoked: number;
  /** The device they joined from was unpaired too. */
  unpaired: boolean;
}

/** One of the group's repositories. */
export interface CollabProject {
  id: string;
  name: string;
}

/** GET /api/collab/projects → 200. */
export interface CollabProjectsResponse {
  projects: CollabProject[];
  /** For admins: this BELL PR's repositories that are not added yet. */
  addable?: { repoId: string; name: string }[];
  /** For admins: bytes the group's record takes and the most it may; absent when unknown. */
  storage?: { used: number; max: number };
}

/** POST /api/collab/projects. */
export interface CollabAddProjectRequest {
  repoId: string;
}

/** POST /api/collab/projects → 201. */
export interface CollabAddProjectResponse {
  project: CollabProject;
}

/** Paths one person holds for a task. */
export interface CollabHold {
  claimId: string;
  taskId: string;
  title: string;
  /** The id of the person who holds them. */
  holder: string;
  scopes: string[];
  /** Goes back with a release. */
  fence: number;
  /** ISO 8601. */
  since: string;
  /** The tasks this work waited for, all done when it was held; absent when none. */
  dependsOn?: CollabDependency[];
}

/** A task that other work depends on. */
export interface CollabDependency {
  taskId: string;
  title: string;
}

/** One repository's board: who holds what. */
export interface CollabBoard {
  project: { id: string; name: string; repoId?: string };
  /** The group's people; a removed person only while they still hold something. */
  people: {
    id: string;
    name: string;
    admin?: true;
    removed?: true;
    disabled?: true;
    username?: string;
  }[];
  /** Oldest first. */
  held: CollabHold[];
  /** Cross-file dependency rules defined on this project; omitted when empty. */
  dependencies?: CollabFileDependency[];
  /** Open team coordination TODOs across unfinished runs of this repository; omitted when empty. */
  openTodos?: CollabBoardTodo[];
}

/** GET /api/collab/projects/:project/tasks → 200. */
export interface CollabTasksResponse {
  tasks: (CollabDependency & { status: "held" | "done" })[];
}

/**
 * GET /api/collab/projects/:project/feed?epoch=&version=&seen=&wait= → 200,
 * or 204 when nothing changed within `wait` seconds (0 to 25). The next
 * request sends `epoch`, `version` and `seen` back as it got them.
 */
export interface CollabFeedResponse {
  /** Another one after BELL PR restarts: `version` and `seen` count anew. */
  epoch: string;
  /** Rises when the board changes. */
  version: number;
  /** Rises when `present` or `activities` changes. */
  seen: number;
  /** ISO 8601: the host's clock when this was answered. */
  asOf: string;
  /** Left out when the caller's `epoch` and `version` are current. */
  board?: CollabBoard;
  /** The ids of the people looking at this board now. */
  present: string[];
  /** Live member status and viewing focus across the workspace; omitted when none. */
  activities?: CollabMemberActivity[];
}

/** POST /api/collab/projects/:project/check. */
export interface CollabCheckRequest {
  scopes: string[];
}

/** A held path that is in the way of an asked one. */
export interface CollabMeeting {
  /** The held path. */
  scope: string;
  claimId: string;
  taskId: string;
  title: string;
  /** The holder's name. */
  holder: string;
}

/** Another unfinished run of this repository whose files or plan meet an asked path. */
export interface CollabChanging {
  runId: string;
  title: string;
  status: RunStatus;
  /** Names of the group's people who own the run; empty when none of them started it. */
  owners: string[];
  /** The changed or planned paths of the run that meet the asked paths, sorted. */
  paths: string[];
}

/** POST /api/collab/projects/:project/check → 200. Changes nothing. */
export interface CollabCheckResponse {
  /** ISO 8601. */
  asOf: string;
  /** The asked paths that cannot be held, as they were sent. */
  invalid: string[];
  meets: CollabMeeting[];
  /** Other people's unfinished runs whose files or plans already meet the asked paths. */
  changing: CollabChanging[];
  /** Cross-file dependencies whose counterpart is held by someone else; omitted when empty. */
  dependencyHits?: CollabDependencyHit[];
}

/** POST /api/collab/projects/:project/work. */
export interface CollabWorkRequest {
  title: string;
  scopes: string[];
  /** Tasks of this repository that must be done first: at most 50 ids. */
  dependsOn?: string[];
}

/** POST /api/collab/projects/:project/work → 201. */
export interface CollabWorkResponse {
  hold: CollabHold;
  /** Other people's unfinished runs whose files or plans already meet the new hold. */
  changing: CollabChanging[];
}

/** In a 409 `conflict`: a held path that is in the way. */
export interface CollabConflict {
  scope: string;
  /** The holder's name. */
  holder: string;
  title: string;
  /** ISO 8601. */
  since: string;
}

/** POST /api/collab/projects/:project/holds/:claim/release. */
export interface CollabReleaseRequest {
  fence: number;
  /** The task is finished: work that depends on it may start. */
  done?: boolean;
}

/** POST …/release and …/revoke → 200. */
export interface CollabOkResponse {
  ok: true;
}

/**
 * Every refusal of /api/collab: its status, a stable `reason`, a sentence
 * in the request's language and, at most, the fields named here.
 */
export interface CollabRefusal {
  reason?: string;
  error: string;
  /** With 409 `conflict`. */
  conflicts?: CollabConflict[];
  /** Seconds; with 429 `slowDown` and `joinLocked`. */
  retryAfter?: number;
  /** With 400 `invalidScope`: the paths that cannot be held. */
  invalid?: string[];
  /** With 400 `dependencyUnknown`: the asked ids that are no task of this repository. */
  unknown?: string[];
  /**
   * With 409 `dependencyPending`: the tasks not done yet. `held` is false
   * for one that was never held or whose hold ended without being done; it
   * is never done now.
   */
  pending?: (CollabDependency & { held: boolean })[];
  /** With 409 `dependencyBlocked`: cross-file guard rules whose counterpart is currently held. */
  dependencyHits?: CollabDependencyHit[];
}
