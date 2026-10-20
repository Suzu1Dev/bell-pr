import assert from "node:assert/strict";
import test from "node:test";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import type { UnderstandingView } from "../../shared/understanding";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { DiffFile } from "../types";
import { ExplanationPanel, ReviewReports, type ExplanationPanelProps } from "./ExplanationPanel";
import en from "./i18n/en";
import zhTW from "./i18n/zh-TW";
import { ReaderView, readerAllowed, readerRequests, unasked, type ByHandReader } from "./ReaderView";

/** A file of a Learn-by-hand run in review: nothing asked for yet. */
const file: DiffFile = {
  path: "src/a.ts",
  fingerprint: "a".repeat(64),
  language: "typescript",
  additions: 20,
  deletions: 2,
  status: "modified",
  patch: "@@ -1 +1 @@\n-old\n+new\n",
  explanationStatus: "pending",
  walkthroughStatus: "pending",
};
const other = "src/b.ts";

/** The check with a question about src/a.ts and the not-tested one; `answered` lists the ids with a saved answer. */
function check(answered: string[], options: { required?: boolean; ownSlot?: boolean } = {}): UnderstandingView {
  const plan = [
    ...(options.ownSlot === false ? [] : [{ id: `fallback:${file.path}`, path: file.path, fingerprint: file.fingerprint }]),
    { id: `fallback:${other}`, path: other, fingerprint: "b".repeat(64) },
    { id: "untested" },
  ].map((item) => ({ ...item, source: "fallback" as const, question: "Why this way?" }));
  return {
    required: options.required ?? true,
    passed: false,
    stale: false,
    plan,
    missing: plan
      .filter((item) => !answered.includes(item.id))
      .map((item) => ({ part: "answer" as const, itemId: item.id })),
    changeFingerprint: "0".repeat(16),
  };
}

const reader = (view: UnderstandingView | undefined): ByHandReader => ({
  onReviewAgain() {},
  check: view,
  onOpenCheck() {},
});

/** The first element of `type` in a tree that is not rendered further. */
function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node))
    return node.map((child) => find(child, type)).find(Boolean);
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  return node.type === type ? (node as ReactElement<Record<string, unknown>>) : find(node.props.children, type);
}

/** What `component` returns for `props`, rendered once in English: its own elements, with their handlers. */
function shallow<P>(component: (props: P) => ReactNode, props: P): ReactNode {
  let tree: ReactNode;
  function Probe() {
    tree = component(props);
    return null;
  }
  renderEn(createElement(Probe));
  return tree;
}

const panel = (props: Partial<ExplanationPanelProps>, render = renderEn) =>
  render(
    createElement(ExplanationPanel, {
      file,
      messages: [],
      loading: false,
      onAsk() {},
      demo: false,
      onRetryExplanation() {},
      onRetryWalkthrough() {},
      ...props,
    }),
  );

test("a file may be explained once its own answer is saved, or with no question once every answer is, or with the check off", () => {
  // Still loading: answer first, the server decides anyway.
  assert.equal(readerAllowed(undefined, file), false);
  assert.equal(readerAllowed(check([]), file), false);
  // Another file's answer is not this file's.
  assert.equal(readerAllowed(check([`fallback:${other}`, "untested"]), file), false);
  assert.equal(readerAllowed(check([`fallback:${file.path}`]), file), true);
  // No question of its own: every question needs its answer first.
  assert.equal(readerAllowed(check([`fallback:${other}`], { ownSlot: false }), file), false);
  assert.equal(readerAllowed(check([`fallback:${other}`, "untested"], { ownSlot: false }), file), true);
  // The person turned the check off in Settings.
  assert.equal(readerAllowed(check([], { required: false }), file), true);
});

test("asking how a reader sees the file asks only for what this file still lacks", () => {
  assert.deepEqual(readerRequests(file), { explanation: true, walkthrough: true });
  const explained = { ...file, explanation: getDemo("en").files[0].explanation, explanationStatus: "ready" as const };
  assert.deepEqual(readerRequests(explained), { explanation: false, walkthrough: true });
  assert.deepEqual(readerRequests({ ...file, explanationStatus: "failed" }), { explanation: true, walkthrough: true });
  for (const status of ["generating", "unavailable"] as const)
    assert.equal(readerRequests({ ...file, explanationStatus: status }).explanation, false);
  assert.deepEqual(readerRequests({ ...explained, walkthroughStatus: "unavailable" }), { explanation: false, walkthrough: false });
  assert.equal(unasked({ ...file, blocked: "A credential." }, "walkthrough"), false);
  assert.equal(unasked({ ...file, walkthroughStatus: "generating" }, "walkthrough"), false);
});

