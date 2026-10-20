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
import {
  cacheSchema,
  fileTree,
  persistedInsightsSchema,
  ProjectInsightsService,
} from "./insights.js";
import { lenientRead } from "./persisted-schema.js";
import { assertNoHan } from "../src/test-utils/render.js";
import { command, git } from "./process.js";
import { AppError } from "./types.js";
import { Store } from "./store.js";
import { withLocale } from "./i18n/index.js";
import { respondIn } from "./prompt-language.js";

/** The JSON data object sent after the prompt sentences and before the Ponytail guidance. */
function payload(input: string) {
  const start = input.indexOf('{"repository"');
  const end = input.indexOf("\n\nBELL Ponytail", start);
  return JSON.parse(input.slice(start, end)) as {
    source: { files: { path: string }[]; tree: string[] };
  };
}

const validAnalysis = () => ({
  summary:
    "依已追蹤檔案取樣：這是一個向使用者打招呼的小工具。未分析敏感、二進位與未追蹤檔案。",
  purpose: "讓使用者取得清楚的問候文字。",
  audience: ["使用命令列的開發者"],
  userJourney: ["執行工具", "讀取輸出的問候文字"],
  modules: [{ path: "hello.ts", purpose: "組合問候文字" }],
  readingPath: [
    {
      path: "README.md",
      why: "先知道工具要解決什麼問題。",
      lookFor: "工具的定位與執行方式。",
    },
    {
      path: "hello.ts",
      why: "整個專案只有這個模組產生輸出。",
      lookFor: "匯出的常數如何組成問候文字。",
    },
  ],
  howItFitsTogether:
    "README.md 描述的命令列用法最終輸出 hello.ts 匯出的常數；此取樣沒有看到其他模組引用它，呼叫方式屬於推論。",
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
    // Only a GitHub issue page may be linked; pull requests and other hosts are rejected.
    for (const issueUrl of [
      "https://example.com/acme/widgets/issues/12",
      "https://github.com/acme/widgets/pull/12",
      "https://github.com/acme/widgets",
      "https://api.github.com/repos/acme/widgets/issues/12",
    ])
      await assert.rejects(
        service.setSettings(f.repo.id, { ...settings, issueUrl }),
        /issues/,
      );
    assert.deepEqual(await service.getSettings(f.repo.id), settings);
    const linked = {
      ...settings,
      issueUrl: "https://github.com/acme/widgets/issues/12",
    };
    await service.setSettings(f.repo.id, linked);
    assert.deepEqual(await service.getSettings(f.repo.id), linked);
    await service.setSettings(f.repo.id, { ...settings, issueUrl: "" });
    assert.deepEqual(await service.getSettings(f.repo.id), {
      ...settings,
      issueUrl: "",
    });
    await service.setSettings(f.repo.id, settings);
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
    let tree: string[] = [];
    const stub = fakeCodex(validAnalysis, async (args, options) => {
      // The tree names every safe tracked path, even unread ones, but never the sensitive .env.
      tree = payload(options.input!).source.tree;
      assert.deepEqual([...tree].sort(), [
        "README.md",
        "hello.ts",
        "linked.txt",
        "token.ts",
      ]);
      assert.match(options.input!, /source\.tree .* only proves those paths exist/);
      assert.notEqual(options.cwd, f.repository);
      assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
      assert.ok(args.includes("--ignore-user-config"));
      assert.ok(args.includes("--skip-git-repo-check"));
      assert.equal(options.timeoutMs, 240_000);
      assert.ok(options.maxBytes! <= 1_000_000);
      const schema = JSON.parse(
        await readFile(args[args.indexOf("--output-schema") + 1], "utf8"),
      );
      assert.equal(schema.additionalProperties, false);
      assert.ok(schema.required.includes("recommendations"));
      assert.ok(schema.required.includes("readingPath"));
      assert.ok(schema.required.includes("howItFitsTogether"));
      assert.match(options.input!, /readingPath lists 3–8 supplied files/);
      assert.match(options.input!, /Explicitly label inferences/);
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
    // Five tracked files; .env (sensitive path), token.ts (secret literal) and the symlink are skipped.
    const sampledBytes = (
      await Promise.all(
        ["hello.ts", "README.md"].map((file) =>
          readFile(path.join(f.repository, file)),
        ),
      )
    ).reduce((total, buffer) => total + buffer.byteLength, 0);
    assert.deepEqual(result.insights.sample, {
      trackedFiles: 5,
      sampledFiles: 2,
      bytes: sampledBytes,
      truncatedFiles: 0,
      treeBytes: Buffer.byteLength(JSON.stringify(tree)),
    });
    assert.deepEqual(result.insights.verification, {
      droppedRecommendations: [],
    });
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

test("the analysis prompt asks for the request's language", async () => {
  const f = await fixture();
  try {
    const stub = fakeCodex();
    const service = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: stub.execute,
    });
    const prompts = () =>
      stub.calls
        .filter((call) => call.args[0] === "exec")
        .map((call) => call.options!.input!);
    await withLocale("en", () => service.generate(f.repo.id));
    const [english] = prompts();
    assert.ok(
      english.startsWith(
        `You are BELL PR's read-only project analyst. Return a single JSON object matching the provided output schema. ${respondIn("en")}`,
      ),
    );
    assert.doesNotMatch(english, /Traditional Chinese/);
    await withLocale("zh-TW", () => service.generate(f.repo.id));
    const chinese = prompts()[1];
    assert.ok(chinese.includes(respondIn("zh-TW")));
    assert.equal(
      english.replace(respondIn("en"), ""),
      chinese.replace(respondIn("zh-TW"), ""),
    );
  } finally {
    await f.cleanup();
  }
});

test("an analysis records its locale outside the fingerprint, and more recommendations keep that locale", async () => {
  const f = await fixture();
  try {
    const proposal = validAnalysis().recommendations[0];
    const english = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: fakeCodex(() => ({
        ...validAnalysis(),
        recommendations: [
          proposal,
          {
            ...proposal,
            id: "unquoted",
            evidenceDetails: [
              { path: "hello.ts", quote: "a quote that is not there", reason: "Guess" },
            ],
          },
        ],
      })).execute,
    });
    const first = await withLocale("en", () => english.generate(f.repo.id));
    assert.equal(first.insights.locale, "en");
    // Persisted text BELL writes about the analysis is in the analysis's locale.
    assert.deepEqual(first.insights.verification?.droppedRecommendations, [
      {
        id: "unquoted",
        title: proposal.title,
        reason: 'The quote was not found in hello.ts: "a quote that is not there"',
      },
    ]);
    // Reading it in another locale is still current: the locale is not part of the fingerprint.
    const read = await withLocale("zh-TW", () => english.get(f.repo.id));
    assert.equal(read.stale, false);
    assert.equal(read.insights?.locale, "en");
    const cacheFile = (await readdir(path.join(f.store.directory, "insights"))).find(
      (name) => name.endsWith(".json"),
    )!;
    const saved = JSON.parse(
      await readFile(path.join(f.store.directory, "insights", cacheFile), "utf8"),
    );
    assert.equal(saved.insights.locale, "en");
    // More recommendations requested from a zh-TW page are still written in English.
    const more = fakeCodex(() => ({
      recommendations: [
        { ...proposal, id: "examples", title: "Add greeting examples", problem: "Examples may help." },
      ],
    }));
    const expanding = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: more.execute,
    });
    const expanded = await withLocale("zh-TW", () => expanding.generateMore(f.repo.id, {}));
    const input = more.calls.find((call) => call.args[0] === "exec")!.options!.input!;
    assert.ok(input.includes(respondIn("en")));
    assert.doesNotMatch(input, /Traditional Chinese/);
    assert.equal(expanded.insights.locale, "en");
    assert.deepEqual(expanded.insights.recommendationExpansion?.addedIds, ["examples"]);
    // A cache written before the locale was recorded was written in zh-TW,
    // the only language of those builds: it expands in zh-TW from any page
    // and stays unlabelled.
    delete saved.insights.locale;
    await writeFile(path.join(f.store.directory, "insights", cacheFile), JSON.stringify(saved));
    const legacy = fakeCodex(() => ({ recommendations: [] }));
    const legacyResult = await withLocale("en", () =>
      new ProjectInsightsService(f.store, {
        getModelCatalog: async () => ({ models: [], source: "codex" }),
        command: legacy.execute,
      }).generateMore(f.repo.id, {}),
    );
    assert.ok(
      legacy.calls.find((call) => call.args[0] === "exec")!.options!.input!.includes(respondIn("zh-TW")),
    );
    assert.equal(legacyResult.insights.locale, undefined);
  } finally {
    await f.cleanup();
  }
});

