/**
 * Pairing codes, the failure lock and device tokens, on a fake clock.
 * Synthetic tokens only.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateApiToken } from "./api-token.js";
import { dataPaths } from "./config.js";
import { DeviceTokens, lastUsedWriteInterval } from "./device-tokens.js";
import {
  clearPairing,
  failureIdleReset,
  firstLockDuration,
  generatePairCode,
  maxLockDuration,
  normalizePairCode,
  pairCodeTtl,
  Pairing,
  type CreateCodeResult,
} from "./pairing.js";

const codeShape = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "bell-pairing-"));
  const dataDir = path.join(root, "data");
  t.after(() => rm(root, { recursive: true, force: true }));
  const clock = { now: Date.parse("2026-10-30T00:00:00.000Z") };
  const now = () => clock.now;
  const install = generateApiToken();
  const devices = new DeviceTokens(dataDir, { now });
  const pairing = new Pairing(dataDir, devices, { now });
  const code = async () => {
    const result = await pairing.createCode(install);
    assert.equal(result.status, "created");
    return (result as Extract<CreateCodeResult, { status: "created" }>).code;
  };
  const wrong = (good: string) => (good.startsWith("0") ? "1111-1111" : "0000-0000");
  const redeem = (value: string, name?: string) => pairing.redeem(value, name, "Paired device", install);
  return { dataDir, clock, install, devices, pairing, code, wrong, redeem, paths: dataPaths(dataDir) };
}

test("codes are 8 Crockford base32 characters with 40 bits and normalize leniently", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const code = generatePairCode();
    assert.match(code, codeShape);
    seen.add(code);
  }
  assert.ok(seen.size > 195);
  assert.equal(normalizePairCode(" abcd-efgh "), "ABCDEFGH");
  assert.equal(normalizePairCode("o1il-0000"), "0111" + "0000");
  assert.equal(normalizePairCode("ABCD-EFG"), undefined);
  assert.equal(normalizePairCode("ABCD-EFGU"), undefined);
});

test("a code works once, expires after 5 minutes and is replaced by a new one", async (t) => {
  const f = await fixture(t);
  const first = await f.code();
  const paired = await f.redeem(first, "Phone");
  assert.equal(paired.status, "paired");
  assert.equal((await f.redeem(first)).status, "invalid");

  const expiring = await f.code();
  f.clock.now += pairCodeTtl;
  assert.equal((await f.redeem(expiring)).status, "invalid");

  const old = await f.code();
  const replacement = await f.code();
  assert.notEqual(old, replacement);
  assert.equal((await f.redeem(old)).status, "invalid");
  assert.equal((await f.redeem(replacement)).status, "paired");
});

test("five wrong codes void the current code", async (t) => {
  const f = await fixture(t);
  const good = await f.code();
  for (let i = 0; i < 5; i++) assert.equal((await f.redeem(f.wrong(good))).status, "invalid");
  assert.equal((await f.redeem(good)).status, "invalid");
});

test("ten failures in 15 minutes void the code and lock pairing, across a new code and a restart", async (t) => {
  const f = await fixture(t);
  let good = await f.code();
  for (let i = 0; i < 4; i++) await f.redeem(f.wrong(good));
  // A new code does not reset the global count.
  good = await f.code();
  for (let i = 0; i < 5; i++) await f.redeem(f.wrong(good));
  const tripped = await f.redeem(f.wrong(good));
  assert.deepEqual(tripped, { status: "locked", lockedUntil: f.clock.now + firstLockDuration });
  // Locked: neither redeem nor a new code, and the voided code stays void.
  assert.equal((await f.redeem(good)).status, "locked");
  assert.equal((await f.pairing.createCode(f.install)).status, "locked");

  // A restart keeps the lock.
  const restarted = new Pairing(f.dataDir, f.devices, { now: () => f.clock.now });
  assert.equal((await restarted.createCode(f.install)).status, "locked");
});

test("each repeated lock doubles and stops at 24 hours", async (t) => {
  const f = await fixture(t);
  let expected = firstLockDuration;
  for (let round = 0; round < 9; round++) {
    const good = await f.code();
    let last;
    for (let i = 0; i < 10; i++) last = await f.redeem(f.wrong(good));
    assert.deepEqual(last, { status: "locked", lockedUntil: f.clock.now + expected }, `round ${round}`);
    f.clock.now += expected;
    expected = Math.min(expected * 2, maxLockDuration);
  }
  assert.equal(expected, maxLockDuration);
});

test("a pairing, a day without failures, or unlock clears the count", async (t) => {
  const f = await fixture(t);
  let good = await f.code();
  for (let i = 0; i < 4; i++) await f.redeem(f.wrong(good));
  assert.equal((await f.redeem(good)).status, "paired");
  good = await f.code();
  for (let i = 0; i < 4; i++) await f.redeem(f.wrong(good));
  good = await f.code();
  for (let i = 0; i < 4; i++) await f.redeem(f.wrong(good));
  // 8 failures since the pairing: two more lock, so the pairing cleared four.
  good = await f.code();
  assert.equal((await f.redeem(f.wrong(good))).status, "invalid");
  assert.equal((await f.redeem(f.wrong(good))).status, "locked");

  f.clock.now += firstLockDuration;
  await f.pairing.unlock();
  good = await f.code();
  for (let i = 0; i < 4; i++) await f.redeem(f.wrong(good));
  good = await f.code();
  for (let i = 0; i < 4; i++) await f.redeem(f.wrong(good));
  // 8 failures, then a day passes: the count and the doubling are gone.
  f.clock.now += failureIdleReset;
  good = await f.code();
  for (let i = 0; i < 4; i++) await f.redeem(f.wrong(good));
  good = await f.code();
  for (let i = 0; i < 5; i++) await f.redeem(f.wrong(good));
  good = await f.code();
  assert.deepEqual(await f.redeem(f.wrong(good)), { status: "locked", lockedUntil: f.clock.now + firstLockDuration });
});

test("unlock clears an active lock", async (t) => {
  const f = await fixture(t);
  let good = await f.code();
  for (let i = 0; i < 5; i++) await f.redeem(f.wrong(good));
  good = await f.code();
  for (let i = 0; i < 5; i++) await f.redeem(f.wrong(good));
  assert.equal((await f.pairing.createCode(f.install)).status, "locked");
  await f.pairing.unlock();
  good = await f.code();
  assert.equal((await f.redeem(good)).status, "paired");
});

test("a missing or damaged failure record fails closed until unlock", async (t) => {
  const f = await fixture(t);
  // A new install starts unlocked.
  const good = await f.code();
  assert.equal((await f.redeem(good)).status, "paired");

  await writeFile(f.paths.pairLock, "{not json");
  assert.deepEqual(await f.pairing.createCode(f.install), { status: "locked" });
  assert.deepEqual(await f.redeem("0000-0000"), { status: "locked" });

  await rm(f.paths.pairLock);
  assert.deepEqual(await f.pairing.createCode(f.install), { status: "locked" });

  await f.pairing.unlock();
  assert.equal((await f.pairing.createCode(f.install)).status, "created");
});

test("parallel redeems of one code give exactly one device", async (t) => {
  const f = await fixture(t);
  const good = await f.code();
  const results = await Promise.all(Array.from({ length: 30 }, () => f.redeem(good)));
  assert.equal(results.filter((result) => result.status === "paired").length, 1);
  assert.equal(f.devices.list(f.install).length, 1);
});

test("files are 0600 in a 0700 directory and hold hashes, never a code or token", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  const good = await f.code();
  await f.redeem(f.wrong(good));
  const paired = await f.redeem(good, "Phone");
  assert.equal(paired.status, "paired");
  const token = (paired as { token: string }).token;
  assert.match(token, /^bpd_[0-9a-f]{64}$/);
  assert.equal((await stat(f.dataDir)).mode & 0o777, 0o700);
  for (const file of [f.paths.devices, f.paths.pairCode, f.paths.pairLock]) {
    assert.equal((await stat(file)).mode & 0o777, 0o600, file);
    const text = await readFile(file, "utf8");
    assert.equal(text.includes(token), false);
    assert.equal(text.includes(token.slice(4)), false);
    assert.equal(text.includes(good), false);
    assert.equal(text.includes(good.replace("-", "")), false);
  }
  const listed = f.devices.list(f.install);
  assert.deepEqual(Object.keys(listed[0]).sort(), ["createdAt", "current", "id", "lastUsedAt", "name"]);
});

test("device tokens verify, record use at most once a minute, and die with a rotate", async (t) => {
  const f = await fixture(t);
  const paired = (await f.redeem(await f.code(), "Phone")) as { id: string; token: string };
  assert.equal(f.devices.verify(paired.token, f.install), paired.id);
  const altered = `${paired.token.slice(0, -1)}${paired.token.endsWith("0") ? "1" : "0"}`;
  assert.equal(f.devices.verify(altered, f.install), undefined);
  assert.equal(f.devices.verify("bpd_short", f.install), undefined);
  assert.equal(f.devices.verify(f.install, f.install), undefined);

  const writes = async () => JSON.parse(await readFile(f.paths.devices, "utf8")).devices[0].lastUsedAt;
  // The first use is written; let the queued write finish.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const first = await writes();
  assert.equal(first, new Date(f.clock.now).toISOString());
  f.clock.now += lastUsedWriteInterval - 1;
  f.devices.verify(paired.token, f.install);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await writes(), first);
  f.clock.now += 1;
  f.devices.verify(paired.token, f.install);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await writes(), new Date(f.clock.now).toISOString());

  // Another install token (a rotate) invalidates every device, even before the files are cleared.
  const rotated = generateApiToken();
  assert.equal(f.devices.verify(paired.token, rotated), undefined);
  assert.deepEqual(f.devices.list(rotated), []);
  // A code minted before the rotate does not pair after it.
  const before = await f.code();
  assert.equal((await f.pairing.redeem(before, undefined, "Paired device", rotated)).status, "invalid");

  await clearPairing(f.dataDir);
  assert.equal(f.devices.verify(paired.token, f.install), undefined);
  assert.deepEqual(JSON.parse(await readFile(f.paths.pairCode, "utf8")), {});
});

test("revoking removes the device at once and a revoked device is not brought back by a late use record", async (t) => {
  const f = await fixture(t);
  const a = (await f.redeem(await f.code(), "A")) as { id: string; token: string };
  const b = (await f.redeem(await f.code(), "B")) as { id: string; token: string };
  f.devices.verify(a.token, f.install);
  assert.equal(await f.devices.revoke(a.id, f.install), true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(f.devices.verify(a.token, f.install), undefined);
  assert.deepEqual(f.devices.list(f.install).map((device) => device.id), [b.id]);
  assert.equal(await f.devices.revoke(a.id, f.install), false);
});
