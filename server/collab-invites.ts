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
 * What a code stands for: a named person to add, with the id of the admin
 * who invites them unless it is the person at the host; or ("Use on
 * another device") the inviter's own id and token, kept only while the
 * code lives.
 */
export type Invite =
  | { name: string; admin?: true; by?: string }
  | { self: { id: string; token: string } };

export type InviteRedeemed =
  | { status: "ok"; invite: Invite }
  | { status: "invalid" }
  /** `retryAfter` in seconds. */
  | { status: "locked"; retryAfter: number };

export class CollabInvites {
  /** By the sha256 of the code. */
  private readonly waiting = new Map<
    string,
    { invite: Invite; expiresAt: number; timer: NodeJS.Timeout }
  >();
  private readonly failures = new Map<string, { at: number[]; lockedUntil?: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private forget(hash: string) {
    clearTimeout(this.waiting.get(hash)?.timer);
    this.waiting.delete(hash);
  }

  private prune(now: number) {
    for (const [hash, { expiresAt }] of this.waiting) if (expiresAt <= now) this.forget(hash);
  }

  /** A new code, or undefined while 20 are still waiting. */
  create(invite: Invite): { code: string; expiresAt: number } | undefined {
    const now = this.now();
    this.prune(now);
    // One code for oneself at a time: a new one replaces the old, so nobody fills the 20 alone.
    if ("self" in invite)
      for (const [hash, { invite: other }] of this.waiting)
        if ("self" in other && other.self.id === invite.self.id) this.forget(hash);
    if (this.waiting.size >= maxInvites) return undefined;
    const code = generatePairCode();
    const hash = sha256Hex(normalizePairCode(code)!);
    // Gone when its time is up, with no later call: a self invite holds a token.
    const timer = setTimeout(() => this.waiting.delete(hash), inviteTtl);
    timer.unref();
    this.waiting.set(hash, { invite, expiresAt: now + inviteTtl, timer });
    return { code, expiresAt: now + inviteTtl };
  }

  /** Voids what a removed person left waiting: the codes they gave out and their own. */
  drop(id: string) {
    for (const [hash, { invite }] of this.waiting)
      if ("self" in invite ? invite.self.id === id : invite.by === id) this.forget(hash);
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
      this.forget(found);
      // A code for oneself costs nothing to make, so it does not clear the count.
      if (!("self" in invite)) this.failures.delete(caller);
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
