import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { DiffFile } from "../types";
import { DiffView, type DiffViewProps } from "./DiffView";

// These tests pin zh-TW, the language their assertions were written in.
const demoFiles = getDemo("zh-TW").files;

const render = (file: DiffFile, view: "unified" | "split" = "unified") =>
  renderZh(
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

test("the idle footer carries the selection hint instead of a separate hint row", () => {
  const html = render(demoFiles[0]);
  assert.match(html, /rv-diff-footer[^>]*>.*點選任何一行，讓 Agent 為你解說/);
  assert.match(html, /rv-shift-hint/);
  assert.doesNotMatch(html, /rv-code-hint/);
});

test("split view labels the before and after columns", () => {
  const html = render(demoFiles[0], "split");
  assert.match(html, /rv-diff-split/);
  assert.match(html, /變更前/);
  assert.match(html, /變更後/);
});

test("the note hint appears only when a note is known to be missing and never disables the checkbox", () => {
  const withHint = renderZh(
    createElement(DiffView, {
      file: demoFiles[0],
      reviewed: false,
      onReview() {},
      onAsk() {},
      view: "unified",
      hasNote: false,
    }),
  );
  assert.match(withHint, /還沒寫下你的理解/);
  assert.doesNotMatch(withHint, /<input type="checkbox"[^>]*disabled/);
  const withNote = renderZh(
    createElement(DiffView, {
      file: demoFiles[0],
      reviewed: false,
      onReview() {},
      onAsk() {},
      view: "unified",
      hasNote: true,
    }),
  );
  assert.doesNotMatch(withNote, /還沒寫下你的理解/);
  assert.doesNotMatch(render(demoFiles[0]), /還沒寫下你的理解/);
});

test("a blocked file shows the reason and disables review", () => {
  const html = render({ ...demoFiles[0], blocked: "原因" });
  assert.match(html, /這個檔案目前無法審閱/);
  assert.match(html, /<p>原因<\/p>/);
  assert.match(html, /<input type="checkbox"[^>]*disabled/);
  assert.doesNotMatch(html, /rv-line-added/);
});

test("an English render of the diff view has no Han in its own text", () => {
  // The English demo's diffs hold only code, so its files serve as they are.
  const files = getDemo("en").files;
  const renderEnglish = (props: Partial<DiffViewProps> & { file: DiffFile }) =>
    renderEn(
      createElement(DiffView, {
        reviewed: false,
        onReview() {},
        onAsk() {},
        view: "unified",
        ...props,
      }),
    );
  for (const file of files) {
    for (const view of ["unified", "split"] as const) {
      const html = renderEnglish({ file, view, hasNote: false });
      assertNoHan(html);
      assert.ok(html.includes(`aria-label="Code changes in ${file.path}"`));
      assert.match(html, /class="rv-note-hint">No note yet</);
      assert.match(html, /Click any line and the agent will explain it/);
      assert.match(html, /<kbd>Shift<\/kbd> for several lines/);
      assert.match(html, /aria-label="Added, line \d+: /);
      if (view === "split") assert.match(html, />Before<\/span><span>After</);
    }
  }
  const reviewed = renderEnglish({ file: files[0], reviewed: true });
  assertNoHan(reviewed);
  assert.match(reviewed, /Reviewed<\/label>/);
  const blocked = renderEnglish({
    file: { ...files[0], blocked: "The file is too large to review." },
  });
  assertNoHan(blocked);
  assert.match(blocked, /This file can&#x27;t be reviewed right now/);
  assert.match(blocked, /<p>The file is too large to review\.<\/p>/);
  const binary = renderEnglish({
    file: { ...files[0], patch: "Binary files differ\n" },
  });
  assertNoHan(binary);
  assert.match(binary, /This file has no text changes to show/);
  assert.match(binary, /can&#x27;t be shown line by line/);
  // An empty added line still gets a readable name.
  const blank = renderEnglish({
    file: { ...files[0], patch: "@@ -1,0 +1,1 @@\n+\n" },
  });
  assert.match(blank, /aria-label="Added, line 1: blank line"/);
});
