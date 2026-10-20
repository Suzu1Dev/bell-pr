// The Learn-by-hand writing views (DESIGN v1.2 F3-F6, F9): each renders in
// English with no Han characters, says what the run's record says, and a
// run fitted to a project's rules never offers a kind of help outside its
// help set. The dictionaries have the same keys in both locales.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement, type ReactElement } from "react";
import type { ByHandRecord, HelpLock } from "../../../shared/by-hand";
import { changeFingerprint } from "../../../shared/change-fingerprint";
import { assertNoHan, renderEn, renderZh } from "../../test-utils/render";
import type { DiffFile, Run } from "../../types";
import { GuidePanel, type GuidePanelProps } from "./GuidePanel";
import en from "./i18n/en";
import zhTW from "./i18n/zh-TW";
import { PlanWithGuide, type PlanWithGuideProps } from "./PlanWithGuide";
import { ReadyDialog, type ReadyDialogProps } from "./ReadyDialog";
import { YourTurn } from "./YourTurn";

const noop = async () => {};
const at = "2026-10-20T09:00:00.000Z";
const files: DiffFile[] = [
  { path: "src/retry.ts", language: "TypeScript", additions: 4, deletions: 1, status: "modified", patch: "@@ -1 +1,4 @@\n-a\n+b\n+c\n+d\n+e", fingerprint: "f1" },
];
const fingerprint = changeFingerprint([{ path: "src/retry.ts", fingerprint: "f1" }]);
const lock: HelpLock = {
  kinds: ["explain", "answer", "test"],
  at,
  rulesCheckedAt: at,
  rules: [{ kind: "ban", path: "docs/policy.md", line: 3, quote: "We decline AI generated content.", allows: [{ line: 5, quote: "Researching APIs or debugging is fine.", kinds: ["explain", "answer", "test"] }] }],
};
const steps = [
  { id: "s1", title: "Find where retries are counted", doneAt: at },
  { id: "s2", title: "Cap the retries at three", files: ["src/retry.ts"], maxRung: 3 },
];
const run = (byHand: ByHandRecord = {}, extra: Partial<Run> = {}): Run => ({
  id: "run-1",
  repoId: "repo-1",
  title: "Cap the retries",
  prompt: "Cap the retries at three.",
  status: "review",
  branch: "fix/retries",
  baseBranch: "main",
  createdAt: at,
  agents: [{ id: "lead", name: "Lead", role: "lead", status: "complete", detail: "" }],
  logs: [],
  draft: { title: "", body: "" },
  reviewedFiles: [],
  learnByHand: true,
  team: { phase: "developing", planSummary: "", tasks: [], messages: [], config: { provider: "codex", maxTeammates: 2, requirePlanApproval: true } } as unknown as Run["team"],
  byHand,
  ...extra,
});
const html = (element: ReactElement) => {
  const text = renderEn(element);
  assertNoHan(text);
  return text;
};
const apostrophes = (text: string) => text.replaceAll("'", "&#x27;").replaceAll('"', "&quot;");

test("the dictionaries have the same keys in both locales, and the English one no Han", () => {
  const shape = (value: unknown): unknown =>
    typeof value === "object" && value
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]))
      : typeof value;
  assert.deepEqual(shape(zhTW), shape(en));
  assertNoHan(readFileSync(new URL("./i18n/en.ts", import.meta.url), "utf8"));
});

const plan = (record: ByHandRecord, props: Partial<PlanWithGuideProps> = {}, extra: Partial<Run> = {}) =>
  createElement(PlanWithGuide, { run: run(record, extra), onSave: noop, onReveal: noop, onAskQuestions: noop, onConfirm: noop, ...props });
const guidePlan = {
  summary: "Requests retry forever after a timeout.",
  steps: [{ title: "Read the retry loop", files: ["src/retry.ts"] }, { title: "Add a cap", files: [] }],
  readFirst: [{ path: "src/retry.ts", startLine: 10, endLine: 24, why: "Where retries are counted." }],
  at,
};

test("Plan with the guide asks for the person's steps first and keeps the outline folded", () => {
  const first = html(plan({ guidePlan }, {}, { status: "awaiting_plan" }));
  assert.ok(first.includes("Write your own steps first."));
  assert.ok(first.includes("<summary>What the guide read</summary><p>Requests retry forever after a timeout.</p>"));
  assert.match(first, /<code>src\/retry\.ts:10-24<\/code>/);
  assert.ok(first.includes("Folded until you save a step of your own."));
  assert.ok(first.includes(apostrophes("I don't know where to start")));
  assert.doesNotMatch(first, /Read the retry loop/);
  // Nothing written yet: there is no plan to confirm.
  assert.match(first, /<button type="button" class="button primary" disabled=""><svg[\s\S]*?<\/svg>This is my plan<\/button>/);
  assert.match(renderZh(plan({ guidePlan }, {}, { status: "awaiting_plan" })), /和嚮導一起規劃/);
});

