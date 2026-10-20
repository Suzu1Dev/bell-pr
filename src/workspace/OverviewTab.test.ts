import assert from "node:assert/strict";
import test from "node:test";
import { getDemo } from "../demo";
import en from "../i18n/en/workspace";
import zhTW from "../i18n/zh-TW/workspace";
import type { Run } from "../types";
import { contributionBrief } from "./OverviewTab";

test("a learn-by-hand run's brief says the person and the guide find how far the problem reaches, not a team", () => {
  const run: Run = { ...getDemo("en").run, id: "run-1", learnByHand: true };
  const before = contributionBrief(run, en.brief)?.before ?? "";
  assert.match(before, /you and the guide find how far it reaches while you plan/);
  assert.doesNotMatch(before, /team/);
  assert.match(contributionBrief(run, zhTW.brief)?.before ?? "", /由你和嚮導在規劃時確認/);
  // An agent run's team still confirms it while planning.
  assert.equal(contributionBrief({ ...run, learnByHand: undefined }, en.brief)?.before, en.brief.before);
});
