/**
 * Pairing codes and the failure lock.
 *
 * A code is 8 Crockford base32 characters (40 bits), valid for 5 minutes
 * and for one pairing; a new code replaces the previous one. Only its
 * sha256 is stored, in `<dataDir>/pair-code.json`.
 *
 * Failures count for the whole install, never per source address: behind
 * `tailscale serve` or `ssh -L` every request comes from 127.0.0.1, and a
 * proxy header naming the client is whatever the sender writes. 5 failures
 * void the current code. 10 failures within 15 minutes void it and lock
 * pairing for 15 minutes; each later lock doubles, up to 24 hours. Only a
 * pairing, 24 hours without a failure (after any lock ends), or `bell-pr
 * pair --unlock` clears the count; a new code does not. The count lives in
 * `<dataDir>/pair-lock.json`, so a restart keeps it. A missing or damaged
 * count, once pairing was used, locks pairing until `--unlock`.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { pairCodeAlphabet } from "../shared/pairing.js";
import { dataPaths } from "./config.js";
import { clearDevices, DeviceTokens, digestsMatch, installDigest, sha256Hex } from "./device-tokens.js";
import { writeDurable } from "./fs-atomic.js";
import { lenientRead } from "./persisted-schema.js";

export const pairCodeTtl = 5 * 60_000;
export const perCodeFailureLimit = 5;
export const failureLimit = 10;
export const failureWindow = 15 * 60_000;
export const firstLockDuration = 15 * 60_000;
export const maxLockDuration = 24 * 60 * 60_000;
/** A day without a failure clears the count and the doubling. */
export const failureIdleReset = 24 * 60 * 60_000;

const hexDigest = /^[0-9a-f]{64}$/;
const epochMs = z.number().int().nonnegative();

const codeFileSchema = z
  .object({
    codeHash: z.string().regex(hexDigest).optional(),
    installDigest: z.string().regex(hexDigest).optional(),
    name: z.string().max(64).optional(),
    createdAt: epochMs.optional(),
    expiresAt: epochMs.optional(),
    failCount: z.number().int().nonnegative().optional(),
  })
  .strict();
const codeReadSchema = lenientRead(codeFileSchema);
type CodeFile = z.infer<typeof codeFileSchema>;

const lockFileSchema = z
  .object({
    failures: z.array(epochMs).max(failureLimit),
    lockedUntil: epochMs.optional(),
    lockDurationMs: epochMs,
    lastFailureAt: epochMs.optional(),
  })
  .strict();
const lockReadSchema = lenientRead(lockFileSchema);
type LockFile = z.infer<typeof lockFileSchema>;

const freshLock = (): LockFile => ({ failures: [], lockDurationMs: 0 });

