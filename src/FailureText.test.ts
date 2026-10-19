import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "./test-utils/render";
import { FailureText } from "./FailureText";

const render = (text: string) => renderZh(createElement(FailureText, { text }));

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

test("in English the label ends at the first colon and the length is a formatted number", () => {
  const raw = `claude failed: ${'{"type":"result","is_error":true},'.repeat(40)}`;
  const html = renderEn(createElement(FailureText, { text: raw }));
  assertNoHan(html);
  assert.match(html, /^claude failed\.<button type="button" class="failure-toggle" aria-expanded="false">/);
  assert.match(html, /Show the raw output \(1,375 characters\)/);
  assert.match(renderEn(createElement(FailureText, { text: "y".repeat(300) })), /^The command failed\.<button/);
});

test("the label keeps its own language's full stop when the page is in the other language", () => {
  const english = `codex failed: ${'{"type":"error"},'.repeat(40)}`;
  assert.match(render(english), /^codex failed\.<button/);
  const chinese = `claude 執行失敗：${'{"type":"error"},'.repeat(40)}`;
  const html = renderEn(createElement(FailureText, { text: chinese }));
  assert.match(html, /^claude 執行失敗<button/);
});
