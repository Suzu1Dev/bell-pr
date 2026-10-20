// Cut K3 (DESIGN v1.2 F9): the Tests card's live output while BELL runs the
// tests, and "Record my result" for a run in the person's own terminal.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../../test-utils/render";
import { TestsCard } from "./TestsCard";

const at = "2026-10-20T09:00:00.000Z";
const card = (running: boolean) =>
  createElement(TestsCard, {
    runId: "run-1",
    record: running ? { busy: { kind: "tests", since: at } } : {},
    testCommand: { suggestion: "npm test", confirmed: { command: "npm test", confirmedAt: at } },
    onConfirmTestCommand: async () => {},
    onRunTests: async () => {},
    onStopTests: async () => {},
    onReportTests: async () => {},
    busy: false,
  });

test("while the tests run the card shows their output so far, and a result can be recorded by hand", () => {
  const running = renderEn(card(true));
  assertNoHan(running);
  assert.match(running, /<details open=""><summary>Output so far<\/summary><pre><\/pre><\/details>/);
  assert.match(running, /Stop<\/button>/);
  const idle = renderEn(card(false));
  assert.doesNotMatch(idle, /Output so far/);
  assert.match(idle, /<details><summary>Record my result<\/summary><p class="field-help">For a run in your own terminal; it&#x27;s marked as reported by you\.<\/p>/);
  assert.ok(idle.includes("It passed") && idle.includes("It failed"));
  assert.match(renderZh(card(false)), /記錄我的結果/);
});
