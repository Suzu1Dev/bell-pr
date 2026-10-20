// Cut K4 (DESIGN v1.2 F3): after a first draft, the person's steps and the
// guide's side by side.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../../test-utils/render";
import type { Run } from "../../types";
import { PlanCompare } from "./PlanCompare";
import { PlanWithGuide } from "./PlanWithGuide";

const at = "2026-10-20T09:00:00.000Z";
const run = {
  id: "run-1",
  status: "awaiting_plan",
  learnByHand: true,
  byHand: {
    plan: { steps: [{ id: "s1", title: "Cap the retries" }], savedAt: at },
    guidePlan: { summary: "", steps: [{ title: "Read the loop", files: [] }], at },
  },
} as unknown as Run;

test("after a first draft the plans can be compared side by side", () => {
  const html = renderEn(createElement(PlanCompare, { run, onReveal: async () => {}, busy: false }));
  assertNoHan(html);
  assert.match(html, /<svg[^>]*lucide-columns[\s\S]*?<\/svg> Compare with the guide&#x27;s steps<\/button>/);
  // The plan panel offers it once a step is written, next to the names.
  const panel = renderEn(createElement(PlanWithGuide, { run, onSave: async () => {}, onReveal: async () => {}, onAskQuestions: async () => {}, onConfirm: async () => {} }));
  assert.ok(panel.includes("Compare with the guide&#x27;s steps"));
  assert.ok(panel.includes("Show the guide&#x27;s step names"));
  assert.match(renderZh(createElement(PlanCompare, { run, onReveal: async () => {}, busy: false })), /和嚮導的步驟比較/);
});
