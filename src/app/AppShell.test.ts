import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderEn } from "../test-utils/render";
import { aboutShown, PresentationCursor } from "./AppShell";

test("the presentation cursor is a ring that assistive technology skips", () => {
  assert.equal(
    renderEn(createElement(PresentationCursor)),
    '<div class="presentation-cursor" aria-hidden="true"></div>',
  );
});

test("About opens from the app or from #/about, but the address does not lay it over another dialog", () => {
  assert.equal(aboutShown("about", { name: "settings", section: "about" }), true);
  assert.equal(aboutShown(null, { name: "about" }), true);
  assert.equal(aboutShown(null, { name: "home" }), false);
  // Closing About would close the dialog under it, such as a split that is
  // still being sent; About shows once that dialog has closed.
  for (const modal of ["split", "task", "help", "runs"] as const)
    assert.equal(aboutShown(modal, { name: "about" }), false, modal);
});
