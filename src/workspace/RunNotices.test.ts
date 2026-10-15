import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Run } from "../types";
import {
  changesRequestedAt,
  RunNotices,
  showsCheckOff,
  UnderstandingOffBadge,
  UnsandboxedBadge,
} from "./RunNotices";

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

test("a run approved without the understanding check keeps a badge that says what it means", () => {
  const approved = renderEn(createElement(UnderstandingOffBadge, { approved: true }));
  assert.match(approved, /class="unsandboxed-badge check-off-badge"/);
  assert.match(approved, /Understanding check off/);
  assert.match(
    approved,
    /<span id="check-off-help" class="unsandboxed-help" role="tooltip">This run was approved without explaining the change back first\./,
  );
  // Until Settings has a Learning section, the badge is a focusable label.
  assert.match(approved, /<span class="badge-label" tabindex="0" aria-describedby="check-off-help">/);
  assertNoHan(approved);
  const setting = renderEn(createElement(UnderstandingOffBadge, { approved: false }));
  assert.match(setting, /The understanding check is off, so you can approve without explaining the change back\./);
  assert.match(renderZh(createElement(UnderstandingOffBadge, { approved: true })), /理解檢查已關閉/);
});

test("the badge shows on runs approved without the check, and on unpublished runs while it is off", () => {
  assert.equal(showsCheckOff(run, false), false);
  assert.equal(showsCheckOff(run, true), true);
  assert.equal(showsCheckOff({ ...run, status: "published" }, true), false);
  assert.equal(showsCheckOff({ ...run, status: "published", understandingCheckOff: true }, false), true);
});

test("after a feedback read that asks for changes, the run says a maintainer waits on you", () => {
  const prFeedback = {
    fetchedAt: "2026-10-12T00:00:00Z",
    prNumber: 3,
    reviewDecision: "CHANGES_REQUESTED",
    items: [
      { kind: "review" as const, author: "maintainer", authorAssociation: "MEMBER", body: "Please add a test.", state: "CHANGES_REQUESTED", url: "#r1", createdAt: "2026-10-11T09:00:00Z" },
      { kind: "comment" as const, author: "maintainer", authorAssociation: "MEMBER", body: "Thanks!", url: "#c1", createdAt: "2026-10-11T10:00:00Z" },
    ],
  };
  const published: Run = { ...run, status: "published", prUrl: "https://github.com/acme/widgets/pull/3", prFeedback };
  assert.equal(changesRequestedAt(published), "2026-10-11T09:00:00Z");
  const html = renderEn(createElement(RunNotices, { run: published, queuedOnFree: false }));
  assert.match(
    html,
    /A maintainer asked for changes on [^.]*2026[^.]*\. Answer on GitHub in your own words, or start a follow-up round\./,
  );
  assertNoHan(html);
  // Nothing to say before a read, or after a read that asked for nothing.
  assert.equal(changesRequestedAt({ ...published, prFeedback: undefined }), undefined);
  assert.equal(
    changesRequestedAt({ ...published, prFeedback: { ...prFeedback, reviewDecision: "APPROVED" } }),
    undefined,
  );
  assert.equal(renderEn(createElement(RunNotices, { run: { ...published, prFeedback: undefined }, queuedOnFree: false })), "");
});
