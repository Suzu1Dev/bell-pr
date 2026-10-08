import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoFiles } from "../demo";
import type { DiffFile } from "../types";
import { DiffView } from "./DiffView";

const render = (file: DiffFile, view: "unified" | "split" = "unified") =>
  renderToStaticMarkup(
    createElement(DiffView, {
      file,
      reviewed: false,
      onReview() {},
      onAsk() {},
      view,
    }),
  );

test("every demo file renders its name and diff lines", () => {
  for (const file of demoFiles) {
    const html = render(file);
    const name = file.path.split("/").pop();
    assert.ok(html.includes(`<strong>${name}</strong>`));
    assert.ok(html.includes(`aria-label="${file.path} 的程式碼差異"`));
    assert.match(html, /rv-line-added/);
    assert.match(html, new RegExp(`\\+${file.additions}<`));
  }
});

test("split view labels the before and after columns", () => {
  const html = render(demoFiles[0], "split");
  assert.match(html, /rv-diff-split/);
  assert.match(html, /變更前/);
  assert.match(html, /變更後/);
});

test("a blocked file shows the reason and disables review", () => {
  const html = render({ ...demoFiles[0], blocked: "原因" });
  assert.match(html, /這個檔案目前無法審閱/);
  assert.match(html, /<p>原因<\/p>/);
  assert.match(html, /<input type="checkbox"[^>]*disabled/);
  assert.doesNotMatch(html, /rv-line-added/);
});
