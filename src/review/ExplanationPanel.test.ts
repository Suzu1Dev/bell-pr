import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoFiles } from "../demo";
import type { DiffFile } from "../types";
import { ExplanationPanel } from "./ExplanationPanel";

const render = (file: DiffFile) =>
  renderToStaticMarkup(
    createElement(ExplanationPanel, {
      file,
      messages: [],
      loading: false,
      onAsk() {},
      demo: true,
    }),
  );

test("a demo file with an explanation renders every learning section", () => {
  const file = demoFiles[0];
  assert.ok(file.explanation, "demo fixture must carry an explanation");
  const html = render(file);
  assert.match(html, /aria-label="程式碼學習助手"/);
  for (const title of [
    "白話文舉例",
    "這段改了什麼？",
    "為什麼這樣改？",
    "帶走一個開發觀念",
    "審閱時，多想一步",
  ]) {
    assert.match(html, new RegExp(title));
  }
  assert.match(html, /指數退避（Exponential backoff）/);
  assert.match(html, /示範解說 · 預先整理的學習內容/);
});

test("a blocked file explains why no explanation is available", () => {
  const html = render({ ...demoFiles[0], blocked: "原因" });
  assert.match(html, /目前無法解說此檔案/);
  assert.match(html, /<p>原因<\/p>/);
  assert.doesNotMatch(html, /這段改了什麼？/);
});
