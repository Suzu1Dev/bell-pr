// The Learn-by-hand UI contract (DESIGN v1.2 §11.1): the one lazy chunk's
// entry re-exports every component, and each stub renders nothing until W2
// builds it. Each new UI file renders in English with no Han characters.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type FunctionComponent } from "react";
import { getDemo } from "../demo";
import { assertNoHan, renderEn } from "../test-utils/render";
import * as lazy from "./lazy";
import { ModeChoice } from "./ModeChoice";

const run = getDemo("en").run;
const files = getDemo("en").files;
const noop = async () => {};

test("the lazy chunk's entry has every Learn-by-hand component", () => {
  assert.deepEqual(Object.keys(lazy).sort(), [
    "ByHandRecord",
    "DraftHelpers",
    "GuidePanel",
    "PlanWithGuide",
    "ReadyDialog",
    "YourTurn",
  ]);
});

test("each Learn-by-hand stub renders in English, with no Han characters", () => {
  const stubs: [(props: never) => null, object][] = [
    [ModeChoice, { mode: "agents", onModeChange: () => {}, fitted: false, onFittedChange: () => {} }],
    [lazy.PlanWithGuide, { run, onSave: noop, onReveal: noop, onAskQuestions: noop, onConfirm: noop }],
    [lazy.YourTurn, { run, worktreePath: "/tmp/run" }],
    [
      lazy.GuidePanel,
      {
        run,
        files,
        onGuide: noop,
        onStep: noop,
        onCheckIn: noop,
        onConfirmTestCommand: noop,
        onRunTests: noop,
        onStopTests: noop,
        onReportTests: noop,
        onLeave: noop,
      },
    ],
    [lazy.ReadyDialog, { run, files, open: true, onClose: () => {}, onReady: noop }],
    [lazy.ByHandRecord, { run, place: "publish" }],
    [lazy.DraftHelpers, { run, onUseTemplate: () => {} }],
  ];
  for (const [component, props] of stubs) {
    const html = renderEn(createElement(component as unknown as FunctionComponent<object>, props));
    assertNoHan(html);
    assert.equal(html, "", component.name);
  }
});
