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
/** Whether the button with this label is there and enabled. */
const button = (html: string, label: string) => {
  const match = new RegExp(`<button([^>]*)>(?:(?!</button>).)*${label}`).exec(html);
  return !match ? "absent" : /disabled=""/.test(match[1]) ? "disabled" : "enabled";
};

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
  assert.equal(button(html, "請 Agent 解決衝突"), "enabled");
  assert.match(html, /復原同步/);
  assert.equal(button(html, "同步到最新目標分支"), "enabled");
});

test("a published PR syncs only when no round is open, and has no undo", () => {
  const published: Run = { ...base, status: "published", prUrl: "https://github.com/o/r/pull/1" };
  const free = render(published);
  assert.equal(button(free, "同步到最新目標分支"), "enabled");
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
  assert.equal(button(busyRound, "同步到最新目標分支"), "disabled");
  assert.match(busyRound, /有一輪修正在進行/);
});

test("resolved conflicts drop the agent action, and a run awaiting plan approval can sync", () => {
  const sync = {
    at: "2026-10-13T01:00:00Z",
    from: "b".repeat(40),
    to: "a".repeat(40),
    snapshot: "c".repeat(40),
    conflicts: ["src/a.ts", "src/b.ts"],
  };
  const partly = render({ ...base, sync: { ...sync, unresolved: ["src/b.ts"] } });
  assert.match(partly, /src\/a\.ts<\/code> · 已解決/);
  assert.doesNotMatch(partly, /src\/b\.ts<\/code> · 已解決/);
  assert.match(partly, /<code>this contribution<\/code>/);
  assert.equal(button(partly, "請 Agent 解決衝突"), "enabled");
  const done = render({ ...base, sync: { ...sync, unresolved: [] } });
  assert.match(done, /衝突標記都已移除/);
  assert.doesNotMatch(done, /請 Agent 解決衝突/);
  const planning = render({ ...base, status: "awaiting_plan", sync });
  assert.equal(button(planning, "同步到最新目標分支"), "enabled");
  assert.equal(button(planning, "請 Agent 解決衝突"), "disabled");
  // Once the plan is approved the team runs; that is not the conflict agent.
  const team = render({ ...base, status: "running", sync });
  assert.doesNotMatch(team, /正在解衝突/);
  assert.equal(button(team, "請 Agent 解決衝突"), "disabled");
});
