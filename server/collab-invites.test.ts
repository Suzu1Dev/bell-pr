/** Group invites with an injected clock (collab-invites.ts). Synthetic codes and tokens only. */
import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";
import { CollabInvites, inviteTtl, maxInvites } from "./collab-invites.js";
import { failureLimit, failureWindow, firstLockDuration, normalizePairCode } from "./pairing.js";

const start = Date.UTC(2026, 0, 1);
const wrong = "0000-0000";
/** Everything an instance keeps in memory, as text. */
const kept = (box: CollabInvites) => inspect(box, { depth: 8 });

function invites() {
  let now = start;
  return {
    invites: new CollabInvites(() => now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("a code works once, however it is typed, and carries what it stands for", () => {
  const { invites: box } = invites();
  const ben = box.create({ name: "Ben", admin: true })!;
  assert.match(ben.code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(ben.expiresAt, start + inviteTtl);
  const typed = ` ${normalizePairCode(ben.code)!.toLowerCase()} `;
  assert.deepEqual(box.redeem(typed, "install"), {
    status: "ok",
    invite: { name: "Ben", admin: true },
  });
  assert.deepEqual(box.redeem(ben.code, "install"), { status: "invalid" });
  // Only the sha256 of a code is kept.
  const other = box.create({ name: "Cy" })!;
  assert.equal(kept(box).includes(normalizePairCode(other.code)!), false);
  assert.match(kept(box), /Cy/);
});

test("a code lives 10 minutes, and an expired one makes room again", () => {
  const { invites: box, advance } = invites();
  const early = box.create({ name: "Ben" })!;
  advance(inviteTtl - 1);
  assert.equal(box.redeem(early.code, "install").status, "ok");
  const late = box.create({ name: "Cy" })!;
  advance(inviteTtl);
  assert.deepEqual(box.redeem(late.code, "install"), { status: "invalid" });

  for (let count = 0; count < maxInvites; count++) assert.ok(box.create({ name: `P${count}` }));
  assert.equal(maxInvites, 20);
  assert.equal(box.create({ name: "One too many" }), undefined);
  advance(inviteTtl);
  assert.ok(box.create({ name: "Room again" }));
});

test("10 wrong codes in 15 minutes lock that caller alone, for 15 minutes, and void nobody's code", () => {
  const { invites: box, advance } = invites();
  const forPhone = box.create({ name: "Phone" })!;
  const forLaptop = box.create({ name: "Laptop" })!;
  for (let attempt = 1; attempt < failureLimit; attempt++)
    assert.deepEqual(box.redeem(wrong, "dev_phone"), { status: "invalid" }, String(attempt));
  assert.deepEqual(box.redeem(wrong, "dev_phone"), {
    status: "locked",
    retryAfter: firstLockDuration / 1000,
  });
  // Locked: not even the right code, and the code stays for later.
  advance(60_000);
  assert.deepEqual(box.redeem(forPhone.code, "dev_phone"), {
    status: "locked",
    retryAfter: firstLockDuration / 1000 - 60,
  });
  // Another caller is neither locked nor robbed of their code.
  assert.equal(box.redeem(forLaptop.code, "dev_laptop").status, "ok");
  assert.deepEqual(box.redeem(wrong, "install"), { status: "invalid" });
  // The invite (10 minutes) outlasts the wait only if made later; a new one works after the lock.
  advance(firstLockDuration - 60_000);
  assert.deepEqual(box.redeem(forPhone.code, "dev_phone"), { status: "invalid" });
  const again = box.create({ name: "Phone" })!;
  assert.equal(box.redeem(again.code, "dev_phone").status, "ok");
});

test("wrong codes spread over more than 15 minutes, or followed by a right one, never lock", () => {
  const { invites: box, advance } = invites();
  for (let attempt = 0; attempt < failureLimit * 2; attempt++) {
    assert.deepEqual(box.redeem(wrong, "dev_phone"), { status: "invalid" });
    advance(failureWindow / (failureLimit - 1));
  }
  for (let round = 0; round < 3; round++) {
    for (let attempt = 1; attempt < failureLimit; attempt++) box.redeem("not a code", "install");
    assert.equal(box.redeem(box.create({ name: "Ben" })!.code, "install").status, "ok");
  }
});

test("a self invite keeps the caller's own token only while the code lives", () => {
  const { invites: box, advance } = invites();
  const self = { id: "m-0123456789", token: `bpc_${"t".repeat(43)}` };
  const used = box.create({ self })!;
  assert.deepEqual(box.redeem(used.code, "dev_phone"), { status: "ok", invite: { self } });
  assert.equal(kept(box).includes(self.token), false);
  box.create({ self });
  assert.equal(kept(box).includes(self.token), true);
  advance(inviteTtl);
  // Any later call drops what expired.
  box.redeem(wrong, "install");
  assert.equal(kept(box).includes(self.token), false);
});
