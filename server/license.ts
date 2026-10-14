/**
 * Licensing: the plan in effect and what it unlocks.
 *
 * - `verifyLicenseKey` checks an offline license key: `BELLPR1.<payload>.
 *   <signature>`, an Ed25519 signature over `bellpr-license-v1.<payload>`
 *   by one of the keys in `server/license-keys.ts`.
 * - `OfflineLicenseService` is the service `bell-pr start` uses. It keeps
 *   the key and the 14-day trial in `<dataDir>/license.json` and fails
 *   closed: without a valid key or an active trial the plan is Free.
 * - `fixedLicense` reports a constant plan, for tests and library use.
 * - `requirePro` gates a route on a Pro feature with a 402 `pro_required`.
 * - `runLicenseCli` is `bell-pr license`.
 *
 * Offline keys are friction for honest users, not DRM: the license terms
 * are the real protection. Never log or print a key; logs name the
 * license id and the plan only.
 */
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { unwatchFile, watchFile, type Stats } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type { RequestHandler } from "express";
import { z } from "zod";
import type { Fix } from "../shared/errors.js";
import { formatters } from "../shared/i18n/locale.js";
import type { ModelSettings } from "../shared/models.js";
import {
  freeEntitlements,
  licenseGraceDays,
  proEntitlements,
  proMaxActiveRuns,
  proOnlyEfforts,
  type Entitlements,
  type LicenseReason,
  type LicenseSummary,
  type Plan,
  type ProFeature,
  trialDays,
} from "../shared/plans.js";
import { product, productLink } from "../shared/product.js";
import { defaultActiveRunLimit } from "./agent-slots.js";
import { buildDate as currentBuildDate } from "./build-info.js";
import { resolveDataDir } from "./config.js";
import { writeDurable } from "./fs-atomic.js";
import { currentLocale, sm } from "./i18n/index.js";
import { licensePublicKeys, revokedLicenseIds } from "./license-keys.js";
import { log } from "./log.js";
import { lenientRead } from "./persisted-schema.js";
import { AppError } from "./types.js";

export interface LicenseService {
  /** The license state shown in the UI and the CLI. */
  summary(): LicenseSummary;
  /** What the plan in effect unlocks. */
  entitlements(): Entitlements;
  /** Throws a 402 `pro_required` AppError unless the plan includes `f`. */
  assertFeature(f: ProFeature): void;
  /**
   * Throws a 402 `pro_required` AppError unless the plan allows the model
   * settings the person selected: web access needs `webAccess`, and an
   * effort in `proOnlyEfforts` needs `deepReasoning`. Only the raw selected
   * settings count, never a resolved default, so "Default" effort is fine
   * on every plan.
   */
  assertModelEntitlement(selected: ModelSettings): void;
  /**
   * Activates a license key, or throws: 400 `license_invalid` with
   * `params.reason`, or 409 `license_env_locked`. Absent when the plan is
   * fixed (`fixedLicense`).
   */
  activate?(key: string): Promise<LicenseSummary>;
  /** Removes the saved key; 409 `license_env_locked` like `activate`. */
  deactivate?(): Promise<LicenseSummary>;
  /** Starts the 14-day trial; 409 `trial_unavailable` once used or on Pro. */
  startTrial?(): Promise<LicenseSummary>;
}

/** The version tag every license key starts with. */
export const licenseKeyPrefix = "BELLPR1";
/** What the signature covers: this prefix, then the payload as written in the key. */
export const licenseSigningPrefix = "bellpr-license-v1.";

const dayMs = 24 * 60 * 60 * 1000;
const keyPattern = /^BELLPR1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
/** Longer input is not a key; PUT /api/license accepts at most 2048 characters. */
const maxKeyLength = 4096;

const isoTime = z.union([
  z.string().date(),
  z.string().datetime({ offset: true }),
]);

/**
 * A license key's payload. Unknown fields are dropped (zod strip mode), so
 * a later issuer may add fields. `email` and `name` are optional: keys
 * from a pre-signed pool carry neither.
 */