test("more recommendations answer the request in its locale and save their notes in the analysis's", async () => {
  const f = await fixture();
  const service = (answer: () => unknown) =>
    new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: fakeCodex(answer).execute,
    });
  try {
    await withLocale("en", () => service(validAnalysis).generate(f.repo.id));
    const proposal = validAnalysis().recommendations[0];
    const expanded = await withLocale("zh-TW", () =>
      service(() => ({
        recommendations: [
          { ...proposal, id: "examples", title: "Add greeting examples", problem: "Examples may help." },
          {
            ...proposal,
            id: "unquoted",
            evidenceDetails: [
              { path: "hello.ts", quote: "a quote that is not there", reason: "Guess" },
            ],
          },
        ],
      })).generateMore(f.repo.id, {}),
    );
    assert.equal(expanded.insights.locale, "en");
    // Saved with the English analysis, so written in English.
    assert.deepEqual(
      expanded.insights.recommendationExpansion?.verification?.droppedRecommendations,
      [
        {
          id: "unquoted",
          title: proposal.title,
          reason: 'The quote was not found in hello.ts: "a quote that is not there"',
        },
      ],
    );
    // A rejected answer is the zh-TW request's error, so it is worded in zh-TW.
    await assert.rejects(
      withLocale("zh-TW", () =>
        service(() => ({ recommendations: [{ id: "BAD" }] })).generateMore(f.repo.id, {}),
      ),
      { message: "AI 分析格式不完整，請重新分析；原有結果已保留。" },
    );
  } finally {
    await f.cleanup();
  }
});

