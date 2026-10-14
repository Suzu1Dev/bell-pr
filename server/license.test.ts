import assert from "node:assert/strict";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultContributionSettings } from "../shared/insights.js";
import type { ProFeature } from "../shared/plans.js";
import { product } from "../shared/product.js";
import { addMonths, main as issueMain } from "../tools/license/issue.js";
import { main as keygenMain } from "../tools/license/keygen.js";
import {
  csvField,
  encodeLicenseKey,
  insideRepository,
  newLicenseId,
  repoRoot,
  ulid,
} from "../tools/license/lib.js";
import { resolveConfig } from "./config.js";
import { withLocale } from "./i18n/index.js";
import { createApp, startServer } from "./index.js";
import {
  fixedLicense,
  licenseFileSchema,
  licenseSigningPrefix,
  OfflineLicenseService,
  runLicenseCli,
  startupPlanLine,
  verifyLicenseKey,
  type LicensePayload,
  type LicenseService,
} from "./license.js";
import { licensePublicKeys, revokedLicenseIds } from "./license-keys.js";
import { log } from "./log.js";
import { lenientRead } from "./persisted-schema.js";
import { Store } from "./store.js";
import { AppError, type Repository, type Run } from "./types.js";
import { Workbench } from "./workbench.js";

// A throwaway signing key for these tests only; no key ships in source.
function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, x: publicKey.export({ format: "jwk" }).x! };
}
const signer = keyPair();
const kid = "test-2026";
const publicKeys = { [kid]: signer.x };
const buildDate = "2026-10-01";
const now = Date.parse("2026-10-14T12:00:00Z");
const day = 24 * 60 * 60 * 1000;

function payload(fields: Partial<LicensePayload> = {}): LicensePayload {
  return {
    v: 1,
    kid,
    id: newLicenseId(now),
    email: "ada@example.com",
    name: "Ada Lovelace",
    plan: "pro",
    seats: 1,
    iat: new Date(now).toISOString(),
    exp: null,
    upd: "2027-10-14",
    ...fields,
  };
}

function issue(fields: Partial<LicensePayload> = {}, key: KeyObject = signer.privateKey) {
  return encodeLicenseKey(payload(fields), key);
}

/** Signs any JSON, skipping the payload schema, as a forger or a future issuer would. */
function signRaw(value: unknown, key: KeyObject = signer.privateKey) {
  const text = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = sign(null, Buffer.from(licenseSigningPrefix + text), key);
  return `BELLPR1.${text}.${signature.toString("base64url")}`;
}

const verifyOptions = (extra: Partial<Parameters<typeof verifyLicenseKey>[1]> = {}) => ({
  now,
  publicKeys,
  revoked: new Set<string>(),
  buildDate,
  ...extra,
});

async function tempDir(t: test.TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-license-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** A license service on `dataDir` with a clock the test moves. */
function offline(dataDir: string, opts: { envKey?: string; revoked?: string[] } = {}) {
  const clock = { now };
  const service = new OfflineLicenseService(dataDir, {
    publicKeys,
    revoked: opts.revoked ?? [],
    buildDate,
    now: () => clock.now,
    ...(opts.envKey === undefined ? {} : { envKey: opts.envKey }),
  });
  return { service, clock };
}

/** Asserts that `fn` throws an AppError with this status and code. */
async function rejectsWith(fn: () => unknown, status: number, code: string) {
  await assert.rejects(
    async () => fn(),
    (error: unknown) => {
      assert.ok(error instanceof AppError, String(error));
      assert.equal(error.statusCode, status);
      assert.equal(error.code, code);
      return true;
    },
  );
}

test("a signed key verifies; tampering, unknown key ids and revocation do not", () => {
  const key = issue();
  const valid = verifyLicenseKey(key, verifyOptions());
  assert.ok(valid.ok);
  assert.equal(valid.status, "active");
  assert.equal(valid.license.email, "ada@example.com");
  assert.equal(valid.license.seats, 1);

  // A changed payload with the old signature, and a changed signature.
  const [prefix, body, signature] = key.split(".");
  const raised = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), seats: 500 }),
  ).toString("base64url");
  assert.deepEqual(verifyLicenseKey(`${prefix}.${raised}.${signature}`, verifyOptions()), {
    ok: false,
    reason: "bad_signature",
  });
  const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  assert.equal(
    (verifyLicenseKey(`${prefix}.${body}.${flipped}`, verifyOptions()) as { reason: string }).reason,
    "bad_signature",
  );
  // Signed by another key that claims the same key id.
  assert.equal(
    (verifyLicenseKey(issue({}, keyPair().privateKey), verifyOptions()) as { reason: string }).reason,
    "bad_signature",
  );
  // A key id this build does not know, and no keys at all (a build before the owner's key).
  assert.deepEqual(verifyLicenseKey(issue({ kid: "other" }), verifyOptions()), {
    ok: false,
    reason: "unknown_kid",
  });
  assert.equal(
    (verifyLicenseKey(key, verifyOptions({ publicKeys: {} })) as { reason: string }).reason,
    "unknown_kid",
  );
  assert.equal(
    (verifyLicenseKey(issue({ kid: "__proto__" }), verifyOptions()) as { reason: string }).reason,
    "unknown_kid",
  );
  // Revoked by id, as a Set or a list.
  const revoked = verifyLicenseKey(key, verifyOptions({ revoked: new Set([valid.license.id]) }));
  assert.equal(revoked.ok, false);
  assert.equal((revoked as { reason: string }).reason, "revoked");
  assert.equal(
    (verifyLicenseKey(key, verifyOptions({ revoked: [valid.license.id] })) as { reason: string }).reason,
    "revoked",
  );
});

test("malformed keys are told apart from bad signatures", () => {
  for (const key of [
    "",
    "BELLPR2.abc.def",
    "BELLPR1.abc",
    "BELLPR1.a+b.cd",
    `BELLPR1.${"A".repeat(5000)}.${"A".repeat(86)}`,
    `BELLPR1.${Buffer.from("not json").toString("base64url")}.AAAA`,
    `BELLPR1.${Buffer.from(JSON.stringify({ v: 1 })).toString("base64url")}.AAAA`,
  ])
    assert.deepEqual(verifyLicenseKey(key, verifyOptions()), { ok: false, reason: "malformed" }, key);
  // A signed payload that misses fields, or names another plan, is malformed too.
  const { seats: _seats, ...withoutSeats } = payload();
  assert.equal((verifyLicenseKey(signRaw(withoutSeats), verifyOptions()) as { reason: string }).reason, "malformed");
  assert.equal(
    (verifyLicenseKey(signRaw({ ...payload(), plan: "enterprise" }), verifyOptions()) as { reason: string }).reason,
    "malformed",
  );
  assert.equal(
    (verifyLicenseKey(signRaw({ ...payload(), seats: 1001 }), verifyOptions()) as { reason: string }).reason,
    "malformed",
  );
  // Fields a later issuer adds are ignored (strip mode).
  const later = verifyLicenseKey(signRaw({ ...payload(), machineLimit: 3 }), verifyOptions());
  assert.ok(later.ok);
  assert.equal("machineLimit" in later.license, false);
});

