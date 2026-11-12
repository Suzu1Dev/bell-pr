import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { DiffFile, Run } from "../types";
import { closeCheckPanel, openCheckPanel, type Understanding } from "../app/hooks/useUnderstanding";
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

test("the file list and checkbox reject a review mark for another round's fingerprint", () => {
  const stale = { ...run, reviewedFiles: [files[0].path], reviewedFingerprints: { [files[0].path]: "old-round" } };
  const html = renderEn(element({ run: stale }));
  assert.doesNotMatch(html, /class="file-reviewed"/);
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked=""/);
  const current = renderEn(element({ run: { ...stale, reviewedFingerprints: { [files[0].path]: files[0].fingerprint! } } }));
  assert.match(current, /class="[^"]*file-reviewed/);
  assert.match(current, /type="checkbox"[^>]*checked=""/);
});

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

test("published files ignore the old unreviewed filter and keep explanations without review controls", () => {
  const published: Run = {
    ...run, status: "published", reviewedFiles: [files[0].path],
    reviewedFingerprints: { [files[0].path]: files[0].fingerprint! },
  };
  const html = renderEn(element({ run: published, onlyUnreviewed: true, editable: false }));
  assert.equal((html.match(/class="file-item /g) ?? []).length, files.length);
  assert.doesNotMatch(html, /Only unreviewed|review-progress|rv-reviewed|file-reviewed/);
  assert.match(html, /Suggested order/);
  assert.match(html, /explanation-wrap/);
  assert.match(html, /Click any line and the agent will explain it/);
  const sample = renderEn(element({ run: published, demo: true, onlyUnreviewed: true }));
  assert.match(sample, /Only unreviewed|review-progress|rv-reviewed/);
  assert.equal((sample.match(/class="file-item /g) ?? []).length, 1);
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

test("the premise check sits in the diff's top bar and no row is left above the code", () => {
  const premise = {
    verdict: "holds",
    statement: "GET requests do not retry today.",
    evidence: "src/client.ts:12 sends one fetch.",
  } as const;
  const team = { ...(run.team ?? {}), premise } as NonNullable<Run["team"]>;
  const html = renderEn(element({ run: { ...run, team } }));
  const topbar = html.slice(html.indexOf('<div class="diff-topbar">'), html.indexOf('role="toolbar"'));
  assert.match(
    topbar,
    /<section class="premise-notice premise-holds premise-compact" aria-label="Premise check"><details><summary>.*?<span>GET requests do not retry today\.<\/span><\/summary><div class="premise-detail" role="region" tabindex="0" aria-label="Evidence and source"><p class="premise-statement">GET requests do not retry today\.<\/p><p>src\/client\.ts:12 sends one fetch\.<\/p>/,
  );
  // The review grid follows the pane's own top bar directly: no worktree or other row above the code.
  assert.doesNotMatch(html, /diff-context-bar|worktree/i);
  assertNoHan(html);
  assert.match(renderZh(element({ run: { ...run, team } })), /aria-label="前提查核"/);
});

test("the open premise check covers the code but stays under the narrow window's navigation drawer", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`\n${selector} {\n`);
    assert.notEqual(start, -1, selector);
    return css.slice(start, css.indexOf("\n}", start));
  };
  // The overlay lies above the diff's sticky layers...
  assert.match(rule(".diff-topbar > .premise-compact details[open] > .premise-detail"), /z-index: 20;/);
  // ...but only inside the pane: the drawer (20) and its scrim (19) paint above it.
  assert.match(rule(".diff-panel"), /isolation: isolate;/);
});

test("a run whose files were cleaned up says so", () => {
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
  // A published run asks for neither a new check nor new review marks.
  assert.doesNotMatch(
    renderEn(
      element({
        run: { ...run, status: "published" },
        allReviewed: true,
        reviewedCount: 2,
        understanding: understanding(),
      }),
    ),
    /review-progress|Every file reviewed/,
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
    const focused = renderEn(element({ understanding: understanding(), focusMode: true, showFiles: false, showExplanation: false }));
    assert.match(focused, /<div class="check-wrap">/);
    assert.doesNotMatch(focused, /review-grid[^"]*explanation-hidden/);
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

test("while the person writes a learn-by-hand change, the guide takes the explanation's place", () => {
  const byHandRun: Run = { ...run, learnByHand: true, byHand: {} };
  const writing = { writing: true, openReady() {}, ask() {}, guide: {} } as unknown as Props["byHand"];
  const html = renderEn(element({ run: byHandRun, byHand: writing }));
  assertNoHan(html);
  // The guide's panel loads lazily in the aside, with a fixed loading state.
  assert.match(html, /<aside class="explanation-wrap"><div class="empty-state" role="status"><svg[^>]*spin[\s\S]*?<\/svg><p>Preparing the reading panel…<\/p><\/div><\/aside>/);
  // No diff yet: "Your turn" replaces "No code changes yet".
  const empty = renderEn(element({ run: byHandRun, files: [], file: undefined, byHand: writing }));
  assert.doesNotMatch(empty, /No code changes yet/);
  // Changed after Ready: the notice above the diff.
  const changed = renderEn(element({ run: { ...byHandRun, byHand: { ready: { at: run.createdAt, changeFingerprint: "0000000000000000", review: true } } }, byHand: writing }));
  assert.ok(changed.includes("You changed the code after marking it ready. The review and the check wait until you mark it ready again."));
  assert.doesNotMatch(html, /You changed the code after marking it ready/);
  // An agent run keeps its explanation panel and its empty state.
  assert.match(renderEn(element({ files: [], file: undefined })), /No code changes yet/);
  // Explain it back opens after Ready (DESIGN v1.2 F10), not while the person writes.
  assert.doesNotMatch(renderEn(element({ run: byHandRun, byHand: writing, understanding: understanding() })), /Take the check now/);
  const ready = { writing: false, openReady() {}, ask() {}, guide: {} } as unknown as Props["byHand"];
  assert.match(renderEn(element({ run: byHandRun, byHand: ready, understanding: understanding() })), /Take the check now/);
});

test("before a learn-by-hand run's first change, Code changes says the guide reads and the person plans, never the agent team", () => {
  const empty = (status: Run["status"], active: boolean, learnByHand?: true, render = renderEn) =>
    render(element({ run: { ...run, status, learnByHand, reports: {} }, files: [], file: undefined, selectedPath: "", active }));
  const reading = empty("running", true, true);
  assertNoHan(reading);
  assert.match(reading, /<h3>The guide is reading the code<\/h3>/);
  assert.doesNotMatch(reading, /agent team|once it finishes/);
  const planning = empty("awaiting_plan", false, true);
  assert.match(planning, /Write your own plan in Agent activity first; then you write the change\./);
  assert.doesNotMatch(planning, /once it finishes/);
  assert.match(empty("running", true, true, renderZh), /嚮導正在閱讀程式碼/);
  // An agent run's team prepares the changes, as before.
  assert.match(empty("running", true), /The agent team is preparing your changes/);
  assert.match(empty("awaiting_plan", false), /once it finishes, you can review it here/);
});