test("the reader view says to answer first, then offers the request, in English", () => {
  const first = renderEn(createElement(ReaderView, { file, reader: reader(check([])), busy: false }));
  assertNoHan(first);
  assert.match(first, /<h3>How a reader sees your change<\/h3>/);
  assert.match(first, /Answer this file&#x27;s question in Explain it back first/);
  assert.match(first, /<button type="button" class="explain-retry">.*Explain it back<\/button>/);
  assert.doesNotMatch(first, /Show how a reader sees it/);
  const noQuestion = renderEn(
    createElement(ReaderView, { file, reader: reader(check([], { ownSlot: false })), busy: false }),
  );
  assert.match(noQuestion, /This file has no question of its own/);
  const ready = renderEn(createElement(ReaderView, { file, reader: reader(check([`fallback:${file.path}`])), busy: false }));
  assertNoHan(ready);
  assert.match(ready, /It takes up to two agent turns\./);
  assert.match(ready, /<button type="button" class="explain-retry">.*Show how a reader sees it<\/button>/);
  assert.doesNotMatch(ready, /Explain it back first/);
  const busy = renderEn(createElement(ReaderView, { file, reader: reader(check([`fallback:${file.path}`])), busy: true }));
  assert.match(busy, /<button type="button" class="explain-retry" disabled="">.*Preparing other explanations…<\/button>/);
  const zh = renderZh(createElement(ReaderView, { file, reader: reader(check([])), busy: false }));
  assert.match(zh, /讀者會怎麼看你的改動/);
  assert.match(zh, />用自己的話講一遍<\/button>/);
});

test("in a Learn-by-hand run the panel shows the reader view, never a promise of an automatic explanation", () => {
  const byHandReview = reader(check([]));
  const explain = panel({ byHandReview, onSaveNote() {} });
  assertNoHan(explain);
  assert.match(explain, /How a reader sees your change/);
  assert.doesNotMatch(explain, /The explanation will be ready automatically/);
  // The note stays, as in every run.
  assert.match(explain, /My understanding/);
  const walkthrough = panel({ byHandReview, initialTab: "walkthrough" });
  assertNoHan(walkthrough);
  assert.match(walkthrough, /How a reader sees your change/);
  assert.doesNotMatch(walkthrough, /will be ready on its own/);
  // An agent run keeps today's waiting cards.
  assert.match(panel({}), /The explanation will be ready automatically/);
  assert.match(panel({ initialTab: "walkthrough" }), /The code walkthrough will be ready on its own/);
});

test("once asked for, a Learn-by-hand file shows the explanation's progress and then its cards", () => {
  const byHandReview = reader(check([`fallback:${file.path}`]));
  const generating = panel({ byHandReview, file: { ...file, explanationStatus: "generating", walkthroughStatus: "generating" } });
  assert.match(generating, /Turning the change into plain language/);
  assert.doesNotMatch(generating, /How a reader sees your change/);
  const demoFile = getDemo("en").files.find((entry) => entry.path === "src/client.ts")!;
  const shown = panel({ byHandReview, file: { ...demoFile, fingerprint: file.fingerprint } });
  assertNoHan(shown);
  assert.match(shown, /What changed here\?/);
  assert.doesNotMatch(shown, /How a reader sees your change/);
  const walked = panel({ byHandReview, file: { ...demoFile, fingerprint: file.fingerprint }, initialTab: "walkthrough" });
  assert.match(walked, /createClient/);
  assert.doesNotMatch(walked, /How a reader sees your change/);
});

test("the panel's own strings have the same keys in both locales, and no Han in English", () => {
  const keys = (value: object): string[] =>
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === "object" ? keys(entry).map((name) => `${key}.${name}`) : [key],
    );
  assert.deepEqual(keys(zhTW), keys(en));
  assertNoHan(JSON.stringify(en));
});

test("the reader view's buttons open the check, or ask for this file's explanation and walkthrough", () => {
  const calls: string[] = [];
  const props = {
    file,
    busy: false,
    onExplain: () => calls.push("explain"),
    onWalkthrough: () => calls.push("walkthrough"),
  };
  const press = (view: UnderstandingView, target = file) =>
    (find(shallow(ReaderView, { ...props, file: target, reader: { ...reader(view), onOpenCheck: () => calls.push("check") } }), "button")!
      .props.onClick as () => void)();
  press(check([]));
  assert.deepEqual(calls.splice(0), ["check"]);
  press(check([`fallback:${file.path}`]));
  assert.deepEqual(calls.splice(0), ["explain", "walkthrough"]);
  // With the explanation already written, only the walkthrough is asked for.
  press(check([`fallback:${file.path}`]), { ...file, explanationStatus: "ready", explanation: getDemo("en").files[0].explanation });
  assert.deepEqual(calls.splice(0), ["walkthrough"]);
});

test("Run the review again opens the Ready dialog in a Learn-by-hand run and reruns the review in an agent run", () => {
  const calls: string[] = [];
  const rerun = (props: Partial<ExplanationPanelProps>) =>
    find(
      shallow(ExplanationPanel, {
        file,
        messages: [],
        loading: false,
        onAsk() {},
        demo: false,
        initialTab: "reports",
        ...props,
      }),
      ReviewReports,
    )!.props.onRerunReview as (() => void) | undefined;
  const byHandReview = { ...reader(check([])), onReviewAgain: () => calls.push("ready dialog") };
  rerun({ onRerunReview: () => calls.push("rerun"), byHandReview })!();
  assert.deepEqual(calls.splice(0), ["ready dialog"]);
  rerun({ onRerunReview: () => calls.push("rerun") })!();
  assert.deepEqual(calls.splice(0), ["rerun"]);
  // A run that takes no rerun now (published, say) shows no button in either mode.
  assert.equal(rerun({ byHandReview }), undefined);
});