test("a key wrapped with whitespace and a pool key without an e-mail both verify", () => {
  const key = issue();
  const wrapped = `  ${key.slice(0, 30)}\n${key.slice(30, 90)}\r\n\t${key.slice(90)}  \n`;
  const result = verifyLicenseKey(wrapped, verifyOptions());
  assert.ok(result.ok);
  assert.equal(result.license.id, (verifyLicenseKey(key, verifyOptions()) as { license: LicensePayload }).license.id);

  const { email: _email, name: _name, ...anonymous } = payload();
  const pooled = verifyLicenseKey(encodeLicenseKey(anonymous, signer.privateKey), verifyOptions());
  assert.ok(pooled.ok);
  assert.equal(pooled.license.email, undefined);
  assert.equal(pooled.license.name, undefined);
});

test("expiry has a 7-day grace period, and the updates term is checked against the build date", () => {
  const exp = new Date(now - 3 * day).toISOString();
  const grace = verifyLicenseKey(issue({ exp }), verifyOptions());
  assert.ok(grace.ok);
  assert.equal(grace.status, "grace");
  assert.equal(
    (verifyLicenseKey(issue({ exp: new Date(now + day).toISOString() }), verifyOptions()) as { status: string }).status,
    "active",
  );
  const expired = verifyLicenseKey(issue({ exp: new Date(now - 8 * day).toISOString() }), verifyOptions());
  assert.equal(expired.ok, false);
  assert.equal((expired as { reason: string }).reason, "expired");
  // The license comes back with a failure after the signature checked out.
  assert.equal((expired as { license?: LicensePayload }).license?.seats, 1);

  assert.equal(
    (verifyLicenseKey(issue({ upd: "2026-09-30" }), verifyOptions()) as { reason: string }).reason,
    "updates_expired",
  );
  assert.ok(verifyLicenseKey(issue({ upd: buildDate }), verifyOptions()).ok);
  // Without upd every build is covered.
  const { upd: _upd, ...perpetual } = payload();
  assert.ok(verifyLicenseKey(encodeLicenseKey(perpetual, signer.privateKey), verifyOptions()).ok);
});

test("turning the clock back does not revive an expired key", () => {
  const key = issue({ exp: new Date(now + day).toISOString() });
  assert.ok(verifyLicenseKey(key, verifyOptions()).ok);
  const rolledBack = verifyLicenseKey(
    key,
    verifyOptions({ lastSeenAt: new Date(now + 30 * day).toISOString() }),
  );
  assert.equal((rolledBack as { reason: string }).reason, "expired");
});

test("a fresh data directory is Free, fails closed, and creates no file", async (t) => {
  const dataDir = await tempDir(t);
  const { service } = offline(dataDir);
  const summary = await service.initialize();
  assert.deepEqual(summary, {
    plan: "free",
    source: "none",
    status: "none",
    reason: "no_license",
    trialAvailable: true,
  });
  assert.equal(service.entitlements().plan, "free");
  assert.equal(service.entitlements().maxTeammates, 2);
  assert.equal(service.entitlements().maxActiveRuns, 1);
  assert.equal(existsSync(path.join(dataDir, "license.json")), false);
  assert.throws(
    () => service.assertFeature("discovery"),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 402);
      assert.equal(error.code, "pro_required");
      // purchaseUrl is still "", so there is no upgrade link.
      assert.deepEqual(error.details, { feature: "discovery", plan: "free", reason: "no_license" });
      return true;
    },
  );
  // Raw selections only: "Default" effort and allowed efforts stay Free.
  for (const [selected, feature] of [
    [{ webAccess: true }, "webAccess"],
    [{ reasoningEffort: "xhigh" }, "deepReasoning"],
    [{ reasoningEffort: "ultra", model: "x" }, "deepReasoning"],
  ] as const)
    assert.throws(
      () => service.assertModelEntitlement(selected),
      (error) => error instanceof AppError && error.details?.feature === feature,
    );
  for (const selected of [{}, { reasoningEffort: "" as const }, { reasoningEffort: "high" as const }, { webAccess: false }])
    assert.doesNotThrow(() => service.assertModelEntitlement(selected));
});

test("activating a key saves it at 0600, logs only its id and survives a restart", async (t) => {
  const dataDir = await tempDir(t);
  const { service } = offline(dataDir);
  await service.initialize();
  const key = issue({ exp: new Date(now + 400 * day).toISOString() });
  const logged: unknown[] = [];
  const info = log.info;
  log.info = (message, fields) => {
    logged.push([message, fields]);
  };
  t.after(() => {
    log.info = info;
  });
  const summary = await service.activate(`\n ${key} \n`);
  assert.equal(summary.plan, "pro");
  assert.equal(summary.source, "file");
  assert.equal(summary.status, "active");
  assert.match(summary.licenseId!, /^lic_[0-9A-Z]{26}$/);
  assert.equal(summary.name, "Ada Lovelace");
  assert.equal(summary.email, "ada@example.com");
  assert.equal(summary.updatesUntil, "2027-10-14");
  assert.ok(summary.expiresAt);
  assert.equal(summary.trialAvailable, false);
  assert.equal(service.entitlements().plan, "pro");
  assert.equal(service.entitlements().maxTeammates, 4);
  assert.equal(service.entitlements().maxActiveRuns, 8);
  for (const feature of ["discovery", "learningExport", "webAccess"] as ProFeature[])
    assert.doesNotThrow(() => service.assertFeature(feature));

  const file = path.join(dataDir, "license.json");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(saved.version, 1);
  assert.equal(saved.key, key);
  assert.ok(saved.activatedAt && saved.lastSeenAt);
  assert.ok(!JSON.stringify(logged).includes(key.split(".")[2]), "the key reached the log");
  assert.ok(JSON.stringify(logged).includes(summary.licenseId!));

  const restarted = offline(dataDir).service;
  assert.equal((await restarted.initialize()).plan, "pro");

  // Removing the key goes back to Free and keeps nothing of it.
  assert.equal((await service.deactivate()).plan, "free");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).key, undefined);
});

