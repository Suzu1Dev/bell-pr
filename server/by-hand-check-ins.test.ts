// The repeated-failure card posts a check-in when it is shown, and the
// person may open the guide panel many times while the same failure stands:
// the server records it once per step until BELL's next test run, so the
// run's record and the learning page count one stuck moment, not one per
// visit. Other check-ins and every exit are recorded as before.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestRun } from "../shared/by-hand.js";
import { checkIn } from "./by-hand.js";
import type { Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

function writingRun() {
  const run = {
    id: "lbh-check-ins",
    status: "review",
    learnByHand: true,
    byHand: {
      plan: { steps: [{ id: "s1", title: "Retry the GET", files: [] }, { id: "s2", title: "Test it", files: [] }], savedAt: "2026-10-20T00:00:00.000Z", confirmedAt: "2026-10-20T00:01:00.000Z" },
      tests: [] as TestRun[],
    },
  } as unknown as Run;
  let saves = 0;
  const ctx = {
    lock: <T>(_id: string, fn: () => Promise<T>) => fn(),
    run: () => run,
    store: { save: async () => void saves++ },
  } as unknown as WorkbenchContext;
  return { run, ctx, saves: () => saves };
}

const failedRun = (at: string, reported?: true): TestRun => ({
  at,
  command: "npm test",
  changeFingerprint: "f",
  outcome: "failed",
  exitCode: 1,
  ms: 10,
  ...(reported ? { reported } : {}),
});

test("a repeated-failure check-in is recorded once per step until BELL's next test run", async () => {
  const { run, ctx, saves } = writingRun();
  const signals = () => run.byHand!.checkIns!.map((entry) => [entry.stepId, entry.signal, entry.choice]);
  run.byHand!.tests = [failedRun("2026-10-20T00:02:00.000Z"), failedRun("2026-10-20T00:03:00.000Z"), failedRun("2026-10-20T00:04:00.000Z")];
  await checkIn(ctx, run.id, { stepId: "s1", signal: "repeat-failure" });
  // The panel shown again: the same card, the same step, no new run.
  await checkIn(ctx, run.id, { stepId: "s1", signal: "repeat-failure" });
  await checkIn(ctx, run.id, { stepId: "s1", signal: "repeat-failure" });
  assert.deepEqual(signals(), [["s1", "repeat-failure", undefined]]);
  assert.equal(saves(), 1);
  // Another step, or no step, is its own card.
  await checkIn(ctx, run.id, { stepId: "s2", signal: "repeat-failure" });
  await checkIn(ctx, run.id, { signal: "repeat-failure" });
  await checkIn(ctx, run.id, { signal: "repeat-failure" });
  assert.equal(signals().length, 3);
  // The person's own result is no new run; a check-in with an exit is always recorded.
  run.byHand!.tests!.push(failedRun(new Date(Date.now() - 1000).toISOString(), true));
  await checkIn(ctx, run.id, { stepId: "s1", signal: "repeat-failure" });
  await checkIn(ctx, run.id, { stepId: "s1", signal: "button", choice: "smaller" });
  await checkIn(ctx, run.id, { stepId: "s1", signal: "button", choice: "smaller" });
  assert.equal(signals().filter(([step, signal]) => step === "s1" && signal === "repeat-failure").length, 1);
  assert.deepEqual(run.byHand!.exits!.map((entry) => entry.exit), ["smaller", "smaller"]);
  // After BELL's next test run the card is a new stuck moment.
  run.byHand!.tests!.push(failedRun(new Date(Date.now() + 1000).toISOString()));
  await checkIn(ctx, run.id, { stepId: "s1", signal: "repeat-failure" });
  assert.equal(signals().filter(([step, signal]) => step === "s1" && signal === "repeat-failure").length, 2);
});