test("an insights cache with a locale and a newer field still loads in a build that predates the locale", async () => {
  const f = await fixture();
  try {
    const service = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: fakeCodex().execute,
    });
    await withLocale("en", () => service.generate(f.repo.id));
    const directory = path.join(f.store.directory, "insights");
    const file = path.join(directory, (await readdir(directory)).find((name) => name.endsWith(".json"))!);
    const written = JSON.parse(await readFile(file, "utf8"));
    assert.equal(written.insights.locale, "en");
    written.insights.readingTime = "a field from a newer build";
    // An older build: the same schemas without the locale field.
    const older = lenientRead(
      cacheSchema.extend({
        insights: persistedInsightsSchema.omit({ locale: true }).nullable(),
      }),
    ).parse(written);
    assert.ok(older.insights);
    assert.equal("locale" in older.insights, false);
    assert.equal("readingTime" in older.insights, false);
    assert.equal(older.insights.recommendations.length, 1);
    assert.equal(older.fingerprint, written.fingerprint);
    // This build keeps the locale and drops only the unknown field.
    const current = lenientRead(cacheSchema).parse(written);
    assert.equal(current.insights?.locale, "en");
    assert.equal("readingTime" in (current.insights ?? {}), false);
    // A locale a later build may add reads as unknown instead of failing the cache.
    const later = lenientRead(cacheSchema).parse({
      ...written,
      insights: { ...written.insights, locale: "ja" },
    });
    assert.equal(later.insights?.locale, undefined);
    assert.equal(later.insights?.summary, written.insights.summary);
    // The service itself reads the file as written.
    await writeFile(file, JSON.stringify(written));
    const reread = await service.get(f.repo.id);
    assert.equal(reread.insights?.locale, "en");
    assert.equal(reread.stale, false);
  } finally {
    await f.cleanup();
  }
});

test("in English, analysis errors and the server log line carry no Han", async () => {
  const f = await fixture();
  try {
    const service = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: fakeCodex(() => ({ ...validAnalysis(), recommendations: [{ id: "BAD" }] })).execute,
    });
    await assert.rejects(
      withLocale("en", () => service.generate(f.repo.id)),
      { message: "The AI analysis came back incomplete. Analyze again; the previous result is kept." },
    );
    await assert.rejects(
      withLocale("en", () => service.generateMore(f.repo.id, {})),
      { message: "Analyze the whole project again before you generate more contribution directions." },
    );
    await assert.rejects(
      withLocale("en", () => service.setSettings(f.repo.id, { ...defaultContributionSettings, issueUrl: "https://example.com/1" })),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /The related issue link must look like https:\/\/github\.com\/<owner>\/<repo>\/issues\/<number>/);
        assertNoHan(error.message);
        return true;
      },
    );
    await assert.rejects(withLocale("en", () => service.get("missing")), { message: "Repository not found." });
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
    const original = await service.generate(f.repo.id);
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "first";\n',
    );
    // The edited file is cited by modules, readingPath and evidenceDetails, listed once.
    assert.deepEqual(await service.get(f.repo.id), {
      ...original,
      stale: true,
      staleDetail: { changedFiles: 1, citedChanged: ["hello.ts"] },
    });
    await service.generate(f.repo.id);
    const fresh = await service.get(f.repo.id);
    assert.equal(fresh.stale, false);
    assert.equal("staleDetail" in fresh, false);
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "other";\n',
    );
    assert.equal((await service.get(f.repo.id)).stale, true);
    await service.generate(f.repo.id);
    await git(f.repository, ["add", "--", "hello.ts"]);
    await git(f.repository, ["commit", "-m", "update greeting"]);
    assert.deepEqual((await service.get(f.repo.id)).staleDetail, {
      changedFiles: 1,
      citedChanged: ["hello.ts"],
    });
    // A new commit without content changes: stale, but nothing cited differs.
    await service.generate(f.repo.id);
    await git(f.repository, ["commit", "--allow-empty", "-m", "empty"]);
    const afterEmptyCommit = await service.get(f.repo.id);
    assert.equal(afterEmptyCommit.stale, true);
    assert.deepEqual(afterEmptyCommit.staleDetail, {
      changedFiles: 0,
      citedChanged: [],
    });
    // A staged file the analysis never cited counts without appearing in citedChanged.
    await writeFile(path.join(f.repository, "notes.txt"), "scratch\n");
    await git(f.repository, ["add", "--", "notes.txt"]);
    assert.deepEqual((await service.get(f.repo.id)).staleDetail, {
      changedFiles: 1,
      citedChanged: [],
    });
  } finally {
    await f.cleanup();
  }
});

test("a stale analysis whose base commit is unknown reports stale without a change listing, and caches without a reading path still load", async () => {
  const f = await fixture();
  try {
    const service = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: fakeCodex().execute,
    });
    const original = await service.generate(f.repo.id);
    const directory = path.join(f.store.directory, "insights");
    const cachePath = path.join(
      directory,
      (await readdir(directory)).find((file) => file.endsWith(".json"))!,
    );
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    cache.insights.baseSha = "0123456789abcdef0123456789abcdef01234567";
    delete cache.insights.readingPath;
    delete cache.insights.howItFitsTogether;
    await writeFile(cachePath, JSON.stringify(cache));
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "rebased";\n',
    );
    const result = await service.get(f.repo.id);
    const {
      readingPath: _readingPath,
      howItFitsTogether: _flow,
      ...legacyInsights
    } = original.insights;
    assert.deepEqual(result, {
      ...original,
      insights: { ...legacyInsights, baseSha: cache.insights.baseSha },
      stale: true,
    });
    assert.equal("staleDetail" in result, false);
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
      {
        ...validAnalysis(),
        readingPath: [
          { path: "missing.ts", why: "Invented file", lookFor: "Nothing" },
        ],
      },
      // Two files were sampled, so a single reading step is too short.
      { ...validAnalysis(), readingPath: validAnalysis().readingPath.slice(0, 1) },
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
      // Sensitive content is checked on the whole answer, even inside a recommendation that would be dropped.
      {
        ...validAnalysis(),
        recommendations: validAnalysis().recommendations.map((entry) => ({
          ...entry,
          evidenceDetails: [
            {
              path: "hello.ts",
              quote: "ghp_abcdefghijklmnopqrstuvwxyz is not in the source",
              reason: "Unsupported inference",
            },
          ],
        })),
      },
      // A directory module must exist in the tree; evidence paths are always sampled files.
      { ...validAnalysis(), modules: [{ path: "../x/", purpose: "Outside" }] },
      { ...validAnalysis(), modules: [{ path: "nope/", purpose: "Unknown" }] },
      { ...validAnalysis(), modules: [{ path: "hello.ts/", purpose: "File" }] },
      { ...validAnalysis(), evidence: [{ path: "./", note: "Directory" }] },
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

