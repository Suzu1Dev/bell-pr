// Cut K2 (DESIGN v1.2 F3): "Questions on my plan", three per run, asked only
// while the person plans, never in a run fitted to rules that don't name
// planning help.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { mount } from "../../mission/test-dom";
import { assertNoHan, renderEn, renderZh } from "../../test-utils/render";
import type { Run } from "../../types";
import { PlanQuestions } from "./PlanQuestions";

const at = "2026-10-20T09:00:00.000Z";
const run = (byHand: Run["byHand"], status = "awaiting_plan") => ({ id: "run-1", status, learnByHand: true, byHand }) as unknown as Run;
const element = (byHand: Run["byHand"], status?: string) =>
  createElement(PlanQuestions, { run: run(byHand, status), onAsk: async () => {}, busy: false });

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

test("once the plan is confirmed, the questions asked stay and no new one is offered", () => {
  const asked = { planQuestions: [{ id: "q1", at, kind: "plan" as const, text: "Which test shows the cap holds?" }] };
  const html = renderEn(element(asked, "review"));
  assertNoHan(html);
  assert.ok(html.includes("<p>Which test shows the cap holds?</p>"));
  assert.doesNotMatch(html, /<button|role="status"/);
  assert.equal(renderEn(element({}, "review")), "");
});

test("a turn on the plan that ends with no new question says why in the run log's words", async () => {
  const at = "2026-10-20T09:00:00.000Z";
  const notice = { time: "2026-10-20T09:05:00.000Z", agent: "lead", kind: "notice" as const, message: "codex exited with 1." };
  const state = (byHand: Run["byHand"], logs: Run["logs"] = []) =>
    createElement(PlanQuestions, { run: { ...run(byHand), logs } as Run, onAsk: async () => {}, busy: false });
  const guide = { kind: "guide", since: at };
  const mounted = await mount(state({ busy: guide }, [{ time: at, agent: "user", message: "Asked." }]));
  try {
    assert.match(mounted.text(), /The guide is reading your plan…/);
    await mounted.rerender(state({}, [{ time: at, agent: "user", message: "Asked." }, notice]));
    assert.match(mounted.text(), /The guide couldn't answer: codex exited with 1\./);
    // The next turn clears it; one that adds a question says nothing.
    await mounted.rerender(state({ busy: guide }, [notice]));
    assert.doesNotMatch(mounted.text(), /couldn't answer/);
    await mounted.rerender(state({ planQuestions: [{ id: "q1", at, kind: "plan", text: "Which test shows the cap holds?" }] }, [notice]));
    assert.doesNotMatch(mounted.text(), /couldn't answer/);
    assert.match(mounted.text(), /2 of 3 left/);
  } finally {
    await mounted.unmount();
  }
});
