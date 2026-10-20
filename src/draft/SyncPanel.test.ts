import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
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
const panel = (run: Run, busy = false) =>
  createElement(SyncPanel, { run, busy, onSync: () => {}, onResolve: () => {}, onUndo: () => {} });
const render = (run: Run, busy = false) => renderZh(panel(run, busy));
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
  // The server refuses another sync until these conflicts are resolved.
  assert.equal(button(html, "同步到最新目標分支"), "disabled");
  assert.match(html, /上一次同步的衝突解決前不能再同步/);
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
  assert.match(partly, /src\/a\.ts<\/code><span class="sync-conflict-state is-resolved"><svg[\s\S]*?<\/svg>已解決<\/span>/);
  assert.match(partly, /src\/b\.ts<\/code><span class="sync-conflict-state is-open"><svg[\s\S]*?<\/svg>仍有衝突標記<\/span>/);
  assert.match(partly, /<p class="sync-conflict-count" role="status">2 個檔案中有 1 個仍有衝突標記。<\/p>/);
  assert.match(partly, /<code>this contribution<\/code>/);
  assert.equal(button(partly, "請 Agent 解決衝突"), "enabled");
  const done = render({ ...base, sync: { ...sync, unresolved: [] } });
  assert.match(done, /衝突標記都已移除/);
  assert.doesNotMatch(done, /請 Agent 解決衝突/);
  assert.equal(button(done, "同步到最新目標分支"), "enabled");
  assert.doesNotMatch(done, /衝突解決前不能再同步/);
  const planning = render({ ...base, status: "awaiting_plan", sync });
  assert.equal(button(planning, "同步到最新目標分支"), "disabled");
  assert.equal(button(planning, "請 Agent 解決衝突"), "disabled");
  const planned = render({ ...base, status: "awaiting_plan", sync: { ...sync, unresolved: [] } });
  assert.equal(button(planned, "同步到最新目標分支"), "enabled");
  // Once the plan is approved the team runs; that is not the conflict agent.
  const team = render({ ...base, status: "running", sync });
  assert.doesNotMatch(team, /正在解衝突/);
  assert.equal(button(team, "請 Agent 解決衝突"), "disabled");
});

test("an unpublished run that cannot sync says why", () => {
  for (const status of ["running", "failed", "cancelled"] as const) {
    const html = render({ ...base, status });
    assert.equal(button(html, "同步到最新目標分支"), "disabled", status);
    assert.match(html, /只有審閱中、已核准或等待計畫核准的工作可以同步/, status);
  }
  assert.doesNotMatch(render(base), /只有審閱中/);
});

test("the English panel explains the base, the conflicts and why it waits, without Han", () => {
  const sync = {
    at: "2026-10-13T01:00:00Z",
    from: "b".repeat(40),
    to: "a".repeat(40),
    snapshot: "c".repeat(40),
    conflicts: ["src/a.ts", "src/b.ts"],
    unresolved: ["src/b.ts"],
    report: "Kept both changes in src/a.ts.",
    resolutions: [{ path: "src/a.ts", resolution: "kept both sides" }],
  };
  const published: Run = { ...base, status: "published", prUrl: "https://github.com/o/r/pull/1" };
  const round = {
    id: "f",
    requestedAt: "2026-10-13T00:00:00Z",
    feedbackUrls: [],
    status: "review" as const,
    parentCommit: "d".repeat(40),
  };
  const runs: [string, Run][] = [
    ["clean", base],
    ["conflicts", { ...base, sync }],
    ["resolved", { ...base, sync: { ...sync, unresolved: [] } }],
    ["resolving", { ...base, sync: { ...sync, resolving: true } }],
    ["running", { ...base, status: "running" }],
    ["published", published],
    ["round open", { ...published, status: "review", followUps: [round] }],
    [
      "published conflicts",
      {
        ...published,
        status: "review",
        followUps: [{ ...round, kind: "sync", conflicts: ["src/a.ts"], resolving: true }],
      },
    ],
  ];
  for (const [name, run] of runs) {
    const html = renderEn(panel(run));
    assert.doesNotThrow(() => assertNoHan(html), name);
  }
  const html = renderEn(panel({ ...base, sync }));
  assert.match(
    html,
    /This contribution is based on <code>main<\/code> at <code>aaaaaaa<\/code>\. Syncing moves these changes/,
  );
  assert.match(html, /Last sync: <code>bbbbbbb<\/code> to <code>aaaaaaa<\/code>, /);
  // Each file says its state in words; the count is announced politely.
  assert.match(html, /src\/a\.ts<\/code><span class="sync-conflict-state is-resolved"><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>Resolved<\/span>/);
  assert.match(html, /src\/b\.ts<\/code><span class="sync-conflict-state is-open"><svg[\s\S]*?<\/svg>Conflict markers left<\/span>/);
  assert.match(html, /<p class="sync-conflict-count" role="status">Conflict markers remain in 1 of 2 files\.<\/p>/);
  assert.doesNotMatch(html, /class="sync-conflicts" role=/);
  assert.match(html, /the side marked <code>latest main<\/code>/);
  assert.match(html, /the side marked <code>this contribution<\/code> is this contribution/);
  assert.equal(button(html, "Ask the agent to resolve the conflicts"), "enabled");
  assert.equal(button(html, "Sync to the latest target branch"), "disabled");
  assert.match(html, /Resolve the conflicts from the last sync before you sync again/);
  assert.match(html, /Undo sync/);
  const pr = renderEn(
    panel({
      ...published,
      status: "review",
      followUps: [{ ...round, kind: "sync", conflicts: ["src/a.ts"] }],
    }),
  );
  assert.match(pr, /the side marked <code>this pull request<\/code> is this pull request/);
  assert.match(renderEn(panel({ ...published, status: "review", followUps: [round] })), /A follow-up round is in progress/);
  assert.match(
    renderEn(panel({ ...base, status: "failed" })),
    /Only runs in review, approved or waiting for plan approval can sync/,
  );
});

