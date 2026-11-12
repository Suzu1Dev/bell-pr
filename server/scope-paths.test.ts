import assert from "node:assert/strict";
import { test } from "node:test";
import {
  baseScopePath,
  claimableScope,
  pathsMeet,
  scopeHolds,
  scopeParents,
  scopesHolding,
  splitScope,
} from "./scope-paths.js";

/** Scopes from a few names that sort around "/" and differ only in case. */
function scopes(seed: number, count: number) {
  const parts = ["a", "A", "b", "B", "a-b", "a.b", "a b", "ab", "a!", "a0"];
  return Array.from({ length: count }, () =>
    Array.from({ length: 1 + ((seed = (seed * 48_271) % 2_147_483_647) % 4) }, () =>
      parts[(seed = (seed * 48_271) % 2_147_483_647) % parts.length],
    ).join("/"),
  );
}

test("scopeParents links two scopes exactly when they meet", () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const list = scopes(seed, 1 + (seed % 30));
    const parents = scopeParents(list);
    const reaches = (from: number, to: number) => {
      for (let at = from; at >= 0; at = parents[at]) if (at === to) return true;
      return false;
    };
    for (let i = 0; i < list.length; i += 1)
      for (let j = i + 1; j < list.length; j += 1)
        assert.equal(reaches(i, j) || reaches(j, i), pathsMeet(list[i], list[j]), `${list[i]} | ${list[j]}`);
  }
});

test("scopeParents never links a scope to one that merely shares a prefix", () => {
  assert.deepEqual(scopeParents(["a/b", "a-b", "a", "a b", "A/B/c", "ab"]), [2, -1, -1, -1, 0, -1]);
  assert.deepEqual(scopeParents([]), []);
});

test("scopesHolding answers as scopeHolds does for every file", () => {
  const files = [...scopes(99, 200), "a/b/c.ts", "A", "a/", "\na", "a/\u0007", "ab/c"];
  for (let seed = 1; seed <= 50; seed += 1) {
    const list = scopes(seed, 1 + (seed % 5));
    const holds = scopesHolding(list);
    for (const file of files)
      assert.equal(holds(file), list.some((scope) => scopeHolds(scope, file)), `${list} | ${file}`);
  }
});

test("line-range scopes canonicalize and allow non-overlapping edits on the same file", () => {
  assert.equal(claimableScope("src/app.ts#L10-L45"), "src/app.ts#L10-L45");
  assert.equal(claimableScope("src/app.ts#l12-30"), "src/app.ts#L12-L30");
  assert.equal(claimableScope("src/app.ts#L8"), "src/app.ts#L8-L8");
  assert.equal(claimableScope("src/app.ts#L30-L10"), undefined);
  assert.equal(claimableScope("src/app.ts#L0-L5"), undefined);
  assert.deepEqual(splitScope("src/app.ts#L10-L45"), { path: "src/app.ts", start: 10, end: 45 });
  assert.equal(baseScopePath("src/app.ts#L10-L45"), "src/app.ts");

  // Non-overlapping ranges on the same file do not meet.
  assert.equal(pathsMeet("src/app.ts#L1-L20", "src/app.ts#L21-L50"), false);
  // Overlapping ranges on the same file (case-insensitive) do meet.
  assert.equal(pathsMeet("src/app.ts#L1-L25", "SRC/APP.TS#L25-L50"), true);
  // Whole-file or parent-folder hold meets any range inside it.
  assert.equal(pathsMeet("src/app.ts", "src/app.ts#L10-L20"), true);
  assert.equal(pathsMeet("src", "src/app.ts#L10-L20"), true);
  assert.equal(scopeHolds("src/app.ts#L10-L20", "src/app.ts#L15-L18"), true);
  assert.equal(scopeHolds("src/app.ts#L10-L20", "src/app.ts#L25-L30"), false);
});