/** A new random code, displayed as XXXX-XXXX. Five bytes are exactly 40 bits. */
export function generatePairCode(): string {
  const bits = randomBytes(5).reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
  let code = "";
  for (let shift = 35n; shift >= 0n; shift -= 5n) code += pairCodeAlphabet[Number((bits >> shift) & 31n)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * The 8 code characters, or undefined. Hyphens, spaces and case are
 * ignored, and I, L and O read as 1, 1 and 0, as Crockford base32 allows.
 */
export function normalizePairCode(input: string): string | undefined {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  return code.length === 8 && [...code].every((char) => pairCodeAlphabet.includes(char)) ? code : undefined;
}

export type PairLocked = { status: "locked"; lockedUntil?: number };
export type CreateCodeResult = { status: "created"; code: string; expiresAt: number } | PairLocked;
export type RedeemResult =
  | { status: "paired"; id: string; token: string; name: string }
  | { status: "invalid" }
  | PairLocked;

export class Pairing {
  private readonly paths: ReturnType<typeof dataPaths>;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly devices: DeviceTokens,
    opts: { now?: () => number } = {},
  ) {
    this.paths = dataPaths(dataDir);
    this.now = opts.now ?? Date.now;
  }

  /** One step at a time, so two redeems of one code cannot both succeed. */
  private serialize<T>(step: () => Promise<T>): Promise<T> {
    const result = this.queue.then(step);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async write(file: string, content: object) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeDurable(file, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
  }

  /**
   * The failure record, or undefined when it cannot be trusted: damaged, or
   * missing although pairing was used before (a code or device file exists).
   * A new install starts with an empty record.
   */
  private readLock(): LockFile | undefined {
    let text: string;
    try {
      text = readFileSync(this.paths.pairLock, "utf8");
    } catch {
      return existsSync(this.paths.pairCode) || existsSync(this.paths.devices) ? undefined : freshLock();
    }
    try {
      const lock = lockReadSchema.parse(JSON.parse(text));
      // A day without failures clears the count and the doubling. Time
      // spent locked does not count, so a 24-hour lock can repeat.
      const quietSince = Math.max(lock.lastFailureAt ?? 0, lock.lockedUntil ?? 0);
      if (lock.lastFailureAt !== undefined && this.now() - quietSince >= failureIdleReset)
        return freshLock();
      return lock;
    } catch {
      return undefined;
    }
  }

  private lockedState(lock: LockFile | undefined): PairLocked | undefined {
    if (!lock) return { status: "locked" };
    if (lock.lockedUntil !== undefined && lock.lockedUntil > this.now())
      return { status: "locked", lockedUntil: lock.lockedUntil };
    return undefined;
  }

  private readCode(): CodeFile {
    try {
      return codeReadSchema.parse(JSON.parse(readFileSync(this.paths.pairCode, "utf8")));
    } catch {
      return {};
    }
  }

  /** Mints a code and voids the previous one. Locked pairing mints nothing. */
  createCode(installToken: string, name?: string): Promise<CreateCodeResult> {
    return this.serialize(async () => {
      const lock = this.readLock();
      const locked = this.lockedState(lock);
      if (locked) return locked;
      await this.write(this.paths.pairLock, lock!);
      const code = generatePairCode();
      const createdAt = this.now();
      const expiresAt = createdAt + pairCodeTtl;
      await this.write(this.paths.pairCode, {
        codeHash: sha256Hex(normalizePairCode(code)!),
        installDigest: installDigest(installToken),
        ...(name ? { name } : {}),
        createdAt,
        expiresAt,
        failCount: 0,
      } satisfies CodeFile);
      return { status: "created", code, expiresAt };
    });
  }

  /** Trades the active code for a new device token, or counts a failure. */
  redeem(input: string, name: string | undefined, defaultName: string, installToken: string): Promise<RedeemResult> {
    return this.serialize(async () => {
      const lock = this.readLock();
      const locked = this.lockedState(lock);
      if (locked) return locked;
      const now = this.now();
      const active = this.readCode();
      const usable =
        active.codeHash !== undefined &&
        active.expiresAt !== undefined &&
        active.expiresAt > now &&
        (active.failCount ?? 0) < perCodeFailureLimit &&
        active.installDigest !== undefined &&
        digestsMatch(active.installDigest, installDigest(installToken));
      const presented = normalizePairCode(input);
      // Hash both sides and always compare, so the time taken does not
      // depend on the code or on whether one is active.
      const matches =
        timingSafeEqual(
          Buffer.from(sha256Hex(presented ?? input), "hex"),
          Buffer.from(active.codeHash ?? sha256Hex(""), "hex"),
        ) &&
        usable &&
        presented !== undefined;
      if (matches) {
        // Used up before the device exists: a second redeem finds no code.
        await this.write(this.paths.pairCode, {});
        await this.write(this.paths.pairLock, freshLock());
        const device = await this.devices.add(name ?? active.name ?? defaultName, installToken);
        return { status: "paired", ...device };
      }
      const next: LockFile = {
        ...lock!,
        failures: [...lock!.failures.filter((at) => now - at < failureWindow), now].slice(-failureLimit),
        lastFailureAt: now,
      };
      let voidCode = false;
      if (usable) {
        const failCount = (active.failCount ?? 0) + 1;
        voidCode = failCount >= perCodeFailureLimit;
        if (!voidCode) await this.write(this.paths.pairCode, { ...active, failCount });
      }
      if (next.failures.length >= failureLimit) {
        const duration = next.lockDurationMs ? Math.min(next.lockDurationMs * 2, maxLockDuration) : firstLockDuration;
        next.failures = [];
        next.lockDurationMs = duration;
        next.lockedUntil = now + duration;
        voidCode = true;
      }
      if (voidCode) await this.write(this.paths.pairCode, {});
      await this.write(this.paths.pairLock, next);
      return next.lockedUntil !== undefined && next.lockedUntil > now
        ? { status: "locked", lockedUntil: next.lockedUntil }
        : { status: "invalid" };
    });
  }

  /** `bell-pr pair --unlock`: clears the lock and the failure count. */
  unlock(): Promise<void> {
    return this.serialize(() => this.write(this.paths.pairLock, freshLock()));
  }
}

/**
 * After `bell-pr token rotate`: no device and no code stays. Rotating
 * already invalidates both through the install digest; this removes them.
 */
export async function clearPairing(dataDir: string): Promise<void> {
  const file = dataPaths(dataDir).pairCode;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeDurable(file, "{}\n", { mode: 0o600 });
  await clearDevices(dataDir);
}
