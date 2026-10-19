import assert from "node:assert/strict";
import test from "node:test";
import type { DiffFile } from "../../types";
import { nextWalkthrough } from "./useWalkthroughs";

const file = (path: string, walkthroughStatus?: DiffFile["walkthroughStatus"]) =>
  ({ path, walkthroughStatus }) as DiffFile;

test("the walkthrough asked for next is one already being written, then the file being read, then the rest in order", () => {
  const files = [file("a.ts", "ready"), file("b.ts", "pending"), file("c.ts", "pending"), file("d.ts", "unavailable")];
  assert.equal(nextWalkthrough(files, "c.ts")?.path, "c.ts");
  assert.equal(nextWalkthrough(files, "a.ts")?.path, "b.ts");
  // Reopened while one is being written: the request waits for that job.
  assert.equal(nextWalkthrough([...files, file("e.ts", "generating")], "c.ts")?.path, "e.ts");
  assert.equal(nextWalkthrough([file("a.ts", "ready"), file("b.ts", "failed")], "b.ts"), undefined);
});
