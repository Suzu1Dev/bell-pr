// The Learn-by-hand UI contract (DESIGN v1.2 §11.1): the one lazy chunk's
// entry re-exports every component, and each stub renders nothing until W2
// builds it. Each new UI file renders in English with no Han characters.
// The writing views and the mode choice are built (their tests are in
// src/byhand/write/ and src/byhand/ModeChoice.test.ts).
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type FunctionComponent } from "react";
import { getDemo } from "../demo";
import { assertNoHan, renderEn } from "../test-utils/render";
import * as lazy from "./lazy";

const run = getDemo("en").run;

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
    [lazy.ByHandRecord, { run, place: "publish" }],
    [lazy.DraftHelpers, { run, onUseTemplate: () => {} }],
  ];
  for (const [component, props] of stubs) {
    const html = renderEn(createElement(component as unknown as FunctionComponent<object>, props));
    assertNoHan(html);
    assert.equal(html, "", component.name);
  }
});
