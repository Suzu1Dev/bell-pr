import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultContributionSettings } from "../shared/insights.js";
import { activeFollowUp } from "../shared/followups.js";
import { summarizeRun } from "../shared/runs.js";
import { ProjectInsightsService } from "./insights.js";
import { git } from "./process.js";
import { Store } from "./store.js";
import type { Database, Repository, Run } from "./types.js";

async function dataDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-store-test-"));
  return {
    directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

const repository: Repository = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "greeting",
  owner: "local",
  fullName: "local/greeting",
  path: "/tmp/greeting",
  defaultBranch: "main",
  url: "",
};

/**
 * A run in the shape Workbench writes today. Keep this fixture loading when
 * adding persisted fields: new fields must be optional (see AGENTS.md).
 */
function interruptedRun(): Run {
  return {
    id: "run00000-0000-4000-8000-000000000001",
    repoId: repository.id,
    title: "補上問候文字測試",
    prompt: "補上問候文字測試",
    status: "running",
    branch: "bellpr/run00000",
    baseBranch: "main",
    baseSha: "a".repeat(40),
    worktreePath: "/tmp/state/worktrees/run00000-0000-4000-8000-000000000001",
    createdAt: "2026-10-07T00:00:00.000Z",
    agents: [
      { id: "lead", name: "Atlas", role: "Team lead", status: "running", detail: "分析專案與拆解需求" },
      { id: "reviewer", name: "Lens", role: "Reviewer", status: "waiting", detail: "獨立審查正確性與維護性" },
      { id: "tester", name: "Scout", role: "Test analyst", status: "waiting", detail: "檢查測試證據與回歸風險" },
    ],
    logs: [{ time: "2026-10-07T00:00:01.000Z", agent: "lead", message: "開始分析" }],
    draft: { title: "補上問候文字測試", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
    contributionSettings: { ...defaultContributionSettings },
    modelExecution: { provider: "codex", source: "cli-default" },
    publishing: false,
    draftPreparation: { status: "generating", fingerprint: "c".repeat(64) },
    explanations: {
      "hello.ts": { status: "generating", fingerprint: "d".repeat(64) },
    },
    team: {
      config: {
        maxTeammates: 3,
        requirePlanApproval: true,
        provider: "codex",
        protocol: "bell-shared-tasks",
        messageDelivery: "between-turns",
      },
      phase: "developing",
      planSummary: "一個任務",
      tasks: [
        {
          id: "task-1",
          title: "補測試",
          description: "新增問候文字測試",
          owner: "Scout",
          files: ["hello.test.ts"],
          dependsOn: [],
          status: "running",
        },
      ],
      messages: [],
    },
  };
}

test("state.json 不是有效 JSON 時，錯誤訊息包含檔案路徑", async (t) => {
  const { directory, cleanup } = await dataDirectory();
  t.after(cleanup);
  await writeFile(path.join(directory, "state.json"), "{ not json");
  await assert.rejects(new Store(directory).initialize(), /state\.json/);
});

test("version 不是 1 時，錯誤訊息包含檔案路徑與版本提示", async (t) => {
  const { directory, cleanup } = await dataDirectory();
  t.after(cleanup);
  await writeFile(
    path.join(directory, "state.json"),
    JSON.stringify({ version: 2, repos: [], runs: [] }),
  );
  await assert.rejects(
    new Store(directory).initialize(),
    (error: Error) =>
      /state\.json/.test(error.message) &&
      /version 1/.test(error.message) &&
      error.cause instanceof Error &&
      error.cause.message === "Invalid state format",
  );
});

test("既有 version 1 的 state.json 可載入，中斷的工作仍會被標記為失敗", async (t) => {
  const { directory, cleanup } = await dataDirectory();
  t.after(cleanup);
  const fixture: Database = {
    version: 1,
    repos: [repository],
    runs: [interruptedRun()],
  };
  await writeFile(path.join(directory, "state.json"), JSON.stringify(fixture));
  const store = new Store(directory);
  await store.initialize();
  assert.equal(store.data.repos.length, 1);
  assert.equal(store.data.repos[0].id, repository.id);
  const [run] = store.data.runs;
  assert.equal(run.status, "failed");
  assert.equal(run.publishing, false);
  assert.match(run.error ?? "", /服務重新啟動/);
  assert.equal(run.agents[0].status, "failed");
  assert.equal(run.agents[1].status, "waiting");
  assert.equal(run.team?.phase, "failed");
  assert.equal(run.team?.tasks[0].status, "failed");
  assert.equal(run.draftPreparation?.status, "failed");
  assert.equal(run.explanations?.["hello.ts"].status, "failed");
  assert.deepEqual(run.contributionSettings, defaultContributionSettings);
  assert.equal(run.logs[0].message, "開始分析");
});

test("重新審查途中當機時，已完成工作的審查者會被標記失敗而工作狀態不變", async (t) => {
  const { directory, cleanup } = await dataDirectory();
  t.after(cleanup);
  const run = interruptedRun();
  run.status = "review";
  run.agents[0].status = "complete";
  run.agents[1].status = "running";
  const fixture: Database = { version: 1, repos: [repository], runs: [run] };
  await writeFile(path.join(directory, "state.json"), JSON.stringify(fixture));
  const store = new Store(directory);
  await store.initialize();
  const [loaded] = store.data.runs;
  assert.equal(loaded.status, "review");
  assert.equal(loaded.error, undefined);
  assert.equal(loaded.agents[0].status, "complete");
  assert.equal(loaded.agents[1].status, "failed");
  assert.match(loaded.agents[1].detail, /重新審查已中斷/);
  assert.equal(loaded.agents[2].status, "waiting");
});

/**
 * A state.json written by the upstream repository at cdcfb06, by its own
 * Workbench through a stand-in GitHub: an updated clone, an unpublished run
 * synced with a conflict the agent left behind, and a published run with a
 * taken-over GitHub commit, a pushed review round and an open sync round.
 */
const upstreamState = () =>
  readFile(
    path.join(import.meta.dirname, "fixtures", "state-upstream-cdcfb06.json"),
    "utf8",
  );

test("a state.json written by upstream cdcfb06 with follow-up rounds and syncs loads and saves unchanged", async (t) => {
  const { directory, cleanup } = await dataDirectory();
  t.after(cleanup);
  const written = await upstreamState();
  await writeFile(path.join(directory, "state.json"), written);
  const store = new Store(directory);
  await store.initialize();
  // Nothing was interrupted, so loading changes nothing.
  assert.deepEqual(store.data, JSON.parse(written));
  const [repo] = store.data.repos;
  assert.ok(repo.updatedAt);
  const [published, unpublished] = store.data.runs;
  assert.deepEqual(
    published.followUps?.map((round) => [
      round.kind ?? "review",
      round.status,
      !!round.adopted,
    ]),
    [
      ["sync", "published", true],
      ["review", "published", false],
      ["sync", "review", false],
    ],
  );
  const round = activeFollowUp(published.followUps);
  assert.equal(round?.mergeParent, published.baseSha);
  assert.equal(round?.parentCommit, published.publishCommit);
  assert.equal(unpublished.sync?.to, unpublished.baseSha);
  assert.deepEqual(unpublished.sync?.unresolved, ["hello.ts"]);
  // The run list leaves the round history and the sync to the open run.
  for (const run of store.data.runs) {
    const summary = summarizeRun(run) as Record<string, unknown>;
    assert.equal("followUps" in summary, false);
    assert.equal("sync" in summary, false);
  }
  // This build writes it back field for field.
  await store.save();
  const reopened = new Store(directory);
  await reopened.initialize();
  assert.deepEqual(reopened.data, JSON.parse(written));
});

test("an upstream state saved during a follow-up round or a conflict resolution reopens in review", async (t) => {
  const { directory, cleanup } = await dataDirectory();
  t.after(cleanup);
  const data = JSON.parse(await upstreamState()) as Database;
  const [published, unpublished] = data.runs;
  // As upstream saves a run while its agent works: the open round becomes
  // a review round whose agent is still editing.
  published.status = "running";
  published.agents[0].status = "running";
  const round = published.followUps!.at(-1)!;
  round.status = "running";
  delete round.kind;
  unpublished.status = "running";
  unpublished.agents[0].status = "running";
  unpublished.sync!.resolving = true;
  await writeFile(path.join(directory, "state.json"), JSON.stringify(data));
  const store = new Store(directory);
  await store.initialize();
  const [pullRequest, synced] = store.data.runs;
  assert.equal(pullRequest.status, "review");
  assert.equal(pullRequest.prUrl, published.prUrl);
  assert.equal(pullRequest.followUps!.at(-1)!.status, "review");
  assert.match(pullRequest.followUps!.at(-1)!.error!, /服務重新啟動/);
  assert.equal(pullRequest.draft.commitMessage, undefined);
  assert.equal(pullRequest.agents[0].status, "failed");
  assert.equal(synced.status, "review");
  assert.equal(synced.sync!.resolving, false);
  assert.match(synced.sync!.report!, /服務重新啟動/);
  assert.equal(synced.agents[0].status, "failed");
});

test("既有 insights 快取檔可由 ProjectInsightsService 讀取", async (t) => {
  const { directory, cleanup } = await dataDirectory();
  t.after(cleanup);
  const repoPath = path.join(directory, "repo");
  await mkdir(repoPath);
  await git(repoPath, ["init", "-b", "main"]);
  await git(repoPath, ["config", "user.name", "BELL Test"]);
  await git(repoPath, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repoPath, "hello.ts"), 'export const hello = "hi";\n');
  await git(repoPath, ["add", "--", "hello.ts"]);
  await git(repoPath, ["commit", "-m", "initial"]);
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const repo = { ...repository, path: repoPath };
  store.data.repos.push(repo);
  const cache = {
    version: 1,
    settings: { ...defaultContributionSettings },
    insights: {
      summary: "依已追蹤檔案取樣：這是一個向使用者打招呼的小工具。",
      purpose: "讓使用者取得清楚的問候文字。",
      audience: ["使用命令列的開發者"],
      userJourney: ["執行工具", "讀取輸出的問候文字"],
      modules: [{ path: "hello.ts", purpose: "組合問候文字" }],
      evidence: [{ path: "hello.ts", note: "提供問候文字" }],
      recommendations: [
        {
          id: "greeting-tests",
          title: "驗證問候文字",
          direction: "testing",
          problem: "此取樣未呈現問候的行為測試，完整測試涵蓋仍需確認。",
          userImpact: "減少問候文字變更時出現不預期行為的機會。",
          approach: "先確認既有測試，再補足輸入範例。",
          acceptance: ["既有與新增測試通過"],
          effort: "small",
          confidence: "medium",
          evidence: ["hello.ts"],
          evidenceDetails: [
            {
              path: "hello.ts",
              quote: "export const hello =",
              reason: "問候內容由這個常數提供，可驗證其對外行為。",
            },
          ],
        },
      ],
      generatedAt: "2026-10-07T00:00:00.000Z",
      source: "ai",
      baseSha: "a".repeat(40),
    },
    fingerprint: "b".repeat(64),
    recommendationPreferences: { order: ["greeting-tests"], hidden: [] },
  };
  const insightsDirectory = path.join(store.directory, "insights");
  await mkdir(insightsDirectory, { recursive: true });
  await writeFile(
    path.join(
      insightsDirectory,
      `${createHash("sha256").update(repo.id).digest("hex")}.json`,
    ),
    JSON.stringify(cache),
  );
  const result = await new ProjectInsightsService(store).get(repo.id);
  assert.equal(result.insights?.summary, cache.insights.summary);
  assert.equal(result.insights?.recommendations[0].id, "greeting-tests");
  assert.equal(result.stale, true);
  assert.deepEqual(result.recommendationPreferences, {
    order: ["greeting-tests"],
    hidden: [],
  });
});