export const licensePayloadSchema = z.object({
  v: z.literal(1),
  kid: z.string().min(1).max(64),
  /** `lic_` and a ULID. */
  id: z.string().regex(/^lic_[0-9A-HJKMNP-TV-Z]{26}$/),
  email: z.string().min(1).max(320).optional(),
  name: z.string().min(1).max(200).optional(),
  plan: z.literal("pro"),
  seats: z.number().int().min(1).max(1000),
  /** When the key was issued. */
  iat: isoTime,
  /** When the license ends; null for a perpetual license. */
  exp: isoTime.nullable(),
  /** The last release day this license covers; absent covers every build. */
  upd: isoTime.optional(),
});
export type LicensePayload = z.infer<typeof licensePayloadSchema>;

export type LicenseKeyFailure =
  | "malformed"
  | "bad_signature"
  | "unknown_kid"
  | "revoked"
  | "expired"
  | "updates_expired";

/**
 * What a key is worth. A failure after the signature checked out
 * (revoked, expired, updates_expired) also carries the license, so its
 * dates can be shown.
 */
export type LicenseKeyResult =
  | { ok: true; license: LicensePayload; status: "active" | "grace" }
  | { ok: false; reason: LicenseKeyFailure; license?: LicensePayload };

export interface VerifyLicenseOptions {
  now: Date | number;
  /** Key id → base64url Ed25519 public key (the JWK `x`). */
  publicKeys: Readonly<Record<string, string>>;
  revoked: ReadonlySet<string> | readonly string[];
  /** This build's release day, YYYY-MM-DD; a key whose `upd` is earlier does not cover it. */
  buildDate: string;
  /**
   * The latest time this data directory has seen. The effective time is
   * the later of it and `now`, so turning the clock back does not revive
   * an expired license.
   */
  lastSeenAt?: Date | number | string;
}

/** Whitespace anywhere is dropped, so a key wrapped by an e-mail still works. */
export function normalizeLicenseKey(key: string) {
  return key.replace(/\s+/g, "");
}

const publicKeyCache = new Map<string, KeyObject | null>();

function publicKey(x: string): KeyObject | null {
  let key = publicKeyCache.get(x);
  if (key === undefined) {
    try {
      key = createPublicKey({
        key: { kty: "OKP", crv: "Ed25519", x },
        format: "jwk",
      });
    } catch {
      key = null;
    }
    publicKeyCache.set(x, key);
  }
  return key;
}

type DecodedKey =
  | { ok: true; license: LicensePayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "unknown_kid" };

