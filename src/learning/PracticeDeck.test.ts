import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { PracticeItem } from "../../shared/practice";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Repo } from "../types";
import {
  daysUntil,
  fetchPractice,
  PracticeCard,
  PracticeDeck,
  recordPractice,
  type PracticeCardState,
} from "./PracticeDeck";

const repos: Repo[] = [
  {
    id: "repo-1",
    name: "open-fetch",
    owner: "openfetch-sample",
    fullName: "openfetch-sample/open-fetch",
    path: "/tmp/open-fetch",
    defaultBranch: "main",
    url: "",
  },
];

const missed: PracticeItem = {
  key: "check:selfCheck:src/retry.ts",
  runId: "run-1",
  repoId: "repo-1",
  kind: "check",
  question: "Why does the retry wait grow after each failure?",
  reference: "Each wait doubles, so a busy server gets time to recover.",
  earlier: "I thought the wait stayed the same.",
  path: "src/retry.ts",
  dimension: "risk",
  dueAt: "2026-10-14T00:00:00.000Z",
  lastGrade: "missed",
  lastConfidence: "sure",
  codeAvailable: true,
};

const surprise: PracticeItem = {
  key: "feedback:https://example.test/pr/1#c1",
  runId: "run-2",
  repoId: "repo-1",
  kind: "feedback",
  question: "A maintainer asked for a test of the last attempt. What should it check?",
  earlier: "Test the edge, not only the happy path.",
  path: "tests/retry.test.ts",
  dimension: "tests",
  dueAt: "2026-10-14T00:00:00.000Z",
  codeAvailable: false,
};

const deck = (props: Partial<Parameters<typeof PracticeDeck>[0]> = {}) =>
  createElement(PracticeDeck, { repos, onOpen() {}, demo: false, ...props });

const card = (item: PracticeItem, initial?: Partial<PracticeCardState>, last = false) =>
  createElement(PracticeCard, {
    item,
    repoName: "openfetch-sample/open-fetch",
    record: async () => undefined,
    onOpen() {},
    onNext() {},
    last,
    initial,
  });

const sample = getDemo("en").practiceSample!;
// Words of reward mechanics the deck never uses (spelled apart so a grep
// of the source for them stays empty).
const rewards = new RegExp(["str" + "eak", "poi" + "nts", "badge earn" + "ed", "confetti"].join("|"), "i");

test("while the deck loads it says so and shows no sample yet", () => {
  const html = renderEn(deck());
  assertNoHan(html);
  assert.match(html, /<h2 id="practice-title">Practice<\/h2>/);
  assert.match(html, /role="status" aria-busy="true">.*Loading your practice items…/);
  assert.doesNotMatch(html, /Sample practice/);
});

test("with nothing scheduled the deck says so and offers the sample's items", () => {
  const html = renderEn(deck({ initial: { items: [] } }));
  assertNoHan(html);
  assert.match(html, /<p class="practice-empty-title">Nothing to practise right now\.<\/p>/);
  assert.match(html, /<h2 id="practice-sample-title">Sample practice<span class="learning-demo-label">Sample<\/span><\/h2>/);
  assert.match(html, /Grading them saves nothing\./);
  // The first sample item, one at a time.
  assert.ok(html.includes(sample[0].question), "the first sample question");
  assert.ok(!html.includes(sample[1].question), "one item at a time");
  assert.doesNotMatch(html, rewards);

  // With an item due later, the deck says when, and the sample stays away.
  const later = renderEn(
    deck({ initial: { items: [], nextDueAt: new Date(Date.now() + 3 * 86_400_000).toISOString() } }),
  );
  assert.match(later, /Nothing to practise right now\.<\/p><p>Next review in 3 days<\/p>/);
  assert.doesNotMatch(later, /Sample practice/);
});

test("a due item asks first: the question, an answer that is never saved, and how sure you are", () => {
  const html = renderEn(deck({ initial: { items: [missed, surprise] } }));
  assertNoHan(html);
  assert.doesNotMatch(html, /Sample practice/);
  assert.match(html, /<span class="note-tag">From your understanding check<\/span><span class="practice-dimension">Risk<\/span><span class="note-number">openfetch-sample\/open-fetch<\/span>/);
  assert.ok(html.includes(`>${missed.question}</h3>`));
  assert.ok(!html.includes(surprise.question), "the next item waits");
  assert.match(html, /<code class="practice-path">src\/retry\.ts<\/code>/);
  assert.match(html, /<span>Your answer<\/span><textarea rows="3"/);
  assert.match(html, /Your answer stays on this page and is never saved\./);
  assert.match(html, /<fieldset class="practice-choice"><legend>How sure are you\?<\/legend>/);
  const chips = [...html.matchAll(/<input type="radio"[^>]*value="(\w+)"[^>]*\/><span>([^<]+)<\/span>/g)].map(
    ([, value, label]) => `${value}=${label}`,
  );
  assert.deepEqual(chips, ["sure=Sure", "think=Think so", "guess=Guessing"]);
  assert.match(html, />Show answer<\/button>/);
  // Nothing of the answer side shows before the reveal.
  assert.ok(!html.includes(missed.reference!));
  assert.doesNotMatch(html, /Got it|Next review/);
  assert.doesNotMatch(html, rewards);
});

