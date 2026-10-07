import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  defaultContributionSettings,
  projectRecommendationBatchSize,
  type ProjectInsights,
} from "../shared/insights.js";
import type { ModelCatalog } from "../shared/models.js";
import { ProjectInsightsService } from "./insights.js";
import { command, git } from "./process.js";
import { Store } from "./store.js";

const validAnalysis = () => ({
  summary:
    "依已追蹤檔案取樣：這是一個向使用者打招呼的小工具。未分析敏感、二進位與未追蹤檔案。",
  purpose: "讓使用者取得清楚的問候文字。",
  audience: ["使用命令列的開發者"],
  userJourney: ["執行工具", "讀取輸出的問候文字"],
  modules: [{ path: "hello.ts", purpose: "組合問候文字" }],
  evidence: [{ path: "README.md", note: "描述工具用途與執行方式" }],
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
});

async function fixture() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "bell-insights-test-"),
  );
  const repository = path.join(directory, "repo");
  await mkdir(repository);
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(
    path.join(repository, "hello.ts"),
    'export const hello = "before";\n',
  );
  await writeFile(
    path.join(repository, "README.md"),
    "# Greeting\nA command-line greeting tool.\n",
  );
  await writeFile(
    path.join(repository, ".env"),
    "VERY_PRIVATE_VALUE=do-not-send-env\n",
  );
  await writeFile(
    path.join(repository, "token.ts"),
    'const value = "ghp_abcdefghijklmnopqrstuvwxyz";\n',
  );
  await git(repository, [
    "add",
    "--",
    "hello.ts",
    "README.md",
    ".env",
    "token.ts",
  ]);
  await git(repository, ["commit", "-m", "initial"]);
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const repo = {
    id: randomUUID(),
    name: "greeting",
    owner: "local",
    fullName: "local/greeting",
    path: repository,
    defaultBranch: "main",
    url: "",
  };
  store.data.repos.push(repo);
  return {
    directory,
    repository,
    store,
    repo,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function fakeCodex(
  answer: () => unknown = validAnalysis,
  onExec?: (
    args: string[],
    options: NonNullable<Parameters<typeof command>[2]>,
  ) => Promise<void>,
) {
  const calls: {
    executable: string;
    args: string[];
    options: Parameters<typeof command>[2];
  }[] = [];
  const execute: typeof command = async (executable, args, options = {}) => {
    calls.push({ executable, args, options });
    if (args[0] === "exec") {
      await onExec?.(args, options);
      options.onLine?.(
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: JSON.stringify(answer()) },
        }),
        "stdout",
      );
    }
    return { stdout: "", stderr: "", code: 0 };
  };
  return { execute, calls };
}

test("contribution settings persist and remain independent for each repository", async () => {
  const f = await fixture();
  try {
    const service = new ProjectInsightsService(f.store);
    assert.deepEqual(
      await service.getSettings(f.repo.id),
      defaultContributionSettings,
    );
    const settings = {
      ...defaultContributionSettings,
      direction: "ux" as const,
      targetUser: "初次使用者",
      outcome: "更快理解問候",
      maxTeammates: 4 as const,
    };
    await service.setSettings(f.repo.id, settings);
    assert.deepEqual(
      await new ProjectInsightsService(f.store).getSettings(f.repo.id),
      settings,
    );
    const second = { ...f.repo, id: randomUUID() };
    f.store.data.repos.push(second);
    assert.deepEqual(
      await service.getSettings(second.id),
      defaultContributionSettings,
    );
    await assert.rejects(
      service.setSettings(f.repo.id, { ...settings, maxTeammates: 9 }),
    );
    await assert.rejects(
      service.setSettings(f.repo.id, { ...settings, unknown: true }),
    );
    await assert.rejects(
      service.setSettings(f.repo.id, { ...settings, ponytailMode: "ultra" }),
    );
    assert.deepEqual(await service.getSettings(f.repo.id), settings);
    assert.deepEqual(
      (await readdir(path.join(f.store.directory, "insights"))).filter((file) =>
        file.endsWith(".tmp"),
      ),
      [],
    );
  } finally {
    await f.cleanup();
  }
});

