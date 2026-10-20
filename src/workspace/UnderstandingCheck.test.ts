import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { UnderstandingView } from "../../shared/understanding";
import {
  demoLockAnswers,
  demoSaveGrades,
  demoUnderstandingView,
} from "../app/hooks/understandingDemo";
import { getDemo } from "../demo";
import en from "../i18n/en/workspace";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Run } from "../types";
import UnderstandingCheck from "./UnderstandingCheck";

type Props = Parameters<typeof UnderstandingCheck>[0];

const demo = getDemo("en");
const t = en.check;
const retry = "selfCheck:src/utils/retry.ts";
const retryCard = demo.files.find((file) => file.path === "src/utils/retry.ts")!.explanation!;
const questionsFor = { fallback: (path: string) => t.fallbackQuestion({ path }), untested: t.untestedQuestion };
const run: Run = { ...demo.run, status: "review" };
const at = "2026-10-03T02:00:00.000Z";
const sample = demo.understandingSample!;
const answers = {
  summary: sample.summary,
  items: Object.entries(sample.answers).map(([id, answer]) => ({ id, answer: answer.answer, confidence: answer.confidence })),
};
/** `text` as React writes it into HTML. */
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
const viewOf = (value: Run) =>
  demoUnderstandingView(value, demo.files, { required: true, questions: questionsFor });

const element = (props: Partial<Props> = {}) =>
  createElement(UnderstandingCheck, {
    run,
    files: demo.files,
    view: viewOf(run),
    demo: true,
    onClose() {},
    onPassed() {},
    check: {
      required: true,
      error: undefined,
      refresh() {},
      async saveAnswers() {},
      async saveGrades() {},
      async confirmSummary() {},
      async restart() {},
      async saveForecast() {},
    },
    ...props,
  });

/** The step headed `title`: a section labelled by its own focusable heading. */
const stepOf = (html: string, title: string) => {
  const heading = new RegExp(`<h3 id="([^"]+)" tabindex="-1">${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h3>`);
  const id = html.match(heading)?.[1];
  assert.ok(id, `a step headed "${title}"`);
  assert.ok(html.includes(`<section class="check-step" aria-labelledby="${id}">`), `${title} is a labelled section`);
  return id;
};

test("a fresh check asks for the explanation and the answers, closed book", () => {
  const html = renderEn(element());
  assert.match(html, /<h2>.*Explain it back<\/h2>/);
  assert.ok(html.includes(t.intro));
  assert.ok(html.includes(t.plan({ questions: 1, lines: 97 })));
  stepOf(html, t.explainTitle);
  assert.ok(html.includes(t.explainPrompt));
  assert.ok(html.includes(t.words({ count: 0, min: 15 })));
  stepOf(html, t.answerTitle);
  assert.ok(html.includes(retryCard.selfCheck!.question));
  assert.ok(html.includes(t.untestedQuestion));
  // Confidence chips are radios in a labelled group; "I don't know" is a checkbox.
  assert.equal(html.match(/<legend>How sure are you\?<\/legend>/g)?.length, 2);
  for (const label of Object.values(t.confidences)) assert.ok(html.includes(`<span>${label}</span>`));
  assert.equal(html.match(/type="checkbox"/g)?.length, 2);
  assert.match(html, />Lock my answers<\/button>/);
  // The sample can type its own answers; the references stay hidden.
  assert.equal(html.match(/Fill with the sample answer/g)?.length, 3);
  assert.ok(!html.includes(retryCard.selfCheck!.answer));
  assert.doesNotMatch(html, /Compare and grade/);
  assertNoHan(html);
});

