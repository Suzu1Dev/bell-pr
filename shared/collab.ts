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

/** POST /api/collab/join → 201. The token is shown only here, once. */
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