test("an invalid key is refused with its reason and changes nothing", async (t) => {
  const dataDir = await tempDir(t);
  const { service } = offline(dataDir, { revoked: [] });
  await service.initialize();
  for (const [key, reason] of [
    ["BELLPR1.nope", "malformed"],
    [issue({ kid: "other" }), "unknown_kid"],
    [issue({ exp: new Date(now - 30 * day).toISOString() }), "expired"],
    [issue({ upd: "2026-01-01" }), "updates_expired"],
  ]) {
    await assert.rejects(
      withLocale("en", () => service.activate(key)),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "license_invalid");
        assert.deepEqual(error.params, { reason });
        return true;
      },
    );
  }
  await assert.rejects(withLocale("en", () => service.activate(issue({ upd: "2026-01-01" }))), /builds released until Jan 1, 2026, and this build is from Oct 1, 2026/);
  assert.equal(service.summary().plan, "free");
  assert.equal(existsSync(path.join(dataDir, "license.json")), false);
});

test("BELLPR_LICENSE_KEY wins over the saved key and locks it", async (t) => {
  const dataDir = await tempDir(t);
  const fileKey = issue({ name: "From file" });
  await offline(dataDir).service.activate(fileKey);
  const envKey = issue({ name: "From env" });

  const { service } = offline(dataDir, { envKey: `  ${envKey}\n` });
  const summary = await service.initialize();
  assert.equal(summary.plan, "pro");
  assert.equal(summary.source, "env");
  assert.equal(summary.name, "From env");
  assert.equal(summary.envLocked, true);
  await rejectsWith(() => service.activate(fileKey), 409, "license_env_locked");
  await rejectsWith(() => service.deactivate(), 409, "license_env_locked");
  assert.equal(JSON.parse(readFileSync(path.join(dataDir, "license.json"), "utf8")).key, fileKey);

  // An invalid env key falls back to the saved key, still locked.
  const fallback = offline(dataDir, { envKey: issue({ kid: "other" }) }).service;
  const second = await fallback.initialize();
  assert.equal(second.source, "file");
  assert.equal(second.name, "From file");
  assert.equal(second.envLocked, true);
  // An empty variable counts as unset.
  assert.equal((await offline(dataDir, { envKey: " " }).service.initialize()).envLocked, undefined);
});

test("the trial runs 14 days once per data directory and ends when the clock goes back", async (t) => {
  const dataDir = await tempDir(t);
  const { service, clock } = offline(dataDir);
  await service.initialize();
  const started = await service.startTrial();
  assert.equal(started.plan, "trial");
  assert.equal(started.source, "trial");
  assert.equal(started.trialDaysLeft, 14);
  assert.equal(started.trialAvailable, false);
  assert.equal(service.entitlements().plan, "trial");
  assert.doesNotThrow(() => service.assertFeature("discovery"));
  await rejectsWith(() => service.startTrial(), 409, "trial_unavailable");

  clock.now = now + 13.5 * day;
  assert.equal(service.summary().trialDaysLeft, 1);
  clock.now = now + 14 * day + 1;
  // A running server records the time it has seen (hourly, and at start).
  await service.initialize();
  assert.deepEqual(service.summary(), {
    plan: "free",
    source: "trial",
    status: "expired",
    reason: "trial_ended",
    trialAvailable: false,
  });
  await rejectsWith(() => service.startTrial(), 409, "trial_unavailable");

  // A restart with the clock turned back before the start: still over.
  const rolledBack = offline(dataDir);
  rolledBack.clock.now = now - day;
  assert.equal((await rolledBack.service.initialize()).reason, "trial_ended");
  // Turned back to within the 14 days, the time seen before still counts.
  const withinTrial = offline(dataDir);
  withinTrial.clock.now = now + day;
  await withinTrial.service.initialize();
  assert.equal(withinTrial.service.summary().plan, "free");

  // With Pro active there is no trial to start.
  const proDir = await tempDir(t);
  const pro = offline(proDir).service;
  await pro.activate(issue());
  await rejectsWith(() => pro.startTrial(), 409, "trial_unavailable");
  assert.equal(pro.summary().trialAvailable, false);
});

test("a key activated during the trial wins, and removing it returns to the trial", async (t) => {
  const dataDir = await tempDir(t);
  const { service } = offline(dataDir);
  await service.startTrial();
  assert.equal((await service.activate(issue())).plan, "pro");
  const back = await service.deactivate();
  assert.equal(back.plan, "trial");
  assert.equal(back.trialDaysLeft, 14);
});

test("an expired saved key reports why the plan is Free", async (t) => {
  const dataDir = await tempDir(t);
  const { service, clock } = offline(dataDir);
  await service.activate(issue({ exp: new Date(now + 10 * day).toISOString() }));
  clock.now = now + 13 * day;
  assert.equal(service.summary().status, "grace");
  assert.equal(service.summary().plan, "pro");
  clock.now = now + 18 * day;
  const summary = service.summary();
  assert.equal(summary.plan, "free");
  assert.equal(summary.status, "expired");
  assert.equal(summary.reason, "expired");
  assert.equal(summary.source, "file");
  assert.ok(summary.licenseId);
  assert.equal(summary.trialAvailable, true);
  assert.throws(
    () => service.assertFeature("learningExport"),
    (error) => error instanceof AppError && error.details?.reason === "expired",
  );
  // The time seen is saved, so a restart with the clock turned back stays expired.
  await service.initialize();
  const restarted = offline(dataDir);
  restarted.clock.now = now;
  assert.equal((await restarted.service.initialize()).reason, "expired");
});

test("an unreadable license.json means Free, and newer fields load in this build", async (t) => {
  const dataDir = await tempDir(t);
  const file = path.join(dataDir, "license.json");
  writeFileSync(file, "{not json");
  const warn = log.warn;
  const warnings: string[] = [];
  log.warn = (message) => {
    warnings.push(message);
  };
  t.after(() => {
    log.warn = warn;
  });
  const { service } = offline(dataDir);
  assert.equal((await service.initialize()).plan, "free");
  assert.equal(warnings.length, 1);

  // A file from a newer build, with fields this build does not know.
  const key = issue();
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      key,
      activatedAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      trial: { startedAt: new Date(now).toISOString(), extendedBy: 7 },
      machineId: "abc",
    }),
  );
  assert.equal((await offline(dataDir).service.initialize()).plan, "pro");
  // Forward compatibility (README §7 rule 7): an older build's schema
  // without a field still reads a file that has it.
  for (const field of ["activatedAt", "trial"] as const) {
    const older = lenientRead(licenseFileSchema.omit({ [field]: true } as { activatedAt: true }));
    assert.ok(older.safeParse(JSON.parse(readFileSync(file, "utf8"))).success, field);
  }
  // This build rewrites the file (a later start records the time, then the
  // key is removed) and keeps the fields it does not know.
  const later = offline(dataDir);
  later.clock.now = now + day;
  await later.service.initialize();
  assert.equal((await later.service.deactivate()).plan, "trial");
  const rewritten = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(rewritten.key, undefined);
  assert.equal(rewritten.lastSeenAt, new Date(now + day).toISOString());
  assert.equal(rewritten.machineId, "abc");
  assert.equal(rewritten.trial.extendedBy, 7);
});