test("once the answers are locked, each one sits beside its AI-written reference to grade", () => {
  const locked = { ...run, understanding: demoLockAnswers(run, demo.files, answers, questionsFor, at) };
  const html = renderEn(element({ run: locked, view: viewOf(locked) }));
  stepOf(html, t.gradeTitle);
  assert.ok(html.includes(t.reference));
  assert.ok(html.includes(retryCard.selfCheck!.answer));
  assert.ok(html.includes(sample.answers[retry].answer));
  // The not-tested answer is compared with the Test analyst's report, not graded.
  assert.ok(html.includes(escaped(t.testerReference)));
  assert.ok(html.includes(t.notGraded));
  for (const grade of Object.values(t.grades)) assert.ok(html.includes(`<dt>${grade}</dt>`));
  assert.ok(html.includes(t.gradeHints.partly));
  assert.match(html, /<legend>Your grade<\/legend>/);
  assert.match(html, />Save my grades<\/button>/);
  // Locked answers read as locked, and the lock is gone.
  assert.doesNotMatch(html, />Lock my answers</);
  assert.match(html, />Start over<\/button>/);
  assertNoHan(html);
});

test("I don't know is graded Missed at once and asks for a correction", () => {
  const record = demoLockAnswers(
    run,
    demo.files,
    {
      summary: sample.summary,
      items: [
        { id: retry, answer: "", dontKnow: true, confidence: "guess" },
        { id: "untested", answer: sample.untested, confidence: "sure" },
      ],
    },
    questionsFor,
    at,
  );
  const value = { ...run, understanding: record };
  const html = renderEn(element({ run: value, view: viewOf(value) }));
  assert.ok(html.includes(escaped(t.dontKnowAnswer)));
  stepOf(html, t.correctTitle);
  assert.ok(html.includes(t.correction));
  assertNoHan(html);
});

test("a passed check shows its receipt and offers the prediction", () => {
  const locked = demoLockAnswers(run, demo.files, answers, questionsFor, at);
  const record = demoSaveGrades(
    { ...run, understanding: locked },
    demo.files,
    { items: [{ id: retry, grade: "partly", correction: sample.answers[retry].correction }] },
    questionsFor,
    at,
  );
  const passed = { ...run, understanding: record };
  const html = renderEn(element({ run: passed, view: viewOf(passed), onOpenFile() {} }));
  assert.ok(html.includes(t.result({ questions: 2, misses: 1 })));
  assert.equal(t.result({ questions: 2, misses: 1 }), "You explained the change and answered 2 questions. You missed 1 and corrected it.");
  assert.ok(html.includes(sample.answers[retry].correction!));
  assert.ok(html.includes(t.openExplanation({ path: "src/utils/retry.ts" })));
  stepOf(html, t.forecastTitle);
  for (const dimension of Object.values(t.dimensions)) assert.ok(html.includes(`<span>${dimension}</span>`));
  assert.match(html, />Save my prediction<\/button>/);
  assert.match(html, />Skip<\/button>/);
  assertNoHan(html);

  // With the prediction saved, the receipt says it and the step is done.
  const predicted = { ...passed, understanding: { ...record, forecast: { dimension: "tests" as const, question: sample.forecast.question, at } } };
  const done = renderEn(element({ run: predicted, view: viewOf(predicted) }));
  assert.ok(done.includes(`${t.forecast({ dimension: t.dimensions.tests })} · ${sample.forecast.question.replace(/'/g, "&#x27;")}`));
  assert.ok(!done.includes(t.forecastTitle));
});

test("after the change moved, the explanation is confirmed or edited", () => {
  const locked = demoLockAnswers(run, demo.files, answers, questionsFor, at);
  const moved = demo.files.map((file) => (file.path === "README.md" ? { ...file, fingerprint: "changed" } : file));
  const value = { ...run, understanding: locked };
  const view = demoUnderstandingView(value, moved, { required: true, questions: questionsFor });
  assert.equal(view.stale, true);
  const html = renderEn(element({ run: value, files: moved, view }));
  assert.ok(html.includes(t.moved));
  assert.match(html, />Still accurate<\/button>/);
  assert.match(html, />Edit it<\/button>/);
  assert.ok(html.includes(`<blockquote class="check-quote">${sample.summary}</blockquote>`));
  assertNoHan(html);
});

test("in a follow-up round the explanation asks what the round changes", () => {
  const round = {
    ...run,
    followUps: [
      { id: "r1", requestedAt: at, feedbackUrls: [], status: "review" as const, parentCommit: "a".repeat(40) },
    ],
  };
  const html = renderEn(element({ run: round, view: viewOf(round) }));
  assert.ok(html.includes(t.roundPrompt));
  assert.ok(!html.includes(t.explainPrompt));
});

