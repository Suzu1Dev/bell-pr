import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { PremiseCheck } from "../../shared/team";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { PremiseNotice } from "./PremiseNotice";

const premise: PremiseCheck = {
  verdict: "refuted",
  statement: "呼叫端把自己產生的 id 交給瀏覽器。",
  evidence: "src/web/interviews.rs:195 回傳的是 interview.id。",
};
const render = (value?: PremiseCheck, compact = false) =>
  renderZh(createElement(PremiseNotice, { premise: value, compact }));

test("a premise check names its verdict, the assumption and the evidence, and says who made it", () => {
  const html = render(premise);
  assert.match(html, /premise-refuted/);
  assert.match(html, /前提查核：假設不成立/);
  assert.match(html, /呼叫端把自己產生的 id 交給瀏覽器。/);
  assert.match(html, /src\/web\/interviews\.rs:195/);
  assert.match(html, /由 Lead 閱讀程式碼得出/);
  assert.match(render({ ...premise, verdict: "holds" }), /假設成立/);
  assert.match(render({ ...premise, verdict: "unclear" }), /無法確認假設/);
  // Compact keeps the evidence folded under a one-line summary.
  assert.match(render(premise, true), /<details><summary>.*假設不成立.*<span>呼叫端把自己產生的 id/);
  assert.equal(render(undefined), "");
});

test("the premise check reads in English, and a verdict word from a later build reads as unclear", () => {
  const english = renderEn(createElement(PremiseNotice, { premise: { ...premise, statement: "The caller hands over an id it made.", evidence: "src/web/interviews.rs:195 returns interview.id." } }));
  assertNoHan(english);
  assert.match(english, /Premise check: the assumption does not hold/);
  assert.match(english, /Found by the lead reading the code/);
  const later = render({ ...premise, verdict: "partly" as PremiseCheck["verdict"] });
  assert.match(later, /premise-unclear/);
  assert.match(later, /無法確認假設/);
});


test("in a Learn-by-hand run the premise check says the guide found it", () => {
  const english = renderEn(createElement(PremiseNotice, { premise, guide: true }));
  assert.match(english, /Found by the guide reading the code; check it against the cited lines\./);
  assert.doesNotMatch(english, /the lead/);
  assert.match(renderEn(createElement(PremiseNotice, { premise, compact: true, guide: true })), /Found by the guide reading the code/);
  assert.match(renderZh(createElement(PremiseNotice, { premise, guide: true })), /由嚮導閱讀程式碼得出/);
});