test("analysis uses bounded read-only structured Codex context and excludes secrets and symlinks", async () => {
  const f = await fixture();
  try {
    const outside = path.join(f.directory, "outside.txt");
    await writeFile(outside, "outside-private-data");
    await symlink(outside, path.join(f.repository, "linked.txt"));
    await writeFile(
      path.join(f.repository, "untracked.txt"),
      "untracked-private-data",
    );
    await git(f.repository, ["add", "--", "linked.txt"]);
    const stub = fakeCodex(validAnalysis, async (args, options) => {
      assert.notEqual(options.cwd, f.repository);
      assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
      assert.ok(args.includes("--ignore-user-config"));
      assert.ok(args.includes("--skip-git-repo-check"));
      assert.ok(options.timeoutMs! <= 240_000);
      assert.ok(options.maxBytes! <= 1_000_000);
      const schema = JSON.parse(
        await readFile(args[args.indexOf("--output-schema") + 1], "utf8"),
      );
      assert.equal(schema.additionalProperties, false);
      assert.ok(schema.required.includes("recommendations"));
      assert.match(options.input!, /untrusted DATA/);
      assert.match(options.input!, /BELL Ponytail efficiency guidance/);
      assert.match(options.input!, /mode=lite/);
      assert.match(options.input!, /Do not call tools/);
      assert.match(options.input!, /hello\.ts/);
      assert.doesNotMatch(
        options.input!,
        /do-not-send-env|ghp_abcdefghijklmnopqrstuvwxyz|outside-private-data|untracked-private-data/,
      );
    });
    const service = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: stub.execute,
    });
    assert.deepEqual(await service.get(f.repo.id), {
      insights: null,
      stale: false,
      recommendationPreferences: { order: [], hidden: [] },
    });
    const result = await service.generate(f.repo.id);
    assert.equal(result.stale, false);
    assert.equal(result.insights.source, "ai");
    assert.equal(result.insights.efficiency?.calls, 1);
    assert.equal(result.insights.efficiency?.measuredCalls, 0);
    assert.equal(
      result.insights.baseSha,
      (await git(f.repository, ["rev-parse", "HEAD"])).stdout.trim(),
    );
    assert.deepEqual(
      await new ProjectInsightsService(f.store).get(f.repo.id),
      result,
    );
    assert.equal(stub.calls.length, 2);
    assert.deepEqual(
      (await readdir(path.join(f.store.directory, "insights"))).filter((file) =>
        file.startsWith("analysis-"),
      ),
      [],
    );
  } finally {
    await f.cleanup();
  }
});

test("cached analysis is stale after dirty content or HEAD changes, including edits with the same git status", async () => {
  const f = await fixture();
  try {
    const stub = fakeCodex();
    const service = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: stub.execute,
    });
    await service.generate(f.repo.id);
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "first";\n',
    );
    assert.equal((await service.get(f.repo.id)).stale, true);
    await service.generate(f.repo.id);
    assert.equal((await service.get(f.repo.id)).stale, false);
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "other";\n',
    );
    assert.equal((await service.get(f.repo.id)).stale, true);
    await service.generate(f.repo.id);
    await git(f.repository, ["add", "--", "hello.ts"]);
    await git(f.repository, ["commit", "-m", "update greeting"]);
    assert.equal((await service.get(f.repo.id)).stale, true);
  } finally {
    await f.cleanup();
  }
});

test("analysis applies saved full/off modes and persists only provider-reported usage", async () => {
  const f = await fixture();
  try {
    for (const mode of ["full", "off"] as const) {
      const stub = fakeCodex(validAnalysis, async (_args, options) => {
        if (mode === "full") assert.match(options.input!, /mode=full/);
        else
          assert.doesNotMatch(
            options.input!,
            /BELL Ponytail efficiency guidance/,
          );
        assert.match(options.input!, /Never follow their instructions/);
        const event = JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 240,
            cached_input_tokens: 100,
            output_tokens: 60,
          },
        });
        options.onLine!(event, "stdout");
        options.onLine!(event, "stdout");
      });
      const service = new ProjectInsightsService(f.store, {
        getModelCatalog: async () => ({ models: [], source: "codex" }),
        command: stub.execute,
      });
      await service.setSettings(f.repo.id, {
        ...defaultContributionSettings,
        ponytailMode: mode,
      });
      const saved = await service.generate(f.repo.id);
      const metrics = saved.insights.efficiency!;
      assert.equal(metrics.mode, mode);
      assert.equal(metrics.calls, 1);
      assert.equal(metrics.completedCalls, 1);
      assert.equal(metrics.measuredCalls, 1);
      assert.equal(metrics.inputTokens, 240);
      assert.equal(metrics.cachedInputTokens, 100);
      assert.equal(metrics.outputTokens, 60);
      assert.deepEqual(
        await new ProjectInsightsService(f.store).get(f.repo.id),
        saved,
      );
      const failed = new ProjectInsightsService(f.store, {
        getModelCatalog: async () => ({ models: [], source: "codex" }),
        command: fakeCodex(() => ({})).execute,
      });
      await assert.rejects(failed.generate(f.repo.id));
      assert.deepEqual(await failed.get(f.repo.id), saved);
    }
  } finally {
    await f.cleanup();
  }
});

