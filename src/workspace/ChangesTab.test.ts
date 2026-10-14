import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { DiffFile, Run } from "../types";
import { ChangesTab } from "./ChangesTab";

type Props = Parameters<typeof ChangesTab>[0];

const files: DiffFile[] = [
  {
    path: "src/hello.ts",
    language: "TypeScript",
    additions: 2,
    deletions: 1,
    status: "modified",
    patch: "@@ -1 +1,2 @@\n-a\n+b\n+c",
    fingerprint: "f1",
  },
  {
    path: "README.md",
    language: "Markdown",
    additions: 1,
    deletions: 0,
    status: "modified",
    patch: "@@ -1 +1,2 @@\n a\n+b",
    fingerprint: "f2",
  },
];
const run: Run = {
  id: "run-1",
  repoId: "repo-1",
  title: "Greet the world",
  prompt: "Greet the world",
  status: "review",
  branch: "fix/run1",
  baseBranch: "main",
  baseSha: "c".repeat(40),
  worktreePath: "/home/someone/.bellpr/worktrees/run-1",
  createdAt: "2026-10-10T00:00:00Z",
  agents: [],
  logs: [],
  draft: { title: "fix: greet", body: "Greets." },
  reviewedFiles: [],
  // The Lead's summary names a reading order, so the second toggle shows.
  reports: {
    implementer:
      "## Suggested review order:\n\n1. `README.md` — the docs first.\n2. `src/hello.ts` — then the code.",
  },
};

const element = (props: Partial<Props> = {}) =>
  createElement(ChangesTab, {
    run,
    files,
    file: files[0],
    selectedPath: files[0].path,
    setSelectedPath() {},
    currentRepo: undefined,
    demo: false,
    active: false,
    editable: true,
    reviewRerunning: false,
    reviewedCount: 0,
    allReviewed: false,
    setTab() {},
    focusMode: false,
    setFocusMode() {},
    showFiles: true,
    setShowFiles() {},
    showExplanation: true,
    setShowExplanation() {},
    codeFont: 14,
    setCodeFont() {},
    explanationWidth: 340,
    setExplanationWidth() {},
    fileSearch: "",
    setFileSearch() {},
    onlyUnreviewed: false,
    setOnlyUnreviewed() {},
    suggestedOrder: false,
    setSuggestedOrder() {},
    diffView: "unified",
    setDiffView() {},
    intelligence: { insights: null, stale: false },
    explanationRequests: new Set<string>(),
    async prepareExplanations() {},
    actions: {
      messages: {},
      chatRequests: {},
      setChatRequests() {},
      chatLoading: false,
      rerunRequests: new Set<string>(),
      async refreshRun() {},
      async copyWorktreePath() {},
      async rerunReview() {},
      async reviewFile() {},
      async saveNote() {},
      async ask() {},
    },
    ...props,
  });

/** The opening tag of the first element whose attributes match `marker`. */
const tag = (html: string, marker: RegExp) =>
  html.match(new RegExp(`<[a-z]+[^>]*${marker.source}[^>]*>`))?.[0] ?? "";

test("the two file filters share one row and say whether they are on", () => {
  const html = renderEn(element({ onlyUnreviewed: true }));
  const filters = html.match(/<div class="file-filters">(.*?)<\/div><div class="file-tree">/)?.[1];
  assert.ok(filters, "the filters sit in their own row before the file list");
  assert.match(filters, /aria-pressed="true"[^>]*>.*?Only unreviewed/);
  assert.match(filters, /aria-pressed="false"[^>]*>.*?Suggested order/);
  // The decorative search mark is hidden from screen readers.
  assert.match(html, /<kbd aria-hidden="true">/);
  assertNoHan(html);
});

test("the file search opens from an icon button that names what it does", () => {
  const closed = renderEn(element());
  const toggle = tag(closed, /class="icon-button file-search-toggle"/);
  assert.match(toggle, /aria-label="Search the changed files"/);
  assert.match(toggle, /aria-expanded="false"/);
  assert.match(toggle, /aria-controls="workspace-file-search"/);
  assert.match(closed, /<input id="workspace-file-search"/);
  assert.doesNotMatch(closed, /is-search-open/);
  // A query keeps the search shown, and the button then closes it.
  const searching = renderEn(element({ fileSearch: "hello" }));
  assert.match(searching, /class="file-panel is-search-open"/);
  assert.match(
    tag(searching, /class="icon-button file-search-toggle"/),
    /aria-label="Close the file search"[^>]*aria-expanded="true"/,
  );
  assertNoHan(searching);
});

test("the diff view buttons form a labelled group with the pressed one marked", () => {
  const html = renderEn(element({ diffView: "split" }));
  assert.match(html, /<div class="view-toggle" role="group" aria-label="Diff view mode">/);
  assert.match(tag(html, /aria-label="Unified view"/), /aria-pressed="false"/);
  assert.match(tag(html, /aria-label="Split view"/), /aria-pressed="true"/);
  assert.match(renderZh(element()), /只看尚未審查/);
});
