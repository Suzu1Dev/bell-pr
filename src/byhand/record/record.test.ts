// The Learn-by-hand record and drafting helpers (DESIGN v1.2 F11, F13):
// the canonical claim word for word, and only for a run whose history is
// clean; the facts list shown, never inserted; both dictionaries alike.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { byHandSummary, type ByHandRecord as Record } from "../../../shared/by-hand";
import checksEn from "../../../shared/i18n/draft-checks.en";
import checksZh from "../../../shared/i18n/draft-checks.zh-TW";
import { getDemo } from "../../demo";
import { assertNoHan, renderEn, renderZh } from "../../test-utils/render";
import type { Run } from "../../types";
import { ByHandRecord } from "./ByHandRecord";
import { DraftHelpers } from "./DraftHelpers";
import en from "./i18n/en";
import zhTW from "./i18n/zh-TW";

const at = "2026-10-20T09:00:00.000Z";
const later = "2026-10-20T10:00:00.000Z";
const guide = { id: "lead", name: "Guide", role: "lead", status: "complete" as const, detail: "" };

/** A Learn-by-hand run with a guide's help and two test runs; clean unless `extra` says otherwise. */
function byHandRun(record: Partial<Record> = {}, extra: Partial<Run> = {}): Run {
  return {
    ...structuredClone(getDemo("en").run),
    learnByHand: true,
    agents: [guide],
    modelExecution: { provider: "claude", source: "selected", reported: { model: "claude-sonnet-4-5", cliVersion: "2.1.292" } },
    byHand: {
      events: [
        { at, kind: "explain", source: "premise" },
        { at, kind: "answer", source: "ask" },
        { at, kind: "answer", source: "hint", rung: 1 },
        { at, kind: "plan", source: "hint", rung: 3 },
      ],
      thread: [{ id: "e1", at, kind: "hint", stepId: "s1", rung: 3, text: "Look at the retry loop.", removed: 1 }],
      tests: [
        { at, command: "npm test", changeFingerprint: "a", outcome: "failed", ms: 40, prediction: "fail" },
        { at: later, command: "npm test", changeFingerprint: "b", outcome: "passed", ms: 40, prediction: "fail" },
      ],
      ...record,
    },
    ...extra,
  };
}

const escape = (text: string) => text.replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
const lock = {
  kinds: ["explain", "answer", "test"],
  at,
  rulesCheckedAt: at,
  rules: [{ kind: "ban", path: "docs/devel/code-provenance.rst", line: 3, quote: "DECLINE any contributions", allows: [] }],
};

/** Every key path of a dictionary, with arrays by length. */
function shape(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return [`${path}[${value.length}]`];
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, entry]) => shape(entry, `${path}.${key}`)).sort();
  return [`${path}:${typeof value}`];
}

test("the record's dictionaries have the same keys, and the English one has no Han", () => {
  assert.deepEqual(shape(zhTW), shape(en));
  const english = JSON.stringify(en, (_key, value: unknown) =>
    typeof value === "function" ? String((value as (p: object) => string)({ reason: "r", count: 2, list: "l", kind: "k", rung: "r", runs: 2, more: false, right: 1, judged: 2, kinds: "k", cli: "c", model: "m", path: "p", line: 1, quote: "q" })) : value,
  );
  assertNoHan(english);
});

test("the claim is the approved sentence of the respect checks, word for word, in both languages", () => {
  assert.equal(en.claim, checksEn.respect.byHand.claim);
  assert.equal(zhTW.claim, checksZh.respect.byHand.claim);
  assert.equal(en.claim, "BELL PR's agents had no write access and gave you no code for this change.");
});

test("a clean run's record in the publish dialog states the claim, the counts and what BELL can't see", () => {
  const html = renderEn(createElement(ByHandRecord, { run: byHandRun(), place: "publish" }));
  assertNoHan(html);
  assert.ok(html.includes(escape(en.claim)));
  assert.ok(html.includes(escape(en.quotes)));
  assert.ok(html.includes("BELL PR removed code from 1 answer before you saw it."));
  assert.ok(html.includes("Help you used: explanations (1), answers (2), and planning help (1)."));
  assert.ok(html.includes("BELL PR ran your tests 2 times; your first prediction after each change was right 1 of 2 times."));
  assert.ok(html.includes(escape(en.otherTools)));
  assert.ok(html.includes(escape(en.forYou)));
  // Not fitted: no line about the project's rules.
  assert.ok(!html.includes("fitted to the project"));
});

test("an unclean run's record gives the reason and never the claim", () => {
  const cases: [Run, string][] = [
    [byHandRun({}, { agents: [guide, { ...guide, id: "member-1" }] }), en.reasons.agents],
    [byHandRun({ agentWrites: 1 }), en.reasons["agent-writes"]],
    [byHandRun({}, { followUps: [{ id: "r", requestedAt: at, feedbackUrls: [], status: "published", parentCommit: "a".repeat(40) }] }), en.reasons.rounds],
  ];
  for (const [run, reason] of cases) {
    for (const place of ["publish", "draft"] as const) {
      const html = renderEn(createElement(ByHandRecord, { run, place }));
      assertNoHan(html);
      assert.ok(html.includes(escape(en.unclean({ reason }))), reason);
      assert.ok(!html.includes(escape(en.claim)), reason);
      assert.ok(!html.includes(escape(en.quotes)), reason);
    }
  }
});