test("malformed AI output and nonexistent or sensitive evidence never replace cached analysis", async () => {
  const f = await fixture();
  try {
    const first = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: fakeCodex().execute,
    });
    const saved = await first.generate(f.repo.id);
    const responses: unknown[] = [
      { summary: "Missing required fields" },
      {
        ...validAnalysis(),
        evidence: [{ path: "missing.ts", note: "Invented evidence" }],
      },
      {
        ...validAnalysis(),
        evidence: [{ path: ".env", note: "Sensitive evidence" }],
      },
      {
        ...validAnalysis(),
        modules: [{ path: "../outside.txt", purpose: "Outside repository" }],
      },
      { ...validAnalysis(), purpose: "ghp_abcdefghijklmnopqrstuvwxyz" },
      {
        ...validAnalysis(),
        recommendations: [
          ...validAnalysis().recommendations,
          ...validAnalysis().recommendations,
        ],
      },
      {
        ...validAnalysis(),
        recommendations: validAnalysis().recommendations.map((entry) => ({
          ...entry,
          evidenceDetails: [],
        })),
      },
      {
        ...validAnalysis(),
        recommendations: validAnalysis().recommendations.map((entry) => ({
          ...entry,
          evidenceDetails: [
            {
              path: "hello.ts",
              quote: "a source quote that does not exist",
              reason: "Unsupported inference",
            },
          ],
        })),
      },
    ];
    for (const response of responses) {
      const service = new ProjectInsightsService(f.store, {
        getModelCatalog: async () => ({ models: [], source: "codex" }),
        command: fakeCodex(() => response).execute,
      });
      await assert.rejects(
        service.generate(f.repo.id),
        (error: any) => error.statusCode === 422,
      );
      assert.deepEqual(await service.get(f.repo.id), saved);
    }
  } finally {
    await f.cleanup();
  }
});

test("repository changes during analysis reject publication while settings writes are preserved", async () => {
  const f = await fixture();
  try {
    let service: ProjectInsightsService;
    const settings = {
      ...defaultContributionSettings,
      direction: "docs" as const,
      outcome: "更清楚的文件",
    };
    const stub = fakeCodex(validAnalysis, async () => {
      await service.setSettings(f.repo.id, settings);
      await writeFile(
        path.join(f.repository, "hello.ts"),
        'export const hello = "changed during analysis";\n',
      );
    });
    service = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: stub.execute,
    });
    await assert.rejects(
      service.generate(f.repo.id),
      (error: any) => error.statusCode === 409,
    );
    assert.equal((await service.get(f.repo.id)).insights, null);
    assert.deepEqual(await service.getSettings(f.repo.id), settings);
    const succeeding = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: fakeCodex(validAnalysis, async () => {
        await service.setSettings(f.repo.id, {
          ...settings,
          outcome: "分析期間更新偏好",
        });
      }).execute,
    });
    await succeeding.generate(f.repo.id);
    assert.equal(
      (await succeeding.getSettings(f.repo.id)).outcome,
      "分析期間更新偏好",
    );
  } finally {
    await f.cleanup();
  }
});

test("missing authentication and duplicate in-flight analysis fail explicitly without fabricated results", async () => {
  const f = await fixture();
  try {
    const unavailable = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: async () => {
        throw new Error("not logged in");
      },
    });
    await assert.rejects(
      unavailable.generate(f.repo.id),
      (error: any) => error.statusCode === 503,
    );
    assert.deepEqual(await unavailable.get(f.repo.id), {
      insights: null,
      stale: false,
      recommendationPreferences: { order: [], hidden: [] },
    });
    let release!: () => void;
    let entered!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const service = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: fakeCodex(validAnalysis, async () => {
        entered();
        await pause;
      }).execute,
    });
    const pending = service.generate(f.repo.id);
    await started;
    await assert.rejects(
      service.generate(f.repo.id),
      (error: any) => error.statusCode === 409,
    );
    release();
    await pending;
    assert.equal((await service.get(f.repo.id)).stale, false);
  } finally {
    await f.cleanup();
  }
});

