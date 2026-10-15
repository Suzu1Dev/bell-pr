import test from "node:test";
import assert from "node:assert/strict";
import { coachLimits, type CoachDebrief } from "./coach.js";

test("a coach debrief stays within its caps", () => {
  const debrief: CoachDebrief = {
    at: "2026-10-15T00:00:00.000Z",
    locale: "en",
    runIds: ["run-1"],
    recurring: { dimension: "tests", quotes: ["Please add a test for the exhausted case."] },
    drills: [{ context: "c", optionA: "a", optionB: "b", question: "q", reveal: "r" }],
    nextStep: "Write the exhausted-retries test before the next PR.",
  };
  assert.ok(debrief.runIds.length <= coachLimits.runIds);
  assert.deepEqual(
    [coachLimits.runIds, coachLimits.quotes, coachLimits.drills, coachLimits.nextStepChars, coachLimits.debriefs],
    [20, 3, 3, 300, 5],
  );
  assert.deepEqual(
    [coachLimits.contextChars, coachLimits.optionChars, coachLimits.questionChars, coachLimits.revealChars],
    [600, 1200, 300, 1200],
  );
});