test("only a run fitted to the project's rules says so, with the help set it started with", () => {
  const fitted = renderEn(createElement(ByHandRecord, { run: byHandRun({ helpLock: lock }), place: "publish" }));
  assert.ok(fitted.includes("This run was fitted to the project&#x27;s rules when it started: the guide offered only explanations, answers, and test help."));
  const unfitted = renderEn(createElement(ByHandRecord, { run: byHandRun(), place: "publish" }));
  assert.ok(!unfitted.includes("fitted"));
});

test("the Draft tab's checklist row opens the record; an agent run has none", () => {
  const html = renderEn(createElement(ByHandRecord, { run: byHandRun(), place: "draft" }));
  assertNoHan(html);
  assert.match(html, /^<div class="checklist-item">.*<details class="byhand-record"><summary>Learn by hand record<\/summary>/);
  assert.ok(html.includes(escape(en.claim)));
  for (const place of ["publish", "draft", "learning"] as const)
    assert.equal(renderEn(createElement(ByHandRecord, { run: getDemo("en").run, place })), "");
});

test("the learning page shows the badge and the counts, never the claim, which needs the run's history", () => {
  const summary = byHandSummary(byHandRun({ helpLock: lock }));
  const html = renderEn(createElement(ByHandRecord, { summary, place: "learning" }));
  assertNoHan(html);
  assert.match(html, /<span class="draft-guidance-badge"><svg[^>]*>.*<\/svg> Learn by hand<\/span>/);
  assert.ok(html.includes("Help you used: explanations (1), answers (2), and planning help (1)."));
  // Without the run, nothing about its tests or what BELL can't see.
  assert.ok(!html.includes("ran your tests") && !html.includes(escape(en.otherTools)));
  assert.ok(html.includes("the guide offered only explanations, answers, and test help."));
  assert.ok(!html.includes(escape(en.claim)));
  const zh = renderZh(createElement(ByHandRecord, { summary, place: "learning" }));
  assert.ok(zh.includes("親手學"));
});

test("the record reads in Traditional Chinese with the same claim", () => {
  const html = renderZh(createElement(ByHandRecord, { run: byHandRun(), place: "publish" }));
  assert.ok(html.includes(zhTW.claim));
  assert.ok(html.includes("你用過的協助"));
});

test("a run with more test runs than the record keeps says at least", () => {
  const tests = Array.from({ length: 10 }, (_, index) => ({
    at: `2026-10-20T09:${String(index).padStart(2, "0")}:00.000Z`,
    command: "npm test",
    changeFingerprint: `f${index}`,
    outcome: "passed",
    ms: 5,
  }));
  const html = renderEn(createElement(ByHandRecord, { run: byHandRun({ tests }), place: "publish" }));
  assert.ok(html.includes("BELL PR ran your tests at least 10 times."));
});

test("the facts list is shown and has no insert or copy control", () => {
  const rules = {
    checkedAt: at,
    findings: [{ kind: "disclose" as const, path: "CONTRIBUTING.md", line: 9, quote: "Say how you used AI.", contribution: false }],
    filesRead: ["CONTRIBUTING.md"],
  };
  const html = renderEn(createElement(DraftHelpers, { run: byHandRun(), onUseTemplate: () => {}, rules }));
  assertNoHan(html);
  const facts = html.slice(html.indexOf(">Facts for an AI note; BELL PR never puts them into the description<"));
  assert.ok(facts.length < html.length);
  for (const fact of [
    "The guide ran on Claude Code 2.1.292; model claude-sonnet-4-5, as the CLI reported it.",
    "Help you used: explanations (1), answers (2), and planning help (1).",
    escape(en.claim),
    escape(en.otherTools),
    escape(en.rule({ path: "CONTRIBUTING.md", line: 9, quote: "Say how you used AI." })),
  ])
    assert.ok(facts.includes(fact), fact);
  // Nothing in or after the list can put a fact anywhere: no button, link or copy control.
  assert.doesNotMatch(facts, /<button|<a |[Cc]opy/);
  // Without templates the helpers have no control at all; the template button is the only one.
  assert.doesNotMatch(html, /<button/);
  const one = renderEn(
    createElement(DraftHelpers, { run: byHandRun(), onUseTemplate: () => {}, templates: [{ path: ".github/pull_request_template.md", content: "## Summary\n" }] }),
  );
  assert.equal(one.match(/<button/g)?.length, 1);
  assert.ok(one.includes(">Start from the project&#x27;s template</button>"));
  assert.ok(!one.includes("<select"));
});