test("the forecast alone, the check off, a run outside review, loading and a failed read", () => {
  const forecast = renderEn(element({ mode: "forecast", check: { ...element().props.check, required: false } }));
  assert.ok(forecast.includes(t.forecastTitle));
  assert.ok(forecast.includes(t.off));
  assert.ok(!forecast.includes(t.explainTitle));
  assertNoHan(forecast);

  const published = { ...run, status: "published" as const };
  const outside = renderEn(element({ run: published, view: viewOf(published) }));
  assert.ok(outside.includes(t.notOpen));
  assert.ok(!outside.includes(t.lock));

  const loading = renderEn(element({ view: undefined as UnderstandingView | undefined }));
  assert.match(loading, /role="status".*Loading the check…/);
  const failed = renderEn(
    element({ view: undefined, check: { ...element().props.check, error: "The server did not answer." } }),
  );
  assert.ok(failed.includes(t.loadFailed({ message: "The server did not answer." })));
  assert.match(failed, />Try again<\/button>/);
  assertNoHan(failed);
});

test("the check reads in Traditional Chinese with the fixed vocabulary", () => {
  const zh = getDemo("zh-TW");
  const zhRun = { ...zh.run, status: "review" as const };
  const html = renderZh(
    element({
      run: zhRun,
      files: zh.files,
      view: demoUnderstandingView(zhRun, zh.files, { required: true, questions: questionsFor }),
    }),
  );
  assert.match(html, /用自己的話講一遍/);
  for (const label of ["確定", "大概", "用猜的", "鎖定我的答案", "填入範例答案"]) assert.ok(html.includes(label), label);
});

test("in a Learn-by-hand run the person's own words and the guide's review are labelled apart, never AI-written or the Test analyst's", () => {
  const locked = { ...run, learnByHand: true as const, understanding: demoLockAnswers(run, demo.files, answers, questionsFor, at) };
  const view = viewOf(locked)!;
  // The server's Learn-by-hand references: the person's own earlier words (or their last test run) and the guide's review.
  const own = (id: string) => (id === "untested" ? "Your last test run of this version: npm test (passed)." : "Cap the retries at three, in the client.");
  const ai = (id: string) => (id === "untested" ? "The guide's review: the timeout path has no test." : "The guide's review: retry.ts:12 still loops when maxRetries is 0.");
  const byHand = {
    ...view,
    plan: view.plan.map((item) => ({ ...item, reference: `${own(item.id)}\n\n${ai(item.id)}`, ownReference: own(item.id), copyReference: ai(item.id) })),
  };
  const html = renderEn(element({ run: locked, view: byHand, demo: false }));
  assertNoHan(html);
  assert.match(html, /Closed book: the guide, the explanations and your notes stay hidden while you answer/);
  assert.match(html, /You grade yourself against your own earlier words and the guide&#x27;s review\./);
  assert.match(html, /<strong>Your own words<\/strong><p>Cap the retries at three, in the client\.<\/p><strong>The guide&#x27;s review<\/strong><p>The guide&#x27;s review: retry\.ts:12/);
  // The not-tested question: the last test run speaks for itself, then the guide's review.
  assert.match(html, /<div class="check-reference"><p>Your last test run of this version: npm test \(passed\)\.<\/p><strong>The guide&#x27;s review<\/strong>/);
  assert.doesNotMatch(html, /AI-written|Test analyst|the agent/);
  const zh = renderZh(element({ run: locked, view: byHand, demo: false }));
  assert.match(zh, /<strong>你自己的話<\/strong>/);
  assert.match(zh, /<strong>嚮導的審查<\/strong>/);
  assert.doesNotMatch(zh, /Test analyst|agent|AI 撰寫/);
  // An agent run keeps its AI-written reference and the Test analyst's report.
  const agent = renderEn(element({ run: { ...locked, learnByHand: undefined }, view, demo: false }));
  assert.ok(agent.includes(t.reference));
  assert.ok(agent.includes(escaped(t.testerReference)));
});
