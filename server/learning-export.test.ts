import assert from "node:assert/strict";
import test from "node:test";
import { learningExport } from "./learning-export.js";
import type { Repository, Run } from "./types.js";

const repo: Repository = {
  id: "repo",
  name: "retry",
  owner: "example",
  fullName: "example/retry",
  path: "/tmp/retry",
  defaultBranch: "main",
  url: "https://github.com/example/retry",
};

const base: Run = {
  id: "run-1",
  repoId: repo.id,
  title: "Improve retry",
  prompt: "Add exponential backoff to withRetry.",
  status: "published",
  branch: "bell/retry",
  baseBranch: "main",
  baseSha: "abc",
  worktreePath: "/tmp/retry-work",
  createdAt: "2026-10-08T00:00:00.000Z",
  agents: [],
  logs: [],
  draft: { title: "Improve retry", body: "body" },
  reviewedFiles: [],
  reviewedFingerprints: {},
};

test("export carries every section, marks stale Q&A and flags unreported usage", () => {
  const markdown = learningExport(
    {
      ...base,
      prUrl: "https://github.com/example/retry/pull/7",
      team: {
        config: {
          maxTeammates: 2,
          requirePlanApproval: false,
          provider: "codex",
          protocol: "bell-shared-tasks",
          messageDelivery: "between-turns",
        },
        phase: "complete",
        planSummary: "兩位成員分別處理 retry 與測試。",
        tasks: [],
        messages: [],
      },
      explanations: {
        "src/retry.ts": {
          fingerprint: "f2",
          status: "ready",
          content: {
            summary: "加入指數退避。",
            reason: "避免重試風暴。",
            concept: "指數退避",
            tip: "檢查 maxDelay。",
            example: { scenario: "塞車", before: "一起重試", after: "分批重試" },
            alternatives: "也可以用固定間隔重試，但在壅塞時會同時打到伺服器。",
            lookup: ["exponential backoff", "jitter"],
            selfCheck: { question: "為什麼要加 jitter？", answer: "分散重試時間。" },
          },
        },
        "tests/retry.test.ts": { fingerprint: "f9", status: "failed", error: "逾時" },
      },
      conversations: {
        "src/retry.ts": {
          fingerprint: "f2",
          updatedAt: "2026-10-08T01:00:00.000Z",
          messages: [
            { role: "user", content: "舊問題", fingerprint: "f1" },
            { role: "assistant", content: "舊回答", fingerprint: "f1" },
            { role: "user", content: "為什麼要 jitter？", fingerprint: "f2" },
            { role: "assistant", content: "分散重試時間。", fingerprint: "f2" },
          ],
        },
        "empty.ts": { fingerprint: "f3", updatedAt: "", messages: [] },
      },
      efficiency: {
        policyVersion: "bell-ponytail-v1",
        mode: "lite",
        calls: 5,
        completedCalls: 5,
        failedCalls: 0,
        measuredCalls: 3,
        durationMs: 61_000,
        inputTokens: 1200,
        cachedInputTokens: 300,
        outputTokens: 400,
      },
    },
    repo,
  );
  assert.match(markdown, /^# 學習紀錄：Improve retry\n\n> .*由 agent 產生，可能有誤/);
  assert.match(markdown, /- Repository：example\/retry\n- 分支：bell\/retry → main/);
  for (const heading of [
    "## 任務描述\n\nAdd exponential backoff to withRetry.",
    "## 團隊計畫\n\n兩位成員分別處理 retry 與測試。",
    "## 檔案解說\n\n### `src/retry.ts`",
    "## 問答紀錄\n\n### `src/retry.ts`",
    "## Pull Request\n\n[https://github.com/example/retry/pull/7](https://github.com/example/retry/pull/7)",
    "## Agent 用量",
  ])
    assert.ok(markdown.includes(heading), heading);
  assert.match(markdown, /- 情境：塞車\n- 修改前：一起重試\n- 修改後：分批重試/);
  assert.match(markdown, /\*\*其他做法\*\*\n\n也可以用固定間隔重試/);
  assert.match(markdown, /\*\*可以查\*\*\n\n- exponential backoff\n- jitter/);
  assert.match(markdown, /\*\*考考自己\*\*\n\n問題：為什麼要加 jitter？\n\n答案：分散重試時間。/);
  assert.match(markdown, /### `tests\/retry.test.ts`\n\n解說狀態：failed（逾時）/);
  assert.match(markdown, /\*\*你（針對較舊版本）：\*\*\n\n舊問題/);
  assert.match(markdown, /\*\*學習助手：\*\*\n\n分散重試時間。/);
  assert.doesNotMatch(markdown, /empty\.ts/);
  assert.match(markdown, /- 用量回報：3 \/ 5 次/);
  assert.match(markdown, /輸入 tokens：1200（含快取讀取 300）/);
  assert.match(markdown, /未回報的用量為未知，不是 0/);
  assert.ok(markdown.endsWith("\n"));
});

test("a bare run exports placeholders instead of empty sections", () => {
  const markdown = learningExport(base);
  assert.doesNotMatch(markdown, /## 團隊計畫|Repository：/);
  assert.match(markdown, /## 檔案解說\n\n尚未產生解說。/);
  assert.match(markdown, /## 問答紀錄\n\n沒有問答紀錄。/);
  assert.match(markdown, /## Pull Request\n\n尚未送出 PR。/);
  assert.match(markdown, /## Agent 用量\n\n沒有用量紀錄。/);
  const complete = learningExport({
    ...base,
    efficiency: {
      policyVersion: "bell-ponytail-v1",
      mode: "lite",
      calls: 2,
      completedCalls: 2,
      failedCalls: 0,
      measuredCalls: 2,
      durationMs: 1000,
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 5,
    },
  });
  assert.doesNotMatch(complete, /未知/);
});