test("a running server picks up a license changed by another process", async (t) => {
  const dataDir = await tempDir(t);
  const { service } = offline(dataDir);
  await service.initialize();
  let changes = 0;
  const stop = service.watch(() => {
    changes += 1;
  });
  try {
    // `bell-pr license trial` in another process.
    await offline(dataDir).service.startTrial();
    const deadline = Date.now() + 15_000;
    while (service.summary().plan !== "trial" && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(service.summary().plan, "trial");
    assert.ok(changes >= 1);
  } finally {
    // Before the directory goes away.
    stop();
  }
});

test("a change another process made is kept when this one changes the license", async (t) => {
  // A running server, and `bell-pr license trial` in another process before
  // the server's watcher noticed it.
  const dataDir = await tempDir(t);
  const running = offline(dataDir).service;
  await running.initialize();
  await offline(dataDir).service.startTrial();
  await running.activate(issue());
  assert.ok(JSON.parse(readFileSync(path.join(dataDir, "license.json"), "utf8")).trial?.startedAt);
  assert.equal((await running.deactivate()).plan, "trial");

  // The trial another process started cannot start a second time here.
  const other = await tempDir(t);
  const server = offline(other).service;
  await server.initialize();
  await offline(other).service.startTrial();
  await rejectsWith(() => server.startTrial(), 409, "trial_unavailable");
});

test("the startup line names the plan and, on Free, why and how to try Pro", () => {
  const line = (summary: Parameters<typeof startupPlanLine>[0]) => withLocale("en", () => startupPlanLine(summary));
  assert.equal(
    line({ plan: "free", source: "none", status: "none", reason: "no_license", trialAvailable: true }),
    "Plan: Free. Start the 14-day Pro trial in Settings or with `bell-pr license trial`.",
  );
  assert.equal(
    line({ plan: "free", source: "trial", status: "expired", reason: "trial_ended", trialAvailable: false }),
    "Plan: Free. The 14-day Pro trial has ended.",
  );
  assert.equal(
    line({ plan: "free", source: "env", status: "invalid", reason: "invalid", trialAvailable: true, envLocked: true }),
    "Plan: Free. The license key is not valid.",
  );
  assert.equal(line({ plan: "trial", source: "trial", status: "active", trialDaysLeft: 1 }), "Plan: Pro trial, 1 day left.");
  assert.equal(line({ plan: "pro", source: "file", status: "active", licenseId: "lic_X" }), "Plan: Pro (license lic_X).");
  assert.equal(
    withLocale("zh-TW", () => startupPlanLine({ plan: "free", source: "none", status: "none", reason: "no_license", trialAvailable: true })),
    "方案：免費。可在「設定」或用 `bell-pr license trial` 開始 14 天 Pro 試用。",
  );
});

test("no key ships in source", () => {
  assert.deepEqual(licensePublicKeys, {});
  assert.equal(revokedLicenseIds.size, 0);
  for (const x of Object.values(licensePublicKeys))
    assert.equal(Buffer.from(x, "base64url").length, 32);
});

// ---------------------------------------------------------------------------
// HTTP

interface Response {
  status: number;
  /** The parsed JSON answer; each test reads the fields it checks. */
  body: ReturnType<typeof JSON.parse>;
}

/** createApp with `license` on a store with one repository and stubbed slow work. */
async function serve(t: test.TestContext, license?: LicenseService) {
  // Removed after the server and its work have stopped (see below).
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-license-app-"));
  const store = new Store(directory);
  await store.initialize();
  const repo: Repository = {
    id: randomUUID(),
    name: "demo",
    owner: "test",
    fullName: "test/demo",
    path: path.join(directory, "demo"),
    defaultBranch: "main",
    url: "",
  };
  store.data.repos = [repo];
  await store.save();
  const workbench = new Workbench(store);
  const changes: string[] = [];
  workbench.entitlementsChanged = () => {
    changes.push(license?.summary().plan ?? "none");
  };
  const app = createApp(workbench, {
    staticDirectory: path.join(directory, "missing"),
    ...(license ? { license } : {}),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const call = (method: string, endpoint: string, body?: unknown) =>
    new Promise<Response>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${port}/api${endpoint}`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            Host: "127.0.0.1:4311",
            "X-Bell-Locale": "en",
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => {
            const json = /json/.test(String(res.headers["content-type"]));
            resolve({ status: res.statusCode!, body: json ? JSON.parse(text) : text });
          });
        },
      );
      req.on("error", reject);
      // A browser's fetch sends the length, also for DELETE.
      const text = method === "GET" ? "" : JSON.stringify(body ?? {});
      if (text) req.setHeader("Content-Length", Buffer.byteLength(text));
      req.end(text || undefined);
    });
  return { call, workbench, app, store, repo, directory, changes };
}

function proRequiredBody(feature: ProFeature, reason = "no_license") {
  return {
    error: withLocale("en", () => new AppError((m) => m.license.featureNeedsPro[feature]).message),
    code: "pro_required",
    feature,
    plan: "free",
    reason,
  };
}

test("the 402 body names the feature, the plan and the reason, and no upgrade link while purchaseUrl is empty", async (t) => {
  assert.equal(product.purchaseUrl, "");
  for (const license of [fixedLicense("free"), offline(await tempDir(t)).service]) {
    const { call } = await serve(t, license);
    const response = await call("POST", "/discovery", {});
    assert.equal(response.status, 402);
    assert.deepEqual(response.body, proRequiredBody("discovery"));
    assert.equal("upgradeUrl" in response.body, false);
  }
});

test("Free gates only what creates Pro work and never a read", async (t) => {
  const dataDir = await tempDir(t);
  const { service } = offline(dataDir);
  await service.initialize();
  const { call, repo, workbench, app, directory } = await serve(t, service);
  const started: string[] = [];
  app.locals.discovery.start = async () => {
    started.push("discovery");
    return { id: "job" };
  };
  workbench.createRun = async () => {
    throw new Error("A refused run must not start");
  };

  assert.equal((await call("GET", "/discovery")).status, 200);
  assert.equal((await call("POST", "/discovery", {})).status, 402);
  assert.equal((await call("POST", "/discovery/cancel")).status, 200);
  assert.deepEqual((await call("POST", `/repos/${repo.id}/insights/recommendations`, {})).body, proRequiredBody("moreRecommendations"));
  assert.deepEqual((await call("GET", "/runs/any/export.md")).body, proRequiredBody("learningExport"));
  assert.deepEqual((await call("POST", "/runs/any/pr/feedback")).body, proRequiredBody("prFeedback"));
  assert.deepEqual((await call("POST", "/runs/any/follow-ups", { feedbackUrls: [] })).body, proRequiredBody("prFeedback"));
  // Discarding a round, syncing and updating the clone are never gated:
  // they reach the Workbench, which answers that the run does not exist.
  for (const endpoint of [
    "/runs/any/follow-ups/discard",
    "/runs/any/sync",
    "/runs/any/sync/resolve",
    "/runs/any/sync/undo",
    `/repos/${randomUUID()}/update`,
  ])
    assert.equal((await call("POST", endpoint)).status, 404, endpoint);

  // The team size is lowered to 2 and saved, never refused.
  const saved = await call("PUT", `/repos/${repo.id}/settings`, { ...defaultContributionSettings, maxTeammates: 3 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.clamped, true);
  assert.equal(saved.body.clampedFrom, 3);
  assert.equal(saved.body.settings.maxTeammates, 2);
  assert.equal((await call("GET", `/repos/${repo.id}/settings`)).body.settings.maxTeammates, 2);
  const unchanged = await call("PUT", `/repos/${repo.id}/settings`, { ...defaultContributionSettings, maxTeammates: 2 });
  assert.deepEqual(Object.keys(unchanged.body), ["settings"]);

  // Web access and Pro-only efforts, on every path that selects them.
  assert.deepEqual((await call("PUT", "/model-settings", { webAccess: true })).body, proRequiredBody("webAccess"));
  assert.deepEqual((await call("PUT", "/model-settings", { reasoningEffort: "xhigh" })).body, proRequiredBody("deepReasoning"));
  assert.equal((await call("PUT", "/model-settings", { webAccess: "yes" })).status, 400);
  assert.equal((await call("PUT", "/model-settings", { webAccess: false })).status, 200);
  assert.deepEqual(
    (await call("PUT", `/repos/${repo.id}/settings`, { ...defaultContributionSettings, webAccess: true })).body,
    proRequiredBody("webAccess"),
  );
  assert.deepEqual(
    (await call("POST", "/runs", { repoId: repo.id, prompt: "Fix the greeting text", settings: { ...defaultContributionSettings, reasoningEffort: "max" } })).body,
    proRequiredBody("deepReasoning"),
  );
  // Stale Pro settings saved earlier: a new analysis or run is refused with
  // the feature, so the UI can offer "Use Free settings".
  await writeFile(path.join(directory, "model-settings.json"), JSON.stringify({ model: "", reasoningEffort: "", webAccess: true }));
  assert.deepEqual((await call("POST", `/repos/${repo.id}/insights`)).body, proRequiredBody("webAccess"));
  assert.deepEqual((await call("POST", "/runs", { repoId: repo.id, prompt: "Fix the greeting text" })).body, proRequiredBody("webAccess"));
  assert.deepEqual(started, []);

  // The trial unlocks discovery at once and tells the Workbench.
  const trial = await call("POST", "/license/trial");
  assert.equal(trial.status, 200);
  assert.equal(trial.body.license.plan, "trial");
  assert.equal((await call("POST", "/discovery", {})).status, 202);
  assert.deepEqual(started, ["discovery"]);
  const pro = await call("PUT", `/repos/${repo.id}/settings`, { ...defaultContributionSettings, maxTeammates: 4 });
  assert.equal(pro.body.settings.maxTeammates, 4);
  assert.equal(pro.body.clamped, undefined);
});

test("the license routes activate, remove and start the trial, and tell the Workbench", async (t) => {
  const dataDir = await tempDir(t);
  const { service } = offline(dataDir);
  await service.initialize();
  const { call, changes } = await serve(t, service);
  assert.deepEqual((await call("GET", "/license")).body, {
    license: { plan: "free", source: "none", status: "none", reason: "no_license", trialAvailable: true },
  });
  const invalid = await call("PUT", "/license", { key: "BELLPR1.x.y" });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "license_invalid");
  assert.deepEqual(invalid.body.params, { reason: "malformed" });
  assert.match(invalid.body.error, /not a BELL PR license key/);
  assert.equal((await call("PUT", "/license", { key: "B".repeat(2049) })).status, 400);
  assert.equal((await call("PUT", "/license", { key: issue(), extra: 1 })).status, 400);
  assert.deepEqual(changes, []);

  const activated = await call("PUT", "/license", { key: issue() });
  assert.equal(activated.status, 200);
  assert.equal(activated.body.license.plan, "pro");
  assert.equal(activated.body.license.source, "file");
  const removed = await call("DELETE", "/license");
  assert.equal(removed.status, 200);
  assert.equal(removed.body.license.plan, "free");
  const trial = await call("POST", "/license/trial");
  assert.equal(trial.body.license.plan, "trial");
  const again = await call("POST", "/license/trial");
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "trial_unavailable");
  assert.deepEqual(changes, ["pro", "free", "trial"]);

  // With the key in the environment the routes refuse changes.
  const locked = await serve(t, offline(dataDir, { envKey: issue() }).service);
  const refused = await locked.call("PUT", "/license", { key: issue() });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "license_env_locked");
  assert.equal((await locked.call("DELETE", "/license")).body.code, "license_env_locked");
  // A fixed plan (the library default) cannot be changed either.
  const fixed = await serve(t);
  assert.equal((await fixed.call("GET", "/license")).body.license.plan, "pro");
  assert.equal((await fixed.call("PUT", "/license", { key: issue() })).body.code, "license_env_locked");
  assert.equal((await fixed.call("POST", "/license/trial")).status, 409);
});

/** An analysis cache with `count` recommendations, as an earlier Pro plan left it. */
function insightsCache(count: number) {
  const recommendation = (index: number) => ({
    id: `rec-${index}`,
    title: `Recommendation ${index}`,
    direction: "docs",
    problem: "The README has no setup example.",
    userImpact: "New users get stuck during setup.",
    approach: "Add a short setup example.",
    acceptance: ["The example runs as written."],
    effort: "small",
    confidence: "medium",
    evidence: ["README.md"],
  });
  return {
    version: 1,
    settings: { ...defaultContributionSettings, maxTeammates: 4 },
    insights: {
      summary: "A demo project.",
      purpose: "Shows the greeting.",
      audience: ["Developers"],
      userJourney: ["Read the README"],
      modules: [{ path: "src/", purpose: "The code." }],
      evidence: [{ path: "README.md", note: "Explains the project." }],
      recommendations: Array.from({ length: count }, (_, index) => recommendation(index + 1)),
      generatedAt: new Date(now).toISOString(),
      source: "ai",
      baseSha: "a".repeat(40),
    },
    fingerprint: null,
    recommendationPreferences: { order: [], hidden: [] },
  };
}

test("after a downgrade a Pro run, its open follow-up round and 12 recommendations stay usable", async (t) => {
  // A trial that ended: the plan is Free now.
  const dataDir = await tempDir(t);
  const { service, clock } = offline(dataDir);
  await service.startTrial();
  clock.now = now + 20 * day;
  assert.equal(service.summary().reason, "trial_ended");
  const { call, repo, workbench, store, directory } = await serve(t, service);

  const insightsDir = path.join(directory, "insights");
  mkdirSync(insightsDir, { recursive: true });
  writeFileSync(
    path.join(insightsDir, `${createHash("sha256").update(repo.id).digest("hex")}.json`),
    JSON.stringify(insightsCache(12)),
  );
  const run: Run = {
    id: randomUUID(),
    repoId: repo.id,
    title: "Pro run",
    prompt: "Improve the greeting",
    status: "review",
    branch: "fix/greeting",
    baseBranch: "main",
    baseSha: "b".repeat(40),
    worktreePath: path.join(directory, "worktrees", "run"),
    createdAt: new Date(now).toISOString(),
    agents: [],
    logs: [],
    draft: { title: "Improve the greeting", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    team: {
      config: {
        maxTeammates: 4,
        requirePlanApproval: true,
        provider: "codex",
        protocol: "bell-shared-tasks",
        messageDelivery: "between-turns",
      },
      phase: "reviewing",
      planSummary: "Four teammates",
      tasks: [],
      messages: [],
    },
    followUps: [
      {
        id: "round-1",
        requestedAt: new Date(now).toISOString(),
        feedbackUrls: ["https://github.com/test/demo/pull/1#discussion_r1"],
        status: "review",
        parentCommit: "c".repeat(40),
      },
    ],
  };
  store.data.runs.push(run);
  await store.save();

  // The Workbench keeps its own rules; here each action only records that
  // the route let it through.
  const reached: string[] = [];
  const record = (name: string) => async () => {
    reached.push(name);
    return run;
  };
  workbench.retryTeam = record("retry");
  workbench.approvePlan = record("approvePlan");
  workbench.revisePlan = record("revisePlan");
  workbench.sendTeamMessage = record("message");
  workbench.approve = record("approve");
  workbench.publish = record("publish");
  workbench.discardFollowUp = record("discard");
  workbench.cancel = record("cancel");
  workbench.rerunReview = record("rerun");
  workbench.review = record("review");
  workbench.saveNote = record("note");

  const fetched = await call("GET", `/runs/${run.id}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.run.team.config.maxTeammates, 4);
  assert.equal(fetched.body.run.followUps[0].status, "review");
  const insights = await call("GET", `/repos/${repo.id}/insights`);
  assert.equal(insights.status, 200);
  assert.equal(insights.body.insights.recommendations.length, 12);
  assert.equal((await call("GET", "/runs")).status, 200);

  const fingerprint = "d".repeat(64);
  for (const [endpoint, body] of [
    [`/runs/${run.id}/team/retry`, {}],
    [`/runs/${run.id}/plan/approve`, {}],
    [`/runs/${run.id}/plan/revise`, { feedback: "Split the work in two." }],
    [`/runs/${run.id}/team/messages`, { to: "lead", content: "Please keep it small." }],
    [`/runs/${run.id}/review`, { filePath: "src/greeting.ts", reviewed: true, fingerprint }],
    [`/runs/${run.id}/review/rerun`, {}],
    [`/runs/${run.id}/approve`, { draft: { title: "Improve the greeting", body: "", commitMessage: "Improve the greeting" } }],
    [`/runs/${run.id}/publish`, { fingerprint }],
    [`/runs/${run.id}/follow-ups/discard`, {}],
    [`/runs/${run.id}/cancel`, {}],
  ] as const) {
    const response = await call("POST", endpoint, body);
    assert.equal(response.status, 200, `${endpoint}: ${JSON.stringify(response.body)}`);
  }
  assert.equal((await call("PATCH", `/runs/${run.id}/notes`, { filePath: "src/greeting.ts", text: "Check this." })).status, 200);
  assert.deepEqual(reached, [
    "retry",
    "approvePlan",
    "revisePlan",
    "message",
    "review",
    "rerun",
    "approve",
    "publish",
    "discard",
    "cancel",
    "note",
  ]);
  // Starting another round or exporting is Pro again.
  assert.equal((await call("POST", `/runs/${run.id}/follow-ups`, { feedbackUrls: [] })).status, 402);
  assert.equal((await call("GET", `/runs/${run.id}/export.md`)).status, 402);
});

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

test("startServer on a fresh data directory is Free: POST /api/discovery answers 402", async (t) => {
  const directory = await tempDir(t);
  // Fake agent CLIs first on PATH, so nothing can reach a real one.
  const bin = path.join(directory, "bin");
  mkdirSync(bin);
  for (const name of ["codex", "claude", "gh"])
    writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const ui = path.join(directory, "ui");
  mkdirSync(ui);
  writeFileSync(path.join(ui, "index.html"), "<!doctype html><title>ui</title>");
  const previous = { PATH: process.env.PATH, key: process.env.BELLPR_LICENSE_KEY };
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  delete process.env.BELLPR_LICENSE_KEY;
  t.after(() => {
    process.env.PATH = previous.PATH;
    if (previous.key !== undefined) process.env.BELLPR_LICENSE_KEY = previous.key;
  });
  const port = await freePort();
  const dataDir = path.join(directory, "data");
  const lines: string[] = [];
  const running = await withLocale("en", () =>
    startServer({
      config: resolveConfig({ port, dataDir }, { BELLPR_STATIC_DIR: ui, BELLPR_NO_OPEN: "1" }),
      handleExit: false,
      print: (line) => lines.push(line),
    }),
  );
  // Stopped in the test, before t.after removes its directory.
  try {
    await failClosedChecks(running, port, dataDir, lines);
  } finally {
    await running.shutdown();
  }
});

async function failClosedChecks(
  running: Awaited<ReturnType<typeof startServer>>,
  port: number,
  dataDir: string,
  lines: string[],
) {
  assert.ok(
    lines.includes("Plan: Free. Start the 14-day Pro trial in Settings or with `bell-pr license trial`."),
    lines.join("\n"),
  );
  assert.ok(lines.at(-1)!.includes("→ "));

  const get = (url: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
      const req = request(url, { headers }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      });
      req.on("error", reject);
      req.end();
    });
  const signIn = await get(running.signInUrl);
  const cookie = (signIn.headers["set-cookie"] as string[])[0].split(";")[0];
  const response = await new Promise<Response>((resolve, reject) => {
    const req = request(
      `http://127.0.0.1:${port}/api/discovery`,
      { method: "POST", headers: { cookie, "Content-Type": "application/json", "X-Bell-Locale": "en" } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
      },
    );
    req.on("error", reject);
    req.end("{}");
  });
  assert.equal(response.status, 402);
  assert.deepEqual(response.body, proRequiredBody("discovery"));
  // Reading the results stays open.
  assert.equal((await get(`http://127.0.0.1:${port}/api/discovery`, { cookie })).status, 200);
  assert.equal(existsSync(path.join(dataDir, "license.json")), false);
}