test("the reveal shows the reference, your earlier correction and the way to the code, then the grades", () => {
  const html = renderEn(card(missed, { stage: "reveal", confidence: "think", answer: "It doubles." }));
  assertNoHan(html);
  assert.match(html, /<textarea rows="3" readonly=""/i);
  assert.match(html, /<fieldset class="practice-choice" disabled="">/);
  assert.match(html, /<strong id="[^"]+-reference">Reference<\/strong><span class="note-ai-label">AI-written; the code is the authority<\/span><p>Each wait doubles/);
  assert.match(html, /<strong>What you had wrong last time<\/strong><p>I thought the wait stayed the same\.<\/p>/);
  assert.match(html, /<button type="button" class="practice-study">Study it in the code/);
  const grades = [...html.matchAll(/data-grade="(\w+)"><strong>([^<]+)<\/strong><small>([^<]+)<\/small>/g)].map(
    ([, grade, label, help]) => [grade, label, help],
  );
  assert.deepEqual(grades, [
    ["got", "Got it", "You named the same cause and effect."],
    ["partly", "Partly", "You had part of it."],
    ["missed", "Missed", "It was something else."],
  ]);
  assert.match(html, /role="group" aria-labelledby="[^"]+-grade"><p id="[^"]+-grade" class="practice-grade-label">How did you do\?<\/p>/);

  // A maintainer's comment is the person's lesson, not an AI reference;
  // without the code, the card says the text stays.
  const feedback = renderEn(card(surprise, { stage: "reveal", confidence: "sure" }));
  assertNoHan(feedback);
  assert.match(feedback, /<span class="note-tag">From maintainer feedback<\/span>/);
  assert.match(feedback, /<strong>Your lesson for next time<\/strong>/);
  assert.match(feedback, /<p>No reference: compare with the code yourself\.<\/p>/);
  assert.doesNotMatch(feedback, /AI-written|Study it in the code/);
  assert.match(feedback, /The code for this run was cleaned up; the card text stays\./);
});

test("after the grade the card says when the item comes back, and moves on", () => {
  const inThree = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const html = renderEn(card(missed, { stage: "graded", confidence: "sure", grade: "got", dueAt: inThree }));
  assertNoHan(html);
  assert.match(html, /<p class="practice-next" role="status">Next review in 3 days<\/p><button type="button" class="button secondary">Next item<\/button>/);
  assert.doesNotMatch(html, /data-grade/);
  assert.match(
    renderEn(card(missed, { stage: "graded", confidence: "sure", grade: "missed", dueAt: new Date(Date.now() + 86_400_000).toISOString() }, true)),
    /Next review in 1 day<\/p><button type="button" class="button secondary">Done<\/button>/,
  );
  // When the server did not say, the card only confirms the grade.
  assert.match(renderEn(card(missed, { stage: "graded", confidence: "sure", grade: "partly" })), />Grade saved\.<\/p>/);
});

test("the demo shows only the sample and asks the server nothing", () => {
  const html = renderEn(deck({ demo: true }));
  assertNoHan(html);
  assert.doesNotMatch(html, /Loading|Nothing to practise/);
  assert.match(html, /Sample practice/);
  assert.ok(html.includes(sample[0].question));
});

test("the deck reads in zh-TW with the fixed vocabulary", () => {
  const html = renderZh(deck({ initial: { items: [missed] } }));
  assert.match(html, /<h2 id="practice-title">練習<\/h2>/);
  assert.match(html, /<span>確定<\/span>.*<span>大概<\/span>.*<span>用猜的<\/span>/);
  const graded = renderZh(card(missed, { stage: "reveal", confidence: "sure" }));
  assert.match(graded, /<strong>答對<\/strong>.*<strong>部分對<\/strong>.*<strong>沒答到<\/strong>/);
  const sampleZh = renderZh(deck({ demo: true }));
  assert.ok(sampleZh.includes(getDemo("zh-TW").practiceSample![0].question));
});

test("daysUntil rounds to whole days, at least one", () => {
  const now = Date.parse("2026-10-14T09:00:00.000Z");
  assert.equal(daysUntil("2026-10-17T09:00:01.000Z", now), 3);
  assert.equal(daysUntil("2026-10-15T08:59:00.000Z", now), 1);
  assert.equal(daysUntil("2026-10-14T09:00:00.000Z", now), 1);
  assert.equal(daysUntil("2026-11-04T09:00:00.000Z", now), 21);
});

test("the deck reads GET /api/learning/practice and sends only the key, the confidence and the grade", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const dueAt = "2026-10-17T09:00:00.000Z";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    const body = String(input).endsWith("/practice") && init?.method === "POST"
      ? { run: { id: "run-1", practice: { [missed.key]: { box: 1, dueAt } } } }
      : { items: [missed] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  assert.deepEqual(await fetchPractice(), { items: [missed] });
  assert.equal(await recordPractice(missed, { confidence: "sure", grade: "got" }), dueAt);
  assert.deepEqual(calls, [
    { url: "/api/learning/practice", method: "GET" },
    {
      url: "/api/runs/run-1/practice",
      method: "POST",
      body: { key: missed.key, confidence: "sure", grade: "got" },
    },
  ]);
});
