import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultContributionSettings } from "../shared/insights.js";
import { activeFollowUp } from "../shared/followups.js";
import { summarizeRun } from "../shared/runs.js";
import { ProjectInsightsService } from "./insights.js";
import { git } from "./process.js";
import { Store } from "./store.js";
import type { Database, Repository, Run } from "./types.js";
import { withLocale } from "./i18n/index.js";

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

/** Writes `runs` as state.json in a fresh data directory and returns it. */
async function stateWith(runs: Run[]) {
  const data = await dataDirectory();
  const fixture: Database = { version: 1, repos: [repository], runs };
  await writeFile(
    path.join(data.directory, "state.json"),
    JSON.stringify(fixture),
  );
  return data;
}

test("restart recovery explains each interrupted run in the run's own locale", async (t) => {
  // The server default is en, as with BELLPR_LOCALE=en or the app settings.
  const chinese = await stateWith([
    { ...interruptedRun(), id: "run-zh", locale: "zh-TW" },
    { ...interruptedRun(), id: "run-older" },
  ]);
  t.after(chinese.cleanup);
  const first = new Store(chinese.directory);
  await withLocale("en", () => first.initialize());
  const [zh, older] = first.data.runs;
  assert.equal(
    zh.error,
    "服務重新啟動，先前工作已中斷。工作目錄仍保留，可檢視差異；團隊工作可在任務板重試失敗的子任務，已整合的子任務不會重跑。",
  );
  assert.equal(
    zh.team?.tasks[0].error,
    "服務重新啟動，任務已中斷；隔離工作目錄保留，重試時會以新快照重新開始。",
  );
  assert.match(zh.draftPreparation?.error ?? "", /^服務重新啟動，PR 草稿建議已中斷/);
  assert.match(zh.explanations?.["hello.ts"].error ?? "", /^服務重新啟動，解說產生已中斷/);
  // A run saved before runs had a locale follows the server default.
  assert.match(older.error ?? "", /^The service restarted, so the run stopped\./);
  assert.equal(older.locale, undefined);

  // The tests' default is zh-TW; an English run still recovers in English.
  const reviewing: Run = { ...interruptedRun(), id: "run-review", locale: "en" };
  reviewing.status = "review";
  reviewing.agents[0].status = "complete";
  reviewing.agents[1].status = "running";
  const english = await stateWith([
    { ...interruptedRun(), id: "run-en", locale: "en" },
    reviewing,
  ]);
  t.after(english.cleanup);
  const second = new Store(english.directory);
  await second.initialize();
  const [en, review] = second.data.runs;
  assert.equal(
    en.error,
    "The service restarted, so the run stopped. Its working directory is kept and you can read the diff; for a team run, retry the failed subtasks on the task board, and integrated subtasks do not run again.",
  );
  assert.equal(
    en.team?.tasks[0].error,
    "The service restarted, so the task stopped; its isolated working directory is kept, and a retry starts again from a fresh snapshot.",
  );
  assert.equal(
    en.draftPreparation?.error,
    "The service restarted, so the PR draft suggestion stopped; your current draft is kept, and you can generate the suggestion again.",
  );
  assert.equal(
    en.explanations?.["hello.ts"].error,
    "The service restarted, so generating the explanation stopped; you can retry it.",
  );
  assert.equal(
    review.agents[1].detail,
    "The service restarted, so the review rerun stopped; the earlier reports are kept",
  );
  // Text saved before the restart is never translated.
  assert.equal(en.logs[0].message, "開始分析");
});

