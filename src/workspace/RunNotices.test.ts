import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Run } from "../types";
import { RunNotices, UnsandboxedBadge } from "./RunNotices";

const run: Run = {
  id: "run-1",
  repoId: "repo-1",
  title: "Greet the world",
  prompt: "Greet the world",
  status: "queued",
  branch: "fix/run1",
  baseBranch: "main",
  createdAt: "2026-10-10T00:00:00Z",
  agents: [],
  logs: [],
  draft: { title: "", body: "" },
  reviewedFiles: [],
};

test("a run queued on Free says why, with the PRO badge and a way to upgrade", () => {
  const html = renderEn(createElement(RunNotices, { run, queuedOnFree: true }));
  assert.match(html, /role="status"/);
  assert.match(html, /Queued: Free runs one contribution at a time/);
  assert.match(html, /class="pro-badge"[^>]*aria-label="Pro feature"/);
  assert.match(html, /<button type="button" class="run-notice-link">Run several at once with Pro<\/button>/);
  assertNoHan(html);
  assert.match(
    renderZh(createElement(RunNotices, { run, queuedOnFree: true })),
    /排隊中：免費方案一次只執行一個貢獻任務/,
  );
});

test("a run with nothing to note renders no notice", () => {
  assert.equal(renderEn(createElement(RunNotices, { run, queuedOnFree: false })), "");
});

test("a run whose files were cleaned up says that its reports and notes stay", () => {
  const html = renderEn(
    createElement(RunNotices, {
      run: { ...run, status: "review", workspaceRemovedAt: "2026-10-12T00:00:00Z" },
      queuedOnFree: false,
    }),
  );
  assert.match(
    html,
    /Files for this run were cleaned up to free disk space\. Reports and notes are kept\./,
  );
  assert.doesNotMatch(html, /Queued/);
  assertNoHan(html);
});

test("the unsandboxed badge links to the safety settings and explains itself", () => {
  const html = renderEn(createElement(UnsandboxedBadge));
  assert.match(html, /<a href="#\/settings\/safety" aria-describedby="unsandboxed-help">/);
  assert.match(html, /Ran without sandbox/);
  assert.match(
    html,
    /<span id="unsandboxed-help" class="unsandboxed-help" role="tooltip">You allowed Claude agents to run without the operating system&#x27;s sandbox/,
  );
  assertNoHan(html);
  assert.match(renderZh(createElement(UnsandboxedBadge)), /未使用沙箱執行/);
});
