import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import {
  reviewabilitySnapshot,
  weakenedTests,
  type ReviewabilityBand,
  type ReviewabilitySnapshot as Snapshot,
} from "../../shared/reviewability";
import { getDemo } from "../demo";
import draft from "../i18n/en/draft";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import ReviewabilitySnapshot, {
  bandTone,
  reasonLines,
  reasonsToSave,
  validReason,
  type ReviewabilitySnapshotProps,
} from "./ReviewabilitySnapshot";

const demo = getDemo("en");
const demoSnapshot = reviewabilitySnapshot({
  files: demo.files,
  mergedSizes: demo.mergedSizes,
});

const testPatch = [
  "@@ -1,6 +1,6 @@",
  " test('retries', () => {",
  "-  expect(retry()).toBe(3);",
  "+  it.skip('flaky', () => {});",
  " });",
].join("\n");
const weakFiles = [
  { path: "tests/retry.test.ts", additions: 1, deletions: 1, patch: testPatch },
  { path: "tests/old.test.ts", additions: 0, deletions: 20, status: "deleted" },
];
const weakened = weakenedTests(weakFiles);

const view = (props: Partial<ReviewabilitySnapshotProps> = {}) =>
  createElement(ReviewabilitySnapshot, {
    snapshot: demoSnapshot,
    weakened: [],
    reasons: {},
    ...props,
  });
const english = (props: Partial<ReviewabilitySnapshotProps> = {}) => {
  const html = renderEn(view(props));
  assertNoHan(html);
  return html;
};
const numbers = (html: string) =>
  Object.fromEntries(
    [...html.matchAll(/<div><dt>([^<]+)<\/dt><dd>([^<]+)<\/dd><\/div>/g)].map((match) => [match[1], match[2]]),
  );

