import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { getCurrentLocale, useFormat, useLocale, useT } from "../i18n";
import { assertNoHan, renderEn, renderWith, renderZh } from "./render";

function Status() {
  const t = useT("common");
  const [locale] = useLocale();
  const fmt = useFormat();
  return createElement(
    "span",
    { lang: locale },
    `${t.runStatus.failed}: ${fmt.list(["a", "b", "c"], { type: "unit" })}`,
  );
}

test("renderEn and renderZh pin the locale, dictionary and formatters", () => {
  assert.equal(
    renderEn(createElement(Status)),
    '<span lang="en">Failed: a, b, c</span>',
  );
  assert.equal(
    renderZh(createElement(Status)),
    '<span lang="zh-TW">執行失敗: a、b、c</span>',
  );
  assert.equal(
    renderWith("zh-TW", createElement(Status)),
    renderZh(createElement(Status)),
  );
  // Rendering a locale never changes the app's active locale.
  assert.equal(getCurrentLocale(), "en");
});

test("assertNoHan accepts English text with typographic punctuation", () => {
  assertNoHan(renderEn(createElement(Status)));
  assertNoHan("BELL PR — “quoted”, it’s… café 😀 ①");
  // The middle dot lists Han among its script extensions, but English uses
  // it as a separator.
  assertNoHan("TRIAL · 14d");
});

test("assertNoHan rejects Han characters and CJK punctuation", () => {
  assert.throws(
    () => assertNoHan(renderZh(createElement(Status))),
    /found "執" \(U\+57F7\) at index 19/,
  );
  // The ideographic comma and the full-width semicolon are not Han by
  // script, but they only appear in Chinese text.
  for (const text of ["a、b", "a；b", "「a」", "Ａ", "a。"])
    assert.throws(() => assertNoHan(text), /Expected no Han/, text);
  assert.throws(() => assertNoHan("x".repeat(100) + "中"), /…x{40}中…/);
});