test("recommendations whose quotes do not match are dropped and reported while the rest of the analysis is saved", async () => {
  const f = await fixture();
  try {
    const proposal = validAnalysis().recommendations[0];
    const detail = (quote: string) => [
      { path: "hello.ts", quote, reason: "Unsupported inference" },
    ];
    const cases: { answer: unknown; kept: string[]; reasons: RegExp[] }[] = [
      {
        answer: {
          ...validAnalysis(),
          recommendations: [
            { ...proposal, evidenceDetails: detail("a source quote that does not exist") },
          ],
        },
        kept: [],
        reasons: [/^引文在 hello\.ts 找不到：「a source quote that does not exist」$/],
      },
      {
        // Only whitespace may differ; case and punctuation differences are not the source text.
        answer: {
          ...validAnalysis(),
          recommendations: [
            { ...proposal, id: "rewrapped", evidenceDetails: detail("export  const\nhello =") },
            { ...proposal, id: "case", evidenceDetails: detail("Export const hello =") },
            { ...proposal, id: "punctuation", evidenceDetails: detail("export const hello ==") },
            {
              ...proposal,
              id: "uncited",
              evidence: ["hello.ts", "README.md"],
              evidenceDetails: detail("export const hello ="),
            },
            {
              ...proposal,
              id: "foreign",
              evidenceDetails: [
                ...detail("export const hello ="),
                { path: "README.md", quote: "A command-line greeting tool.", reason: "Not in evidence" },
              ],
            },
          ],
        },
        kept: ["rewrapped"],
        reasons: [
          /^引文在 hello\.ts 找不到：「Export const hello =」$/,
          /^引文在 hello\.ts 找不到：「export const hello ==」$/,
          /^evidence 路徑 README\.md 缺對應引文$/,
          /^引文路徑 README\.md 不在這項建議的 evidence 清單：「A command-line greeting tool\.」$/,
        ],
      },
    ];
    for (const entry of cases) {
      const service = new ProjectInsightsService(f.store, {
        getModelCatalog: async () => ({ models: [], source: "codex" }),
        command: fakeCodex(() => entry.answer).execute,
      });
      const { insights } = await service.generate(f.repo.id);
      assert.equal(insights.summary, validAnalysis().summary);
      assert.deepEqual(insights.modules, validAnalysis().modules);
      assert.deepEqual(insights.recommendations.map((item) => item.id), entry.kept);
      const dropped = insights.verification!.droppedRecommendations;
      assert.equal(dropped.length, entry.reasons.length);
      for (const [index, reason] of entry.reasons.entries()) {
        assert.equal(dropped[index].title, proposal.title);
        assert.match(dropped[index].reason, reason);
        assert.deepEqual(Object.keys(dropped[index]).sort(), ["id", "reason", "title"]);
      }
      // The saved cache reloads through the strict persisted schema.
      assert.deepEqual(
        (await new ProjectInsightsService(f.store).get(f.repo.id)).insights,
        insights,
      );
    }
    // With every recommendation dropped, asking for more is the ordinary remedy.
    const empty = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: fakeCodex(() => cases[0].answer).execute,
    });
    await empty.generate(f.repo.id);
    const more = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: fakeCodex(() => ({
        recommendations: [
          proposal,
          { ...proposal, id: "unverified", title: "沒有依據的建議", evidenceDetails: detail("missing text") },
        ],
      })).execute,
    });
    const expanded = (await more.generateMore(f.repo.id, {})).insights;
    assert.deepEqual(expanded.recommendations.map((item) => item.id), ["greeting-tests"]);
    // The original analysis keeps its own verification record; the expansion gets a separate one.
    assert.equal(expanded.verification!.droppedRecommendations.length, 1);
    assert.deepEqual(expanded.recommendationExpansion?.addedIds, ["greeting-tests"]);
    assert.deepEqual(expanded.recommendationExpansion?.verification, {
      droppedRecommendations: [
        { id: "unverified", title: "沒有依據的建議", reason: "引文在 hello.ts 找不到：「missing text」" },
      ],
    });
  } finally {
    await f.cleanup();
  }
});

