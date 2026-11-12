/**
 * Team account credentials, session tokens (`bpa_…`) and Tailscale loopback
 * identity verification for remote multi-user collaboration.
 */
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

export const accountTokenPattern = /^bpa_[A-Za-z0-9_-]{43}$/;
const usernamePattern = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const scryptKeyLen = 32;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, scryptKeyLen, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function digestsEqual(leftHex: string, rightHex: string): boolean {
  const a = Buffer.from(leftHex, "hex");
  const b = Buffer.from(rightHex, "hex");
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

/** Normalizes a team username to lowercase ASCII, or returns undefined if invalid. */
export function normalizeUsername(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.trim().toLowerCase();
  return usernamePattern.test(cleaned) ? cleaned : undefined;
}

/** Validates a password length (8 to 128 characters). */
export function validPassword(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length >= 8 && raw.length <= 128;
}

/** Hashes a password with random 16-byte salt using Node's built-in scrypt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Verifies a password against a stored `scrypt$<salt>$<hash>` string in constant time. */
export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (salt.length !== 16 || expected.length !== scryptKeyLen) return false;
  const derived = await scryptAsync(password, salt);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Issues a new `bpa_` account session token and its SHA-256 digest for `collab.json`. */
export function issueAccountSessionToken(): { token: string; tokenHash: string } {
  const token = `bpa_${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: sha256Hex(token) };
}

/**
 * Matches a presented `bpa_` token against `collab.json`'s `sessions` map in
 * constant time across all active sessions.
 */
export function verifyAccountSessionToken(
  presented: unknown,
  sessions: Record<string, { participantId?: string }> | undefined,
): string | undefined {
  if (typeof presented !== "string" || !accountTokenPattern.test(presented) || !sessions)
    return undefined;
  const digest = sha256Hex(presented);
  let matched: string | undefined;
  for (const [hash, session] of Object.entries(sessions)) {
    if (hash.length === 64 && digestsEqual(digest, hash) && session?.participantId) {
      matched = session.participantId;
    }
  }
  return matched;
}

function isLoopbackSocket(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return (
    remoteAddress === "127.0.0.1" ||
    remoteAddress === "::1" ||
    remoteAddress === "::ffff:127.0.0.1"
  );
}

/**
 * Reads verified Tailscale Serve identity headers ONLY when Tailscale auth is
 * explicitly enabled on the host AND the TCP connection comes from a local
 * loopback proxy (`tailscale serve`), preventing remote header spoofing.
 */
export function readTailscaleIdentity(
  req: { get(name: string): string | undefined; socket?: { remoteAddress?: string } },
  enabled: boolean,
): { login: string; name: string } | undefined {
  if (!enabled || !isLoopbackSocket(req.socket?.remoteAddress)) return undefined;
  const rawLogin = req.get("tailscale-user-login")?.trim().toLowerCase();
  if (!rawLogin || rawLogin.length > 120 || !/^[^\s@]+@[^\s@]+$/.test(rawLogin)) return undefined;
  const rawName = req.get("tailscale-user-name")?.trim();
  const cleanName = (rawName && rawName.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, " ").trim()) || rawLogin.split("@")[0];
  return {
    login: rawLogin,
    name: cleanName.slice(0, 40),
  };
}

/** In-memory brute-force rate limiter for remote login attempts. */
export class AuthRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxAttempts = 10,
    private readonly windowMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): number | undefined {
    const now = this.now();
    const entry = this.buckets.get(key);
    if (!entry || now >= entry.resetAt) return undefined;
    if (entry.count >= this.maxAttempts) {
      return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    }
    return undefined;
  }

  recordFailure(key: string): void {
    const now = this.now();
    const entry = this.buckets.get(key);
    if (!entry || now >= entry.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count += 1;
    }
  }

  clear(key: string): void {
    this.buckets.delete(key);
  }
}