// ---------------------------------------------------------------------------
// bell-pr license

function output() {
  let text = "";
  return { stream: { write: (chunk: string) => (text += chunk) }, text: () => text };
}

async function cli(dataDir: string, argv: string[], extra: Parameters<typeof runLicenseCli>[1] = {}) {
  const stdout = output();
  const stderr = output();
  const code = await withLocale("en", () =>
    runLicenseCli(argv, {
      dataDir,
      stdout: stdout.stream,
      stderr: stderr.stream,
      env: {},
      publicKeys,
      revoked: [],
      now: () => now,
      ...extra,
    }),
  );
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

test("bell-pr license shows the status, activates, removes and starts the trial", async (t) => {
  const dataDir = path.join(await tempDir(t), "data");
  const status = await cli(dataDir, []);
  assert.equal(status.code, 0);
  assert.match(status.stdout, /^Plan: Free\nNo license key is active\./);
  assert.match(status.stdout, /Start the 14-day Pro trial: bell-pr license trial/);
  assert.match(status.stdout, /Activate a license key: bell-pr license activate <key>/);
  // Showing the status creates nothing.
  assert.equal(existsSync(dataDir), false);
  const json = await cli(dataDir, ["status", "--json"]);
  assert.deepEqual(JSON.parse(json.stdout), {
    license: { plan: "free", source: "none", status: "none", reason: "no_license", trialAvailable: true },
    fixes: [
      { label: "Start the 14-day Pro trial", command: "bell-pr license trial" },
      { label: "Activate a license key", command: "bell-pr license activate <key>" },
    ],
  });

  const key = issue();
  const activated = await cli(dataDir, ["activate", key]);
  assert.equal(activated.code, 0);
  assert.match(activated.stdout, /^License activated\.\nPlan: Pro\nLicense: lic_/m);
  assert.match(activated.stdout, /Licensed to: Ada Lovelace <ada@example.com>/);
  assert.match(activated.stdout, /Expires: never/);
  assert.match(activated.stdout, /Updates: builds released until Oct 14, 2027/);
  assert.match(activated.stdout, /picks up the change within a few seconds/);
  assert.ok(!activated.stdout.includes(key) && !activated.stderr.includes(key));
  assert.equal(statSync(path.join(dataDir, "license.json")).mode & 0o777, 0o600);

  const removed = await cli(dataDir, ["deactivate"]);
  assert.match(removed.stdout, /^License key removed\.\nPlan: Free/);
  assert.match((await cli(dataDir, ["deactivate"])).stdout, /^No license key is saved in this data directory\./);
  const trial = await cli(dataDir, ["trial"]);
  assert.match(trial.stdout, /^Pro trial started\.\nPlan: Pro trial\nTrial: 14 days left/);
  const twice = await cli(dataDir, ["trial"]);
  assert.equal(twice.code, 1);
  assert.equal(twice.stderr, "This data directory has already used its 14-day Pro trial.\n");

  // From standard input, so the key stays out of the shell history.
  const fromStdin = await cli(dataDir, ["activate", "-"], {
    stdin: (async function* () {
      yield `${key.slice(0, 40)}\n`;
      yield `${key.slice(40)}\n`;
    })(),
  });
  assert.equal(fromStdin.code, 0, fromStdin.stderr);
});

test("bell-pr license refuses mistakes, invalid keys and keys set in the environment", async (t) => {
  const dataDir = path.join(await tempDir(t), "data");
  for (const argv of [["frobnicate"], ["status", "--verbose"], ["status", "--json=yes"], ["trial", "--json"], ["activate"], ["deactivate", "now"]]) {
    const result = await cli(dataDir, argv);
    assert.equal(result.code, 2, argv.join(" "));
    assert.match(result.stderr, /Usage: bell-pr license/);
    assert.equal(result.stdout, "");
  }
  for (const argv of [["--help"], ["activate", "-h"]]) {
    const help = await cli(dataDir, argv);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^Usage: bell-pr license \[status \[--json\] \| activate <key> \| deactivate \| trial\]/);
  }
  const invalid = await cli(dataDir, ["activate", issue({ kid: "other" })]);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /cannot check this license key/);
  const locked = await cli(dataDir, ["activate", issue()], { env: { BELLPR_LICENSE_KEY: issue() } });
  assert.equal(locked.code, 1);
  assert.match(locked.stderr, /BELLPR_LICENSE_KEY/);
  const status = await cli(dataDir, [], { env: { BELLPR_LICENSE_KEY: issue() } });
  assert.match(status.stdout, /Key from: the BELLPR_LICENSE_KEY environment variable/);
  assert.doesNotMatch(status.stdout, /bell-pr license activate/);
});

