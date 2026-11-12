import assert from "node:assert/strict";
import test from "node:test";
import { getDemo } from "../demo";
import { contributionBrief } from "./OverviewTab";

test("an incomplete task brief does not invent an analysis or risks", () => {
  const run = getDemo("en").run;
  const settings = { ...run.contributionSettings!, outcome: "", acceptance: "", constraints: "", targetUser: "" };
  for (const learnByHand of [undefined, true] as const) {
    const brief = contributionBrief({ ...run, contributionSettings: settings, learnByHand });
    assert.equal(brief?.problem, run.prompt);
    assert.equal(brief?.before, "");
    assert.equal(brief?.after, "");
    assert.equal(brief?.motivation, "");
    assert.deepEqual(brief?.risks, []);
    assert.deepEqual(brief?.validation, []);
  }
});

test("the task brief preserves supplied outcomes, criteria and constraints", () => {
  const run = getDemo("en").run;
  const settings = { ...run.contributionSettings!, outcome: "Retry transient failures", acceptance: "Retries stop after three attempts\nNo retry on 401", constraints: "Keep the public API", targetUser: "SDK users" };
  const brief = contributionBrief({ ...run, contributionSettings: settings });
  assert.equal(brief?.after, settings.outcome);
  assert.deepEqual(brief?.validation, settings.acceptance.split("\n"));
  assert.deepEqual(brief?.risks, [settings.constraints]);
  assert.deepEqual(brief?.beneficiaries, [settings.targetUser]);
});
