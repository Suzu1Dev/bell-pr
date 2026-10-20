// Cut K2 (DESIGN v1.2 F3): "Questions on my plan", three per run, never
// offered in a run fitted to rules that don't name planning help.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../../test-utils/render";
import type { Run } from "../../types";
import { PlanQuestions } from "./PlanQuestions";

const at = "2026-10-20T09:00:00.000Z";
const run = (byHand: Run["byHand"]) => ({ id: "run-1", learnByHand: true, byHand }) as unknown as Run;
const element = (byHand: Run["byHand"]) => createElement(PlanQuestions, { run: run(byHand), onAsk: async () => {}, busy: false });

test("questions on the plan count down from three and show what the guide asked", () => {
  const html = renderEn(
    element({ planQuestions: [{ id: "q1", at, kind: "plan", text: "Which test shows the cap holds?", refs: [{ path: "test/retry.test.ts", line: 4 }] }] }),
  );
  assertNoHan(html);
  assert.match(html, /<span role="status">2 of 3 left<\/span>/);
  assert.ok(html.includes("<p>Which test shows the cap holds?</p>"));
  assert.match(html, /<code>test\/retry\.test\.ts:4<\/code>/);
  assert.match(renderEn(element({ busy: { kind: "plan", since: at } })), /The guide is reading your plan…/);
  const used = renderEn(element({ planQuestions: ["a", "b", "c"].map((id) => ({ id, at, kind: "plan", text: id })) }));
  assert.match(used, /<button type="button" class="button secondary" disabled="">/);
  assert.equal(renderEn(element({ helpLock: { kinds: ["explain", "answer"], at, rulesCheckedAt: at, rules: [] } })), "");
  assert.match(renderZh(element({})), /對我的計畫提問/);
});