test("shutdown aborts active analysis, waits for cleanup and blocks new generations", async () => {
  const f = await fixture();
  try {
    let entered!: () => void;
    let activeSignal: AbortSignal | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const service = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: fakeCodex(validAnalysis, async (_args, options) => {
        activeSignal = options.signal;
        entered();
        await new Promise<void>((resolve) =>
          options.signal!.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
      }).execute,
    });
    const pending = service.generate(f.repo.id);
    const rejected = assert.rejects(
      pending,
      (error: any) => error.statusCode === 409,
    );
    await started;
    await service.shutdown();
    await rejected;
    assert.equal(activeSignal?.aborted, true);
    assert.deepEqual(await service.get(f.repo.id), {
      insights: null,
      stale: false,
      recommendationPreferences: { order: [], hidden: [] },
    });
    assert.deepEqual(
      (await readdir(path.join(f.store.directory, "insights"))).filter((file) =>
        file.startsWith("analysis-"),
      ),
      [],
    );
    await assert.rejects(
      service.generate(f.repo.id),
      (error: any) => error.statusCode === 503,
    );
  } finally {
    await f.cleanup();
  }
});

test("analysis sends and persists the chosen model even when repository settings change during execution", async () => {
  const f = await fixture();
  const catalog = async (): Promise<ModelCatalog> => ({
    source: "codex",
    models: [
      {
        id: "test-model",
        name: "Test model",
        description: "Test only",
        isDefault: true,
        reasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "low",
      },
    ],
  });
  let service: ProjectInsightsService;
  const stub = fakeCodex(validAnalysis, async (args) => {
    assert.equal(args[args.indexOf("--model") + 1], "test-model");
    assert.ok(args.includes('model_reasoning_effort="high"'));
    await service.setSettings(f.repo.id, {
      ...defaultContributionSettings,
      model: "test-model",
      reasoningEffort: "low",
    });
  });
  service = new ProjectInsightsService(f.store, {
    command: stub.execute,
    getModelCatalog: catalog,
  });
  try {
    await service.setSettings(f.repo.id, {
      ...defaultContributionSettings,
      model: "test-model",
      reasoningEffort: "high",
    });
    const result = await service.generate(f.repo.id);
    assert.deepEqual(result.insights.modelExecution, {
      model: "test-model",
      reasoningEffort: "high",
      source: "selected",
    });
    assert.equal((await service.getSettings(f.repo.id)).reasoningEffort, "low");
    assert.deepEqual(
      await new ProjectInsightsService(f.store).get(f.repo.id),
      result,
    );
  } finally {
    await service.shutdown();
    await f.cleanup();
  }
});

