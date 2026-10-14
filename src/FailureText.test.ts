import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FailureText } from "./FailureText";

const render = (text: string) => renderToStaticMarkup(createElement(FailureText, { text }));

test("a sentence-long error is shown as is", () => {
  const text = "claude 執行失敗：API Error: 500 Internal server error";
  assert.equal(render(text), text);
});

test("a CLI's raw output is folded behind its label, with its length", () => {
  const raw = `claude 執行失敗：cess is refreshing it${'"},{"type":"result"'.repeat(30)}`;
  const html = render(raw);
  assert.match(html, /^claude 執行失敗。<button type="button" class="failure-toggle" aria-expanded="false">/);
  assert.match(html, new RegExp(`查看原始輸出（${raw.length} 字）`));
  assert.doesNotMatch(html, /cess is refreshing/);
  assert.match(render("x".repeat(300)), /^執行失敗。<button/);
});