test("an interrupted conflict resolution or follow-up round is explained in the run's own locale", async (t) => {
  // An English run whose agent was resolving sync conflicts, under the
  // tests' zh-TW default.
  const resolving: Run = {
    ...interruptedRun(),
    id: "run-sync",
    locale: "en",
    sync: {
      at: "2026-10-07T00:00:02.000Z",
      from: "a".repeat(40),
      to: "b".repeat(40),
      snapshot: "c".repeat(40),
      conflicts: ["hello.ts"],
      resolving: true,
    },
  };
  const english = await stateWith([resolving]);
  t.after(english.cleanup);
  const first = new Store(english.directory);
  await first.initialize();
  const [synced] = first.data.runs;
  assert.equal(synced.status, "review");
  assert.equal(synced.sync?.resolving, false);
  assert.equal(
    synced.sync?.report,
    "The service restarted, so resolving the conflicts stopped; the edited files are kept, and you can finish yourself or ask the agent again.",
  );

  // A zh-TW run whose follow-up round was running, under an en default.
  const revising: Run = {
    ...interruptedRun(),
    id: "run-round",
    locale: "zh-TW",
    prUrl: "https://github.com/test-owner/example/pull/1",
    followUps: [
      {
        id: "round-1",
        requestedAt: "2026-10-07T00:00:02.000Z",
        feedbackUrls: [],
        note: "Rename the greeting.",
        status: "running",
        parentCommit: "b".repeat(40),
      },
    ],
  };
  const chinese = await stateWith([revising]);
  t.after(chinese.cleanup);
  const second = new Store(chinese.directory);
  await withLocale("en", () => second.initialize());
  const [round] = second.data.runs;
  assert.equal(round.status, "review");
  assert.equal(round.followUps?.[0].status, "review");
  assert.equal(
    round.followUps?.[0].error,
    "服務重新啟動，這輪修正已中斷；工作目錄保留的修改可以審閱、寫好提交訊息後推送，或放棄這輪修正。",
  );
});