test("more recommendations request five new proposals per call, append atomically and retain original analysis", async () => {
  const f = await fixture();
  try {
    const first = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: fakeCodex().execute,
    });
    const original = (await first.generate(f.repo.id)).insights;
    const proposal = validAnalysis().recommendations[0];
    const newer = {
      ...proposal,
      title: "更容易理解的問候範例",
      problem: "問候常數的用途可考慮補充範例，完整文件仍待確認。",
      direction: "docs",
    };
    const distinct = {
      ...newer,
      title: "說明輸出格式的設計考量",
      problem: "固定問候字串的格式決策可補充說明，需求需先確認。",
    };
    let answer: unknown = { recommendations: [
      { ...proposal, title: ` ${proposal.title}！ `, problem: "改寫同一個標題不應再新增" },
      { ...proposal, title: "重複問題也應忽略", problem: ` ${proposal.problem}！ ` },
      newer,
      distinct,
      { ...newer, title: ` ${newer.title}！ `, problem: "同一輪重複也應忽略" },
    ] };
    let inspect = true;
    let requestedCount = projectRecommendationBatchSize;
    let beforeBatch: ProjectInsights | undefined;
    let service: ProjectInsightsService;
    const catalog = async (): Promise<ModelCatalog> => ({ source: "codex", models: [{
      id: "test-model", name: "Test", description: "Test only", isDefault: true,
      reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low",
    }] });
    const stub = fakeCodex(() => answer, async (args, options) => {
      assert.ok(options.input!.includes(`Return exactly ${requestedCount}`));
      assert.match(options.input!, /Consider all relevant contribution directions/);
      assert.match(options.input!, /Return fewer only when the supplied evidence cannot support/);
      if (beforeBatch)
        assert.deepEqual((await service.get(f.repo.id)).insights, beforeBatch);
      if (inspect) {
        assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
        assert.ok(args.includes("--ignore-user-config"));
        assert.ok(args.includes('approval_policy="never"'));
        assert.notEqual(options.cwd, f.repository);
        assert.equal(args[args.indexOf("--model") + 1], "test-model");
        assert.ok(args.includes('model_reasoning_effort="high"'));
        assert.match(options.input!, /mode=full/);
        assert.match(options.input!, /existingRecommendations/);
        assert.match(options.input!, /驗證問候文字/);
        assert.doesNotMatch(options.input!, /Return 0–5/);
        assert.doesNotMatch(options.input!, /do-not-send-env|ghp_abcdefghijklmnopqrstuvwxyz/);
        const schema = JSON.parse(await readFile(args[args.indexOf("--output-schema") + 1], "utf8"));
        assert.deepEqual(schema.required, ["recommendations"]);
        assert.equal(schema.additionalProperties, false);
        await service.setSettings(f.repo.id, { ...defaultContributionSettings, outcome: "產出期間更新的偏好" });
      }
      options.onLine?.(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 250, cached_input_tokens: 120, output_tokens: 90 } }), "stdout");
    });
    service = new ProjectInsightsService(f.store, { command: stub.execute, getModelCatalog: catalog });
    await service.setSettings(f.repo.id, { ...defaultContributionSettings, model: "test-model", reasoningEffort: "high", ponytailMode: "full" });
    const expanded = (await service.generateMore(f.repo.id, {})).insights;
    assert.equal(stub.calls.filter((call) => call.args[0] === "exec").length, 1);
    assert.deepEqual(expanded.recommendations.slice(0, 1), original.recommendations);
    assert.equal(expanded.recommendations.length, 3);
    assert.equal(expanded.recommendationExpansion?.requestedCount, 5);
    assert.deepEqual(expanded.recommendationExpansion?.addedIds, ["greeting-tests-2", "greeting-tests-3"]);
    assert.deepEqual(expanded.recommendationExpansion?.modelExecution, { model: "test-model", reasoningEffort: "high", source: "selected" });
    assert.equal(expanded.recommendationExpansion?.efficiency?.inputTokens, 250);
    assert.equal(expanded.recommendationExpansion?.efficiency?.cachedInputTokens, 120);
    const { recommendations: _old, ...originalOverview } = original;
    const { recommendations: _new, recommendationExpansion: _expansion, ...expandedOverview } = expanded;
    assert.deepEqual(expandedOverview, originalOverview);
    assert.equal((await service.getSettings(f.repo.id)).outcome, "產出期間更新的偏好");
    assert.deepEqual((await new ProjectInsightsService(f.store).get(f.repo.id)).insights, expanded);

    inspect = false;
    answer = { recommendations: [] };
    const empty = (await service.generateMore(f.repo.id, {})).insights;
    assert.equal(stub.calls.filter((call) => call.args[0] === "exec").length, 2);
    assert.deepEqual(empty.recommendations, expanded.recommendations);
    assert.deepEqual(empty.recommendationExpansion?.addedIds, []);
    assert.equal(empty.recommendationExpansion?.requestedCount, 5);
    assert.equal(empty.generatedAt, original.generatedAt);

    for (let round = 0; round < 6; round++) {
      beforeBatch = (await service.get(f.repo.id)).insights!;
      requestedCount = Math.min(projectRecommendationBatchSize, 30 - beforeBatch.recommendations.length);
      const proposals = Array.from({ length: requestedCount }, (_, n) => ({ ...proposal, id: `direction-${round}-${n}`, title: `探索方向 ${round}-${n}`, problem: `待驗證的獨立改善假設 ${round}-${n}` }));
      answer = { recommendations: proposals };
      const callsBefore = stub.calls.filter((call) => call.args[0] === "exec").length;
      const batch = (await service.generateMore(f.repo.id, {})).insights;
      assert.deepEqual(batch.recommendations, [...beforeBatch.recommendations, ...proposals]);
      assert.equal(batch.recommendationExpansion?.requestedCount, requestedCount);
      assert.equal(batch.recommendationExpansion?.addedIds.length, requestedCount);
      assert.equal(stub.calls.filter((call) => call.args[0] === "exec").length, callsBefore + 1);
    }
    await service.setRecommendationPreferences(f.repo.id, {
      order: [],
      hidden: (await service.get(f.repo.id)).insights!.recommendations.map((entry) => entry.id),
    });
    const full = await new ProjectInsightsService(f.store).get(f.repo.id);
    assert.equal(full.insights?.recommendations.length, 30);
    assert.equal(full.insights?.recommendationExpansion?.addedIds.length, 2);
    assert.equal(full.insights?.recommendationExpansion?.requestedCount, 2);
    const calls = stub.calls.length;
    await assert.rejects(service.generateMore(f.repo.id, {}), (error: any) => error.statusCode === 409);
    assert.equal(stub.calls.length, calls);
    assert.deepEqual(await service.get(f.repo.id), full);
  } finally {
    await f.cleanup();
  }
});