test("the snapshot of the sample shows its numbers, a green band labelled as BELL's default, and the project's sizes", () => {
  assert.equal(demoSnapshot.band, "small");
  const html = english({ onAskSplit() {} });
  assert.match(html, /<h3 id="reviewability-[^"]+"><svg[\s\S]*?<\/svg> How reviewable is this change\?<\/h3>/);
  assert.match(html, /<span class="reviewability-band is-ok" title="BELL PR&#x27;s size bands are defaults/);
  assert.match(html, />Small · BELL PR default<\/span>/);
  assert.deepEqual(numbers(html), {
    "Changed lines": String(demoSnapshot.changedLines),
    Files: String(demoSnapshot.files),
    "Test files changed": String(demoSnapshot.testFilesChanged),
    "New dependencies": "0",
    "Outside the plan": "0",
    "Whitespace-only changes": String(demoSnapshot.whitespaceOnly.length),
  });
  assert.match(html, /Lockfiles and generated files are not counted\./);
  assert.match(html, /<h4>The project&#x27;s last merged pull requests<\/h4><ul><li>#118: \+64 −12 in 4 files<\/li><li>#121: \+23 −5 in 2 files<\/li><li>#125: \+140 −31 in 6 files<\/li><\/ul>/);
  assert.match(html, /<h4>Is this one logical change\?<\/h4>/);
  assert.match(html, /<button type="button" class="button secondary"><svg[\s\S]*?lucide-split[\s\S]*?<\/svg> Ask how to split it<\/button>/);
  // No Ask button without a handler (the demo hides it).
  assert.doesNotMatch(english(), /Ask how to split it/);
  assert.match(english({ snapshot: { ...demoSnapshot, mergedSizes: undefined } }), /The sizes of the project&#x27;s recent merged pull requests were not read\./);
});

test("each band has its chip and colour", () => {
  const expected: Record<ReviewabilityBand, [string, string]> = {
    small: ["is-ok", "Small"],
    medium: ["is-warn", "Medium"],
    large: ["is-warn", "Large"],
    "very-large": ["is-alert", "Very large"],
  };
  for (const [band, [tone, label]] of Object.entries(expected) as [ReviewabilityBand, [string, string]][]) {
    assert.equal(`is-${bandTone[band]}`, tone);
    const html = english({ snapshot: { ...demoSnapshot, band } });
    assert.match(html, new RegExp(`<span class="reviewability-band ${tone}"[^>]*>${label} · BELL PR default</span>`), band);
  }
});

test("new dependencies, files outside the plan and whitespace-only changes are named", () => {
  const snapshot: Snapshot = {
    ...demoSnapshot,
    newDependencies: [{ path: "package.json", name: "p-retry" }],
    outsidePlan: ["src/extra.ts", "docs/notes.md"],
    whitespaceOnly: ["src/types.ts"],
  };
  const html = english({ snapshot });
  assert.match(html, /<p class="reviewability-list"><strong>New dependencies<\/strong> p-retry<\/p>/);
  assert.match(html, /<strong>Outside the plan<\/strong> src\/extra\.ts, docs\/notes\.md/);
  assert.match(html, /<strong>Whitespace-only changes<\/strong> src\/types\.ts/);
});

test("each weakened test asks for a one-line reason; Save sends the valid ones", () => {
  assert.deepEqual(
    weakened.map((item) => item.id),
    ["tests/retry.test.ts#-2", "tests/retry.test.ts#2", "tests/old.test.ts#0"],
  );
  const html = english({ weakened, onSaveReasons() {} });
  assert.match(html, /<h4>Weakened tests<\/h4>/);
  assert.match(html, /<code>tests\/retry\.test\.ts:2, added<\/code><code class="reviewability-weakened-text">it\.skip\(&#x27;flaky&#x27;, \(\) =&gt; \{\}\);<\/code>/);
  assert.match(html, /<code>tests\/retry\.test\.ts:2, removed<\/code><code class="reviewability-weakened-text">expect\(retry\(\)\)\.toBe\(3\);<\/code>/);
  assert.match(html, /<code>tests\/old\.test\.ts: test file deleted<\/code>/);
  assert.equal(html.match(/<label for="reviewability-reason-[^"]+">Your reason<\/label>/g)?.length, 3);
  assert.equal(html.match(/maxLength="300"/g)?.length, 3);
  // Nothing changed yet: Save waits.
  assert.match(html, /<button type="button" class="button primary" disabled="">Save reasons<\/button>/);
  assert.doesNotMatch(html, /Offered for your Testing section/);
  // Without a save handler the fields are read-only.
  assert.equal(english({ weakened }).match(/<input[^>]*disabled=""/g)?.length, 3);
  assert.doesNotMatch(english({ weakened }), /Save reasons/);
});

test("saved reasons are offered for the Testing section, with a copy button", () => {
  const reasons = {
    "tests/retry.test.ts#2": "The flaky test waits on a real network.",
    "tests/old.test.ts#0": "short",
  };
  const html = english({ weakened, reasons, onSaveReasons() {} });
  assert.match(html, /<p>Offered for your Testing section<\/p><pre>- `tests\/retry\.test\.ts:2`: The flaky test waits on a real network\.<\/pre>/);
  assert.match(html, /Copy for the Testing section<\/button>/);
  assert.equal(reasonLines(weakened, reasons), "- `tests/retry.test.ts:2`: The flaky test waits on a real network.");
  assert.equal(
    reasonLines(weakened, { "tests/old.test.ts#0": "Replaced by the new suite." }),
    "- `tests/old.test.ts`: Replaced by the new suite.",
  );
  assert.equal(validReason("too short"), false);
  assert.equal(validReason("now three words"), true);
  assert.equal(validReason("改用新的測試"), true);
});

test("the compact form shows the band, the numbers and how many reasons are missing", () => {
  const html = english({ compact: true, weakened, onAskSplit() {} });
  assert.match(html, /<section class="reviewability is-compact"/);
  assert.match(html, /Small · BELL PR default/);
  assert.match(html, /<p class="reviewability-missing">3 weakened tests need a reason\.<\/p>/);
  assert.doesNotMatch(html, /Ask how to split it|Save reasons|last merged/);
  assert.doesNotMatch(
    english({ compact: true, weakened, reasons: Object.fromEntries(weakened.map((item) => [item.id, "It is now covered elsewhere."])) }),
    /reviewability-missing/,
  );
  assert.match(english({ compact: true, weakened: weakened.slice(0, 1) }), /1 weakened test needs a reason\./);
});

test("the zh-TW snapshot keeps the numbers and names the band in its own words", () => {
  const html = renderZh(view({ weakened, onSaveReasons() {}, onAskSplit() {} }));
  assert.match(html, /這份變更好審查嗎？/);
  assert.match(html, />小 · BELL PR 預設</);
  assert.match(html, /#118：4 個檔案 \+64 −12/);
  assert.match(html, /被削弱的測試/);
  assert.match(html, /儲存理由/);
});

test("saving sends every weakened item, an emptied field as \"\" so the server removes its reason", () => {
  const [first, second, third] = weakened;
  assert.ok(first && second && third);
  assert.deepEqual(
    reasonsToSave(weakened, {
      [first.id]: "  The flaky test waits on a real network.  ",
      [second.id]: "",
      // Too short: Save is off while it is, and it is never sent.
      [third.id]: "too short",
    }),
    { [first.id]: "The flaky test waits on a real network.", [second.id]: "" },
  );
  // A field never typed in is sent empty too: nothing is saved for it.
  assert.deepEqual(
    reasonsToSave(weakened, {}),
    Object.fromEntries(weakened.map((item) => [item.id, ""])),
  );
});

test("a snapshot with independent parts says so and offers to split now, and the button needs a handler", () => {
  const text = draft.reviewability;
  const parts = { ...demoSnapshot, parts: 2 };
  const html = english({ snapshot: parts, onSplit() {}, onAskSplit() {} });
  assert.ok(html.includes(`<p>${text.parts({ count: 2 })}</p>`));
  assert.match(html, new RegExp(`<button type="button" class="button primary"><svg[\\s\\S]*?${text.splitNow}</button>`));
  assert.ok(html.includes(text.askSplit));
  // Without a handler the sentence stays, and no split button appears.
  const withoutHandler = english({ snapshot: parts });
  assert.ok(withoutHandler.includes(text.parts({ count: 2 })));
  assert.ok(!withoutHandler.includes(text.splitNow));
  // A change with no parts gets no sentence; the split button stays when a handler is given (the dialog starts empty).
  const noParts = english({ onSplit() {} });
  assert.ok(!noParts.includes(text.parts({ count: 2 })));
  assert.ok(noParts.includes(text.splitNow));
});
