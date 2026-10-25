import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderEn } from "../test-utils/render";
import { PresentationCursor } from "./AppShell";

test("the presentation cursor is a ring that assistive technology skips", () => {
  assert.equal(
    renderEn(createElement(PresentationCursor)),
    '<div class="presentation-cursor" aria-hidden="true"></div>',
  );
});
