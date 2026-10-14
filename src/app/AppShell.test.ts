import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { PresentationCursor, SessionEndedNotice } from "./AppShell";

test("an ended session says how to sign in again, in English with no Chinese left", () => {
  const html = renderEn(createElement(SessionEndedNotice, { onDismiss() {} }));
  assert.match(html, /^<div role="alert" class="session-banner">/);
  assert.match(html, /<strong>Your session ended\.<\/strong>/);
  assert.match(html, /<code>bell-pr open<\/code>/);
  assert.match(html, /This page stays as it is until then/);
  assert.match(html, /aria-label="Dismiss notification"/);
  assertNoHan(html);
  assert.match(
    renderZh(createElement(SessionEndedNotice, { onDismiss() {} })),
    /<strong>工作階段已結束。<\/strong>/,
  );
});

test("the presentation cursor is a ring that assistive technology skips", () => {
  assert.equal(
    renderEn(createElement(PresentationCursor)),
    '<div class="presentation-cursor" aria-hidden="true"></div>',
  );
});
