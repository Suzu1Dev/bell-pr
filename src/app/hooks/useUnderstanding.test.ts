import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { getDemo } from "../../demo";
import { renderEn } from "../../test-utils/render";
import type { Run } from "../../types";
import {
  checkSettings,
  closeCheckPanel,
  markCheckOff,
  openCheckPanel,
  setCheckSettingsForTests,
  useCheckPanel,
  useUnderstanding,
} from "./useUnderstanding";

const demo = getDemo("en");

test("the check is on unless the person turned it off; a variable can only keep it on", () => {
  assert.deepEqual(checkSettings(undefined), { off: false, lockedBy: undefined, tryFirst: true });
  assert.deepEqual(
    checkSettings({ settings: { skipUnderstandingCheck: true, hideTryFirst: true }, lockedBy: {} }),
    { off: true, lockedBy: undefined, tryFirst: false },
  );
  assert.deepEqual(
    checkSettings({
      settings: { skipUnderstandingCheck: false },
      lockedBy: { skipUnderstandingCheck: "BELLPR_REQUIRE_UNDERSTANDING_CHECK" },
    }),
    { off: false, lockedBy: "BELLPR_REQUIRE_UNDERSTANDING_CHECK", tryFirst: true },
  );
});

test("a run approved without passing is marked Check off, and a pass clears the mark", () => {
  const run: Run = { ...demo.run, status: "approved" };
  assert.equal(markCheckOff(run, { passed: false }).understandingCheckOff, true);
  const marked = { ...run, understandingCheckOff: true };
  assert.equal("understandingCheckOff" in markCheckOff(marked, { passed: true }), false);
});

/** What the hooks say, rendered once on the server. */
function Probe({ run, runId }: { run: Run; runId: string }) {
  const check = useUnderstanding(run, demo.files, { demo: true, setRun() {} });
  const mode = useCheckPanel(runId);
  return createElement(
    "pre",
    null,
    JSON.stringify({ required: check.required, off: check.off, passed: check.passed, tryFirst: check.tryFirst, mode: mode ?? null }),
  );
}
const probe = (run: Run, runId = run.id) =>
  JSON.parse(
    renderEn(createElement(Probe, { run, runId })).replace(/^<pre>|<\/pre>$/g, "").replace(/&quot;/g, '"'),
  );

test("the sample's check follows the setting, and the open panel belongs to one run", () => {
  try {
    setCheckSettingsForTests(undefined);
    assert.deepEqual(probe(demo.run), { required: true, off: false, passed: false, tryFirst: true, mode: null });
    setCheckSettingsForTests({ settings: { skipUnderstandingCheck: true, hideTryFirst: true }, lockedBy: {} });
    assert.deepEqual(probe(demo.run), { required: false, off: true, passed: false, tryFirst: false, mode: null });
    // Without a window, opening only records which run's check is open.
    openCheckPanel(demo.run.id, "forecast");
    assert.equal(probe(demo.run).mode, "forecast");
    assert.equal(probe(demo.run, "another-run").mode, null);
    openCheckPanel(demo.run.id);
    assert.equal(probe(demo.run).mode, "check");
    closeCheckPanel();
    assert.equal(probe(demo.run).mode, null);
  } finally {
    setCheckSettingsForTests(undefined);
    closeCheckPanel();
  }
});
