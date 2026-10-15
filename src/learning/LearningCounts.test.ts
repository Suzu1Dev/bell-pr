import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { learningCounts, type LearningCounts as Counts } from "../../shared/practice";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { countLines, LearningCounts, LearningCountsList } from "./LearningCounts";

/** Counts from no runs at all, with `extra` on top. */
const counts = (extra: Partial<Counts> = {}): Counts => ({ ...learningCounts([]), ...extra });

/** Every count one short of its threshold. */
const below = counts({
  runs: 4,
  approved: 0,
  explainedBack: 1,
  graded: 19,
  byConfidence: {
    sure: { graded: 12, got: 9 },
    think: { graded: 5, got: 3 },
    guess: { graded: 2, got: 0 },
  },
  forecastHits: { hits: 3, of: 4 },
  feedback: { tagged: 4, prs: 3, dimensions: [{ dimension: "tests", prs: 2 }] },
});

/** Every count past its threshold. */
const above = counts({
  runs: 11,
  approved: 9,
  explainedBack: 7,
  checkOff: 2,
  graded: 24,
  byConfidence: {
    sure: { graded: 18, got: 14 },
    think: { graded: 4, got: 2 },
    guess: { graded: 2, got: 1 },
  },
  forecastHits: { hits: 4, of: 7 },
  feedback: {
    tagged: 6,
    prs: 4,
    dimensions: [
      { dimension: "tests", prs: 3 },
      { dimension: "naming", prs: 1 },
    ],
  },
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ");

test("below every threshold the counts show nothing", () => {
  assert.deepEqual(countLines(below), []);
  assert.equal(renderEn(createElement(LearningCountsList, { counts: below })), "");
  // Nothing either before the server answered, or when it could not.
  assert.equal(renderEn(createElement(LearningCounts)), "");
});

test("past their thresholds the counts read as plain sentences, in English and zh-TW", () => {
  const html = renderEn(createElement(LearningCountsList, { counts: above }));
  assertNoHan(html);
  assert.match(html, /<section class="learning-counts" aria-labelledby="learning-counts-title"><h2 id="learning-counts-title">From your own records<\/h2>/);
  const lines = [...html.matchAll(/<li>(.*?)<\/li>/g)].map(([, line]) => line);
  assert.deepEqual(lines, [
    "When you said Sure, you were right 14 of 18 times.",
    "Runs you explained back: 7 of 9 · approved with the check off: 2",
    "You saw it coming 4 of 7 times.",
    "Maintainers raised Tests in 3 of your last 4 PRs.",
  ]);
  assert.match(html, /Counted on this computer from your own records\./);

  const zh = text(renderZh(createElement(LearningCountsList, { counts: above })));
  assert.match(zh, /你回答「確定」的 18 次中，有 14 次是對的。/);
  assert.match(zh, /用自己的話講一遍的任務：7 \/ 9 · 理解檢查關閉時核准：2/);
  assert.match(zh, /你最近的 4 個 PR 中，維護者在 3 個提到「測試」。/);
});

test("each count has its own threshold", () => {
  const ids = (value: Counts) => countLines(value).map((line) => line.id);
  assert.deepEqual(ids(counts({ ...below, graded: 20 })), ["calibration"]);
  assert.deepEqual(ids(counts({ ...below, approved: 1 })), ["explained"]);
  assert.deepEqual(ids(counts({ ...below, forecastHits: { hits: 0, of: 5 } })), ["forecasts"]);
  assert.deepEqual(ids(counts({ ...below, feedback: { ...below.feedback, tagged: 5 } })), ["recurring"]);
  // Twenty graded answers, none of them at Sure: no calibration line.
  const noSure = counts({
    ...above,
    byConfidence: { sure: { graded: 0, got: 0 }, think: { graded: 20, got: 10 }, guess: { graded: 4, got: 1 } },
  });
  assert.ok(!ids(noSure).includes("calibration"));
});

test("a check passed before approval never reads as more runs than there are", () => {
  const [line] = countLines(counts({ approved: 2, explainedBack: 3, checkOff: 0 }));
  assert.deepEqual(line, { id: "explained", explained: 3, of: 3, checkOff: 0 });
  const one = renderEn(
    createElement(LearningCountsList, {
      counts: counts({
        feedback: { tagged: 5, prs: 1, dimensions: [{ dimension: "naming", prs: 1 }] },
      }),
    }),
  );
  assert.match(one, /<li>Maintainers raised Naming in your last PR\.<\/li>/);
});