// ---------------------------------------------------------------------------
// tools/license

test("keygen writes a 0600 private key outside the repository and never replaces one", async (t) => {
  const keys = await tempDir(t);
  const stdout = output();
  const stderr = output();
  const deps = { stdout: stdout.stream, stderr: stderr.stream, home: keys };
  assert.equal(await keygenMain(["--kid", "test-2026", "--dir", keys], deps), 0, stderr.text());
  const pem = path.join(keys, "test-2026.pem");
  assert.equal(statSync(pem).mode & 0o777, 0o600);
  // A PKCS8 PEM file holding an Ed25519 private key.
  const written = readFileSync(pem, "utf8");
  const privateKey = createPrivateKey(written);
  assert.equal(privateKey.type, "private");
  assert.equal(privateKey.asymmetricKeyType, "ed25519");
  assert.equal(privateKey.export({ type: "pkcs8", format: "pem" }), written);
  const x = /Public key \(x\): ([A-Za-z0-9_-]{43})\n/.exec(stdout.text())![1];
  assert.match(stdout.text(), new RegExp(`"test-2026": "${x}",`));
  assert.ok(!stdout.text().includes(written.split("\n")[1]), "the private key was printed");

  assert.equal(await keygenMain(["--kid", "test-2026", "--dir", keys], deps), 1);
  assert.match(stderr.text(), /already exists/);
  assert.equal(await keygenMain(["--kid", "x", "--dir", path.join(repoRoot, "tmp-keys")], deps), 1);
  assert.equal(existsSync(path.join(repoRoot, "tmp-keys")), false);
  assert.equal(await keygenMain(["--kid", "Bad/Kid", "--dir", keys], deps), 2);
  assert.equal(await keygenMain(["--dir", keys], deps), 2);
  // The default folder is under the home directory given.
  assert.equal(await keygenMain(["--kid", "default-dir"], deps), 0);
  assert.ok(existsSync(path.join(keys, ".config", "bell-pr-licensing", "default-dir.pem")));
});

