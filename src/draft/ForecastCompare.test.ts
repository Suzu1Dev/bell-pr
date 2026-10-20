import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { PrFeedback, PrFeedbackItem } from "../../shared/pr-feedback";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import ForecastCompare, {
  feedbackOutcome,
  maintainerItems,
  type ForecastCompareProps,
} from "./ForecastCompare";

const demo = getDemo("en");
const sample = demo.prFeedback!;
const forecast = {
  dimension: demo.understandingSample!.forecast.dimension,
  question: demo.understandingSample!.forecast.question,
  at: "2026-10-04T01:00:00.000Z",
};

const item = (overrides: Partial<PrFeedbackItem>): PrFeedbackItem => ({
  kind: "comment",
  author: "someone",
  authorAssociation: "NONE",
  body: "A comment.",
  url: "https://github.com/acme/widgets/pull/9#issuecomment-1",
  createdAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});
const feedback = (overrides: Partial<PrFeedback> = {}): PrFeedback => ({
  fetchedAt: "2026-10-11T00:00:00.000Z",
  prNumber: 9,
  items: [],
  ...overrides,
});

const view = (props: Partial<ForecastCompareProps> = {}) =>
  createElement(ForecastCompare, { forecast, feedback: sample, tags: demo.feedbackTags, demo: true, ...props });
const english = (props: Partial<ForecastCompareProps> = {}) => {
  const html = renderEn(view(props));
  assertNoHan(html);
  return html;
};
const pressed = (html: string) =>
  [...html.matchAll(/<button type="button" class="forecast-chip" aria-pressed="true"[^>]*>([^<]+)<\/button>/g)].map(
    (match) => match[1],
  );

