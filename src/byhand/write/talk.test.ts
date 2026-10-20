// Cut K6 (DESIGN v1.2 F6): R0 "Talk it through", a local form with the
// deterministic checks, and the card after the same failure three times.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { TestRun } from "../../../shared/by-hand";
import { assertNoHan, renderEn, renderZh } from "../../test-utils/render";
import { RepeatFailure, TalkItThrough } from "./TalkItThrough";

const at = (minute: number) => `2026-10-20T09:0${minute}:00.000Z`;
const failing = (minute: number): TestRun => ({ at: at(minute), command: "npm test", changeFingerprint: "f", outcome: "failed", exitCode: 1, ms: 9, tailHash: "h" });
const noop = async () => {};

test("Talk it through is a local form that the person opens", () => {
  const html = renderEn(createElement(TalkItThrough, { step: { id: "s1", title: "Cap" }, tests: [], fingerprint: "f", onStep: noop }));
  assertNoHan(html);
  assert.match(html, /<button type="button" class="mission-text-button" aria-expanded="false"><svg[\s\S]*?<\/svg> Talk it through<\/button>/);
  assert.match(renderZh(createElement(TalkItThrough, { tests: [], fingerprint: "f", onStep: noop })), /說說看/);
});

test("the same failure three runs in a row shows one card pointing at the exits", () => {
  const card = (tests: TestRun[]) => renderEn(createElement(RepeatFailure, { step: { id: "s1", title: "Cap" }, tests, onCheckIn: noop }));
  const html = card([failing(1), failing(2), failing(3)]);
  assertNoHan(html);
  assert.ok(html.includes("The same failure, three runs in a row. Step back and try one of the exits below."));
  assert.equal(card([failing(1), failing(2)]), "");
  assert.equal(card([failing(1), failing(2), { ...failing(3), tailHash: "other" }]), "");
});
