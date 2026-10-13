import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SyncPanel } from "./SyncPanel";
import type { Run } from "../types";

const base: Run = {
  id: "r",
  repoId: "repo",
  title: "t",
  prompt: "p",
  status: "review",
  branch: "fix/abc",
  baseBranch: "main",
  baseSha: "a".repeat(40),
  createdAt: "2026-10-13T00:00:00Z",
  agents: [],
  logs: [],
  draft: { title: "t", body: "b" },
  reviewedFiles: [],
};
const render = (run: Run, busy = false) =>
  renderToStaticMarkup(
    createElement(SyncPanel, { run, busy, onSync: () => {}, onResolve: () => {}, onUndo: () => {} }),
  );
const disabled = (html: string, label: string) =>
  new RegExp(`<button[^>]*disabled=""[^>]*>(?:(?!</button>).)*${label}`).test(html);

test("an unpublished run shows its base, its conflicts with the agent action, and undo", () => {
  const html = render({
    ...base,
    sync: {
      at: "2026-10-13T01:00:00Z",
      from: "b".repeat(40),
      to: "a".repeat(40),
      snapshot: "c".repeat(40),
      conflicts: ["src/hello.ts"],
      report: "仍有衝突標記：src/hello.ts。",
    },
  });
  assert.match(html, /<code>main<\/code> 的 <code>aaaaaaa<\/code>/);
  assert.match(html, /上次同步：<code>bbbbbbb<\/code>/);
  assert.match(html, /src\/hello\.ts/);
  assert.match(html, /仍有衝突標記/);
  assert.ok(!disabled(html, "請 Agent 解決衝突"));
  assert.match(html, /復原同步/);
  assert.ok(!disabled(html, "同步到最新目標分支"));
});

test("a published PR syncs only when no round is open, and has no undo", () => {
  const published: Run = { ...base, status: "published", prUrl: "https://github.com/o/r/pull/1" };
  const free = render(published);
  assert.ok(!disabled(free, "同步到最新目標分支"));
  assert.doesNotMatch(free, /復原同步/);
  assert.match(free, /合併 commit/);
  const busyRound = render({
    ...published,
    status: "review",
    followUps: [
      {
        id: "f",
        requestedAt: "2026-10-13T00:00:00Z",
        feedbackUrls: [],
        status: "review",
        parentCommit: "d".repeat(40),
      },
    ],
  });
  assert.ok(disabled(busyRound, "同步到最新目標分支"));
  assert.match(busyRound, /有一輪修正在進行/);
});
