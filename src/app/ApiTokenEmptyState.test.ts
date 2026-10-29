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
  assert.match(english, /Open bell-pr from this computer by running `bell-pr open`\./);
  assert.doesNotMatch(english, /Bearer|X-Bell-Token/);

  const chinese = renderToStaticMarkup(
    createElement(
      LocaleProvider,
      { locale: "zh-TW", messages: zhTW },
      createElement(ApiTokenEmptyState),
    ),
  );
  assert.match(chinese, /請在這台電腦執行 `bell-pr open` 開啟 bell-pr。/);
  assert.doesNotMatch(chinese, /Bearer|X-Bell-Token/);
});
