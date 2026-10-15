import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import en from "../i18n/en";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import {
  QuizAttempt,
  QuizAttemptView,
  type QuizAttemptProps,
  type QuizAttemptViewProps,
} from "./QuizAttempt";
import { dontKnowInput } from "./try-first";

const t = en.review.tryFirst;
const question = "How long can the third retry wait at most?";
const reference = "Up to 4 seconds, but jitter usually makes it shorter.";
const answer = "Four seconds at most, and jitter picks less.";

/** Text as renderToStaticMarkup escapes it. */
const html = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

const quiz = (props: Partial<QuizAttemptProps> = {}) =>
  renderEn(createElement(QuizAttempt, { question, reference, demo: false, ...props }));

const view = (props: Partial<QuizAttemptViewProps>) =>
  renderEn(
    createElement(QuizAttemptView, {
      question,
      reference,
      demo: false,
      answer: "",
      typing: false,
      onAnswer() {},
      onConfidence() {},
      onReveal() {},
      onDontKnow() {},
      onGrade() {},
      onFill() {},
      ...props,
    }),
  );

test("before an answer, the quiz asks for one and a confidence, and the reference is not in the markup", () => {
  const markup = quiz();
  assertNoHan(markup);
  for (const text of [
    "Quiz yourself",
    t.badge,
    question,
    t.quiz.answerLabel,
    t.quiz.confidenceLabel,
    t.quiz.reveal,
    html(t.quiz.dontKnow),
  ])
    assert.ok(markup.includes(text), text);
  // The answer field is labelled, capped at 1,000 characters and described by the question.
  const field = /<label class="tf-label" for="([^"]+)">Your answer<\/label><textarea id="\1"[^>]*>/.exec(
    markup,
  );
  assert.ok(field, "labelled answer field");
  assert.match(field[0], /maxLength="1000"/i);
  const describedBy = /aria-describedby="([^"]+)"/.exec(field[0])![1];
  assert.match(markup, new RegExp(`<div id="${describedBy}"><div class="markdown-content"><p>${question}`));
  // Sure / Think so / Guessing, one radio group with a name.
  const group = /<div class="tf-chips" role="radiogroup" aria-labelledby="([^"]+)">([\s\S]*?)<\/div>/.exec(markup);
  assert.ok(group, "confidence radiogroup");
  assert.match(markup, new RegExp(`<p class="tf-label" id="${group[1]}">How sure are you\\?</p>`));
  assert.deepEqual(
    [...group[2].matchAll(/type="radio"[^>]*value="(\w+)"[^>]*\/>([^<]+)<\/label>/g)].map(
      ([, value, label]) => `${value}:${label}`,
    ),
    ["sure:Sure", "think:Think so", "guess:Guessing"],
  );
  // The live region is there, empty, before the reveal.
  assert.match(markup, /<div class="tf-reference" aria-live="polite"><\/div>/);
  assert.ok(!markup.includes(reference));
  assert.ok(!markup.includes(t.quiz.referenceLabel));
  assert.ok(!markup.includes(t.grades.got));
  // No sample to type outside the demo.
  assert.ok(!markup.includes(t.fill));
});

test("the demo offers the sample answer to type; a real run never does", () => {
  const demo = quiz({ demo: true, sample: answer });
  assertNoHan(demo);
  assert.match(demo, /<button type="button" class="tf-button tf-fill">Fill with the sample answer<\/button>/);
  assert.ok(!quiz({ demo: false, sample: answer }).includes(t.fill));
  assert.ok(!quiz({ demo: true }).includes(t.fill));
  // While it types, the button waits.
  assert.match(
    view({ demo: true, sample: answer, typing: true }),
    /<button type="button" class="tf-button tf-fill" disabled="">/,
  );
});

test("a typed answer without a confidence says how it can count toward the check", () => {
  const typed = view({ answer });
  assertNoHan(typed);
  assert.ok(typed.includes(t.quiz.confidenceHint));
  assert.ok(!view({ answer, confidence: "think" }).includes(t.quiz.confidenceHint));
  assert.ok(!view({ answer: "  " }).includes(t.quiz.confidenceHint));
});

test("while the answer is being saved, the reference stays out of the markup", () => {
  const saving = view({ answer, confidence: "think", pending: "reveal" });
  assertNoHan(saving);
  assert.match(saving, /aria-busy="true"[^>]*>.*Saving…<\/button>/);
  assert.ok(!saving.includes(reference));
  assert.ok(!saving.includes(t.quiz.referenceLabel));
  // Only an attempt on record brings the reference in.
  const saved = view({ answer, confidence: "think", record: { answer, confidence: "think" } });
  assert.ok(saved.includes(reference));
});