test("issue signs keys that BELL PR accepts, records them in the ledger and issues pools without an e-mail", async (t) => {
  const keys = await tempDir(t);
  const quiet = { stdout: output().stream, stderr: output().stream, home: keys };
  await keygenMain(["--kid", "test-2026", "--dir", keys], quiet);
  const pem = path.join(keys, "test-2026.pem");
  const x = verifyX(pem);
  const verify = (key: string) =>
    verifyLicenseKey(key, { now, publicKeys: { "test-2026": x }, revoked: [], buildDate: "2026-10-14" });

  const stdout = output();
  const stderr = output();
  const deps = { stdout: stdout.stream, stderr: stderr.stream, now: () => now };
  const code = await issueMain(
    ["--kid", "test-2026", "--key", pem, "--seats", "3", "--email", "ada@example.com", "--name", "Ada, Countess"],
    deps,
  );
  assert.equal(code, 0, stderr.text());
  const key = stdout.text().trim();
  const result = verify(key);
  assert.ok(result.ok);
  assert.equal(result.license.seats, 3);
  assert.equal(result.license.email, "ada@example.com");
  assert.equal(result.license.exp, null);
  assert.equal(result.license.upd, "2027-10-14");
  const ledger = path.join(keys, "ledger.csv");
  assert.equal(statSync(ledger).mode & 0o777, 0o600);
  const [header, row] = readFileSync(ledger, "utf8").trim().split("\n");
  assert.equal(header, "issued_at,license_id,kid,seats,email,name,expires,updates_until,pool,key");
  assert.ok(row.includes(`${result.license.id},test-2026,3,ada@example.com,"Ada, Countess",,2027-10-14,,${key}`));

  // A time-limited license.
  const limited = output();
  assert.equal(
    await issueMain(["--kid", "test-2026", "--key", pem, "--seats", "1", "--expires", "2027-06-30"], { ...deps, stdout: limited.stream }),
    0,
  );
  const limitedKey = verify(limited.text().trim());
  assert.ok(limitedKey.ok);
  assert.equal(limitedKey.license.exp, "2027-06-30");
  assert.equal(limitedKey.license.upd, undefined);

  // A pool: one key per line, each with its own id and no e-mail or name.
  const out = path.join(keys, "pool.csv");
  assert.equal(await issueMain(["--kid", "test-2026", "--key", pem, "--seats", "1", "--pool", "5", "--out", out], deps), 0);
  const pool = readFileSync(out, "utf8").trim().split("\n");
  assert.equal(pool.length, 5);
  assert.equal(statSync(out).mode & 0o777, 0o600);
  const ids = pool.map((poolKey) => {
    const checked = verify(poolKey);
    assert.ok(checked.ok);
    assert.equal(checked.license.email, undefined);
    assert.equal(checked.license.name, undefined);
    return checked.license.id;
  });
  assert.equal(new Set(ids).size, 5);
  assert.equal(readFileSync(ledger, "utf8").trim().split("\n").length, 1 + 1 + 1 + 5);

  // Mistakes exit 2 and write nothing.
  for (const argv of [
    ["--kid", "test-2026", "--key", pem, "--seats", "1", "--pool", "2", "--out", out],
    ["--kid", "test-2026", "--key", pem, "--seats", "1", "--pool", "2", "--out", path.join(keys, "p2.csv"), "--email", "a@b.co"],
    ["--kid", "test-2026", "--key", pem, "--seats", "1", "--pool", "2"],
    ["--kid", "test-2026", "--key", pem, "--seats", "0"],
    ["--kid", "test-2026", "--key", pem, "--seats", "1", "--email", "not-an-email"],
    ["--kid", "test-2026", "--key", pem, "--seats", "1", "--expires", "2020-01-01"],
    // A time without its offset is not a format a key's payload accepts.
    ["--kid", "test-2026", "--key", pem, "--seats", "1", "--expires", "2027-12-31T10:00"],
    ["--kid", "test-2026", "--key", pem, "--seats", "1", "--expires", "2027-01-01", "--updates-months", "6"],
    ["--kid", "test-2026", "--key", path.join(keys, "missing.pem"), "--seats", "1"],
    ["--kid", "test-2026", "--key", pem, "--seats", "1", "--ledger", path.join(repoRoot, "ledger.csv")],
  ])
    assert.equal(await issueMain(argv, { ...deps, stderr: output().stream }), 2, argv.join(" "));
  assert.equal(existsSync(path.join(repoRoot, "ledger.csv")), false);
  assert.equal(existsSync(path.join(keys, "p2.csv")), false);
});

