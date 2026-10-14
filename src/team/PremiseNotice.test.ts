import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PremiseCheck } from "../../shared/team";
import { PremiseNotice } from "./PremiseNotice";

const premise: PremiseCheck = {
  verdict: "refuted",
  statement: "呼叫端把自己產生的 id 交給瀏覽器。",
  evidence: "src/web/interviews.rs:195 回傳的是 interview.id。",
};
const render = (value?: PremiseCheck, compact = false) =>
  renderToStaticMarkup(createElement(PremiseNotice, { premise: value, compact }));

test("a premise check names its verdict, the assumption and the evidence, and says who made it", () => {
  const html = render(premise);
  assert.match(html, /premise-refuted/);
  assert.match(html, /前提查核：假設不成立/);
  assert.match(html, /呼叫端把自己產生的 id 交給瀏覽器。/);
  assert.match(html, /src\/web\/interviews\.rs:195/);
  assert.match(html, /由 Lead 在規劃前閱讀程式碼得出/);
  assert.match(render({ ...premise, verdict: "holds" }), /假設成立/);
  assert.match(render({ ...premise, verdict: "unclear" }), /無法確認假設/);
  // Compact keeps the evidence folded under a one-line summary.
  assert.match(render(premise, true), /<details><summary>.*假設不成立.*<span>呼叫端把自己產生的 id/);
  assert.equal(render(undefined), "");
});
