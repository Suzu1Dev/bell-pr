import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { PracticeReadyChip } from "./PracticeReadyChip";

test("the Learning item's chip says how many practice items are ready, and nothing at 0", () => {
  assert.equal(renderEn(createElement(PracticeReadyChip, { count: 0 })), "");
  const three = renderEn(createElement(PracticeReadyChip, { count: 3 }));
  assertNoHan(three);
  assert.equal(
    three,
    '<span class="nav-count learning-ready" role="img" aria-label="3 practice items ready" title="3 practice items ready">3 ready</span>',
  );
  assert.match(renderEn(createElement(PracticeReadyChip, { count: 1 })), /aria-label="1 practice item ready"/);
  assert.match(renderZh(createElement(PracticeReadyChip, { count: 2 })), /aria-label="有 2 則練習可以做了"[^>]*>2 則可練習</);
});