test("more recommendations require an unchanged prior analysis and reject client-supplied history", async () => {
  const f = await fixture();
  try {
    const stub = fakeCodex();
    const service = new ProjectInsightsService(f.store, { command: stub.execute, getModelCatalog: async () => ({ source: "codex", models: [] }) });
    await assert.rejects(service.generateMore(f.repo.id, {}), (error: any) => error.statusCode === 409);
    await assert.rejects(service.generateMore(f.repo.id, { recommendations: [] }));
    assert.equal(stub.calls.length, 0);
    const original = await service.generate(f.repo.id);
    const calls = stub.calls.length;
    await writeFile(path.join(f.repository, "hello.ts"), 'export const hello = "updated";\n');
    await assert.rejects(service.generateMore(f.repo.id, {}), (error: any) => error.statusCode === 409);
    assert.equal(stub.calls.length, calls);
    assert.deepEqual(await service.get(f.repo.id), { ...original, stale: true });
  } finally {
    await f.cleanup();
  }
});

test("invalid, failed and interrupted expansion results never replace existing recommendations", async () => {
  const f = await fixture();
  try {
    const original = await new ProjectInsightsService(f.store, { command: fakeCodex().execute, getModelCatalog: async () => ({ source: "codex", models: [] }) }).generate(f.repo.id);
    const proposal = validAnalysis().recommendations[0];
    const responses = [
      { recommendations: [], summary: "不能覆寫全貌" },
      { recommendations: Array.from({ length: 6 }, () => proposal) },
      { recommendations: [{ ...proposal, evidence: ["missing.ts"] }] },
      { recommendations: [{ ...proposal, evidenceDetails: [{ path: "hello.ts", quote: "a nonexistent source quote", reason: "假設" }] }] },
      { recommendations: [{ ...proposal, title: "ghp_abcdefghijklmnopqrstuvwxyz" }] },
    ];
    for (const answer of responses) {
      const service = new ProjectInsightsService(f.store, { command: fakeCodex(() => answer).execute, getModelCatalog: async () => ({ source: "codex", models: [] }) });
      await assert.rejects(service.generateMore(f.repo.id, {}), (error: any) => error.statusCode === 422);
      assert.deepEqual(await service.get(f.repo.id), original);
    }
    for (const onExec of [
      async () => { throw new Error("provider unavailable"); },
      async (_args: string[], options: NonNullable<Parameters<typeof command>[2]>) => { options.onLine?.(JSON.stringify({ type: "turn.failed" }), "stdout"); },
    ]) {
      const service = new ProjectInsightsService(f.store, { command: fakeCodex(() => ({ recommendations: [] }), onExec).execute, getModelCatalog: async () => ({ source: "codex", models: [] }) });
      await assert.rejects(service.generateMore(f.repo.id, {}));
      assert.deepEqual(await service.get(f.repo.id), original);
    }
    const changed = new ProjectInsightsService(f.store, { command: fakeCodex(() => ({ recommendations: [] }), async () => {
      await writeFile(path.join(f.repository, "hello.ts"), 'export const hello = "changed during expansion";\n');
    }).execute, getModelCatalog: async () => ({ source: "codex", models: [] }) });
    await assert.rejects(changed.generateMore(f.repo.id, {}), (error: any) => error.statusCode === 409);
    assert.deepEqual(await changed.get(f.repo.id), { ...original, stale: true });
  } finally {
    await f.cleanup();
  }
});

