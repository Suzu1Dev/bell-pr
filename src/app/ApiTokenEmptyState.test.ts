import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "../i18n";
import en from "../i18n/en";
import zhTW from "../i18n/zh-TW";
import { ApiTokenEmptyState } from "./ApiTokenEmptyState";

test("a missing API token shows how to open bell-pr, not the request header", () => {
  const english = renderToStaticMarkup(
    createElement(LocaleProvider, { locale: "en", messages: en }, createElement(ApiTokenEmptyState)),
  );
  assert.match(english, /class="empty-state"/);
  assert.match(english, /Run `bell-pr` on the computer hosting BELL PR to reopen your workspace\./);
  assert.doesNotMatch(english, /Bearer|X-Bell-Token/);

  const chinese = renderToStaticMarkup(
    createElement(
      LocaleProvider,
      { locale: "zh-TW", messages: zhTW },
      createElement(ApiTokenEmptyState),
    ),
  );
  assert.match(chinese, /請在執行 BELL PR 的電腦上執行 `bell-pr`，重新開啟工作台。/);
  assert.doesNotMatch(chinese, /Bearer|X-Bell-Token/);
});
