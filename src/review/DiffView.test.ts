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

/** A 500-line diff in two hunks: 300 unchanged, 100 removed and 100 added lines. */
function longPatch() {
  const hunk = (start: number, context: number, changed: number, name?: string) => [
    `@@ -${start},${context + changed} +${start},${context + changed} @@${name ? ` ${name}` : ""}`,
    ...Array.from({ length: context }, (_, index) => ` const keep${start + index} = ${index};`),
    ...Array.from({ length: changed }, (_, index) => `-const old${index} = ${index};`),
    ...Array.from({ length: changed }, (_, index) => `+const next${index} = ${index};`),
  ];
  return [
    "diff --git a/src/long.ts b/src/long.ts",
    "--- a/src/long.ts",
    "+++ b/src/long.ts",
    ...hunk(1, 200, 50, "export function first() {"),
    ...hunk(400, 100, 50),
    "",
  ].join("\n");
}

const longFile: DiffFile = {
  ...getDemo("en").files[0],
  path: "src/long.ts",
  patch: longPatch(),
  additions: 100,
  deletions: 100,
};

const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

/** The markup of the list of lines: from the listbox to the hidden keyboard help after it. */
function codeRegion(html: string) {
  const start = html.indexOf('role="listbox"');
  const end = html.indexOf('class="rv-visually-hidden"');
  assert.ok(start > 0 && end > start, "the diff renders a listbox before its keyboard help");
  return html.slice(start, end);
}

test("a 500-line diff is one tab stop: a listbox of lines with a roving tabindex", () => {
  for (const view of ["unified", "split"] as const) {
    const html = renderEn(
      createElement(DiffView, {
        file: longFile,
        reviewed: false,
        onReview() {},
        onAsk() {},
        view,
      }),
    );
    const region = codeRegion(html);
    assert.equal(count(region, /tabindex="0"/g), 1, view);
    assert.equal(count(html, /tabindex="0"/g), 1, view);
    assert.equal(count(region, /tabindex="-1"/g), 499, view);
    // Every code line is one option, named by its own label.
    assert.equal(count(region, /role="option"/g), 500, view);
    assert.equal(count(region, /aria-selected="false"/g), 500, view);
    assert.equal(count(region, /role="option"[^>]*aria-label="(Added|Removed|Unchanged), line \d+: /g), 500, view);
    // The first line holds the tab stop.
    assert.match(region, /tabindex="0" aria-selected="false" aria-label="Unchanged, line 1: const keep1 = 0;"/);
    assert.match(region, /^role="listbox" aria-multiselectable="true" aria-label="Diff lines" aria-describedby="[^"]+"/);
    // Each hunk is a group named after where it starts; the raw header is hidden.
    assert.equal(count(region, /role="group"/g), 2, view);
    assert.match(region, /role="group" aria-label="Changes from old line 1, new line 1, in export function first\(\) \{"/);
    assert.match(region, /role="group" aria-label="Changes from old line 400, new line 400"/);
    assert.equal(count(region, /class="rv-hunk[^"]*" aria-hidden="true"/g), 2, view);
    assertNoHan(html);
  }
  // Split view shows each unchanged line twice; only its new side is in the list.
  const split = renderEn(
    createElement(DiffView, {
      file: longFile,
      reviewed: false,
      onReview() {},
      onAsk() {},
      view: "split",
    }),
  );
  assert.equal(
    count(split, /<div class="rv-line rv-line-context" aria-hidden="true" title=/g),
    300,
  );
});

test("the list of lines explains its keys and has a status for the selection", () => {
  const html = renderEn(
    createElement(DiffView, {
      file: longFile,
      reviewed: false,
      onReview() {},
      onAsk() {},
      view: "unified",
    }),
  );
  const describedBy = /role="listbox"[^>]*aria-describedby="([^"]+)"/.exec(html)![1];
  assert.match(
    html,
    new RegExp(`<p class="rv-visually-hidden" id="${describedBy}">Use the arrow keys to move between lines and Shift with an arrow key to select several\\. Press Enter to go to “Explain this code” for the selection, and Escape to clear it\\.</p>`),
  );
  // Empty until lines are selected, so a screen reader hears the count change.
  assert.match(html, /<span class="rv-visually-hidden" role="status"><\/span>/);
  const zh = renderZh(
    createElement(DiffView, {
      file: longFile,
      reviewed: false,
      onReview() {},
      onAsk() {},
      view: "unified",
    }),
  );
  assert.match(zh, /aria-label="差異的各行"/);
  assert.match(zh, /用方向鍵在各行之間移動.*按 Enter 前往選取範圍的「解說這段程式碼」/);
  assert.match(zh, /aria-label="export function first\(\) \{ 中，從舊版第 1 行、新版第 1 行起的變更"/);
});

test("a diff without code lines shows its empty state instead of an empty list", () => {
  const html = renderEn(
    createElement(DiffView, {
      file: { ...longFile, patch: "@@ -1,0 +1,0 @@\n\\ No newline at end of file\n" },
      reviewed: false,
      onReview() {},
      onAsk() {},
      view: "unified",
    }),
  );
  assert.match(html, /This file has no text changes to show/);
  assert.doesNotMatch(html, /role="listbox"/);
  // Without lines there are no keys to explain and nothing to select.
  assert.doesNotMatch(html, /rv-visually-hidden/);
  const blocked = renderEn(
    createElement(DiffView, {
      file: { ...longFile, blocked: "The file is too large to review." },
      reviewed: false,
      onReview() {},
      onAsk() {},
      view: "unified",
    }),
  );
  assert.doesNotMatch(blocked, /role="listbox"|rv-visually-hidden/);
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
  const html = renderZh(
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
  // The gap rows stay inside the list's groups, which they name.
  assert.match(html, /role="group" aria-label="export function count\(\) \{ 中，從舊版第 4 行、新版第 4 行起的變更"><div class="rv-hunk rv-gap" role="none">/);
  assert.match(html, /role="group" aria-label="最後一段變更之後的未變更程式碼"><div class="rv-hunk rv-gap" role="none">/);
  const english = renderEn(
    createElement(DiffView, {
      file,
      reviewed: false,
      onReview() {},
      onAsk() {},
      view: "split",
      onLoadBase: async () => [],
    }),
  );
  assertNoHan(english);
  assert.match(english, /aria-label="Show 3 more lines above this change"/);
  assert.match(english, /3 unchanged lines/);
  assert.match(english, /aria-label="Show the rest of the file"/);
  assert.match(english, /Whole file/);
});

test("a submodule or a mode-only change offers no expansion", () => {
  const withLoader = (file: DiffFile) =>
    renderZh(
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
  } as const;
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

test("a highlighted range marks its lines in the changed version only", () => {
  const client = demoFiles.find((entry) => entry.path === "src/client.ts")!;
  const html = renderZh(
    createElement(DiffView, {
      file: client,
      reviewed: false,
      onReview() {},
      onAsk() {},
      view: "unified",
      highlight: { startLine: 12, endLine: 16 },
    }),
  );
  // Each marked row's new-file number, from its second gutter.
  const marked = [
    ...html.matchAll(
      /class="rv-line [^"]*rv-line-highlighted[^"]*"[^>]*>(?:<span class="rv-gutter rv-gutter-old">\d*<\/span>)<span class="rv-gutter">(\d+)<\/span>/g,
    ),
  ].map((match) => Number(match[1]));
  // Lines 12 to 16 of the new file; the two removed lines in between are not marked.
  assert.deepEqual(marked, [12, 13, 14, 15, 16]);
  assert.doesNotMatch(html, /rv-line-removed[^"]*rv-line-highlighted/);
});
