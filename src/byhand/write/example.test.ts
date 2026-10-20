// Cut K5 (DESIGN v1.2 F6): the R4 rung, "An example in this project",
// after R3 and an attempt; there is no code rung past it.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../../test-utils/render";
import type { DiffFile, Run } from "../../types";
import { GuidePanel } from "./GuidePanel";

const at = "2026-10-20T09:00:00.000Z";
const files: DiffFile[] = [{ path: "a.ts", language: "TypeScript", additions: 1, deletions: 0, status: "modified", patch: "", fingerprint: "f2" }];
const noop = async () => {};
const panel = (byHand: Run["byHand"]) =>
  createElement(GuidePanel, {
    run: { id: "run-1", repoId: "repo-1", status: "review", learnByHand: true, agents: [], byHand } as unknown as Run,
    files,
    onGuide: noop,
    onStep: noop,
    onCheckIn: noop,
    onConfirmTestCommand: noop,
    onRunTests: noop,
    onStopTests: noop,
    onReportTests: noop,
    onLeave: noop,
  });
const plan = { steps: [{ id: "s1", title: "Cap the retries", maxRung: 3 }], savedAt: at };

test("after Options and an attempt, the ladder offers an example in this project", () => {
  // R3 was given at another version: the change since counts as an attempt.
  const html = renderEn(panel({ plan, hints: { s1: { rung: 3, at, fingerprint: "older" } } }));
  assertNoHan(html);
  assert.match(html, /<button type="button" class="button secondary"><svg[\s\S]*?<\/svg> Next hint: An example in this project<\/button>/);
  assert.match(renderZh(panel({ plan, hints: { s1: { rung: 3, at, fingerprint: "older" } } })), /專案裡的例子/);
  // Past R4 there is no code rung: the exits.
  assert.ok(renderEn(panel({ plan, hints: { s1: { rung: 4, at, fingerprint: "older" } } })).includes("No hint left on this step; the exits are below."));
});
