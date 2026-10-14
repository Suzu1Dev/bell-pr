import assert from "node:assert/strict";
import test from "node:test";
import { assertNoHan } from "../../test-utils/render";
import en from "../../i18n/en";
import zhTW from "../../i18n/zh-TW";
import {
  mergePlaybackRun,
  readRunFiles,
  runPath,
  stopNotice,
} from "./useRunActions";
import type { Run } from "../../types";

const zh = zhTW.workspace.notices;

const base: Run = {
  id: "r",
  repoId: "repo",
  title: "t",
  prompt: "p",
  status: "running",
  branch: "fix/abc",
  baseBranch: "main",
  baseSha: "a".repeat(40),
  createdAt: "2026-10-13T00:00:00Z",
  agents: [],
  logs: [],
  draft: { title: "t", body: "b" },
  reviewedFiles: [],
};
const sync = {
  at: "2026-10-13T01:00:00Z",
  from: "b".repeat(40),
  to: "a".repeat(40),
  snapshot: "c".repeat(40),
  conflicts: ["src/hello.ts"],
};
const stopped = /已停止解衝突；已改的檔案保留/;

test("stopping the conflict agent says so instead of reporting a stopped re-review", () => {
  // An unpublished run: the resolution is recorded on run.sync.
  const resolving = { ...base, sync: { ...sync, resolving: true } };
  assert.match(
    stopNotice(resolving, { ...base, status: "review", sync }, false, zh),
    stopped,
  );
  // A published PR: the resolution is recorded on its open sync round.
  const round = {
    id: "f",
    kind: "sync" as const,
    requestedAt: "2026-10-13T00:00:00Z",
    feedbackUrls: [],
    status: "review" as const,
    parentCommit: "d".repeat(40),
    conflicts: ["src/hello.ts"],
  };
  const published = { ...base, prUrl: "https://github.com/o/r/pull/1" };
  assert.match(
    stopNotice(
      { ...published, followUps: [{ ...round, resolving: true }] },
      { ...published, status: "review", followUps: [round] },
      false,
      zh,
    ),
    stopped,
  );
  // A re-review stopped on a run in review keeps its own message.
  assert.equal(
    stopNotice({ ...base, status: "review", sync }, { ...base, status: "review", sync }, true, zh),
    "已停止重新審查；原有報告與審閱狀態保留。",
  );
});

test("each stop notice reads in the UI language", () => {
  const notices = en.workspace.notices;
  const round = {
    id: "f",
    requestedAt: "2026-10-13T00:00:00Z",
    feedbackUrls: [],
    status: "running" as const,
    parentCommit: "d".repeat(40),
  };
  const cases: [Run, Run, boolean, string][] = [
    [{ ...base, sync: { ...sync, resolving: true } }, { ...base, status: "review", sync }, false, notices.stopResolving],
    [{ ...base, followUps: [round] }, { ...base, status: "review", followUps: [{ ...round, status: "review" }] }, false, notices.stopRoundKept],
    [{ ...base, followUps: [round] }, { ...base, status: "published", followUps: [{ ...round, status: "discarded" }] }, false, notices.stopRoundEmpty],
    [{ ...base, status: "review" }, { ...base, status: "review" }, true, notices.stopReview],
    [base, { ...base, status: "cancelled", team: { tasks: [{}] } } as unknown as Run, false, notices.stopTeam],
    [base, { ...base, status: "cancelled" }, false, notices.stopTask],
  ];
  for (const [before, updated, rerunning, expected] of cases) {
    const notice = stopNotice(before, updated, rerunning, notices);
    assert.equal(notice, expected);
    assertNoHan(notice);
  }
});

test("a run whose working files were cleaned up still opens, with no files to show", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  let answer: Response;
  globalThis.fetch = (async () => answer) as typeof fetch;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  answer = json(410, { error: "Files were cleaned up.", code: "workspace_removed" });
  assert.deepEqual(await readRunFiles("r"), []);
  answer = json(200, { files: [{ path: "a.ts" }] });
  assert.deepEqual(await readRunFiles("r"), [{ path: "a.ts" }]);
  // Any other failure is still reported.
  answer = json(404, { error: "Run not found." });
  await assert.rejects(readRunFiles("r"), { status: 404, message: "Run not found." });
});

test("a run id is escaped in its API path, so it cannot name another route", async (t) => {
  assert.equal(runPath("demo-run"), "/runs/demo-run");
  assert.equal(runPath("../repos"), "/runs/..%2Frepos");
  assert.equal(runPath("a?b#c"), "/runs/a%3Fb%23c");
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    return new Response(JSON.stringify({ files: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  await readRunFiles("x/../../status");
  assert.deepEqual(asked, ["/api/runs/x%2F..%2F..%2Fstatus/diff"]);
});

test("a playback step brings the run's progress and keeps what the reader did", () => {
  const team = {
    config: {
      maxTeammates: 2 as const,
      requirePlanApproval: true,
      provider: "codex" as const,
      protocol: "bell-shared-tasks" as const,
      messageDelivery: "between-turns" as const,
    },
    phase: "developing" as const,
    planSummary: "Plan",
    tasks: [],
    messages: [
      {
        id: "m1",
        from: "lead",
        to: "all",
        content: "Brief",
        createdAt: "2026-10-13T00:00:01Z",
        status: "delivered" as const,
        recipients: [],
        deliveredTo: [],
      },
    ],
  };
  const typed = {
    ...team.messages[0],
    id: "u1",
    from: "user",
    content: "Keep the old option working",
    status: "queued" as const,
  };
  const previous: Run = {
    ...base,
    id: "demo-run",
    reviewedFiles: ["a.ts"],
    draft: { title: "Mine", body: "My words", publishBranch: "my-branch" },
    notes: { "a.ts": { text: "note", fingerprint: "f", updatedAt: "2026-10-13T00:00:00Z" } },
    team: { ...team, messages: [...team.messages, typed] },
  };
  const step: Run = {
    ...base,
    id: "demo-run",
    status: "published",
    prUrl: "#demo-pr",
    publishedBranch: "fix/abc",
    reports: { reviewer: "Looks fine" },
    team,
  };
  const merged = mergePlaybackRun(previous, step);
  assert.equal(merged.status, "published");
  assert.equal(merged.prUrl, "#demo-pr");
  assert.deepEqual(merged.reports, { reviewer: "Looks fine" });
  assert.deepEqual(merged.reviewedFiles, ["a.ts"]);
  assert.equal(merged.draft.body, "My words");
  assert.equal(merged.notes?.["a.ts"].text, "note");
  // The sample PR goes out under the branch the reader chose.
  assert.equal(merged.publishedBranch, "my-branch");
  // The playback's messages first, then what the reader typed to the team.
  assert.deepEqual(merged.team?.messages.map((message) => message.id), ["m1", "u1"]);
  // A step that already lists a message does not list it twice.
  assert.equal(
    mergePlaybackRun(previous, { ...step, team: previous.team }).team?.messages.length,
    2,
  );
});
