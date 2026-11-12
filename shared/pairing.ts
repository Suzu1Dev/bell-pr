/**
 * Device pairing API shapes, shared by the server, the CLI and the /pair
 * page. A pairing code is 8 Crockford base32 characters (40 bits), shown
 * as XXXX-XXXX; a device token is `bpd_` plus 32 random bytes in hex.
 */

/** Crockford base32: no I, L, O or U. */
export const pairCodeAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const deviceTokenPrefix = "bpd_";

/** POST /api/pair/codes → 201. */
export interface PairCodeResponse {
  code: string;
  /** ISO 8601. */
  expiresAt: string;
  /** The /pair page address, without query, fragment, or token. */
  pairUrl: string;
}

/** POST /api/pair → 201. The token is shown only here, once. */
export interface PairRedeemResponse {
  deviceId: string;
  token: string;
  name: string;
}

/** POST /api/pair or /api/pair/codes → 423. No lockedUntil: the failure record is missing or damaged. */
export interface PairLockedResponse {
  error: "pairing_locked";
  lockedUntil?: string;
  /** How to unlock, in the request's language. */
  hint: string;
}

/** GET /api/devices → 200, one per paired device. Never a token or its hash. */
export interface DeviceSummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** The request was made with this device's token. */
  current: boolean;
}
