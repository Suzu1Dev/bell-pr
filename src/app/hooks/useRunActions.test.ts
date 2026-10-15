import assert from "node:assert/strict";
import test from "node:test";
import { assertNoHan } from "../../test-utils/render";
import en from "../../i18n/en";
import zhTW from "../../i18n/zh-TW";
import {
  answerTyping,
  mergePlaybackRun,
  readRunFiles,
  runPath,
  stopNotice,
  stopSampleRun,
  withSampleFeedback,
} from "./useRunActions";
import { getDemo } from "../../demo";
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

test("a playback answer waits 300-900 ms, then types out in growing slices", () => {
  const answer = "Full jitter spreads the retries of many clients over time.".repeat(8);
  const quick = answerTyping(answer, 1, () => 0);
  const slow = answerTyping(answer, 1, () => 0.999);
  assert.equal(quick.delay, 300);
  assert.ok(slow.delay >= 300 && slow.delay < 900, String(slow.delay));
  // Each slice starts the answer and grows it; the last one is the answer.
  assert.ok(quick.slices.length > 1 && quick.slices.length <= 40);
  quick.slices.forEach((slice, index) => {
    assert.ok(answer.startsWith(slice));
    if (index) assert.ok(slice.length > quick.slices[index - 1].length);
  });
  assert.equal(quick.slices.at(-1), answer);
  // About 1.2 s in all at speed 1, a quarter of it at speed 4, never under 16 ms a slice.
  const total = quick.pause * (quick.slices.length - 1);
  assert.ok(total > 1000 && total <= 1300, String(total));
  assert.ok(answerTyping(answer, 4, () => 0).pause < quick.pause);
  assert.equal(answerTyping(answer, 400, () => 0).pause, 16);
  // A short answer still arrives whole.
  assert.deepEqual(answerTyping("Yes.", 1, () => 0).slices, ["Yes."]);
});

test("stopping the sample's team stops it where it was, and a finished sample stays", () => {
  const playing: Run = {
    ...base,
    id: "demo-run",
    status: "running",
    agents: [
      { id: "lead", name: "Lead", role: "Lead", status: "complete", detail: "" },
      { id: "frontend", name: "Frontend", role: "Teammate", status: "running", detail: "" },
    ],
    team: {
      config: {
        maxTeammates: 2,
        requirePlanApproval: true,
        provider: "codex",
        protocol: "bell-shared-tasks",
        messageDelivery: "between-turns",
      },
      phase: "developing",
      planSummary: "Plan",
      tasks: [
        { id: "t1", title: "One", description: "", owner: "frontend", files: [], dependsOn: [], status: "complete" },
        { id: "t2", title: "Two", description: "", owner: "frontend", files: [], dependsOn: ["t1"], status: "running" },
      ],
      messages: [],
    },
  };
  const stopped = stopSampleRun(playing);
  assert.equal(stopped.status, "cancelled");
  assert.equal(stopped.team?.phase, "cancelled");
  assert.deepEqual(stopped.team?.tasks.map((task) => task.status), ["complete", "pending"]);
  assert.deepEqual(stopped.agents.map((agent) => agent.status), ["complete", "waiting"]);
  // The playing run itself is not changed.
  assert.equal(playing.status, "running");
  // A sample in review or published has no team at work to stop.
  for (const status of ["review", "approved", "published"] as const) {
    const done = { ...playing, status };
    assert.equal(stopSampleRun(done), done);
  }
  assert.equal(zh.demoStopped, "範例團隊已停止。可從「新增貢獻」重新開始。");
  assertNoHan(en.workspace.notices.demoStopped);
});

test("a playback step keeps the reader's own records: the check, attempts, tags and reasons", () => {
  const understanding = { summary: { text: "Mine", changeFingerprint: "0".repeat(16), at: "2026-10-13T00:00:00Z" } };
  const previous: Run = {
    ...base,
    id: "demo-run",
    understanding,
    understandingCheckOff: true,
    attempts: { "a.ts": { fingerprint: "a.ts", quiz: { answer: "It retries", at: "2026-10-13T00:00:00Z" } } },
    feedbackTags: { "#c1": { predicted: true, at: "2026-10-13T00:00:00Z" } },
    reviewability: { testReasons: { "a.test.ts#-3": "The assertion moved below." } },
  };
  const merged = mergePlaybackRun(previous, { ...base, id: "demo-run", status: "approved" });
  assert.equal(merged.status, "approved");
  assert.deepEqual(merged.understanding, understanding);
  assert.equal(merged.understandingCheckOff, true);
  assert.deepEqual(merged.attempts, previous.attempts);
  assert.deepEqual(merged.feedbackTags, previous.feedbackTags);
  assert.deepEqual(merged.reviewability, previous.reviewability);
  // Nothing the reader did not write appears.
  assert.equal("understanding" in mergePlaybackRun(base, { ...base, status: "review" }), false);
});

test("the sample's feedback comes with its own tags, unless the reader tagged it", () => {
  const sample = getDemo("en");
  const read = withSampleFeedback({ ...sample.run }, sample);
  assert.deepEqual(read.prFeedback, sample.prFeedback);
  assert.deepEqual(read.feedbackTags, sample.feedbackTags);
  // The review asked for a test, which the sample's forecast (Tests) predicted.
  const review = sample.prFeedback!.items[0];
  assert.deepEqual(
    { dimension: read.feedbackTags![review.url].dimension, predicted: read.feedbackTags![review.url].predicted },
    { dimension: "tests", predicted: true },
  );
  const own = { [review.url]: { dimension: "naming" as const, at: "2026-10-13T00:00:00Z" } };
  assert.deepEqual(withSampleFeedback({ ...sample.run, feedbackTags: own }, sample).feedbackTags, own);
});
