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
  const withHint = renderToStaticMarkup(
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
  const withNote = renderToStaticMarkup(
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

test("a modified file offers its unchanged code around the changes; the demo shows its files as they are", () => {
  const file: DiffFile = {
    path: "src/count.ts",
    language: "TypeScript",
    additions: 1,
    deletions: 1,
    status: "modified",
    fingerprint: "f".repeat(64),
    patch: [
      "@@ -4,3 +4,3 @@ export function count() {",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
      " const c = 4;",
    ].join("\n"),
  };
  const html = renderToStaticMarkup(
    createElement(DiffView, {
      file,
      reviewed: false,
      onReview() {},
      onAsk() {},
      view: "unified",
      onLoadBase: async () => [],
    }),
  );
  assert.match(html, /aria-pressed="false"[^>]*>.*完整檔案/);
  assert.match(html, /aria-label="顯示這段變更上方的 3 行"/);
  assert.match(html, /3 行未變更/);
  assert.match(html, /aria-label="顯示到檔案結尾"/);
  assert.match(html, /aria-label="顯示上一段變更下方的 20 行"/);
  // No loader: the plain hunk header, no arrows and no whole-file toggle.
  for (const demo of demoFiles) {
    const plain = render(demo);
    assert.doesNotMatch(plain, /完整檔案|rv-gap/);
  }
  assert.doesNotMatch(render(file), /完整檔案|rv-gap/);
  assert.match(render(file), /@@ -4,3 \+4,3 @@/);
});

test("a highlighted range marks its lines in the changed version only", () => {
  const client = demoFiles.find((entry) => entry.path === "src/client.ts")!;
  const html = renderToStaticMarkup(
    createElement(DiffView, {
      file: client,
      reviewed: false,
      onReview() {},
      onAsk() {},
      view: "unified",
      highlight: { startLine: 12, endLine: 16 },
    }),
  );
  const marked = html.match(/rv-line-highlighted/g) ?? [];
  // Lines 12 to 16 of the new file; the two removed lines in between are not marked.
  assert.equal(marked.length, 5);
  assert.doesNotMatch(html, /rv-line-removed rv-line-highlighted|rv-line-removed[^"]*rv-line-highlighted/);

test("a submodule or a mode-only change offers no expansion", () => {
  const withLoader = (file: DiffFile) =>
    renderToStaticMarkup(
      createElement(DiffView, {
        file,
        reviewed: false,
        onReview() {},
        onAsk() {},
        view: "unified",
        onLoadBase: async () => [],
      }),
    );
  const base = {
    language: "Text",
    additions: 1,
    deletions: 1,
    status: "modified",
    fingerprint: "f".repeat(64),
  };
  const submodule = withLoader({
    ...base,
    path: "vendor/lib",
    patch: [
      "diff --git a/vendor/lib b/vendor/lib",
      "index 1111111..2222222 160000",
      "--- a/vendor/lib",
      "+++ b/vendor/lib",
      "@@ -1 +1 @@",
      "-Subproject commit 1111111111111111111111111111111111111111",
      "+Subproject commit 2222222222222222222222222222222222222222",
    ].join("\n"),
  });
  assert.doesNotMatch(submodule, /完整檔案|rv-gap/);
  const modeOnly = withLoader({
    ...base,
    path: "run.sh",
    additions: 0,
    deletions: 0,
    patch: "diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n",
  });
  assert.doesNotMatch(modeOnly, /完整檔案|rv-gap/);
});