/** Format, key id and signature: everything about a key that time does not change. */
function decodeLicenseKey(
  rawKey: string,
  publicKeys: Readonly<Record<string, string>>,
): DecodedKey {
  const key = normalizeLicenseKey(rawKey);
  if (key.length > maxKeyLength || !keyPattern.test(key))
    return { ok: false, reason: "malformed" };
  const [, payloadText, signatureText] = key.split(".");
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const kid = (payload as { kid?: unknown } | null)?.kid;
  if (typeof kid !== "string" || !kid) return { ok: false, reason: "malformed" };
  const x = Object.hasOwn(publicKeys, kid) ? publicKeys[kid] : undefined;
  const signer = x ? publicKey(x) : null;
  if (!signer) return { ok: false, reason: "unknown_kid" };
  let valid = false;
  try {
    valid = verify(
      null,
      Buffer.from(licenseSigningPrefix + payloadText, "ascii"),
      signer,
      Buffer.from(signatureText, "base64url"),
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad_signature" };
  // Only a signed payload is parsed in full.
  const parsed = licensePayloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.kid !== kid)
    return { ok: false, reason: "malformed" };
  return { ok: true, license: parsed.data };
}

function toTime(value: Date | number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const time =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

/** Revocation, expiry with its grace period, and the updates term. */
function checkLicense(
  license: LicensePayload,
  opts: Omit<VerifyLicenseOptions, "publicKeys">,
): LicenseKeyResult {
  const revoked =
    opts.revoked instanceof Set
      ? opts.revoked.has(license.id)
      : (opts.revoked as readonly string[]).includes(license.id);
  if (revoked) return { ok: false, reason: "revoked", license };
  const now = Math.max(toTime(opts.now) ?? 0, toTime(opts.lastSeenAt) ?? 0);
  let status: "active" | "grace" = "active";
  if (license.exp !== null) {
    const exp = Date.parse(license.exp);
    if (now > exp + licenseGraceDays * dayMs)
      return { ok: false, reason: "expired", license };
    if (now > exp) status = "grace";
  }
  if (license.upd !== undefined && Date.parse(license.upd) < Date.parse(opts.buildDate))
    return { ok: false, reason: "updates_expired", license };
  return { ok: true, license, status };
}

/**
 * Checks a license key offline. Pure: the result depends only on the key
 * and the options.
 */
export function verifyLicenseKey(
  key: string,
  opts: VerifyLicenseOptions,
): LicenseKeyResult {
  const decoded = decodeLicenseKey(key, opts.publicKeys);
  if (!decoded.ok) return decoded;
  return checkLicense(decoded.license, opts);
}

function isProOnlyEffort(effort: ModelSettings["reasoningEffort"]) {
  return (proOnlyEfforts as readonly unknown[]).includes(effort);
}

/**
 * The 402 for a Pro feature: `{error, code: 'pro_required', feature, plan,
 * reason, upgradeUrl?}`. `upgradeUrl` is the purchase page, left out while
 * product.ts has none.
 */
function proRequired(feature: ProFeature, summary: LicenseSummary) {
  const upgradeUrl = productLink("purchaseUrl");
  return new AppError((m) => m.license.featureNeedsPro[feature], 402, {
    code: "pro_required",
    details: {
      feature,
      plan: summary.plan,
      reason: summary.reason ?? "no_license",
      ...(upgradeUrl ? { upgradeUrl } : {}),
    },
  });
}

function assertModel(license: LicenseService, selected: ModelSettings) {
  if (selected.webAccess === true) license.assertFeature("webAccess");
  if (isProOnlyEffort(selected.reasoningEffort))
    license.assertFeature("deepReasoning");
}

/**
 * A license service with a constant plan, for tests and library use. Pro
 * and the trial allow everything and run up to `maxActiveRuns` at once
 * (default 2); Free allows no Pro feature and runs one contribution at a
 * time. Blocked features throw a 402 with code `pro_required` and the
 * details `{feature, plan, reason}`. The plan cannot be changed through
 * the license routes.
 */
export function fixedLicense(
  plan: Plan,
  opts: { maxActiveRuns?: number } = {},
): LicenseService {
  const pro =
    plan === "free"
      ? undefined
      : proEntitlements(opts.maxActiveRuns ?? defaultActiveRunLimit);
  const entitlements: Entitlements = pro
    ? Object.freeze({ ...pro, plan, features: Object.freeze(pro.features) })
    : freeEntitlements;
  const summary: LicenseSummary =
    plan === "free"
      ? { plan, source: "none", status: "none", reason: "no_license" }
      : { plan, source: plan === "trial" ? "trial" : "none", status: "active" };
  const license: LicenseService = {
    summary: () => ({ ...summary }),
    entitlements: () => entitlements,
    assertFeature(feature) {
      if (!entitlements.features[feature])
        throw proRequired(feature, summary);
    },
    assertModelEntitlement: (selected) => assertModel(license, selected),
  };
  return license;
}

/**
 * Express middleware that answers 402 `pro_required` unless the plan in
 * effect includes `feature`. The plan is read on every request, so a
 * started trial or an activated key applies at once. Its route parameters
 * are plain strings, so the handlers after it keep `req.params.id: string`.
 */
export function requirePro(
  license: LicenseService,
  feature: ProFeature,
): RequestHandler<Record<string, string>> {
  return (_req, _res, next) => {
    license.assertFeature(feature);
    next();
  };
}

/**
 * `<dataDir>/license.json`, written with mode 0600. Times are ISO strings.
 * Reads are lenient (README §7): a file from a newer build loads with its
 * unknown fields dropped.
 */
export const licenseFileSchema = z.object({
  version: z.literal(1),
  /** The activated key, whitespace removed. */
  key: z.string().max(maxKeyLength).optional(),
  activatedAt: z.string().max(64).optional(),
  /** The latest time this data directory has seen; always written. */
  lastSeenAt: z.string().max(64).optional(),
  trial: z.object({ startedAt: z.string().max(64) }).optional(),
});
export type LicenseFile = z.infer<typeof licenseFileSchema>;
const persistedLicenseFileSchema = lenientRead(licenseFileSchema);

export interface OfflineLicenseOptions {
  /** BELLPR_LICENSE_KEY; it wins over the saved key and locks it. */
  envKey?: string;
  publicKeys: Readonly<Record<string, string>>;
  revoked: ReadonlySet<string> | readonly string[];
  /** The clock, in epoch milliseconds; Date.now by default. */
  now?: () => number;
  /** This build's release day; build-info's by default. */
  buildDate?: string;
  /** Runs Pro and the trial execute at once; `proMaxActiveRuns` (8) by default. */
  maxActiveRuns?: number;
  /** No log lines: `bell-pr license` prints its own output. */
  quiet?: boolean;
}

/** How often a running server records the time it has seen. */
const lastSeenIntervalMs = 60 * 60 * 1000;
/** How often a running server looks for changes `bell-pr license` made. */
const watchIntervalMs = 2000;

function iso(time: number) {
  return new Date(time).toISOString();
}

/**
 * The license service behind `bell-pr start` and `bell-pr license`. The plan
 * comes from, in order: a valid BELLPR_LICENSE_KEY, the key saved in
 * license.json, an active trial, else Free. Call `initialize()` before use.
 */
export class OfflineLicenseService implements LicenseService {
  readonly file: string;
  private readonly envKey?: string;
  private readonly now: () => number;
  private readonly buildDate: string;
  private readonly pro: Entitlements;
  private readonly trialEntitlements: Entitlements;
  /** The file's content; undefined while there is none. */
  private state?: LicenseFile;
  /** The latest clock reading, so rollback within this process counts too. */
  private highWater = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private decoded = new Map<string, DecodedKey>();

  constructor(
    readonly dataDir: string,
    private readonly opts: OfflineLicenseOptions,
  ) {
    this.file = path.join(dataDir, "license.json");
    const envKey = opts.envKey ? normalizeLicenseKey(opts.envKey) : "";
    this.envKey = envKey || undefined;
    this.now = opts.now ?? Date.now;
    this.buildDate = opts.buildDate ?? currentBuildDate;
    const pro = proEntitlements(opts.maxActiveRuns ?? proMaxActiveRuns);
    this.pro = Object.freeze({ ...pro, features: Object.freeze(pro.features) });
    this.trialEntitlements = Object.freeze({ ...this.pro, plan: "trial" });
  }

  /** Reads license.json and records the time; never fails on its content. */
  async initialize(): Promise<LicenseSummary> {
    await this.enqueue(async () => {
      await this.read();
      await this.recordLastSeen();
    });
    const summary = this.summary();
    if (this.envKey) {
      const env = this.check(this.envKey);
      if (!env.ok)
        this.log("warn", "BELLPR_LICENSE_KEY does not unlock Pro", {
          reason: env.reason,
        });
    }
    this.log("info", "License", {
      plan: summary.plan,
      ...(summary.licenseId ? { licenseId: summary.licenseId } : {}),
    });
    return summary;
  }

  summary(): LicenseSummary {
    return this.evaluate().summary;
  }

  /** True while license.json holds a key, valid or not. */
  get keySaved(): boolean {
    return this.state?.key !== undefined;
  }

  entitlements(): Entitlements {
    return this.evaluate().entitlements;
  }

  assertFeature(feature: ProFeature): void {
    const { summary, entitlements } = this.evaluate();
    if (!entitlements.features[feature]) throw proRequired(feature, summary);
  }

  assertModelEntitlement(selected: ModelSettings): void {
    assertModel(this, selected);
  }

  async activate(key: string): Promise<LicenseSummary> {
    return this.enqueue(async () => {
      this.assertNotEnvLocked();
      const normalized = normalizeLicenseKey(key);
      const result = this.check(normalized);
      if (!result.ok) throw this.invalidKey(result);
      const now = this.clock();
      await this.write({
        ...this.state,
        version: 1,
        key: normalized,
        activatedAt: iso(now),
        lastSeenAt: iso(this.effectiveTime()),
      });
      this.log("info", "License activated", {
        licenseId: result.license.id,
        plan: "pro",
      });
      return this.summary();
    });
  }

  async deactivate(): Promise<LicenseSummary> {
    return this.enqueue(async () => {
      this.assertNotEnvLocked();
      if (this.state?.key !== undefined) {
        const previous = this.decode(this.state.key);
        const { key: _key, activatedAt: _activatedAt, ...rest } = this.state;
        await this.write({ ...rest, lastSeenAt: iso(this.effectiveTime()) });
        this.log("info", "License deactivated", {
          ...(previous.ok ? { licenseId: previous.license.id } : {}),
          plan: this.summary().plan,
        });
      }
      return this.summary();
    });
  }

  async startTrial(): Promise<LicenseSummary> {
    return this.enqueue(async () => {
      if (this.state?.trial)
        throw new AppError((m) => m.license.trialUsed, 409, {
          code: "trial_unavailable",
        });
      if (this.evaluate().summary.plan === "pro")
        throw new AppError((m) => m.license.trialNotNeeded, 409, {
          code: "trial_unavailable",
        });
      const now = this.clock();
      await this.write({
        ...this.state,
        version: 1,
        trial: { startedAt: iso(now) },
        lastSeenAt: iso(this.effectiveTime()),
      });
      this.log("info", "Trial started", { plan: "trial" });
      return this.summary();
    });
  }

  /**
   * Follows license.json while a server runs: a change that `bell-pr
   * license` makes in another process applies within a few seconds and
   * calls `onChange`, and the time seen is recorded every hour. Returns the
   * function that stops both.
   */
  watch(onChange: () => void): () => void {
    const listener = (current: Stats, previous: Stats) => {
      if (
        current.mtimeMs === previous.mtimeMs &&
        current.ino === previous.ino &&
        current.size === previous.size
      )
        return;
      void this.enqueue(() => this.read())
        .then(onChange)
        .catch((error) =>
          log.warn("Could not reload license.json", { error: errorText(error) }),
        );
    };
    watchFile(this.file, { interval: watchIntervalMs, persistent: false }, listener);
    const timer = setInterval(() => {
      void this.enqueue(() => this.recordLastSeen()).catch(() => undefined);
    }, lastSeenIntervalMs);
    timer.unref();
    return () => {
      unwatchFile(this.file, listener);
      clearInterval(timer);
    };
  }

  /** Logs the license id and the plan, never the key. */
  private log(
    level: "info" | "warn",
    message: string,
    fields?: Record<string, unknown>,
  ) {
    if (!this.opts.quiet) log[level](message, fields);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private clock() {
    const now = this.now();
    if (now > this.highWater) this.highWater = now;
    return now;
  }

  /** The later of the clock, the latest reading here and the saved lastSeenAt. */
  private effectiveTime(clock = this.clock()) {
    return Math.max(clock, this.highWater, toTime(this.state?.lastSeenAt) ?? 0);
  }

  private async read() {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      this.state = undefined;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        log.warn("Could not read license.json; the plan is Free until it can be read", {
          error: errorText(error),
        });
      return;
    }
    try {
      this.state = persistedLicenseFileSchema.parse(JSON.parse(text));
    } catch {
      this.state = undefined;
      log.warn("license.json is not valid; the plan is Free until a key is activated again");
    }
  }

  private async write(next: LicenseFile) {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await writeDurable(this.file, `${JSON.stringify(next, null, 2)}\n`, {
      mode: 0o600,
    });
    this.state = next;
  }

  /** Saves the time seen when it moved forward; only when license.json exists. */
  private async recordLastSeen() {
    if (!this.state) return;
    const effective = this.effectiveTime();
    if (effective <= (toTime(this.state.lastSeenAt) ?? 0)) return;
    try {
      await this.write({ ...this.state, lastSeenAt: iso(effective) });
    } catch (error) {
      log.warn("Could not update license.json", { error: errorText(error) });
    }
  }

  private decode(key: string): DecodedKey {
    let decoded = this.decoded.get(key);
    if (!decoded) {
      decoded = decodeLicenseKey(key, this.opts.publicKeys);
      // Keys that were only tried (PUT /api/license) must not pile up.
      if (this.decoded.size >= 8) this.decoded.clear();
      this.decoded.set(key, decoded);
    }
    return decoded;
  }

  private check(key: string, clock = this.clock()): LicenseKeyResult {
    const decoded = this.decode(key);
    if (!decoded.ok) return decoded;
    return checkLicense(decoded.license, {
      now: this.effectiveTime(clock),
      revoked: this.opts.revoked,
      buildDate: this.buildDate,
    });
  }

  private assertNotEnvLocked() {
    if (this.envKey)
      throw new AppError((m) => m.license.envLocked, 409, {
        code: "license_env_locked",
      });
  }

  private invalidKey(result: Extract<LicenseKeyResult, { ok: false }>) {
    const date = (value: string) =>
      formatters(currentLocale()).date(value, { timeZone: "UTC" });
    const reason = result.reason;
    return new AppError(
      (m) => {
        const messages = m.license.invalidKey;
        switch (reason) {
          case "malformed":
            return messages.malformed;
          case "bad_signature":
            return messages.badSignature;
          case "unknown_kid":
            return messages.unknownKid;
          case "revoked":
            return messages.revoked;
          case "expired":
            return messages.expired({ date: date(result.license!.exp!) });
          case "updates_expired":
            return messages.updatesExpired({
              until: date(result.license!.upd!),
              build: date(this.buildDate),
            });
        }
      },
      400,
      { code: "license_invalid", params: { reason } },
    );
  }

  private evaluate(): { summary: LicenseSummary; entitlements: Entitlements } {
    const clock = this.clock();
    const effective = this.effectiveTime(clock);
    const envLocked = this.envKey ? { envLocked: true } : {};
    const env = this.envKey ? this.check(this.envKey, clock) : undefined;
    const saved = this.state?.key ? this.check(this.state.key, clock) : undefined;
    for (const [result, source] of [
      [env, "env"],
      [saved, "file"],
    ] as const)
      if (result?.ok)
        return {
          summary: {
            plan: "pro",
            source,
            status: result.status,
            ...licenseFields(result.license),
            trialAvailable: false,
            ...envLocked,
          },
          entitlements: this.pro,
        };

    const trialUsed = this.state?.trial !== undefined;
    const started = toTime(this.state?.trial?.startedAt);
    if (started !== undefined) {
      const ends = started + trialDays * dayMs;
      // A clock before the start means it was turned back: the trial is over.
      if (clock >= started && effective < ends)
        return {
          summary: {
            plan: "trial",
            source: "trial",
            status: "active",
            trialDaysLeft: Math.ceil((ends - effective) / dayMs),
            trialAvailable: false,
            ...envLocked,
          },
          entitlements: this.trialEntitlements,
        };
    }

    const failed = [env, saved].find(
      (result): result is Extract<LicenseKeyResult, { ok: false }> =>
        result !== undefined && !result.ok,
    );
    let summary: LicenseSummary;
    if (failed) {
      const reason: LicenseReason =
        failed.reason === "expired" || failed.reason === "updates_expired"
          ? failed.reason
          : "invalid";
      summary = {
        plan: "free",
        source: failed === env ? "env" : "file",
        status: reason === "invalid" ? "invalid" : "expired",
        reason,
        ...(failed.license ? licenseFields(failed.license) : {}),
      };
    } else if (trialUsed) {
      summary = {
        plan: "free",
        source: "trial",
        status: "expired",
        reason: "trial_ended",
      };
    } else {
      summary = { plan: "free", source: "none", status: "none", reason: "no_license" };
    }
    return {
      summary: { ...summary, trialAvailable: !trialUsed, ...envLocked },
      entitlements: freeEntitlements,
    };
  }
}

/** The license details a summary shows; personal fields only when present. */
function licenseFields(license: LicensePayload) {
  return {
    licenseId: license.id,
    ...(license.name ? { name: license.name } : {}),
    ...(license.email ? { email: license.email } : {}),
    ...(license.exp ? { expiresAt: license.exp } : {}),
    ...(license.upd ? { updatesUntil: license.upd } : {}),
  };
}

function errorText(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code ?? String(error);
}

/** What the command line passes to `bell-pr license`. */
export interface LicenseCliDeps {
  /** The resolved data directory, which holds license.json. */
  dataDir?: string;
  /** Where output goes; process.stdout by default. */
  stdout?: { write(text: string): unknown };
  /** Where mistakes go; process.stderr by default. */
  stderr?: { write(text: string): unknown };
  /** BELLPR_LICENSE_KEY comes from here; process.env by default. */
  env?: NodeJS.ProcessEnv;
  /** Read by `activate -`; process.stdin by default. */
  stdin?: AsyncIterable<string | Buffer>;
  /** Tests pass their own keys; server/license-keys.ts by default. */
  publicKeys?: Readonly<Record<string, string>>;
  revoked?: ReadonlySet<string> | readonly string[];
  now?: () => number;
}

/** The next steps for a summary, each with the command that takes it. */
export function licenseFixes(summary: LicenseSummary): Fix[] {
  if (summary.plan === "pro" || summary.envLocked) return [];
  const bin = product.binNames[0];
  const m = sm().license.cli.fixes;
  return [
    ...(summary.trialAvailable
      ? [{ label: m.trial, command: `${bin} license trial` }]
      : []),
    { label: m.activate, command: `${bin} license activate <key>` },
  ];
}

/** The plan line `bell-pr start` prints. */
export function startupPlanLine(summary: LicenseSummary): string {
  const m = sm().license.startup;
  if (summary.plan === "pro") return m.pro({ licenseId: summary.licenseId });
  if (summary.plan === "trial")
    return m.trial({ daysLeft: summary.trialDaysLeft ?? trialDays });
  return m.free({
    reason:
      summary.reason && summary.reason !== "no_license"
        ? sm().license.cli.reasons[summary.reason]
        : undefined,
    trial: summary.trialAvailable === true && !summary.envLocked,
  });
}

/** The status as lines of text, in the CLI's language. */
function statusLines(summary: LicenseSummary): string[] {
  const m = sm().license;
  const date = (value: string) =>
    formatters(currentLocale()).date(value, { timeZone: "UTC" });
  const lines = [m.cli.plan({ plan: m.planNames[summary.plan] })];
  if (summary.plan === "trial" && summary.trialDaysLeft !== undefined)
    lines.push(m.cli.trialLeft({ daysLeft: summary.trialDaysLeft }));
  if (summary.plan === "free" && summary.reason)
    lines.push(m.cli.reasons[summary.reason]);
  if (summary.licenseId) {
    lines.push(m.cli.licenseId({ id: summary.licenseId }));
    const who = [summary.name, summary.email && `<${summary.email}>`]
      .filter(Boolean)
      .join(" ");
    if (who) lines.push(m.cli.licensee({ who }));
    lines.push(
      summary.expiresAt
        ? m.cli.expires({ date: date(summary.expiresAt) })
        : m.cli.expiresNever,
    );
    if (summary.status === "grace" && summary.expiresAt)
      lines.push(
        m.cli.grace({
          date: date(
            new Date(
              Date.parse(summary.expiresAt) + licenseGraceDays * dayMs,
            ).toISOString(),
          ),
        }),
      );
    if (summary.updatesUntil)
      lines.push(m.cli.updatesUntil({ date: date(summary.updatesUntil) }));
  }
  if (summary.source === "env" || summary.source === "file")
    lines.push(m.cli.source[summary.source]);
  if (summary.envLocked && summary.source !== "env") lines.push(m.cli.envLocked);
  for (const fix of licenseFixes(summary))
    lines.push(`${fix.label}: ${fix.command}`);
  return lines;
}

async function readAll(stream: AsyncIterable<string | Buffer>) {
  let text = "";
  for await (const chunk of stream) {
    text += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (text.length > maxKeyLength * 2) break;
  }
  return text;
}

/**
 * `bell-pr license [status [--json] | activate <key|-> | deactivate |
 * trial]`. Exit codes: 0 done, 1 refused (an invalid key, a key set in
 * the environment, a used trial), 2 a usage mistake.
 */
export async function runLicenseCli(
  argv: string[],
  deps: LicenseCliDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const env = deps.env ?? process.env;
  const m = sm();
  const usage = (reason: string) => {
    stderr.write(`${m.cli.invalidArguments({ reason })}\n${m.license.cli.usage}\n`);
    return 2;
  };
  const { tokens = [] } = parseArgs({
    args: argv,
    options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
    strict: false,
    allowPositionals: true,
    tokens: true,
  });
  if (tokens.some((token) => token.kind === "option" && token.name === "help")) {
    stdout.write(`${m.license.cli.usage}\n`);
    return 0;
  }
  let json = false;
  const positionals: string[] = [];
  for (const token of tokens) {
    if (token.kind === "positional") positionals.push(token.value);
    if (token.kind !== "option") continue;
    if (token.name !== "json")
      return usage(m.cli.arguments.unknownOption({ option: token.rawName }));
    if (token.inlineValue)
      return usage(m.cli.arguments.noValue({ option: token.rawName }));
    json = true;
  }
  const [command = "status", ...rest] = positionals;
  if (!["status", "activate", "deactivate", "trial"].includes(command))
    return usage(m.license.cli.unknownSubcommand({ command }));
  if (json && command !== "status")
    return usage(m.cli.arguments.unknownOption({ option: "--json" }));
  const extra = command === "activate" ? rest.slice(1) : rest;
  if (extra.length) return usage(m.cli.arguments.unexpected({ value: extra[0] }));
  if (command === "activate" && rest[0] === undefined)
    return usage(m.license.cli.missingKey);

  const license = new OfflineLicenseService(
    deps.dataDir ?? resolveDataDir({}, env),
    {
      envKey: env.BELLPR_LICENSE_KEY,
      publicKeys: deps.publicKeys ?? licensePublicKeys,
      revoked: deps.revoked ?? revokedLicenseIds,
      quiet: true,
      ...(deps.now ? { now: deps.now } : {}),
    },
  );
  await license.initialize();
  let summary: LicenseSummary;
  let done: string | undefined;
  try {
    switch (command) {
      case "activate": {
        const key = rest[0] === "-" ? await readAll(deps.stdin ?? process.stdin) : rest[0];
        summary = await license.activate(key);
        done = m.license.cli.activated;
        break;
      }
      case "deactivate": {
        const saved = license.keySaved;
        summary = await license.deactivate();
        done = saved ? m.license.cli.deactivated : m.license.cli.nothingToRemove;
        break;
      }
      case "trial":
        summary = await license.startTrial();
        done = m.license.cli.trialStarted;
        break;
      default:
        summary = license.summary();
    }
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    stderr.write(`${error.message}\n`);
    return 1;
  }
  if (json) {
    stdout.write(
      `${JSON.stringify({ license: summary, fixes: licenseFixes(summary) }, null, 2)}\n`,
    );
    return 0;
  }
  const lines = statusLines(summary);
  if (done) lines.unshift(done);
  if (done && command !== "status") lines.push(m.license.cli.running);
  stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
