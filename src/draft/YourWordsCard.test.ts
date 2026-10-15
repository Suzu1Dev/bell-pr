import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import YourWordsCard, { type YourWordsCardProps } from "./YourWordsCard";
import { insertSummary, insertUntested } from "./your-words";

const sample = getDemo("en").understandingSample!;
const body = getDemo("en").run.draft.body;

const card = (props: Partial<YourWordsCardProps> = {}) =>
  createElement(YourWordsCard, {
    summary: sample.summary,
    untested: sample.untested,
    body,
    projectLanguageAllowed: false,
    onInsert() {},
    ...props,
  });
const english = (props: Partial<YourWordsCardProps> = {}) => {
  const html = renderEn(card(props));
  assertNoHan(html);
  return html;
};
const buttons = (html: string) =>
  [...html.matchAll(/<button type="button" class="button secondary"( disabled="")?>[\s\S]*?<\/svg>([^<]+)<\/button>/g)].map(
    (match) => [match[2], !!match[1]] as const,
  );

test("the card offers the person's explanation and not-tested answer, one button each", () => {
  const html = english();
  assert.match(html, /<h3 id="your-words-[^"]+"><svg[\s\S]*?<\/svg> Your words in the PR<\/h3>/);
  assert.match(html, /Nothing goes into the description until you click/);
  assert.ok(html.includes(`<blockquote>${sample.summary.replace(/'/g, "&#x27;")}</blockquote>`));
  assert.ok(html.includes(`<blockquote>${sample.untested.replace(/'/g, "&#x27;")}</blockquote>`));
  assert.deepEqual(buttons(html), [
    ["Use my explanation", false],
    ["Add my not-tested answer to Testing", false],
  ]);
  // Locked while the draft is busy.
  assert.deepEqual(
    buttons(english({ disabled: true })).map(([, disabled]) => disabled),
    [true, true],
  );
});

test("there is no card without a summary: the check was not taken", () => {
  assert.equal(renderEn(card({ summary: undefined })), "");
  assert.equal(renderEn(card({ summary: "  " })), "");
  // Without a not-tested answer, only the explanation is offered.
  assert.deepEqual(buttons(english({ untested: "" })), [["Use my explanation", false]]);
});

test("text already in the description is marked and cannot be inserted twice", () => {
  const withSummary = insertSummary(body, sample.summary);
  assert.deepEqual(buttons(english({ body: withSummary })), [
    ["In the description", true],
    ["Add my not-tested answer to Testing", false],
  ]);
  const both = insertUntested(withSummary, sample.untested);
  assert.deepEqual(buttons(english({ body: both })), [
    ["In the description", true],
    ["In the description", true],
  ]);
});

test("the CJK guard shows Chinese text as a reference to copy, unless the project allows it", () => {
  const zh = getDemo("zh-TW").understandingSample!;
  const html = renderEn(card({ summary: zh.summary, untested: "I did not test Retry-After." }));
  // The reference is the person's own text; the rest of the card is English.
  assertNoHan(html.replace(/<blockquote>[^<]*<\/blockquote>/g, ""));
  assert.match(
    html,
    /<div class="your-words-reference"><p>The PR description is in English; write it in English using your explanation\.<\/p><span class="draft-copy"><button type="button" class="button secondary">[\s\S]*?Copy<\/button>/,
  );
  assert.doesNotMatch(html, /Use my explanation/);
  // The English not-tested answer can still go in.
  assert.match(html, /Add my not-tested answer to Testing/);
  // A project whose rules ask for another language takes the text as it is.
  const allowed = renderEn(card({ summary: zh.summary, projectLanguageAllowed: true }));
  assert.match(allowed, /Use my explanation/);
  assert.doesNotMatch(allowed, /your-words-reference/);
});

test("the zh-TW card names the actions in its own words", () => {
  const html = renderZh(card());
  assert.match(html, /PR 裡用你自己的話/);
  assert.match(html, /使用我的說明/);
  assert.match(html, /把我沒測試的部分加到 Testing/);
});