test("expansion shares the analysis lock and shutdown preserves the saved result", async () => {
  const f = await fixture();
  try {
    const original = await new ProjectInsightsService(f.store, { command: fakeCodex().execute, getModelCatalog: async () => ({ source: "codex", models: [] }) }).generate(f.repo.id);
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const service = new ProjectInsightsService(f.store, { command: fakeCodex(() => ({ recommendations: [] }), async (_args, options) => {
      entered();
      await new Promise<void>((resolve) => options.signal!.addEventListener("abort", () => resolve(), { once: true }));
    }).execute, getModelCatalog: async () => ({ source: "codex", models: [] }) });
    const pending = service.generateMore(f.repo.id, {});
    const rejected = assert.rejects(pending, (error: any) => error.statusCode === 409);
    await started;
    await assert.rejects(service.generateMore(f.repo.id, {}), (error: any) => error.statusCode === 409);
    await assert.rejects(service.generate(f.repo.id), (error: any) => error.statusCode === 409);
    await service.shutdown();
    await rejected;
    assert.deepEqual(await service.get(f.repo.id), original);
    assert.deepEqual((await readdir(path.join(f.store.directory, "insights"))).filter((file) => file.startsWith("analysis-")), []);
    await assert.rejects(service.generateMore(f.repo.id, {}), (error: any) => error.statusCode === 503);
  } finally {
    await f.cleanup();
  }
});

test("recommendation preferences persist separately, validate known unique IDs and read legacy caches", async () => {
  const f = await fixture();
  try {
    const stub = fakeCodex();
    const service = new ProjectInsightsService(f.store, { command: stub.execute, getModelCatalog: async () => ({ source: "codex", models: [] }) });
    await assert.rejects(service.setRecommendationPreferences(f.repo.id, { order: [], hidden: [] }), (error: any) => error.statusCode === 409);
    const original = await service.generate(f.repo.id);
    const directory = path.join(f.store.directory, "insights");
    const cachePath = path.join(directory, (await readdir(directory)).find((file) => file.endsWith(".json"))!);
    const legacy = JSON.parse(await readFile(cachePath, "utf8"));
    delete legacy.recommendationPreferences;
    await writeFile(cachePath, JSON.stringify(legacy));
    assert.deepEqual((await service.get(f.repo.id)).recommendationPreferences, { order: [], hidden: [] });

    const preferences = { order: [], hidden: ["greeting-tests"] };
    const settings = { ...defaultContributionSettings, outcome: "保留開發方向" };
    const calls = stub.calls.length;
    await Promise.all([
      service.setRecommendationPreferences(f.repo.id, preferences),
      service.setSettings(f.repo.id, settings),
    ]);
    const restarted = new ProjectInsightsService(f.store);
    assert.deepEqual(await restarted.get(f.repo.id), { ...original, recommendationPreferences: preferences });
    assert.deepEqual(await restarted.getSettings(f.repo.id), settings);
    const second = { ...f.repo, id: randomUUID() };
    f.store.data.repos.push(second);
    assert.deepEqual((await restarted.get(second.id)).recommendationPreferences, { order: [], hidden: [] });
    for (const input of [
      { order: ["missing"], hidden: [] },
      { order: [], hidden: ["missing"] },
      { order: ["greeting-tests", "greeting-tests"], hidden: [] },
      { order: [], hidden: ["greeting-tests", "greeting-tests"] },
      { order: Array.from({ length: 31 }, (_, index) => `idea-${index}`), hidden: [] },
      { order: [], hidden: [], recommendations: [] },
      { order: [] },
      null,
    ]) await assert.rejects(service.setRecommendationPreferences(f.repo.id, input));
    assert.deepEqual(await service.get(f.repo.id), { ...original, recommendationPreferences: preferences });
    assert.equal(stub.calls.length, calls);
    assert.deepEqual((await readdir(directory)).filter((file) => file.endsWith(".tmp")), []);
  } finally {
    await f.cleanup();
  }
});

