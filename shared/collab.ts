/**
 * Group work API shapes (/api/collab), shared by the server, the CLI and
 * the Group page. A request carries the app token as every other request
 * does, and says who is asking within the group with a participant token
 * (`bpc_…`) in the `x-bell-participant` header.
 */

/** Where group work stands on this instance. Never persisted. */
export type CollabState = "notSetUp" | "ready" | "stopped";

/** `collab` in GET /api/status; absent when BELL PR runs without --group. */
export interface CollabStatus {
  state: CollabState;
  /** Why it stopped: a stable word, not a sentence. */
  reason?: string;
}

/** GET /api/collab → 200. */
export interface CollabInfo extends CollabStatus {
  groupId?: string;
  /** The request came with the install token: the person at the host. */
  host: boolean;
  /** Who the participant token belongs to; absent when missing, unknown or removed. */
  me?: { id: string; name: string; admin?: true };
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
  token: string;
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
  runId?: string;
  /** The id of the person who holds them. */
  holder: string;
  scopes: string[];
  /** Goes back with a release: a later hold of the same task has another. */
  fence: number;
  /** ISO 8601. */
  since: string;
}

/** A task nobody holds now, which anyone may take again. */
export interface CollabReleased {
  taskId: string;
  title: string;
  runId?: string;
  /** The paths of its last hold; none when it was never held. */
  scopes: string[];
  /** ISO 8601: when its last hold ended, or when it was made if never held. */
  at: string;
  /** The id of the person who ended the last hold. */
  by?: string;
  /** `never`: the task was made and its hold was then refused. */
  how: "released" | "revoked" | "never";
  /** What the admin who revoked it wrote. */
  reason?: string;
}

/** One repository's board: who holds what, and what is free to take again. */
export interface CollabBoard {
  /** `closed`: the coordinator keeps the project shut until an admin settles an interrupted change. */
  project: { id: string; name: string; repoId?: string; closed?: true };
  /** The group's people; a removed person only while they still hold something. */
  people: { id: string; name: string; admin?: true; removed?: true }[];
  /** Oldest first. */
  held: CollabHold[];
  /** Newest first, at most 20. */
  released: CollabReleased[];
  /** How many more released tasks there are than `released` lists. */
  moreReleased?: number;
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
  /** Rises when `present` changes. */
  seen: number;
  /** ISO 8601: the host's clock when this was answered. */
  asOf: string;
  /** Left out when the caller's `epoch` and `version` are current. */
  board?: CollabBoard;
  /** The ids of the people looking at this board now. */
  present: string[];
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

/** POST /api/collab/projects/:project/check → 200. Changes nothing. */
export interface CollabCheckResponse {
  /** ISO 8601. */
  asOf: string;
  /** The asked paths that cannot be held, as they were sent. */
  invalid: string[];
  meets: CollabMeeting[];
}

/** POST /api/collab/projects/:project/work: a new task, or a released one taken again. */
export type CollabWorkRequest =
  | { title: string; scopes: string[]; runId?: string }
  | { taskId: string; scopes: string[] };

/** POST /api/collab/projects/:project/work → 201. */
export interface CollabWorkResponse {
  hold: CollabHold;
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
}

/** POST /api/collab/projects/:project/holds/:claim/revoke. */
export interface CollabRevokeRequest {
  reason?: string;
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
  meets?: CollabMeeting[];
}