test("sampling reads entry files and every top-level directory before tests, lists the tree and accepts directory modules", async () => {
  const f = await fixture();
  try {
    const files = [
      "src/App.tsx",
      "src/review/Panel.tsx",
      ...Array.from({ length: 35 }, (_, n) => `server/part-${String(n).padStart(2, "0")}.ts`),
      ...Array.from({ length: 35 }, (_, n) => `server/part-${String(n).padStart(2, "0")}.test.ts`),
    ];
    for (const file of files) {
      await mkdir(path.dirname(path.join(f.repository, file)), { recursive: true });
      await writeFile(path.join(f.repository, file), `// ${file}\nexport const name = "${file}";\n`);
    }
    await git(f.repository, ["add", "--", "src", "server"]);
    await git(f.repository, ["commit", "-m", "breadth"]);
    let sampled: string[] = [];
    // hello.ts is tracked but 61st in line, so the answer must cite files that were actually sampled.
    const stub = fakeCodex(
      () => ({
        ...validAnalysis(),
        modules: [
          { path: "src/review/", purpose: "差異審閱介面（目錄層級，內容未全部讀取）" },
          { path: "server/", purpose: "API 與分析服務" },
          { path: "src/App.tsx", purpose: "前端入口" },
        ],
        readingPath: [
          { path: "README.md", why: "先知道工具要解決什麼問題。", lookFor: "定位與執行方式。" },
          { path: "src/App.tsx", why: "前端入口。", lookFor: "頁面如何組成。" },
          { path: "server/part-00.ts", why: "伺服器端的第一個模組。", lookFor: "匯出的常數如何被使用。" },
        ],
        recommendations: validAnalysis().recommendations.map((entry) => ({
          ...entry,
          evidence: ["README.md"],
          evidenceDetails: [
            { path: "README.md", quote: "A command-line greeting tool.", reason: "README 描述工具用途。" },
          ],
        })),
      }),
      async (_args, options) => {
        const source = payload(options.input!).source;
        sampled = source.files.map((file) => file.path);
        assert.ok(source.tree.includes("server/part-34.test.ts"));
        assert.ok(!source.tree.includes(".env"));
      },
    );
    const service = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: stub.execute,
    });
    const { insights } = await service.generate(f.repo.id);
    assert.equal(insights.sample?.sampledFiles, 60);
    assert.equal(insights.sample?.trackedFiles, 4 + files.length);
    assert.equal(sampled[0], "README.md");
    // Entry file first, then one file per top-level directory in turn, so src/ is read before server/ is exhausted.
    assert.equal(sampled[1], "src/App.tsx");
    assert.deepEqual(sampled.slice(2, 4), ["server/part-00.ts", "src/review/Panel.tsx"]);
    const firstTest = sampled.findIndex((file) => file.endsWith(".test.ts"));
    const lastCode = sampled.map((file) => /^server\/part-\d+\.ts$/.test(file)).lastIndexOf(true);
    assert.ok(firstTest > lastCode, `tests (${firstTest}) should follow code (${lastCode})`);
    assert.equal(sampled.filter((file) => /^server\/part-\d+\.ts$/.test(file)).length, 35);
    assert.ok(sampled.filter((file) => file.endsWith(".test.ts")).length < 35);
    assert.ok(!sampled.includes("hello.ts"));
    assert.deepEqual(
      insights.modules.map((module) => module.path),
      ["src/review/", "server/", "src/App.tsx"],
    );
    assert.deepEqual(insights.verification, { droppedRecommendations: [] });
    assert.deepEqual(
      (await new ProjectInsightsService(f.store).get(f.repo.id)).insights,
      insights,
    );
  } finally {
    await f.cleanup();
  }
});