test("the conflict count reads naturally for one file, all files and some files", () => {
  const sync = {
    at: "2026-10-13T01:00:00Z",
    from: "b".repeat(40),
    to: "a".repeat(40),
    snapshot: "c".repeat(40),
  };
  const count = (conflicts: string[], unresolved?: string[]) =>
    /class="sync-conflict-count" role="status">([^<]*)</.exec(
      renderEn(panel({ ...base, sync: { ...sync, conflicts, unresolved } })),
    )?.[1];
  assert.equal(count(["a.ts"]), "Conflict markers remain in the file.");
  assert.equal(count(["a.ts", "b.ts", "c.ts"]), "Conflict markers remain in all 3 files.");
  assert.equal(count(["a.ts", "b.ts", "c.ts"], ["c.ts"]), "Conflict markers remain in 1 of 3 files.");
  assert.equal(
    count(["a.ts"], []),
    "All conflict markers are removed; changed files still need a file-by-file review.",
  );
});

test("a Learn-by-hand run has no conflict agent: the person resolves the markers by hand", () => {
  const sync = {
    at: "2026-10-13T01:00:00Z",
    from: "b".repeat(40),
    to: "a".repeat(40),
    snapshot: "c".repeat(40),
    conflicts: ["src/hello.ts"],
  };
  const agent = renderEn(panel({ ...base, sync }));
  assert.equal(button(agent, "Ask the agent to resolve the conflicts"), "enabled");
  const html = renderEn(panel({ ...base, learnByHand: true, sync }));
  assertNoHan(html);
  assert.equal(button(html, "Ask the agent to resolve the conflicts"), "absent");
  assert.ok(!/ask the agent/i.test(html));
  assert.ok(html.includes("Resolve the markers by hand; BELL PR re-checks them when you refresh the diff on the Code changes tab."));
  // The published PR's sync round reads the same way, in Traditional Chinese too.
  const published = renderZh(
    panel({
      ...base,
      learnByHand: true,
      status: "published",
      prUrl: "https://github.com/o/r/pull/1",
      followUps: [
        { id: "s", kind: "sync", requestedAt: sync.at, feedbackUrls: [], status: "review", parentCommit: "d".repeat(40), conflicts: ["src/hello.ts"] },
      ],
    }),
  );
  assert.match(published, /請親手解決衝突標記/);
  assert.equal(button(published, "請 Agent 解決衝突"), "absent");
});

test("a Learn-by-hand run's conflict help still says which side is which and that approval waits for the markers", () => {
  const sync = { at: "2026-10-13T01:00:00Z", from: "b".repeat(40), to: "a".repeat(40), snapshot: "c".repeat(40), conflicts: ["src/hello.ts"] };
  const html = renderEn(panel({ ...base, learnByHand: true, sync }));
  assertNoHan(html);
  assert.match(html, /the side marked <code>latest main<\/code> is the target branch&#x27;s current content/);
  assert.match(html, /You cannot approve until every conflict marker is removed/);
  assert.match(html, /Changed files still need a file-by-file review/);
  assert.ok(!/ask the agent/i.test(html));
  const zh = renderZh(panel({ ...base, learnByHand: true, sync }));
  assert.match(zh, /衝突標記全部移除前不能核准/);
  assert.doesNotMatch(zh, /請 Agent 解決/);
});
