import assert from "node:assert/strict";
import test from "node:test";
import { stopNotice } from "./useRunActions";
import type { Run } from "../../types";

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
    stopNotice(resolving, { ...base, status: "review", sync }, false),
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
    ),
    stopped,
  );
  // A re-review stopped on a run in review keeps its own message.
  assert.equal(
    stopNotice({ ...base, status: "review", sync }, { ...base, status: "review", sync }, true),
    "已停止重新審查；原有報告與審閱狀態保留。",
  );
});