test("after the answer is saved, the reference shows beside it, labelled, with the grade chips", () => {
  const markup = quiz({ saved: { answer, confidence: "think" } });
  assertNoHan(markup);
  assert.ok(!markup.includes("<textarea"), "the answer is final once revealed");
  assert.ok(!markup.includes(t.quiz.reveal));
  assert.match(
    markup,
    /<div class="tf-yours"><p class="tf-label">Your answer<span class="tf-tag">Think so<\/span><\/p><p class="tf-yours-text">Four seconds at most, and jitter picks less\.<\/p><\/div>/,
  );
  // The reference sits in the polite live region, labelled AI-written.
  assert.match(
    markup,
    /<div class="tf-reference" aria-live="polite"><div class="tf-reference-body" tabindex="-1" data-focus="reference"><p class="tf-label">Reference answer<\/p><p class="tf-provenance">AI-written; the diff is the authority<\/p><div class="markdown-content"><p>Up to 4 seconds/,
  );
  // Got it / Partly / Missed, each with its definition, in a group that takes focus.
  const group = /<div class="tf-grades" role="group" aria-labelledby="([^"]+)" aria-busy="false" tabindex="-1" data-focus="grades">([\s\S]*?)<\/div>/.exec(
    markup,
  );
  assert.ok(group, "grade group");
  assert.match(markup, new RegExp(`id="${group[1]}">How did your answer compare\\?</p>`));
  const grades = [
    ...group[2].matchAll(
      /<button type="button" class="tf-grade" aria-labelledby="([^"]+)" aria-describedby="([^"]+)"><strong id="\1">([^<]+)<\/strong><span id="\2">([^<]+)<\/span><\/button>/g,
    ),
  ].map(([, , , label, hint]) => `${label}: ${hint}`);
  assert.deepEqual(grades, [
    "Got it: You named the same cause and effect.",
    "Partly: You had part of it.",
    "Missed: It was something else.",
  ]);
  // The demo's reference is prewritten, and says so.
  const demo = quiz({ demo: true, sample: answer, saved: { answer, confidence: "think" } });
  assertNoHan(demo);
  assert.ok(demo.includes(t.quiz.referenceLabelDemo));
  assert.ok(!demo.includes(t.fill), "nothing left to fill");
});

test("a graded answer collapses to one line; a confident miss says it comes back in practice", () => {
  const got = quiz({ saved: { answer, confidence: "think", grade: "got" } });
  assertNoHan(got);
  assert.match(got, /<div class="tf-graded"><p tabindex="-1" data-focus="graded"><svg[^>]*>.*<\/svg>Your grade: Got it\.<\/p><\/div>/);
  assert.ok(!got.includes('class="tf-grade"'), "no grade chips once graded");
  assert.ok(got.includes(reference), "the reference stays to read");
  assert.ok(!got.includes(t.quiz.confidentMiss));
  for (const [confidence, grade, miss] of [
    ["sure", "partly", true],
    ["think", "missed", true],
    ["guess", "missed", false],
    ["guess", "partly", false],
    ["sure", "got", false],
  ] as const) {
    const markup = quiz({ saved: { answer, confidence, grade } });
    assertNoHan(markup);
    assert.ok(markup.includes(html(t.quiz.graded[grade])), `${confidence} ${grade}`);
    assert.equal(markup.includes(t.quiz.confidentMiss), miss, `${confidence} ${grade}`);
  }
});

test("Show answer with an empty field is a skip: the reference shows and nothing is graded", () => {
  const markup = quiz({ saved: { skipped: true } });
  assertNoHan(markup);
  assert.ok(markup.includes(t.quiz.skipped));
  assert.ok(markup.includes(reference));
  assert.ok(!markup.includes('class="tf-grades"'));
  assert.ok(!markup.includes('class="tf-tag"'));
});

test("I don't know shows a missed attempt at Guessing, with the reference", () => {
  const markup = quiz({ saved: dontKnowInput("") });
  assertNoHan(markup);
  assert.ok(markup.includes(html(t.quiz.dontKnowAnswer)));
  assert.match(markup, /<span class="tf-tag">Guessing<\/span>/);
  assert.ok(markup.includes(html(t.quiz.graded.missed)));
  assert.ok(markup.includes(reference));
  // A miss at Guessing is not a confident one.
  assert.ok(!markup.includes(t.quiz.confidentMiss));
});

test("a failed save is announced", () => {
  const markup = view({ answer, error: t.fileChanged });
  assertNoHan(markup);
  assert.ok(markup.includes(`<p class="tf-error" role="alert">${html(t.fileChanged)}</p>`));
  assert.ok(!markup.includes(reference));
});

test("the zh-TW quiz uses the shared vocabulary", () => {
  const before = renderZh(createElement(QuizAttempt, { question, reference, demo: true, sample: answer }));
  for (const text of ["考考自己", "先試著答", "你的答案", "確定", "大概", "用猜的", "看答案", "我不知道", "填入示範答案"])
    assert.ok(before.includes(text), text);
  const after = renderZh(
    createElement(QuizAttempt, { question, reference, demo: false, saved: { answer, confidence: "sure" } }),
  );
  for (const text of ["答對", "部分對", "沒答到", "AI 撰寫；以 diff 為準", "參考答案"])
    assert.ok(after.includes(text), text);
  const miss = renderZh(
    createElement(QuizAttempt, {
      question,
      reference,
      demo: false,
      saved: { answer, confidence: "sure", grade: "missed" },
    }),
  );
  assert.ok(miss.includes("你的評分：沒答到。"));
  assert.ok(miss.includes("練習卡組"));
});