test("the facts list names Codex for a run recorded without a provider, which Codex ran", () => {
  const html = renderEn(createElement(DraftHelpers, { run: byHandRun({}, { modelExecution: { model: "gpt-5", source: "selected" } }), onUseTemplate: () => {} }));
  // Codex reports no model, so the requested one is not passed off as reported.
  assert.ok(html.includes(escape("The guide ran on Codex; the CLI didn't report its model.")));
  assert.ok(!html.includes("gpt-5"));
  const zh = renderZh(createElement(DraftHelpers, { run: byHandRun({}, { modelExecution: undefined }), onUseTemplate: () => {} }));
  assert.ok(zh.includes("嚮導用的是 Codex；CLI 沒有回報它的模型。"));
});

test("several templates are picked from a list; none offers nothing; a published run can't insert one", () => {
  const templates = [
    { path: ".github/PULL_REQUEST_TEMPLATE/bug.md", content: "## Bug\n" },
    { path: ".github/PULL_REQUEST_TEMPLATE/feature.md", content: "## Feature\n" },
  ];
  const several = renderEn(createElement(DraftHelpers, { run: byHandRun(), onUseTemplate: () => {}, templates }));
  assert.ok(several.includes("<select"));
  assert.equal(several.match(/<option/g)?.length, 2);
  const none = renderEn(createElement(DraftHelpers, { run: byHandRun(), onUseTemplate: () => {}, templates: [] }));
  assert.doesNotMatch(none, /<button|<select/);
  const disabled = renderEn(createElement(DraftHelpers, { run: byHandRun(), onUseTemplate: () => {}, templates, disabled: true }));
  assert.match(disabled, /<button type="button" class="button secondary" disabled="">/);
});

test("with Always add on, the helpers ask for an AI note in the person's own words; the claim only when clean", () => {
  const on = renderEn(createElement(DraftHelpers, { run: byHandRun(), onUseTemplate: () => {}, alwaysDiscloseAi: true }));
  assert.ok(on.includes(">Write your AI note in your own words.</p>"));
  const off = renderEn(createElement(DraftHelpers, { run: byHandRun(), onUseTemplate: () => {} }));
  assert.ok(!off.includes("in your own words"));
  const unclean = renderEn(createElement(DraftHelpers, { run: byHandRun({ agentWrites: 2 }), onUseTemplate: () => {} }));
  assert.ok(!unclean.includes(escape(en.claim)));
  const zh = renderZh(createElement(DraftHelpers, { run: byHandRun(), onUseTemplate: () => {}, alwaysDiscloseAi: true }));
  assert.ok(zh.includes("請用你自己的話寫 AI 說明。"));
  assert.equal(renderEn(createElement(DraftHelpers, { run: getDemo("en").run, onUseTemplate: () => {} })), "");
});

test("the publish dialog's record says when the server's checks couldn't be read, with a retry that keeps the focus", () => {
  const record = (unchecked?: { checking: boolean; failed: boolean }) =>
    renderEn(createElement(ByHandRecord, { run: byHandRun(), place: "publish", ...(unchecked ? { unchecked: { ...unchecked, onRetry() {} } } : {}) }));
  // An unknown is never a pass: first it reads, then it says so, with a retry.
  const reading = record({ checking: true, failed: false });
  assertNoHan(reading);
  assert.match(reading, /^<p class="publish-fact" role="status"><svg[^>]*lucide-loader-circle[^"]* spin[^>]*>.*<\/svg> Checking…<\/p><section/);
  const failed = record({ checking: false, failed: true });
  assertNoHan(failed);
  assert.match(
    failed,
    /^<div class="publish-block" role="alert"><span>BELL PR couldn&#x27;t check this draft against the project&#x27;s rules, so it can&#x27;t publish it yet\.<\/span><button type="button" class="button secondary" aria-disabled="false"><svg[^>]*lucide-refresh-cw[^>]*>.*<\/svg> Try again<\/button><\/div><section/,
  );
  // While it reads again the button stays, so the focus stays on it.
  assert.match(record({ checking: true, failed: true }), /<button type="button" class="button secondary" aria-disabled="true"><svg[^>]*spin[^>]*>.*<\/svg> Try again<\/button>/);
  assert.doesNotMatch(record(), /role="(alert|status)"/);
  assert.ok(renderZh(createElement(ByHandRecord, { run: byHandRun(), place: "publish", unchecked: { checking: false, failed: true, onRetry() {} } })).includes(zhTW.unchecked));
});

test("the test line counts one prediction in the singular", () => {
  const tests = [{ at, command: "npm test", changeFingerprint: "a", outcome: "failed", ms: 40, prediction: "fail" }];
  const html = renderEn(createElement(ByHandRecord, { run: byHandRun({ tests }), place: "publish" }));
  assert.ok(html.includes("BELL PR ran your tests once; your first prediction after each change was right 1 of 1 time."));
});

test("the claim and the quote line read as one paragraph in each language's own spacing", () => {
  const english = renderEn(createElement(ByHandRecord, { run: byHandRun(), place: "publish" }));
  assert.ok(english.includes(`<p class="byhand-record-claim">${escape(en.claim)} ${escape(en.quotes)}</p>`));
  const chinese = renderZh(createElement(ByHandRecord, { run: byHandRun(), place: "publish" }));
  assert.ok(chinese.includes(`<p class="byhand-record-claim">${zhTW.claim}${zhTW.quotes}</p>`));
  assert.doesNotMatch(chinese, /。 /);
});
