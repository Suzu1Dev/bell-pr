import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { getDemo } from "../../demo";
import { mount } from "../../mission/test-dom";
import { renderEn } from "../../test-utils/render";
import type { DiffFile, Run } from "../../types";
import {
  checkSettings,
  closeCheckPanel,
  markCheckOff,
  openCheckPanel,
  setCheckSettingsForTests,
  useCheckPanel,
  useUnderstanding,
  type Understanding,
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

test("a real run's check is read again when a walkthrough becomes ready, the reports change or a lock is refused", async () => {
  const reads: string[] = [];
  const realFetch = globalThis.fetch;
  const view = { required: true, passed: false, stale: false, plan: [], missing: [], changeFingerprint: "fp" };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/understanding/answers"))
      return new Response(JSON.stringify({ error: "Reload the check and answer again." }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    if (url.endsWith("/understanding") && !init?.method) reads.push(url);
    const body = url.endsWith("/app-settings") ? { settings: {}, lockedBy: {} } : { understanding: view };
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const run = (reviewer: string) =>
    ({ id: "run-1", repoId: "repo-1", status: "review", agents: [], reports: { reviewer } }) as unknown as Run;
  const file = (walkthroughStatus: DiffFile["walkthroughStatus"]) =>
    ({ path: "src/a.ts", fingerprint: "a1", explanationStatus: "failed", walkthroughStatus }) as DiffFile;
  let latest: Understanding | undefined;
  function Live({ value, files }: { value: Run; files: DiffFile[] }) {
    latest = useUnderstanding(value, files, { demo: false, setRun() {} });
    return null;
  }
  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  const mounted = await mount(createElement(Live, { value: run("Looks fine."), files: [file("pending")] }));
  try {
    await settle();
    assert.equal(reads.length, 1);
    // A walkthrough being written asks no new question yet.
    await mounted.rerender(createElement(Live, { value: run("Looks fine."), files: [file("generating")] }));
    await settle();
    assert.equal(reads.length, 1);
    // A ready walkthrough's "Check yourself" can replace the file's question.
    await mounted.rerender(createElement(Live, { value: run("Looks fine."), files: [file("ready")] }));
    await settle();
    assert.equal(reads.length, 2);
    // A re-review can rank other files first.
    await mounted.rerender(createElement(Live, { value: run("src/a.ts needs a test."), files: [file("ready")] }));
    await settle();
    assert.equal(reads.length, 3);
    // A refused lock reads the check again, so the current questions show.
    await assert.rejects(async () => act(async () => latest!.saveAnswers({ summary: "A summary.", items: [] })));
    await settle();
    assert.equal(reads.length, 4);
  } finally {
    await mounted.unmount();
    globalThis.fetch = realFetch;
  }
});