test("after a first draft the guide's step names can be shown, and an early reveal says so", () => {
  const saved = { steps: [{ id: "s1", title: "Cap the retries" }], savedAt: at };
  const drafted = html(plan({ guidePlan, plan: saved }));
  assert.ok(drafted.includes(apostrophes("Show the guide's step names")));
  assert.match(drafted, /<button type="button" class="button primary"><svg[\s\S]*?<\/svg>This is my plan<\/button>/);
  const revealed = html(plan({ guidePlan, plan: { ...saved, outlineAt: at, outlineBeforeDraft: true } }));
  assert.ok(revealed.includes("<li>Read the retry loop</li><li>Add a cap</li>"));
  assert.ok(revealed.includes("Shown before your first draft, at your request."));
  // A confirmed plan is the person's: no second confirmation.
  assert.doesNotMatch(html(plan({ guidePlan, plan: { ...saved, confirmedAt: at } })), /This is my plan/);
});

test("a run fitted to rules that don't name planning help keeps the outline closed", () => {
  const fitted = html(plan({ guidePlan, helpLock: lock }, {}, { status: "awaiting_plan" }));
  assert.ok(fitted.includes(apostrophes("doesn't name planning help: the guide's outline stays closed.")));
  assert.doesNotMatch(fitted, /I don&#x27;t know where to start|step names/);
});

test("Your turn shows the run's folder to open, and the first open step", () => {
  const text = html(createElement(YourTurn, { run: run({ plan: { steps, savedAt: at } }), worktreePath: "/home/someone/.bellpr/worktrees/run-1" }));
  assert.ok(text.includes("<code>/home/someone/.bellpr/worktrees/run-1</code>"));
  assert.ok(text.includes(apostrophes("Open this folder in your editor, make your first step's change, save, and come back.")));
  assert.ok(text.includes("First step: Cap the retries at three"));
  // While presenting, the folder is not offered to copy.
  assert.doesNotMatch(html(createElement(YourTurn, { run: run(), worktreePath: "/w/run-1", presenting: true })), /aria-label="Copy"/);
});

const guide = (record: ByHandRecord, props: Partial<GuidePanelProps> = {}, extra: Partial<Run> = {}) =>
  createElement(GuidePanel, {
    run: run(record, extra),
    files,
    onGuide: noop,
    onStep: noop,
    onCheckIn: noop,
    onConfirmTestCommand: noop,
    onRunTests: noop,
    onStopTests: noop,
    onReportTests: noop,
    onLeave: noop,
    ...props,
  });
const thread = [
  { id: "e1", at, kind: "hint", stepId: "s2", rung: 1, text: "Look where the attempt counter grows.", refs: [{ path: "src/retry.ts", line: 12 }] },
  {
    id: "e2",
    at: "2026-10-20T09:05:00.000Z",
    kind: "ask",
    entry: "project",
    question: "Where are timeouts handled?",
    text: "In the request wrapper.",
    quotes: [{ path: "src/http.ts", startLine: 3, endLine: 5, from: "base", text: "if (timedOut) retry();" }],
    removed: 1,
  },
];

test("the guide says the agents can't edit files, lists the steps, and offers the next hint behind the attempt gate", () => {
  const text = html(guide({ plan: { steps, savedAt: at }, thread, hints: { s2: { rung: 1, at, fingerprint } } }));
  assert.ok(text.includes(apostrophes("BELL PR's agents can't edit files in this run.")));
  assert.match(text, /<li aria-current="step"><span>Cap the retries at three<\/span>/);
  for (const chip of ["Setup and tools", "This project", "A concept", "My change"]) assert.ok(text.includes(chip), chip);
  // R1 given at this version: R2 waits for an attempt.
  assert.match(text, /<button type="button" class="button secondary" disabled=""><svg[\s\S]*?<\/svg> Next hint: What applies<\/button>/);
  assert.ok(text.includes("Try something first: change the code, run the tests, or say what you tried."));
  // The thread: newest first, quotes under their header, the filter's note.
  assert.ok(text.indexOf("In the request wrapper.") < text.indexOf("Look where the attempt counter grows."));
  assert.match(text, /<figcaption><code>src\/http\.ts:3-5<\/code> From the repository<\/figcaption><pre><code>if \(timedOut\) retry\(\);<\/code><\/pre>/);
  assert.ok(text.includes("BELL PR removed code from this answer."));
  assert.match(text, /<code>src\/retry\.ts:12<\/code>/);
  assert.ok(text.includes("I&#x27;m stuck"));
  assert.ok(text.includes("The guide can be wrong."));
  assert.match(renderZh(guide({ plan: { steps, savedAt: at } })), /我卡住了/);
});

test("a run whose history withdrew the claim says why instead of the in-run line", () => {
  const text = html(guide({ agentWrites: 1 }));
  assert.doesNotMatch(text, /agents can&#x27;t edit files/);
  assert.ok(text.includes("BELL PR saw agent edits in this run (an agent tried to change files), so it makes no Learn-by-hand claim for it."));
});

test("a fitted run names its help set and offers no hint, test help or review outside it", () => {
  const text = html(
    guide({
      helpLock: lock,
      plan: { steps, savedAt: at },
      hints: { s2: { rung: 2, at: "2026-10-20T08:00:00.000Z", fingerprint: "old" } },
      tests: [{ at, command: "npm test", changeFingerprint: fingerprint, outcome: "failed", exitCode: 1, ms: 900, prediction: "fail" }],
    }),
  );
  assert.ok(text.includes("This run is fitted to the project&#x27;s rules: the guide offers only explanations, answers, and test help."));
  assert.ok(text.includes("Not offered in this run: the project&#x27;s text it is fitted to doesn&#x27;t name planning help and reviews."));
  // R3 is planning help: no rung button, the exits instead.
  assert.doesNotMatch(text, /Next hint: Options/);
  assert.ok(text.includes("No hint left on this step; the exits are below."));
  // Test help is in the set: the failure can be explained.
  assert.ok(text.includes("You predicted Fail; it failed."));
  assert.ok(text.includes("Explain this failure"));
  const noTests = html(guide({ helpLock: { ...lock, kinds: ["explain", "answer"] }, tests: [{ at, command: "npm test", changeFingerprint: fingerprint, outcome: "failed", ms: 9 }] }));
  assert.doesNotMatch(noTests, /Explain this failure/);
});

test("a run that won't publish here says why, and that practising is fine", () => {
  const text = html(
    guide({}, {
      rulesCase: {
        case: "blocked",
        finding: { kind: "ban", path: "CONTRIBUTING.md", line: 3, quote: "No AI-assisted contributions.", contribution: true },
        reach: "assistance",
        reason: "reach",
      },
    }),
  );
  assert.ok(text.includes("BELL PR won&#x27;t publish this run here: its rule restricts AI help itself, or BELL PR can&#x27;t tell what it covers. Practise freely."));
});

test("the Tests card runs only a confirmed command and folds the output", () => {
  const unconfirmed = html(guide({}, { testCommand: { suggestion: "npm test" } }));
  assert.match(unconfirmed, /<input id="by-hand-command" class="text-input" maxLength="300" placeholder="[^"]*" value="npm test"\/>/);
  assert.match(unconfirmed, /<button type="button" class="button primary" disabled=""><svg[\s\S]*?<\/svg>Run the tests<\/button>/);
  assert.ok(unconfirmed.includes("without BELL PR&#x27;s or the AI providers&#x27; keys in its environment"));
  const ran = html(
    guide(
      { tests: [{ at, command: "npm test", changeFingerprint: fingerprint, outcome: "passed", exitCode: 0, ms: 1200, prediction: "fail", outputTail: "1 passing", newFiles: ["coverage/lcov.info"] }] },
      { testCommand: { suggestion: "npm test", confirmed: { command: "npm test", confirmedAt: at } } },
    ),
  );
  assert.ok(ran.includes("Confirmed: npm test"));
  assert.match(ran, /<button type="button" class="button primary"><svg[\s\S]*?<\/svg>Run the tests<\/button>/);
  assert.ok(ran.includes("You predicted Fail; it passed."));
  assert.ok(ran.includes("BELL PR sees 1 new file your tests wrote: coverage/lcov.info"));
  assert.ok(ran.includes("<details><summary>Output</summary><pre>1 passing</pre></details>"));
  assert.doesNotMatch(ran, /Explain this failure/);
});

const ready = (record: ByHandRecord, props: Partial<ReadyDialogProps> = {}) =>
  createElement(ReadyDialog, { run: run(record), files, open: true, onClose() {}, onReady: noop, ...props });

test("Ready for review states the version's facts and offers the guide's review", () => {
  const text = html(ready({}));
  assert.ok(text.includes("1 file changed, +4 −1."));
  assert.ok(text.includes("Not run since your last edit."));
  assert.match(text, /<input type="checkbox" checked=""\/><span class="mission-plan-copy"><strong>Ask the guide to review it<\/strong><small>The guide reads your change/);
  assert.ok(text.includes("The review takes about 2 agent turns."));
  assert.ok(text.includes(apostrophes("Nothing is explained or reviewed until you say it's ready.")));
  assert.equal(renderEn(ready({}, { open: false })), "");
  assert.match(html(ready({}, { aiRules: true })), /This project has rules about AI use\./);
});

test("a second review waits for a test run at the new version, and a fitted run without review offers none", () => {
  const again = html(ready({ reviews: [{ at, changeFingerprint: "older", verified: "", checked: ["x"], findings: [] }] }));
  assert.match(again, /<input type="checkbox" disabled=""\/><span class="mission-plan-copy"><strong>Ask the guide to review it<\/strong><small>Run your tests on this version first; the tests are the judge\.<\/small>/);
  const tested = html(ready({ reviews: [], ready: { at, changeFingerprint: "older", review: true }, tests: [{ at, command: "npm test", changeFingerprint: fingerprint, outcome: "passed", ms: 5, prediction: "pass" }] }));
  assert.match(tested, /Your tests passed [^<]+; you predicted Pass\./);
  assert.match(tested, /<input type="checkbox" checked=""\/>/);
  const fitted = html(ready({ helpLock: lock }));
  assert.doesNotMatch(fitted, /Ask the guide to review it/);
  assert.ok(fitted.includes(apostrophes("doesn't name AI review, so the guide doesn't review here; your tests are the judge.")));
});