test("a run's locale, and fields a newer build adds, survive a load and save", async (t) => {
  // state.json is read through a passthrough schema: a build that predates
  // `locale` keeps the field (and any other it does not know) and writes it
  // back field for field, as this one does.
  const run = {
    ...interruptedRun(),
    status: "review",
    locale: "en",
    unsandboxed: true,
    fromNewerBuild: { kept: true },
  } as Run;
  delete run.draftPreparation;
  delete run.explanations;
  for (const agent of run.agents) agent.status = "complete";
  run.team!.tasks[0].status = "complete";
  const unknownLocale = {
    ...interruptedRun(),
    id: "run-unknown-locale",
    locale: "fr",
  } as unknown as Run;
  const { directory, cleanup } = await stateWith([run, unknownLocale]);
  t.after(cleanup);
  const written = JSON.parse(
    await readFile(path.join(directory, "state.json"), "utf8"),
  ) as Database;
  const store = new Store(directory);
  await withLocale("en", () => store.initialize());
  assert.deepEqual(store.data.runs[0], written.runs[0]);
  assert.equal(store.data.runs[0].locale, "en");
  // A locale this build does not know is kept as written, and recovery
  // uses the locale in effect instead of failing.
  const [, unknown] = store.data.runs;
  assert.equal(unknown.locale, "fr");
  assert.match(unknown.error ?? "", /^The service restarted/);
  await store.save();
  const reopened = new Store(directory);
  await reopened.initialize();
  assert.deepEqual(reopened.data.runs[0], written.runs[0]);
  assert.deepEqual(
    (reopened.data.runs[0] as unknown as Record<string, unknown>).fromNewerBuild,
    { kept: true },
  );
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

test("each Store rotates state.json into three backups on its first save and writes compact JSON", async (t) => {
  const { directory, cleanup } = await dataDirectory();
  t.after(cleanup);
  const statePath = path.join(directory, "state.json");
  const generations: string[] = [];
  for (let start = 0; start < 5; start++) {
    const store = new Store(directory);
    await store.initialize();
    store.data.repos = [{ ...repository, name: `generation-${start}` }];
    await store.save();
    // Later saves of the same Store do not rotate again.
    await store.save();
    generations.push(await readFile(statePath, "utf8"));
  }
  const names = (await readdir(directory)).sort();
  assert.deepEqual(
    names.filter((name) => name.startsWith("state.json")),
    ["state.json", "state.json.bak.1", "state.json.bak.2", "state.json.bak.3"],
  );
  // bak.1 is the state the newest Store found when it started.
  assert.equal(await readFile(`${statePath}.bak.1`, "utf8"), generations[3]);
  assert.equal(await readFile(`${statePath}.bak.2`, "utf8"), generations[2]);
  assert.equal(await readFile(`${statePath}.bak.3`, "utf8"), generations[1]);
  assert.ok(!generations[4].includes("\n"), "state.json is compact");
  if (process.platform !== "win32") {
    assert.equal((await stat(statePath)).mode & 0o777, 0o600);
    assert.equal((await stat(`${statePath}.bak.1`)).mode & 0o777, 0o600);
  }
});

test("a missing state.json starts empty and keeps every backup in place", async (t) => {
  const { directory, cleanup } = await dataDirectory();
  t.after(cleanup);
  const statePath = path.join(directory, "state.json");
  for (let start = 0; start < 4; start++) {
    const store = new Store(directory);
    await store.initialize();
    store.data.repos = [{ ...repository, name: `generation-${start}` }];
    await store.save();
  }
  const backups = async () =>
    Promise.all(
      [1, 2, 3].map((index) => readFile(`${statePath}.bak.${index}`, "utf8")),
    );
  const before = await backups();
  await rm(statePath);
  const store = new Store(directory);
  await store.initialize();
  assert.deepEqual(store.data, { version: 1, repos: [], runs: [] });
  assert.deepEqual(store.backupsWithoutState?.sort(), [
    "state.json.bak.1",
    "state.json.bak.2",
    "state.json.bak.3",
  ]);
  // Nothing new to keep, so no backup moved or was dropped.
  assert.deepEqual(await backups(), before);
  // The next start backs up the new state.json as usual.
  const next = new Store(directory);
  await next.initialize();
  assert.equal(next.backupsWithoutState, undefined);
  assert.deepEqual(await backups(), [
    await readFile(statePath, "utf8"),
    before[0],
    before[1],
  ]);
});

test("save() coalesces writes and resolves once the state it was called after is on disk", async (t) => {
  const { directory, cleanup } = await dataDirectory();
  t.after(cleanup);
  const store = new Store(directory);
  await store.initialize();
  const statePath = path.join(directory, "state.json");
  const saves: Promise<void>[] = [];
  const returned = new Set<Promise<void>>();
  for (let index = 0; index < 50; index++) {
    store.data.repos = [{ ...repository, name: `name-${index}` }];
    const saved = store.save();
    returned.add(saved);
    saves.push(
      saved.then(async () => {
        // Whatever was written includes this change or a later one.
        const written = JSON.parse(await readFile(statePath, "utf8")) as Database;
        assert.ok(Number(written.repos[0].name.slice(5)) >= index);
      }),
    );
  }
  // One write in flight plus one waiting: fifty calls, two writes.
  assert.equal(returned.size, 2);
  await Promise.all(saves);
  const written = JSON.parse(await readFile(statePath, "utf8")) as Database;
  assert.equal(written.repos[0].name, "name-49");
  assert.deepEqual(
    (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("save() shares one pending write between the calls made while another write runs", async (t) => {
  const { directory, cleanup } = await dataDirectory();
  t.after(cleanup);
  const store = new Store(directory);
  await store.initialize();
  const first = store.save();
  const second = store.save();
  const third = store.save();
  assert.notEqual(first, second);
  assert.equal(second, third);
  await Promise.all([first, second, third]);
  // Once idle, a call starts a write of its own. It is awaited before the
  // test ends, so cleanup never removes the directory under a running write.
  const fourth = store.save();
  assert.notEqual(fourth, second);
  await fourth;
});

test("the data directory is made private, and one owned by another user is refused", async (t) => {
  const { directory, cleanup } = await dataDirectory();
  t.after(cleanup);
  if (process.platform === "win32" || typeof process.getuid !== "function")
    return t.skip("POSIX permissions only");
  const dataDir = path.join(directory, "data");
  await mkdir(dataDir, { mode: 0o755 });
  await new Store(dataDir).initialize();
  assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  const getuid = process.getuid;
  t.after(() => {
    process.getuid = getuid;
  });
  process.getuid = () => getuid() + 1;
  await assert.rejects(
    withLocale("en", () => new Store(dataDir).initialize()),
    (error: Error) =>
      error.message ===
      `The data directory ${dataDir} belongs to another user. Start BELL PR as that user, or choose a data directory you own with --data-dir.`,
  );
});

test("a state.json from a newer format is never replaced by a backup", async (t) => {
  const { directory, cleanup } = await dataDirectory();
  t.after(cleanup);
  const statePath = path.join(directory, "state.json");
  await writeFile(statePath, JSON.stringify({ version: 1, repos: [], runs: [] }));
  await new Store(directory).initialize();
  const newer = JSON.stringify({ version: 2, repos: [], runs: [] });
  await writeFile(statePath, newer);
  await assert.rejects(new Store(directory).initialize(), /version 1/);
  assert.equal(await readFile(statePath, "utf8"), newer);
});
