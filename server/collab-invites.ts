/**
 * Invites to group work. A code is made and read as a pairing code is
 * (pairing.ts). Only its sha256 is kept, in memory, for 10 minutes and one
 * use; at most 20 wait at a time, and a restart voids them all.
 *
 * Wrong codes count per caller (a paired device's id, or "install" for the
 * person at the host): 10 within 15 minutes lock that caller alone for 15
 * minutes. A wrong code never voids anyone's invite.
 */
import { digestsMatch, sha256Hex } from "./device-tokens.js";
import {
  failureLimit,
  failureWindow,
  firstLockDuration,
  generatePairCode,
  normalizePairCode,
} from "./pairing.js";

export const inviteTtl = 10 * 60_000;
export const maxInvites = 20;

/**
 * What a code stands for: a named person to add, or ("Use on another
 * device") the inviter's own id and token, kept only while the code lives.
 */
export type Invite = { name: string; admin?: true } | { self: { id: string; token: string } };

export type InviteRedeemed =
  | { status: "ok"; invite: Invite }
  | { status: "invalid" }
  /** `retryAfter` in seconds. */
  | { status: "locked"; retryAfter: number };

export class CollabInvites {
  /** By the sha256 of the code. */
  private readonly waiting = new Map<string, { invite: Invite; expiresAt: number }>();
  private readonly failures = new Map<string, { at: number[]; lockedUntil?: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private prune(now: number) {
    for (const [hash, { expiresAt }] of this.waiting) if (expiresAt <= now) this.waiting.delete(hash);
  }

  /** A new code, or undefined while 20 are still waiting. */
  create(invite: Invite): { code: string; expiresAt: number } | undefined {
    const now = this.now();
    this.prune(now);
    if (this.waiting.size >= maxInvites) return undefined;
    const code = generatePairCode();
    const expiresAt = now + inviteTtl;
    this.waiting.set(sha256Hex(normalizePairCode(code)!), { invite, expiresAt });
    return { code, expiresAt };
  }

  /** Uses a code up, or counts a wrong one against `caller`. */
  redeem(input: string, caller: string): InviteRedeemed {
    const now = this.now();
    this.prune(now);
    const record = this.failures.get(caller);
    if (record?.lockedUntil !== undefined && record.lockedUntil > now)
      return { status: "locked", retryAfter: Math.ceil((record.lockedUntil - now) / 1000) };
    // Text that is not a code matches nothing: no waiting code is empty.
    const digest = sha256Hex(normalizePairCode(input) ?? "");
    // Compares with every waiting code, so the time taken says nothing about which.
    let found: string | undefined;
    for (const hash of this.waiting.keys()) if (digestsMatch(digest, hash)) found = hash;
    if (found !== undefined) {
      const { invite } = this.waiting.get(found)!;
      this.waiting.delete(found);
      this.failures.delete(caller);
      return { status: "ok", invite };
    }
    const at = [...(record?.at ?? []).filter((time) => now - time < failureWindow), now];
    if (at.length < failureLimit) {
      this.failures.set(caller, { at });
      return { status: "invalid" };
    }
    this.failures.set(caller, { at: [], lockedUntil: now + firstLockDuration });
    return { status: "locked", retryAfter: firstLockDuration / 1000 };
  }
}
