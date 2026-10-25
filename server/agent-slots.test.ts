import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
  AgentSlots,
  parseActiveRunLimit,
  parseAgentProcessLimit,
} from "./agent-slots.js";
import { AppError } from "./types.js";
import { withLocale } from "./i18n/index.js";

test("slots respect the limit and grant waiters in FIFO order", async () => {
  const slots = new AgentSlots(2);
  const first = await slots.acquire();
  const second = await slots.acquire();
  assert.equal(slots.active, 2);
  const order: string[] = [];
  const third = slots.acquire().then((release) => {
    order.push("third");
    return release;
  });
  const fourth = slots.acquire().then((release) => {
    order.push("fourth");
    return release;
  });
  await delay(10);
  assert.equal(slots.waiting, 2);
  assert.deepEqual(order, []);
  first();
  const releaseThird = await third;
  assert.deepEqual(order, ["third"]);
  assert.equal(slots.active, 2);
  assert.equal(slots.waiting, 1);
  second();
  await fourth;
  assert.deepEqual(order, ["third", "fourth"]);
  assert.equal(slots.active, 2);
  releaseThird();
  (await fourth)();
  assert.equal(slots.active, 0);
  assert.equal(slots.waiting, 0);
});

test("aborting while waiting rejects and does not leak a slot", async () => {
  const slots = new AgentSlots(1);
  const release = await slots.acquire();
  const controller = new AbortController();
  const waiting = slots.acquire(controller.signal);
  assert.equal(slots.waiting, 1);
  controller.abort();
  await assert.rejects(waiting, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 409);
    assert.equal(error.message, "工作已取消。");
    return true;
  });
  assert.equal(slots.waiting, 0);
  assert.equal(slots.active, 1);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(slots.acquire(aborted.signal), /已取消/);
  release();
  assert.equal(slots.active, 0);
  (await slots.acquire())();
  assert.equal(slots.active, 0);
});

test("a waiter cancelled from another locale is told so in its own locale", async () => {
  const slots = new AgentSlots(1);
  const release = await slots.acquire();
  const controller = new AbortController();
  // An English run waits for a slot; a request in zh-TW cancels it.
  const waiting = withLocale("en", () => slots.acquire(controller.signal));
  withLocale("zh-TW", () => controller.abort());
  await assert.rejects(waiting, {
    statusCode: 409,
    message: "The operation was cancelled.",
  });
  release();
});

test("releasing twice frees only one slot", async () => {
  const slots = new AgentSlots(1);
  const release = await slots.acquire();
  release();
  release();
  assert.equal(slots.active, 0);
  const again = await slots.acquire();
  assert.equal(slots.active, 1);
  again();
  again();
  assert.equal(slots.active, 0);
});

test("raising the limit grants waiters at once; lowering it waits for running work", async () => {
  const slots = new AgentSlots(1);
  const first = await slots.acquire();
  const order: string[] = [];
  const waiting = ["second", "third", "fourth"].map((name) =>
    slots.acquire().then((release) => {
      order.push(name);
      return release;
    }),
  );
  await delay(10);
  assert.equal(slots.waiting, 3);
  slots.setLimit(3);
  assert.equal(slots.limit, 3);
  const second = await waiting[0];
  const third = await waiting[1];
  // FIFO order, and only as many as the new limit allows.
  assert.deepEqual(order, ["second", "third"]);
  assert.equal(slots.active, 3);
  assert.equal(slots.waiting, 1);

  // Lowering never stops running work: the waiter gets a slot only once
  // fewer than the new limit are active.
  slots.setLimit(1);
  first();
  second();
  await delay(10);
  assert.deepEqual(order, ["second", "third"]);
  assert.equal(slots.active, 1);
  third();
  const fourth = await waiting[2];
  assert.deepEqual(order, ["second", "third", "fourth"]);
  assert.equal(slots.active, 1);
  fourth();
  assert.equal(slots.active, 0);
  assert.throws(() => slots.setLimit(0), /positive integer/);
  assert.throws(() => slots.setLimit(1.5), /positive integer/);
  assert.equal(slots.limit, 1);
});

test("BELLPR_MAX_AGENT_PROCESSES defaults to 3 and rejects values outside 1-32", () => {
  assert.equal(parseAgentProcessLimit(undefined), 3);
  assert.equal(parseAgentProcessLimit("1"), 1);
  assert.equal(parseAgentProcessLimit("32"), 32);
  withLocale("en", () => {
    for (const invalid of ["0", "33", "two", "", "2.5"])
      assert.throws(() => parseAgentProcessLimit(invalid), /1 and 32/);
  });
  assert.throws(() => new AgentSlots(0), /positive integer/);
});

test("BELLPR_MAX_ACTIVE_RUNS defaults to 2 and rejects values outside 1-8", () => {
  assert.equal(parseActiveRunLimit(undefined), 2);
  assert.equal(parseActiveRunLimit("1"), 1);
  assert.equal(parseActiveRunLimit("8"), 8);
  withLocale("en", () => {
    for (const invalid of ["0", "9", "two", "", "1.5"])
      assert.throws(() => parseActiveRunLimit(invalid), /1 and 8/);
  });
});