/** The public key of a PEM file, the way BELL PR's key table stores it. */
function verifyX(pem: string) {
  return createPublicKey(createPrivateKey(readFileSync(pem, "utf8"))).export({ format: "jwk" }).x!;
}

test("tool helpers: ULIDs, month arithmetic, CSV fields and repository paths", async () => {
  assert.match(ulid(), /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(ulid(0, new Uint8Array(10)), "0".repeat(26));
  assert.ok(ulid(now) < ulid(now + 1));
  assert.equal(addMonths(new Date("2026-01-31T10:00:00Z"), 1), "2026-02-28");
  assert.equal(addMonths(new Date("2026-10-14T00:00:00Z"), 12), "2027-10-14");
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField('Ada "AL", Countess'), '"Ada ""AL"", Countess"');
  assert.equal(csvField("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.ok(insideRepository(path.join(repoRoot, "server", "x.pem")));
  assert.ok(insideRepository(repoRoot));
  assert.equal(insideRepository(path.join(os.tmpdir(), "x.pem")), false);
  assert.equal(insideRepository(`${repoRoot}-sibling/x.pem`), false);
  // A second guard: Git ignores key files anywhere in the repository.
  assert.match(await readFile(path.join(repoRoot, ".gitignore"), "utf8"), /^\*\.pem$/m);
});