test("citations of tracked but unsampled files are kept, marked or dropped by field, and only an emptied section rejects the analysis", async () => {
  const f = await fixture();
  try {
    // README, src/App.tsx and the server files fill the 60-file sample; hello.ts is tracked but unread.
    const files = [
      "src/App.tsx",
      ...Array.from({ length: 60 }, (_, n) => `server/part-${String(n).padStart(2, "0")}.ts`),
    ];
    for (const file of files) {
      await mkdir(path.dirname(path.join(f.repository, file)), { recursive: true });
      await writeFile(path.join(f.repository, file), `// ${file}\nexport const name = "${file}";\n`);
    }
    await git(f.repository, ["add", "--", "src", "server"]);
    await git(f.repository, ["commit", "-m", "breadth"]);
    const proposal = validAnalysis().recommendations[0];
    const readme = {
      ...proposal,
      evidence: ["README.md"],
      evidenceDetails: [
        { path: "README.md", quote: "A command-line greeting tool.", reason: "README 描述工具用途。" },
      ],
    };
    const cite = (id: string, file: string) => ({
      ...readme,
      id,
      evidence: [file],
      evidenceDetails: [{ ...readme.evidenceDetails[0], path: file }],
    });
    let sampled: string[] = [];
    const stub = fakeCodex(
      () => ({
        ...validAnalysis(),
        modules: [
          { path: "src/App.tsx", purpose: "前端入口" },
          { path: "hello.ts", purpose: "問候文字（清單中存在，內容未讀）" },
          { path: "server/", purpose: "伺服器端模組" },
          { path: "nope/thing.ts", purpose: "不存在的檔案" },
        ],
        readingPath: [
          { path: "README.md", why: "先知道工具要解決什麼問題。", lookFor: "定位與執行方式。" },
          { path: "src/App.tsx", why: "前端入口。", lookFor: "頁面如何組成。" },
          { path: "hello.ts", why: "問候文字的來源。", lookFor: "匯出的常數。" },
          { path: "nope.ts", why: "不存在的檔案。", lookFor: "什麼都看不到。" },
        ],
        evidence: [
          { path: "README.md", note: "描述工具用途與執行方式" },
          { path: "hello.ts", note: "內容未讀，不能當依據" },
          { path: ".env", note: "敏感路徑" },
        ],
        recommendations: [readme, cite("unsampled", "hello.ts"), cite("invented", "nope.ts")],
      }),
      async (_args, options) => {
        sampled = payload(options.input!).source.files.map((file) => file.path);
      },
    );
    const service = new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: stub.execute,
    });
    const { insights } = await service.generate(f.repo.id);
    assert.equal(sampled.length, 60);
    assert.ok(!sampled.includes("hello.ts"));
    assert.deepEqual(
      insights.modules.map((module) => module.path),
      ["src/App.tsx", "hello.ts", "server/"],
    );
    assert.deepEqual(insights.readingPath, [
      { path: "README.md", why: "先知道工具要解決什麼問題。", lookFor: "定位與執行方式。" },
      { path: "src/App.tsx", why: "前端入口。", lookFor: "頁面如何組成。" },
      { path: "hello.ts", why: "問候文字的來源。", lookFor: "匯出的常數。", sampled: false },
    ]);
    assert.deepEqual(insights.evidence, [{ path: "README.md", note: "描述工具用途與執行方式" }]);
    assert.deepEqual(insights.recommendations.map((entry) => entry.id), ["greeting-tests"]);
    assert.deepEqual(insights.verification, {
      droppedRecommendations: [
        { id: "unsampled", title: proposal.title, reason: "引用了未抽樣的檔案 hello.ts" },
        { id: "invented", title: proposal.title, reason: "引用了未提供的檔案 nope.ts" },
      ],
      droppedPaths: [
        { field: "modules", path: "nope/thing.ts", reason: "引用了未提供的檔案 nope/thing.ts" },
        { field: "readingPath", path: "nope.ts", reason: "引用了未提供的檔案 nope.ts" },
        { field: "evidence", path: "hello.ts", reason: "引用了未抽樣的檔案 hello.ts" },
        { field: "evidence", path: ".env", reason: "引用了未提供的檔案 .env" },
      ],
    });
    // The saved cache reloads through the strict persisted schema.
    const saved = await new ProjectInsightsService(f.store).get(f.repo.id);
    assert.deepEqual(saved.insights, insights);
    // Rejection names the first emptied section and its first dropped path; the saved analysis stays.
    const rejected: { answer: unknown; message: string }[] = [
      {
        answer: {
          ...validAnalysis(),
          modules: [{ path: "nope/a.ts", purpose: "不存在" }, { path: "nope/b.ts", purpose: "不存在" }],
          readingPath: [{ path: "nope.ts", why: "不存在的檔案。", lookFor: "什麼都看不到。" }],
        },
        message: "AI 分析引用了未提供的檔案（modules：nope/a.ts），請重新分析；原有結果已保留。",
      },
      {
        answer: {
          ...validAnalysis(),
          readingPath: [{ path: "nope.ts", why: "不存在的檔案。", lookFor: "什麼都看不到。" }],
        },
        message: "AI 分析引用了未提供的檔案（readingPath：nope.ts），請重新分析；原有結果已保留。",
      },
      {
        answer: { ...validAnalysis(), evidence: [{ path: "hello.ts", note: "內容未讀" }] },
        message: "AI 分析引用了未提供的檔案（evidence：hello.ts），請重新分析；原有結果已保留。",
      },
    ];
    for (const entry of rejected) {
      const again = new ProjectInsightsService(f.store, {
        getModelCatalog: async () => ({ models: [], source: "codex" }),
        command: fakeCodex(() => entry.answer).execute,
      });
      await assert.rejects(
        again.generate(f.repo.id),
        (error: any) => error.statusCode === 422 && error.message === entry.message,
      );
      assert.deepEqual(await again.get(f.repo.id), saved);
    }
  } finally {
    await f.cleanup();
  }
});

test("the file tree collapses into per-directory counts past its cap", () => {
  const paths = [
    ...Array.from({ length: 1_600 }, (_, n) => `src/file-${String(n).padStart(4, "0")}.ts`),
    ...Array.from({ length: 10 }, (_, n) => `tools/tool-${n}.ts`),
    "zzz-root.ts",
  ].sort();
  const tree = fileTree(paths);
  const listed = tree.filter((entry) => !entry.endsWith(" files)"));
  const collapsed = tree.filter((entry) => entry.endsWith(" files)"));
  assert.equal(listed.length, 1_500);
  assert.deepEqual(collapsed, ["src/ (100 files)", "tools/ (10 files)", "./ (1 files)"]);
  assert.deepEqual(fileTree(["README.md", "src/a.ts"]), ["README.md", "src/a.ts"]);
  const long = Array.from({ length: 500 }, (_, n) => `${"d".repeat(100)}/${String(n).padStart(3, "0")}.ts`);
  const bounded = fileTree(long);
  assert.ok(bounded.filter((entry) => !entry.endsWith(" files)")).length < 500);
  assert.ok(Buffer.byteLength(bounded.filter((entry) => !entry.endsWith(" files)")).join("\n")) <= 40_000);
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

test("Claude Code analysis uses the signed-in CLI without tools, an inline schema and Claude usage fields", async () => {
  const f = await fixture();
  const calls: {
    executable: string;
    args: string[];
    options: NonNullable<Parameters<typeof command>[2]>;
  }[] = [];
  const execute: typeof command = async (executable, args, options = {}) => {
    calls.push({ executable, args, options });
    if (executable === "claude" && args[0] === "-p") {
      const value = (flag: string) => args[args.indexOf(flag) + 1];
      assert.equal(value("--model"), "sonnet");
      assert.equal(value("--effort"), "high");
      assert.equal(value("--tools"), "");
      assert.ok(args.includes("--strict-mcp-config"));
      assert.ok(
        JSON.parse(value("--json-schema")).required.includes(
          "recommendations",
        ),
      );
      assert.notEqual(options.cwd, f.repository);
      assert.equal(options.env?.ANTHROPIC_API_KEY, undefined);
      assert.match(options.input!, /untrusted DATA/);
      options.onLine?.(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "out-1", name: "StructuredOutput" },
            ],
          },
        }),
        "stdout",
      );
      options.onLine?.(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "",
          structured_output: validAnalysis(),
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 300,
            output_tokens: 40,
          },
        }),
        "stdout",
      );
    }
    return { stdout: "", stderr: "", code: 0 };
  };
  const service = new ProjectInsightsService(f.store, { command: execute });
  try {
    await service.setSettings(f.repo.id, {
      ...defaultContributionSettings,
      provider: "claude",
      model: "sonnet",
      reasoningEffort: "high",
    });
    const result = await service.generate(f.repo.id);
    assert.deepEqual(
      calls.map(({ executable, args }) => [executable, args[0]]),
      [
        ["claude", "auth"],
        ["claude", "-p"],
      ],
    );
    assert.deepEqual(result.insights.modelExecution, {
      provider: "claude",
      model: "sonnet",
      reasoningEffort: "high",
      source: "selected",
    });
    assert.equal(result.insights.recommendations.length, 1);
    assert.equal(result.insights.efficiency?.measuredCalls, 1);
    assert.equal(result.insights.efficiency?.inputTokens, 510);
    assert.equal(result.insights.efficiency?.cachedInputTokens, 300);
    assert.equal(result.insights.efficiency?.outputTokens, 40);
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
    assert.deepEqual(expanded.sample, original.sample);
    assert.equal(expanded.sample?.sampledFiles, 2);
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
    assert.deepEqual(await service.get(f.repo.id), { ...original, stale: true, staleDetail: { changedFiles: 1, citedChanged: ["hello.ts"] } });
  } finally {
    await f.cleanup();
  }
});

