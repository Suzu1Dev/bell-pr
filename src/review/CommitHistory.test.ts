import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { CommitSummary } from "../../shared/commits";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { CommitHistory, CommitList } from "./CommitHistory";

// These tests pin zh-TW, the language their assertions were written in.
const demoRun = getDemo("zh-TW").run;
const renderToStaticMarkup = renderZh;

const commit = (overrides: Partial<CommitSummary>): CommitSummary => ({
  sha: "a".repeat(40),
  parents: ["0".repeat(40)],
  author: "Sample Author",
  date: "2026-10-14T01:00:00Z",
  subject: "fix: first push",
  body: "",
  source: "initial",
  files: 1,
  additions: 2,
  deletions: 1,
  ...overrides,
});

test("commits are labelled by where they came from, link to the PR, and open to their files and diffs", () => {
  const commits = [
    commit({}),
    commit({ sha: "b".repeat(40), subject: "Address review", source: "review", round: 1 }),
    commit({ sha: "c".repeat(40), subject: "Merge branch 'main'", source: "sync", parents: ["1".repeat(40), "2".repeat(40)] }),
    commit({ sha: "d".repeat(40), subject: "Apply suggestion", source: "adopted" }),
  ];
  const html = renderToStaticMarkup(
    createElement(CommitList, {
      commits,
      prUrl: "https://github.com/o/r/pull/7",
      open: "b".repeat(40),
      file: "a.ts",
      detail: {
        files: [
          { path: "a.ts", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new\n" },
          { path: ".env", status: "added", additions: 1, deletions: 0, patch: "", blocked: "敏感檔案或產物，不顯示內容。" },
        ],
        omitted: 2,
      },
      onToggle() {},
      onFile() {},
    }),
  );
  for (const label of ["初次送出", "依 review 修正第 1 輪", "同步目標分支", "接續 GitHub 上的提交"])
    assert.match(html, new RegExp(label));
  assert.match(html, /href="https:\/\/github\.com\/o\/r\/pull\/7\/commits\/bbbbbbb/);
  assert.match(html, /合併 commit：/);
  assert.equal(html.match(/aria-expanded="true"/g)?.length, 1);
  // The open file's diff is shown read-only; the blocked one is named only.
  assert.match(html, /rv-line rv-line-removed[^>]*>.*old/);
  assert.match(html, /rv-line rv-line-added[^>]*>.*new/);
  assert.doesNotMatch(html, /type="checkbox"/);
  assert.match(html, /<code>\.env<\/code>/);
  assert.match(html, /另外 2 個檔案超過顯示上限/);
});

test("an unpublished contribution or the demo explains why there are no commits yet", () => {
  const unpublished = renderToStaticMarkup(createElement(CommitHistory, { run: { ...demoRun, id: "r" }, demo: false }));
  assert.match(unpublished, /這個貢獻還沒送出 PR/);
  const demo = renderToStaticMarkup(createElement(CommitHistory, { run: demoRun, demo: true }));
  assert.match(demo, /示範資料還沒有送出 PR/);
});

test("the sample shows its own history, labelled as a sample, with every commit's files", () => {
  const html = renderEn(createElement(CommitHistory, { run: getDemo("en").run, demo: true }));
  assertNoHan(html);
  assert.match(html, /The sample has not sent a PR, so it has no commits yet\./);
  for (const label of ["First push", "Review round 1", "Merged the target branch"])
    assert.match(html, new RegExp(label));
  // The sample links nowhere: its PR exists on no server.
  assert.doesNotMatch(html, /<a href=/);
  const published = renderEn(
    createElement(CommitHistory, { run: { ...getDemo("en").run, status: "published" }, demo: true }),
  );
  assert.match(published, /The sample PR&#x27;s commits: the first push, one review round and a merge of the target branch\./);
  const sample = getDemo("en").commitHistory!;
  assert.equal(sample.commits.length, 3);
  for (const commit of sample.commits) {
    const detail = sample.details[commit.sha];
    assert.ok(detail, commit.subject);
    assert.equal(detail.files.length, commit.files, commit.subject);
    assert.equal(detail.files.reduce((sum, file) => sum + file.additions, 0), commit.additions);
  }
  assert.equal(sample.commits[2].parents.length, 2);
});

test("an English commit list names its sources and counts in English", () => {
  const html = renderEn(
    createElement(CommitList, {
      commits: [
        commit({ files: 1 }),
        commit({ sha: "e".repeat(40), source: "review", round: 2, files: 3 }),
        commit({ sha: "f".repeat(40), source: "other" }),
      ],
      open: "e".repeat(40),
      detail: "loading",
      onToggle() {},
      onFile() {},
    }),
  );
  assertNoHan(html);
  assert.match(html, /First push/);
  assert.match(html, /Review round 2/);
  assert.match(html, /Other commit/);
  assert.match(html, /1 file /);
  assert.match(html, /3 files /);
  assert.match(html, /Reading what this commit changed…/);
  assert.match(html, /Hide/);
});