test("the sample shows the forecast beside the maintainer's items, with the person's tags", () => {
  const html = english({ onTag() {} });
  assert.match(html, /<h3 id="forecast-[^"]+"><svg[\s\S]*?<\/svg> Your forecast and what the maintainers said<\/h3>/);
  assert.match(html, /<p class="forecast-outcome"><strong>Outcome<\/strong> Changes requested<\/p>/);
  assert.match(html, /<h4>Your forecast<\/h4><span class="forecast-chip is-static">Tests<\/span><p>They&#x27;ll ask whether the retry cap is tested\.<\/p>/);
  assert.match(html, /<h4>What the maintainers said<\/h4>/);
  assert.equal(html.match(/<li class="forecast-item">/g)?.length, 2);
  // Plain text, as the maintainer wrote it; the sample's fragment URLs are no links.
  assert.match(html, /Renaming `retry\.delay` breaks existing configs\./);
  assert.doesNotMatch(html, /Open on GitHub/);
  assert.match(html, /<code>src\/client\.ts:20<\/code>/);
  // The tags: Tests and Saw it coming, then Risk and Surprised me with its lesson.
  assert.deepEqual(pressed(html), ["Tests", "Saw it coming", "Risk", "Surprised me"]);
  assert.match(html, /<label for="forecast-lesson-[^"]+">Lesson for next time<\/label>/);
  assert.ok(html.includes(`value="${demo.feedbackTags!["#demo-pr-thread-1"].lesson!.replace(/'/g, "&#x27;")}"`));
  assert.match(html, /maxLength="200"/);
  assert.match(html, /200 characters or fewer\./);
  assert.match(html, /aria-label="What @sample_maintainer raised"/);
  assert.match(html, /aria-label="Did you see @sample_maintainer&#x27;s point coming\?"/);
  // Eight dimensions per item.
  assert.equal(html.match(/class="forecast-chip"/g)?.length, 2 * (8 + 2));
});

test("only OWNER, MEMBER and COLLABORATOR items count as what the maintainers said", () => {
  const items = [
    item({ author: "owner", authorAssociation: "OWNER", url: "#a" }),
    item({ author: "member", authorAssociation: "member", url: "#b" }),
    item({ author: "collab", authorAssociation: "COLLABORATOR", url: "#c" }),
    item({ author: "drive-by", authorAssociation: "CONTRIBUTOR", url: "#d" }),
    item({ author: "bot", authorAssociation: "NONE", url: "#e" }),
  ];
  assert.deepEqual(maintainerItems(feedback({ items })).map((entry) => entry.author), ["owner", "member", "collab"]);
  const html = english({ feedback: feedback({ items }), tags: {}, demo: false });
  assert.equal(html.match(/<li class="forecast-item">/g)?.length, 3);
  assert.doesNotMatch(html, /drive-by|@bot/);
  // A real item's link opens on GitHub.
  const linked = english({
    feedback: feedback({ items: [item({ authorAssociation: "OWNER" })] }),
    demo: false,
  });
  assert.match(linked, /<a href="https:\/\/github\.com\/acme\/widgets\/pull\/9#issuecomment-1" target="_blank" rel="noopener noreferrer">Open on GitHub/);
});

test("the outcome states facts only and never calls silence a rejection", () => {
  assert.deepEqual(feedbackOutcome(feedback({ merged: true, prState: "MERGED" })), { id: "merged" });
  assert.deepEqual(feedbackOutcome(feedback({ prState: "MERGED" })), { id: "merged" });
  assert.deepEqual(feedbackOutcome(feedback({ prState: "CLOSED" })), { id: "closed" });
  assert.deepEqual(feedbackOutcome(feedback({ reviewDecision: "CHANGES_REQUESTED" })), { id: "changes" });
  assert.deepEqual(feedbackOutcome(feedback({ reviewDecision: "APPROVED" })), { id: "approved" });
  assert.deepEqual(
    feedbackOutcome(feedback({ items: [item({ authorAssociation: "MEMBER" })] })),
    { id: "commented" },
  );
  // Silence: days since the oldest item on the pull request, when there is one.
  assert.deepEqual(
    feedbackOutcome(feedback({ items: [item({ createdAt: "2026-10-01T00:00:00.000Z" })] })),
    { id: "waiting", days: 10 },
  );
  assert.deepEqual(feedbackOutcome(feedback()), { id: "waiting" });
  const outcome = (value: PrFeedback) =>
    /<strong>Outcome<\/strong> ([^<]+)<\/p>/.exec(english({ feedback: value, demo: false }))?.[1];
  assert.equal(outcome(feedback({ merged: true })), "Merged");
  assert.equal(outcome(feedback({ prState: "CLOSED" })), "Closed without merging");
  assert.equal(outcome(feedback({ reviewDecision: "APPROVED" })), "Approved, not merged yet");
  assert.equal(outcome(feedback({ items: [item({ authorAssociation: "OWNER" })] })), "The maintainers commented; no decision yet");
  assert.equal(outcome(feedback({ items: [item({})] })), "No response yet (10 days)");
  assert.equal(
    outcome(feedback({ items: [item({ createdAt: "2026-10-10T00:00:00.000Z" })] })),
    "No response yet (1 day)",
  );
  assert.equal(outcome(feedback()), "No response yet");
  for (const value of [feedback(), feedback({ prState: "CLOSED" }), feedback({ items: [item({})] })])
    assert.doesNotMatch(english({ feedback: value, demo: false }), /reject/i);
});

test("without feedback or a forecast the columns say so", () => {
  const unread = english({ feedback: undefined, forecast: undefined });
  assert.match(unread, /<p class="forecast-none">No forecast<\/p>/);
  assert.match(unread, /<p class="forecast-none">Read the feedback to compare it with your forecast\.<\/p>/);
  assert.doesNotMatch(unread, /Outcome/);
  const quiet = english({ feedback: feedback(), forecast: { at: forecast.at } });
  assert.match(quiet, /No forecast/);
  assert.match(quiet, /<p class="forecast-none">Nothing from the maintainers yet\.<\/p>/);
  // A forecast with a line only.
  assert.match(english({ forecast: { question: "Naming.", at: forecast.at } }), /<h4>Your forecast<\/h4><p>Naming\.<\/p>/);
});

test("without onTag the tags are shown and cannot change", () => {
  const html = english();
  assert.equal(html.match(/<button type="button" class="forecast-chip"[^>]*disabled=""/g)?.length, 2 * (8 + 2));
  assert.doesNotMatch(html, /Save the lesson/);
  assert.match(english({ onTag() {} }), /Save the lesson<\/button>/);
});

test("outside the sample the forecast and what the maintainers said show side by side", () => {
  const html = english({ demo: false });
  assert.match(html, /<h4>Your forecast<\/h4><span class="forecast-chip is-static">Tests<\/span>/);
  assert.match(html, /What the maintainers said<\/h4>/);
  assert.match(html, /forecast-item/);
  assert.doesNotMatch(html, /pro-badge|forecast-locked|Pro\b/);
  assert.match(html, /Changes requested/);
});

test("the zh-TW comparison uses its own words", () => {
  const html = renderZh(view({ onTag() {} }));
  assert.match(html, /你的預測與維護者的回饋/);
  assert.match(html, /有預料到/);
  assert.match(html, /出乎意料/);
  assert.match(html, /要求修改/);
  assert.match(html, /給下次的提醒/);
});
