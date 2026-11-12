/** How often one person may ask (collab-limits.ts), on a clock the test sets. */
import test from "node:test";
import assert from "node:assert/strict";
import { PersonLimit } from "./collab-limits.js";

test("a person's calls are counted within a sliding window, each person alone", () => {
  let now = 1_000_000;
  const limit = new PersonLimit(3, 60_000, () => now);
  const take = (id: string, at: number) => {
    now = 1_000_000 + at;
    return limit.take(id);
  };
  assert.deepEqual([take("m-a", 0), take("m-a", 10_000), take("m-a", 20_000)], [
    undefined,
    undefined,
    undefined,
  ]);
  // Over the limit: the seconds until the oldest counted call is a minute old, rounded up.
  assert.equal(take("m-a", 20_000), 40);
  assert.equal(take("m-a", 59_001), 1);
  assert.equal(take("m-a", 59_999), 1);
  // Somebody else is not held up, nor is a name every object has.
  assert.equal(take("m-b", 59_999), undefined);
  for (const id of ["__proto__", "constructor"]) assert.equal(take(id, 59_999), undefined);
  // The refused calls were not counted: one place is free as the first call leaves the window.
  assert.equal(take("m-a", 60_000), undefined);
  assert.equal(take("m-a", 60_000), 10);
  assert.equal(take("m-a", 70_000), undefined);
  assert.equal(take("m-a", 79_999), 1);
});