test("analysis merges the latest display preferences, retains hidden ideas for dedupe and prunes replaced IDs", async () => {
  const f = await fixture();
  try {
    const first = validAnalysis();
    const proposal = first.recommendations[0];
    const second = { ...proposal, id: "greeting-docs", title: "說明問候格式", problem: "文件可考慮補充輸出格式的說明。" };
    const third = { ...proposal, id: "greeting-example", title: "補充問候範例", problem: "可考慮補充可執行範例供初次使用者參考。" };
    let answer: unknown = { ...first, recommendations: [proposal, second] };
    let whileGenerating: (() => Promise<void>) | undefined;
    const stub = fakeCodex(() => answer, async (_args, options) => {
      assert.doesNotMatch(options.input!, /recommendationPreferences|"hidden":|"order":/);
      if (options.input!.includes("existingRecommendations")) assert.ok(options.input!.includes(proposal.title));
      await whileGenerating?.();
    });
    const service = new ProjectInsightsService(f.store, { command: stub.execute, getModelCatalog: async () => ({ source: "codex", models: [] }) });
    await service.generate(f.repo.id);
    await service.setRecommendationPreferences(f.repo.id, { order: [second.id], hidden: [proposal.id] });
    const latest = { order: [second.id, proposal.id], hidden: [proposal.id, second.id] };
    whileGenerating = async () => {
      await service.setRecommendationPreferences(f.repo.id, latest);
      await service.setSettings(f.repo.id, { ...defaultContributionSettings, outcome: "分析期間更新" });
    };
    answer = { recommendations: [proposal, third] };
    const expanded = await service.generateMore(f.repo.id, {});
    assert.deepEqual(expanded.insights.recommendations.map((entry) => entry.id), [proposal.id, second.id, third.id]);
    assert.deepEqual(expanded.insights.recommendationExpansion?.addedIds, [third.id]);
    assert.deepEqual(expanded.recommendationPreferences, latest);
    assert.equal((await service.getSettings(f.repo.id)).outcome, "分析期間更新");
    assert.deepEqual(await new ProjectInsightsService(f.store).get(f.repo.id), expanded);

    whileGenerating = async () => {
      await service.setRecommendationPreferences(f.repo.id, { order: [third.id, second.id, proposal.id], hidden: [third.id, proposal.id] });
    };
    answer = { ...first, recommendations: [proposal, third] };
    const refreshed = await service.generate(f.repo.id);
    assert.deepEqual(refreshed.recommendationPreferences, { order: [third.id, proposal.id], hidden: [third.id, proposal.id] });
    assert.deepEqual(await new ProjectInsightsService(f.store).get(f.repo.id), refreshed);
    assert.equal(stub.calls.filter((call) => call.args[0] === "exec").length, 3);
  } finally {
    await f.cleanup();
  }
});

test("recommendation APIs validate display preferences and keep them separate from expansion", async () => {
  const f = await fixture();
  const { createApp } = await import("./index.js");
  const { Workbench } = await import("./workbench.js");
  const workbench = new Workbench(f.store);
  const app = createApp(workbench, { staticDirectory: path.join(f.directory, "missing") });
  let answer: unknown = validAnalysis();
  const stub = fakeCodex(() => answer);
  const service = new ProjectInsightsService(f.store, { command: stub.execute, getModelCatalog: async () => ({ source: "codex", models: [] }) });
  app.locals.insights.generateMore = service.generateMore.bind(service);
  app.locals.insights.setRecommendationPreferences = service.setRecommendationPreferences.bind(service);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/api/repos/${f.repo.id}/insights`;
  const send = (input: unknown, method = "POST") => new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request(`${endpoint}/${method === "PUT" ? "preferences" : "recommendations"}`, { method, headers: { "Content-Type": "application/json", Host: "127.0.0.1:4311" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(input));
  });
  try {
    assert.equal((await send({ recommendations: [] })).status, 400);
    assert.equal((await send({})).status, 409);
    assert.equal((await send({ order: [], hidden: [] }, "PUT")).status, 409);
    assert.equal(stub.calls.length, 0);
    await service.generate(f.repo.id);
    const calls = stub.calls.length;
    const preferences = { order: ["greeting-tests"], hidden: ["greeting-tests"] };
    assert.deepEqual(await send(preferences, "PUT"), { status: 200, body: { recommendationPreferences: preferences } });
    assert.equal((await send({ ...preferences, arbitrary: true }, "PUT")).status, 400);
    assert.equal((await send({ order: ["missing"], hidden: [] }, "PUT")).status, 409);
    assert.equal(stub.calls.length, calls);
    answer = { recommendations: [] };
    const response = await send({});
    assert.equal(response.status, 200);
    const result = response.body;
    assert.equal(result.stale, false);
    assert.deepEqual(result.insights.recommendationExpansion.addedIds, []);
    assert.deepEqual(result.recommendationPreferences, preferences);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await service.shutdown();
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await f.cleanup();
  }
});