test("invalid, failed and interrupted expansion results never replace existing recommendations", async () => {
  const f = await fixture();
  try {
    const first = (await new ProjectInsightsService(f.store, { command: fakeCodex().execute, getModelCatalog: async () => ({ source: "codex", models: [] }) }).generate(f.repo.id)).insights;
    const proposal = validAnalysis().recommendations[0];
    // Evidence outside the sample drops the one proposal, as in the first analysis; the original list stays.
    const unsampled = new ProjectInsightsService(f.store, {
      command: fakeCodex(() => ({
        recommendations: [
          { ...proposal, id: "missing", evidence: ["missing.ts"] },
          { ...proposal, id: "directory", evidence: ["src/"] },
        ],
      })).execute,
      getModelCatalog: async () => ({ source: "codex", models: [] }),
    });
    const expanded = (await unsampled.generateMore(f.repo.id, {})).insights;
    assert.deepEqual(expanded.recommendations, first.recommendations);
    assert.deepEqual(expanded.recommendationExpansion?.addedIds, []);
    assert.deepEqual(
      expanded.recommendationExpansion?.verification?.droppedRecommendations.map((entry) => entry.reason),
      ["引用了未提供的檔案 missing.ts", "引用了未提供的檔案 src/"],
    );
    const original = await unsampled.get(f.repo.id);
    const responses = [
      { recommendations: [], summary: "不能覆寫全貌" },
      { recommendations: Array.from({ length: 6 }, () => proposal) },
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
    assert.deepEqual(await changed.get(f.repo.id), { ...original, stale: true, staleDetail: { changedFiles: 1, citedChanged: ["hello.ts"] } });
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
    for (const again of [() => service.generateMore(f.repo.id, {}), () => service.generate(f.repo.id)])
      await assert.rejects(again(), (error: any) => error.statusCode === 409 && error.code === "already_running");
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

test("analyzing a project that is being analyzed answers 409 with the code already_running", async () => {
  const f = await fixture();
  const { createApp } = await import("./index.js");
  const { Workbench } = await import("./workbench.js");
  const app = createApp(new Workbench(f.store), { staticDirectory: path.join(f.directory, "missing") });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const service = new ProjectInsightsService(f.store, {
    command: fakeCodex(validAnalysis, async () => {
      entered();
      await released;
    }).execute,
    getModelCatalog: async () => ({ source: "codex", models: [] }),
  });
  app.locals.insights.generate = service.generate.bind(service);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const analyze = () => new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = request(`http://127.0.0.1:${address.port}/api/repos/${f.repo.id}/insights`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1:4311", "X-Bell-Locale": "en" },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
    });
    req.on("error", reject);
    req.end("{}");
  });
  try {
    const first = analyze();
    await started;
    assert.deepEqual(await analyze(), {
      status: 409,
      body: {
        error: "This project is already being analyzed. Wait for the current analysis to finish.",
        code: "already_running",
      },
    });
    release();
    assert.equal((await first).status, 200);
  } finally {
    release();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await service.shutdown();
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
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

test("Claude Code analysis retries once after losing the OAuth refresh lock and exiting non-zero, counting both calls; other API errors fail at once", async () => {
  const f = await fixture();
  const refreshRace =
    "Failed to refresh OAuth token: another Claude Code process is refreshing it or exited mid-refresh. This is usually transient; retry in a minute, and if it persists close other Claude Code processes or sign in again";
  const waits: number[] = [];
  let analyses = 0;
  const claude =
    (
      respond: (
        emit: (event: unknown) => void,
        invocation: number,
      ) => void,
    ): typeof command =>
    async (executable, args, options = {}) => {
      if (executable === "claude" && args[0] === "-p")
        respond(
          (event) => options.onLine?.(JSON.stringify(event), "stdout"),
          ++analyses,
        );
      return { stdout: "", stderr: "", code: 0 };
    };
  const sleep = async (ms: number) => {
    waits.push(ms);
  };
  const service = new ProjectInsightsService(f.store, {
    sleep,
    command: claude((emit, invocation) => {
      if (invocation === 1) {
        emit({
          type: "assistant",
          message: { content: [{ type: "text", text: refreshRace }] },
          error: "server_error",
          is_api_error_message: true,
        });
        emit({
          type: "result",
          subtype: "success",
          is_error: true,
          terminal_reason: "api_error",
          result: refreshRace,
          usage: {
            input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 0,
          },
          modelUsage: {},
        });
        // command() flushes the events above through onLine, then rejects on claude's exit code 1.
        throw new AppError(`claude 執行失敗：${refreshRace}`, 422);
      }
      emit({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        structured_output: validAnalysis(),
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 300,
          output_tokens: 40,
        },
      });
    }),
  });
  const plain = new ProjectInsightsService(f.store, {
    sleep,
    command: claude((emit) => {
      emit({
        type: "result",
        subtype: "success",
        is_error: true,
        terminal_reason: "api_error",
        result: "API Error: 500 Internal server error",
      });
      // command() keeps the raw JSON tail; the error claude reported replaces it.
      throw new AppError(
        `claude 執行失敗：${`{"type":"result","is_error":true,"result":"API Error: 500 Internal server error","session_id":"s"}`}`,
        422,
      );
    }),
  });
  try {
    await service.setSettings(f.repo.id, {
      ...defaultContributionSettings,
      provider: "claude",
    });
    const result = await service.generate(f.repo.id);
    assert.equal(analyses, 2);
    assert.deepEqual(waits, [15_000]);
    assert.equal(result.insights.recommendations.length, 1);
    assert.equal(result.insights.efficiency?.calls, 2);
    assert.equal(result.insights.efficiency?.failedCalls, 1);
    assert.equal(result.insights.efficiency?.completedCalls, 1);
    assert.equal(result.insights.efficiency?.measuredCalls, 2);
    assert.equal(result.insights.efficiency?.inputTokens, 510);
    analyses = 0;
    waits.length = 0;
    await assert.rejects(
      plain.generate(f.repo.id),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 422 &&
        error.message === "claude 執行失敗：API Error: 500 Internal server error",
    );
    assert.equal(analyses, 1);
    assert.equal(waits.length, 0);
  } finally {
    await service.shutdown();
    await plain.shutdown();
    await f.cleanup();
  }
});

test("analysis waits longer for Claude Code at xhigh and explains a timeout with the minutes waited", async () => {
  const f = await fixture();
  const timeouts: number[] = [];
  let timeOut = false;
  const execute: typeof command = async (executable, args, options = {}) => {
    if (executable === "claude" && args[0] === "-p") {
      timeouts.push(options.timeoutMs!);
      if (timeOut) throw new AppError("claude 執行逾時。", 504);
      options.onLine?.(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "",
          structured_output: validAnalysis(),
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 40,
          },
        }),
        "stdout",
      );
    }
    return { stdout: "", stderr: "", code: 0 };
  };
  const service = new ProjectInsightsService(f.store, { command: execute });
  try {
    await service.setSettings(f.repo.id, {
      ...defaultContributionSettings,
      provider: "claude",
      model: "opus",
      reasoningEffort: "xhigh",
    });
    await service.generate(f.repo.id);
    // 240 s × 2.5 (Claude) × 1.5 (xhigh) = 900 s.
    assert.deepEqual(timeouts, [900_000]);
    timeOut = true;
    await assert.rejects(
      service.generate(f.repo.id),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 504 &&
        error.message ===
          "claude 執行逾時（已等待 15 分鐘）。較高的思考強度或大型專案需要更久；可降低思考強度、改用較快的模型，或提高 BELLPR_AGENT_TIMEOUT_SCALE。",
    );
    // The earlier result is kept.
    assert.equal((await service.get(f.repo.id)).insights?.source, "ai");
    const scaled = new ProjectInsightsService(f.store, {
      command: execute,
      agentTimeoutScale: 2,
    });
    timeOut = false;
    await scaled.generate(f.repo.id);
    assert.equal(timeouts.at(-1), 1_800_000);
    await scaled.shutdown();
  } finally {
    await service.shutdown();
    await f.cleanup();
  }
});

test("an analysis that names a local setup's credentials or an Authorization header is saved; known secret shapes still reject it", async () => {
  // redact() masks these since README v1.2 §18.11 item 3; masking is never a reason to reject the whole answer.
  const f = await fixture();
  try {
    const answer = {
      ...validAnalysis(),
      howItFitsTogether:
        "The local setup connects to postgres://postgres:postgres@localhost:5432/app_dev and sends Authorization: Basic dXNlcjpwYXNzd29yZA== to the health check.",
    };
    const saved = await new ProjectInsightsService(f.store, {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      command: fakeCodex(() => answer).execute,
    }).generate(f.repo.id);
    assert.equal(saved.insights.howItFitsTogether, answer.howItFitsTogether);
    await assert.rejects(
      new ProjectInsightsService(f.store, {
        getModelCatalog: async () => ({ models: [], source: "codex" }),
        command: fakeCodex(() => ({ ...answer, howItFitsTogether: "It sets password=hunter2hunter2 first." })).execute,
      }).generate(f.repo.id),
      (error: any) => error.statusCode === 422,
    );
  } finally {
    await f.cleanup();
  }
});
