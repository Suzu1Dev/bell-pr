import test from "node:test";
import assert from "node:assert/strict";
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
import { defaultContributionSettings } from "../shared/insights.js";
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
