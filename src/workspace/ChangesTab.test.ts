import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { DiffFile, Run } from "../types";
import { maskPath } from "../app/presentation";
import { closeCheckPanel, openCheckPanel, type Understanding } from "../app/hooks/useUnderstanding";
import { ChangesTab, WorktreeHint } from "./ChangesTab";

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

test("the diff toolbar is one labelled tab stop", () => {
  /** The toolbar's markup and the tabindex of each of its buttons. */
  const toolbar = (props: Partial<Props> = {}) => {
    const html = renderEn(element(props));
    const start = html.indexOf('role="toolbar"');
    // Up to the diff: the premise and worktree row sits above the review grid.
    const markup = html.slice(start, html.indexOf('class="rv-diff', start));
    return {
      html,
      stops: [...markup.matchAll(/<button[^>]*tabindex="(-?\d)"/g)].map((match) => match[1]),
    };
  };
  const { html, stops } = toolbar();
  assert.match(html, /<div class="diff-toolbar-actions" role="toolbar" aria-label="Diff tools">/);
  assert.deepEqual(stops, ["0", "-1", "-1", "-1", "-1", "-1", "-1", "-1"]);
  assertNoHan(html);
  assert.match(renderZh(element()), /role="toolbar" aria-label="Diff 工具"/);
});

test("the worktree path can be copied, except while presenting, when it loses its folders", () => {
  const html = renderEn(element());
  assert.match(html, /<code><span>\/home\/someone\/\.bellpr\/worktrees\/run-1<\/span><\/code>/);
  assert.match(html, /aria-label="Copy the worktree path"/);
  const path = run.worktreePath!;
  const presenting = renderEn(
    createElement(WorktreeHint, {
      path,
      presenting: true,
      maskPath: (value: string) => maskPath(value, undefined, true),
      onCopy() {},
    }),
  );
  assert.match(presenting, /<code><span>…\/run-1<\/span><\/code>/);
  assert.doesNotMatch(presenting, /someone|\/home\//);
  assert.doesNotMatch(presenting, /Copy the worktree path/);
  assertNoHan(presenting);
});

test("the premise check and the worktree share one row above the diff, the path on one line with the hint as its tooltip", () => {
  const premise = {
    verdict: "holds",
    statement: "GET requests do not retry today.",
    evidence: "src/client.ts:12 sends one fetch.",
  } as const;
  const team = { ...(run.team ?? {}), premise } as NonNullable<Run["team"]>;
  const html = renderEn(element({ run: { ...run, team } }));
  const bar = html.slice(html.indexOf('<div class="diff-context-bar">'));
  assert.match(
    bar,
    /^<div class="diff-context-bar"><section class="premise-notice premise-holds premise-compact" aria-label="Premise check"><details><summary>.*?<span>GET requests do not retry today\.<\/span><\/summary>/,
  );
  assert.match(
    bar,
    /<\/section><div class="worktree-hint" title="You can edit files in this folder directly\. Refresh the diff to update the explanations and the review status\."><svg[^>]*><path[^]*?<\/svg><span>Worktree<\/span><span class="visually-hidden">You can edit files/,
  );
  assertNoHan(html);
  assert.match(renderZh(element({ run: { ...run, team } })), /<span>工作目錄<\/span>/);
  // Without a premise the bar holds the worktree alone; with neither, there is no bar.
  assert.match(renderEn(element()), /<div class="diff-context-bar"><div class="worktree-hint"/);
  assert.doesNotMatch(renderEn(element({ editable: false })), /diff-context-bar/);
});

test("a run whose files were cleaned up says so instead of offering its folder", () => {
  const html = renderEn(
    element({
      run: { ...run, workspaceRemovedAt: "2026-10-12T00:00:00Z" },
      files: [],
      file: undefined,
      selectedPath: "",
    }),
  );
  assert.match(html, /The changed files were cleaned up/);
  assert.match(html, /Reports and notes are kept\./);
  assert.doesNotMatch(html, /worktree-hint/);
  assertNoHan(html);
});

/** The check as useUnderstanding reports it. */
const understanding = (fields: Partial<Understanding> = {}) =>
  ({
    view: undefined,
    required: true,
    passed: false,
    off: false,
    tryFirst: true,
    error: undefined,
    refresh() {},
    async saveAnswers() {},
    async saveGrades() {},
    async confirmSummary() {},
    async restart() {},
    async saveForecast() {},
    async saveAttempt() {},
    ...fields,
  }) as Understanding;

test("the Changes header offers the check before every file is ticked", () => {
  const html = renderEn(element({ understanding: understanding() }));
  // Under the file list's heading, before the files: it adds no stop between
  // the file list and the explanation.
  assert.match(html, /<\/div><button type="button" class="check-link">.*Take the check now<\/button><label class="file-search">/);
  assert.match(
    renderEn(element({ understanding: understanding({ passed: true }) })),
    /class="check-link">.*Open your check<\/button>/,
  );
  // Only a run waiting for review or approval takes the check.
  assert.doesNotMatch(
    renderEn(element({ run: { ...run, status: "published" }, understanding: understanding() })),
    /check-link/,
  );
  assertNoHan(html);
});

test("every file ticked: the hint points at the check, unless it is off or passed", () => {
  const ticked = (fields: Partial<Understanding>) =>
    renderEn(element({ allReviewed: true, reviewedCount: 2, understanding: understanding(fields) }));
  assert.match(ticked({}), /Every file reviewed\. Next: explain it back\./);
  assert.match(ticked({ required: false, off: true }), /<small>Every file reviewed\.<\/small>/);
  assert.match(ticked({ passed: true }), /<small>Every file reviewed\.<\/small>/);
  // A published run takes no check any more, so nothing comes next.
  assert.match(
    renderEn(
      element({
        run: { ...run, status: "published" },
        allReviewed: true,
        reviewedCount: 2,
        understanding: understanding(),
      }),
    ),
    /<small>Every file reviewed\.<\/small>/,
  );
  assert.match(
    renderEn(element()),
    /Once you have read a file and its explanation, mark it as reviewed\./,
  );
});

test("while the check is open it takes the explanation's place: closed book", () => {
  try {
    openCheckPanel(run.id);
    const html = renderEn(element({ understanding: understanding() }));
    assert.match(html, /<div class="check-wrap">/);
    assert.doesNotMatch(html, /check-link/);
    // The explanation panel is not mounted at all, so no note or reference can show.
    assert.doesNotMatch(html, /explain-panel/);
    // Another run's workspace keeps its explanation.
    assert.doesNotMatch(
      renderEn(element({ run: { ...run, id: "run-2" }, understanding: understanding() })),
      /check-wrap/,
    );
  } finally {
    closeCheckPanel();
  }
});
