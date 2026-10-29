/**
 * The per-install API token. The first start writes 32 random bytes (hex)
 * to `<dataDir>/api-token` and later starts reuse that file. A missing or
 * damaged file is written again. `bell-pr token rotate` replaces it; the
 * server reads the file on each request, so the new token applies without
 * a restart.
 *
 * The file is mode 0600. The token is a bearer secret: it is not written
 * to the server log, the lock file, or `bell-pr doctor` output.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { writeDurable } from "./fs-atomic.js";

/** 32 bytes, hex-encoded. */
export const apiTokenBytes = 32;
const tokenPattern = /^[0-9a-f]{64}$/;

export function generateApiToken(): string {
  return randomBytes(apiTokenBytes).toString("hex");
}

/** The token in `file`, or undefined when it is missing or not a token. */
export function readApiToken(file: string): string | undefined {
  try {
    const text = readFileSync(file, "utf8").trim();
    return tokenPattern.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

async function writeToken(file: string, token: string) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeDurable(file, `${token}\n`);
  if (process.platform !== "win32") await chmod(file, 0o600);
}

/** The token already in `file`, or a new one. A valid file is kept. */
export async function loadOrCreateApiToken(file: string): Promise<string> {
  const existing = readApiToken(file);
  if (existing) {
    if (process.platform !== "win32") await chmod(file, 0o600).catch(() => undefined);
    return existing;
  }
  const token = generateApiToken();
  await writeToken(file, token);
  return token;
}

/** Replaces the token in `file`. Returns the new token; callers must not print it. */
export async function rotateApiToken(file: string): Promise<string> {
  const token = generateApiToken();
  await writeToken(file, token);
  return token;
}

/**
 * Constant-time comparison. Both sides are hashed to a fixed length so a
 * different length cannot skip the compare, and the raw token is never
 * compared directly.
 */
export function tokensMatch(expected: string, presented: string): boolean {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(presented).digest();
  return timingSafeEqual(left, right);
}

/** The page address that carries the token in the fragment, never the query. */
export function withApiToken(base: string, token: string | undefined): string {
  if (!token) return base;
  return `${base}#bell_token=${token}`;
}
