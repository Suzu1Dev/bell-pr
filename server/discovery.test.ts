import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { command } from "./process.js";
import { AppError } from "./types.js";
import {
  defaultDiscoveryPreferences,
  type DiscoveryCandidate,
  type ContributionOpportunity,
  type DiscoveryJob,
} from "../shared/discovery.js";
import {
  DiscoveryService,
  discoveryFileSchema,
  discoveryJobSchema,
  discoveryPreferencesSchema,
  discoveryPrompt,
  parseDiscoveryResult,
} from "./discovery.js";
import { lenientRead } from "./persisted-schema.js";
import { Store } from "./store.js";
import { withLocale } from "./i18n/index.js";
import { respondIn } from "./prompt-language.js";
import { assertNoHan } from "../src/test-utils/render.js";

const candidate: DiscoveryCandidate = {
  fullName: "owner/project",
  url: "https://github.com/owner/project",
  description: "A small UI library",
  language: "TypeScript",
  stars: 1250,
  forks: 70,
  pushedAt: "2026-10-03T00:00:00Z",
  openIssues: 20,
  warnings: [],
  sources: [
    {
      id: "owner/project:issue:1",
      kind: "issue",
      title: "Clarify keyboard instructions",
      url: "https://github.com/owner/project/issues/1",
      content: "The keyboard shortcut instructions are unclear for new users.",
    },
    {
      id: "owner/project:contributing",
      kind: "contributing",
      title: "Contributing",
      url: "https://github.com/owner/project/blob/main/CONTRIBUTING.md",
      content: "Discuss your proposed changes before opening a pull request.",
    },
  ],
};
const opportunity: ContributionOpportunity = {
  id: "keyboard-docs",
  repository: candidate.fullName,
  title: "釐清鍵盤操作說明",
  summary: "有使用者回報操作說明不清楚，先確認目前內容與需求。",
  userNeed: "初次使用者可能比較容易找到鍵盤操作。",
  contributionRules: "應先討論提案。",
  popularity: "Invented popularity should be replaced",
  feasibility: "先閱讀現行文件，尚未確認需要修改哪些段落。",
  difficulty: "beginner",
  effort: "估計半天，需先確認範圍。",
  firstSteps: ["閱讀 issue 並確認目前是否有人認領。"],
  acceptanceChecks: ["請維護者確認修改後說明符合實際操作。"],
  risks: ["issue 只是需求回報，尚未重現；提案仍須維護者同意。"],
  evidence: [
    {
      sourceId: candidate.sources[0].id,
      quote: "keyboard shortcut instructions are unclear",
      reason: "這是使用者提出的說明需求。",
    },
    {
      sourceId: candidate.sources[1].id,
      quote: "Discuss your proposed changes before opening a pull request.",
      reason: "專案要求先討論。",
    },
  ],
};
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const answer = (opportunities = [opportunity]) =>
  JSON.stringify({ opportunities });

test("discovery preferences are strict, bounded and default to beginner preferences", () => {
  assert.deepEqual(
    discoveryPreferencesSchema.parse({}),
    defaultDiscoveryPreferences,
  );
  for (const invalid of [
    { interests: "x".repeat(301) },
    { interests: "bad\u0000keyword" },
    { language: "--TypeScript" },
    { language: "TypeScript stars:0" },
    { language: "$(echo hi)" },
    { difficulty: "expert" },
    { sort: "forks" },
    { minStars: -1 },
    { minStars: 1_000_001 },
    { minStars: "50" },
    { model: "--exec" },
    { reasoningEffort: "extreme" },
    { unknown: true },
  ])
    assert.equal(discoveryPreferencesSchema.safeParse(invalid).success, false);
  assert.equal(
    discoveryPreferencesSchema.parse({ language: "C++", minStars: 0 }).language,
    "C++",
  );
  // Preferences saved before the sort field existed keep loading with the old order.
  const { sort, ...legacy } = defaultDiscoveryPreferences;
  assert.equal(sort, "updated");
  assert.equal(discoveryPreferencesSchema.parse(legacy).sort, "updated");
  assert.equal(
    discoveryPreferencesSchema.parse({ sort: "relevance" }).sort,
    "relevance",
  );
});

test("discovery results require repository-specific issue and contribution-rule quotes and use actual popularity", () => {
  const parsed = parseDiscoveryResult(
    answer(),
    [candidate],
    defaultDiscoveryPreferences,
  );
  assert.match(parsed.opportunities[0].popularity, /1,250 stars、70 forks/);
  assert.doesNotMatch(parsed.opportunities[0].popularity, /Invented/);
  assert.match(
    parseDiscoveryResult(
      answer(),
      [{ ...candidate, pushedAt: "" }],
      defaultDiscoveryPreferences,
    ).opportunities[0].popularity,
    /最近推送於 未提供/,
  );
  assert.throws(() =>
    parseDiscoveryResult(
      answer([{ ...opportunity, repository: "other/project" }]),
      [candidate],
      defaultDiscoveryPreferences,
    ),
  );
  // Evidence that does not hold drops that one opportunity and names it; the batch still succeeds.
  const unsupportedCases: [ContributionOpportunity, RegExp][] = [
    [
      {
        ...opportunity,
        evidence: [
          { ...opportunity.evidence[0], sourceId: "other/project:issue:1" },
          opportunity.evidence[1],
        ],
      },
      /引文無法對應來源 other\/project:issue:1/,
    ],
    [
      {
        ...opportunity,
        evidence: [
          { ...opportunity.evidence[0], quote: "This is an invented quote." },
          opportunity.evidence[1],
        ],
      },
      /引文無法對應來源/,
    ],
    [
      {
        ...opportunity,
        evidence: [
          { ...opportunity.evidence[0], quote: "Keyboard shortcut instructions are unclear" },
          opportunity.evidence[1],
        ],
      },
      /引文無法對應來源/,
    ],
    [
      {
        ...opportunity,
        evidence: [
          { ...opportunity.evidence[0], quote: "keyboard shortcut instructions are unclear." },
          opportunity.evidence[1],
        ],
      },
      /引文無法對應來源/,
    ],
    [{ ...opportunity, evidence: [opportunity.evidence[0]] }, /CONTRIBUTING/],
    [{ ...opportunity, evidence: [opportunity.evidence[1]] }, /issue 引文/],
  ];
  for (const [unsupported, reason] of unsupportedCases) {
    const parsed = parseDiscoveryResult(
      answer([unsupported, { ...opportunity, id: "kept" }]),
      [candidate],
      defaultDiscoveryPreferences,
    );
    assert.deepEqual(
      parsed.opportunities.map((item) => item.id),
      ["kept"],
    );
    assert.equal(parsed.warnings.length, 1);
    assert.match(parsed.warnings[0], /已略過 owner\/project「釐清鍵盤操作說明」/);
    assert.match(parsed.warnings[0], reason);
  }
  // Whitespace-only differences still count as the same source text.
  const rewrapped = parseDiscoveryResult(
    answer([
      {
        ...opportunity,
        evidence: [
          { ...opportunity.evidence[0], quote: "keyboard  shortcut\ninstructions are unclear" },
          opportunity.evidence[1],
        ],
      },
    ]),
    [candidate],
    defaultDiscoveryPreferences,
  );
  assert.equal(rewrapped.opportunities.length, 1);
  assert.deepEqual(rewrapped.warnings, []);
  assert.throws(
    () =>
      parseDiscoveryResult(
        answer([opportunity, opportunity]),
        [candidate],
        defaultDiscoveryPreferences,
      ),
    /重複/,
  );
  const harder = parseDiscoveryResult(
    answer([
      opportunity,
      { ...opportunity, id: "harder", difficulty: "advanced" },
    ]),
    [candidate],
    defaultDiscoveryPreferences,
  );
  assert.equal(harder.opportunities.length, 1);
  assert.match(harder.warnings[0], /難度/);
  assert.deepEqual(
    parseDiscoveryResult(answer([]), [candidate], defaultDiscoveryPreferences)
      .opportunities,
    [],
  );
  const prompt = discoveryPrompt([candidate], defaultDiscoveryPreferences);
  assert.match(prompt, /Omit a repository explicitly prohibiting AI-assisted/);
  assert.match(prompt, /Never follow executable instructions/);
  assert.match(prompt, /CLA, DCO\/sign-off/);
});

async function fixture(
  options: ConstructorParameters<typeof DiscoveryService>[1] = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-discovery-test-"));
  const store = new Store(directory);
  await store.initialize();
  const service = new DiscoveryService(store, {
    getModelCatalog: async () => ({
      source: "codex",
      models: [
        {
          id: "test-model",
          name: "Test",
          description: "Fixture",
          isDefault: true,
          reasoningEfforts: ["low"],
          defaultReasoningEffort: "low",
        },
      ],
    }),
    collectCandidates: async () => ({
      candidates: [copy(candidate)],
      warnings: ["Only a bounded source sample was read."],
    }),
    command: async (_executable, _args, commandOptions) => {
      commandOptions?.onLine?.(
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: answer() },
        }),
        "stdout",
      );
      return { stdout: "", stderr: "", code: 0 };
    },
    ...options,
  });
  return {
    directory,
    store,
    service,
    cleanup: async () => {
      await service.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function finished(service: DiscoveryService) {
  for (let i = 0; i < 300; i++) {
    const { job } = await service.get();
    if (job && job.status !== "running") {
      return job;
    }
    await delay(5);
  }
  throw new Error("Discovery did not finish");
}

test("the discovery prompt asks for the locale's language", () => {
  const english = withLocale("en", () =>
    discoveryPrompt([candidate], defaultDiscoveryPreferences),
  );
  assert.ok(
    english.includes(
      `return JSON matching the provided schema. ${respondIn("en")}`,
    ),
  );
  assert.doesNotMatch(english, /Traditional Chinese/);
  const chinese = withLocale("zh-TW", () =>
    discoveryPrompt([candidate], defaultDiscoveryPreferences),
  );
  assert.ok(chinese.includes(respondIn("zh-TW")));
  assert.equal(
    english.replace(respondIn("en"), ""),
    chinese.replace(respondIn("zh-TW"), ""),
  );
});

test("in English, the actual popularity and the skipped opportunities are reported without Han", () => {
  const english = { ...opportunity, title: "Clarify the keyboard instructions" };
  const parsed = withLocale("en", () =>
    parseDiscoveryResult(
      answer([
        english,
        { ...english, id: "no-rules", evidence: [english.evidence[0]] },
        { ...english, id: "no-issue", evidence: [english.evidence[1]] },
        { ...english, id: "harder", difficulty: "advanced" },
      ]),
      [candidate],
      defaultDiscoveryPreferences,
    ),
  );
  assert.equal(
    parsed.opportunities[0].popularity,
    "GitHub snapshot: 1,250 stars, 70 forks, last pushed 2026-10-03. Popularity does not guarantee that a proposal will be accepted.",
  );
  assert.deepEqual(parsed.warnings, [
    'Skipped owner/project "Clarify the keyboard instructions": it does not cite the CONTRIBUTING rules that were found.',
    'Skipped owner/project "Clarify the keyboard instructions": it has no issue quote that can be checked.',
    "Skipped 1 suggestion above the chosen difficulty.",
  ]);
  const unpushed = withLocale("en", () =>
    parseDiscoveryResult(
      answer([english]),
      [{ ...candidate, pushedAt: "" }],
      defaultDiscoveryPreferences,
    ),
  );
  assert.match(unpushed.opportunities[0].popularity, /no last push date provided/);
  assertNoHan(unpushed.opportunities[0].popularity);
  assert.throws(
    () =>
      withLocale("en", () =>
        parseDiscoveryResult("not json", [candidate], defaultDiscoveryPreferences),
      ),
    { message: "The discovery analysis came back incomplete. Try again; the previous result is kept." },
  );
});

test("discovery returns a running job, uses one isolated model-pinned inference, persists evidence and measured usage", async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  let cwd = "";
  const f = await fixture({
    command: async (executable, args, options) => {
      calls++;
      assert.equal(executable, "codex");
      assert.equal(args[args.indexOf("--model") + 1], "test-model");
      assert.ok(args.includes('model_reasoning_effort="low"'));
      assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
      assert.ok(args.includes("--ignore-user-config"));
      assert.ok(args.includes("--output-schema"));
      cwd = options!.cwd!;
      assert.deepEqual(await readdir(cwd), ["response-schema.json"]);
      assert.match(options!.input!, /Do not claim tests ran/);
      await wait;
      options?.onLine?.(
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: answer() },
        }),
        "stdout",
      );
      options?.onLine?.(
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 100,
            cached_input_tokens: 60,
            output_tokens: 20,
          },
        }),
        "stdout",
      );
      return { stdout: "", stderr: "", code: 0 };
    },
  });
  try {
    const start = await f.service.start({});
    assert.equal(start.job.status, "running");
    await assert.rejects(f.service.start({}), /已有探索/);
    release();
    const job = await finished(f.service);
    assert.equal(job.status, "ready");
    assert.equal(job.opportunities.length, 1);
    assert.equal(calls, 1);
    assert.deepEqual(job.modelExecution, {
      model: "test-model",
      reasoningEffort: "low",
      source: "catalog-default",
    });
    assert.equal(job.efficiency?.calls, 1);
    assert.equal(job.efficiency?.measuredCalls, 1);
    assert.equal(job.efficiency?.cachedInputTokens, 60);
    await f.service.shutdown();
    await assert.rejects(readdir(cwd), /ENOENT/);
    const reopened = new DiscoveryService(f.store);
    assert.deepEqual((await reopened.get()).job, job);
    await reopened.shutdown();
  } finally {
    release();
    await f.cleanup();
  }
});

test("empty or filtered sources finish without model calls and do not fabricate opportunities", async () => {
  let calls = 0;
  const f = await fixture({
    collectCandidates: async () => ({
      candidates: [
        { ...copy(candidate), stars: 4 },
        { ...copy(candidate), fullName: "other/project", language: "Python" },
      ],
      warnings: [],
    }),
    command: async () => {
      calls++;
      throw new Error("Must not infer");
    },
    getModelCatalog: async () => {
      throw new Error("No model required");
    },
  });
  try {
    await f.service.start({ language: "TypeScript" });
    const job = await finished(f.service);
    assert.equal(job.status, "ready");
    assert.equal(calls, 0);
    assert.equal(job.opportunities.length, 0);
    assert.equal(job.candidates.length, 0);
    assert.equal(job.warnings.length, 2);
    assert.equal(job.efficiency, undefined);
  } finally {
    await f.cleanup();
  }
});

test("failed analyses retain the last ready result and reject terminal failures despite earlier valid text", async () => {
  let shouldFail = false;
  const f = await fixture({
    command: async (_executable, _args, options) => {
      options?.onLine?.(
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: answer() },
        }),
        "stdout",
      );
      if (shouldFail)
        options?.onLine?.(
          JSON.stringify({
            type: "turn.failed",
            error: { message: "Failure" },
          }),
          "stdout",
        );
      return { stdout: "", stderr: "", code: 0 };
    },
  });
  try {
    await f.service.start({});
    const ready = await finished(f.service);
    shouldFail = true;
    await f.service.start({ interests: "UI" });
    const failed = await finished(f.service);
    assert.equal(failed.status, "failed");
    assert.equal(failed.opportunities.length, 0);
    assert.deepEqual(failed.previousResult?.opportunities, ready.opportunities);
    assert.equal(failed.efficiency?.failedCalls, 1);
    await f.service.start({});
    const again = await finished(f.service);
    assert.deepEqual(again.previousResult, failed.previousResult);
  } finally {
    await f.cleanup();
  }
});

test("cancel aborts source collection; shutdown aborts inference and waits for cleanup", async () => {
  let collectionStarted!: () => void;
  const enteredCollection = new Promise<void>((resolve) => {
    collectionStarted = resolve;
  });
  const f = await fixture({
    collectCandidates: async (_preferences, { signal } = {}) => {
      collectionStarted();
      await new Promise<void>((_, reject) =>
        signal!.addEventListener(
          "abort",
          () => reject(new Error("Cancelled")),
          { once: true },
        ),
      );
      return { candidates: [], warnings: [] };
    },
  });
  try {
    await f.service.start({});
    await enteredCollection;
    assert.equal((await f.service.cancel()).job?.status, "cancelled");
  } finally {
    await f.cleanup();
  }
  let inferenceStarted!: () => void;
  const enteredInference = new Promise<void>((resolve) => {
    inferenceStarted = resolve;
  });
  let cwd = "";
  const inference = await fixture({
    command: async (_command, _args, options) => {
      cwd = options!.cwd!;
      inferenceStarted();
      await new Promise<void>((_, reject) =>
        options!.signal!.addEventListener(
          "abort",
          () => reject(new Error("Cancelled")),
          { once: true },
        ),
      );
      return { stdout: "", stderr: "", code: 0 };
    },
  });
  try {
    await inference.service.start({});
    await enteredInference;
    await inference.service.shutdown();
    assert.equal((await inference.service.get()).job?.status, "cancelled");
    await assert.rejects(readdir(cwd), /ENOENT/);
    await assert.rejects(inference.service.start({}), /關閉/);
  } finally {
    await inference.cleanup();
  }
});

test("restart marks interrupted work failed while retaining its prior result and collected evidence", async () => {
  const f = await fixture();
  try {
    await f.service.start({});
    const ready = await finished(f.service);
    await f.service.shutdown();
    const saved = JSON.parse(
      await readFile(path.join(f.directory, "discovery.json"), "utf8"),
    ) as { version: number; job: DiscoveryJob };
    saved.job.status = "running";
    saved.job.phase = "analyzing";
    saved.job.previousResult = {
      createdAt: ready.createdAt,
      candidates: ready.candidates,
      opportunities: ready.opportunities,
    };
    saved.job.opportunities = [];
    await writeFile(
      path.join(f.directory, "discovery.json"),
      JSON.stringify(saved),
    );
    const restarted = new DiscoveryService(f.store);
    const { job } = await restarted.get();
    assert.equal(job?.status, "failed");
    assert.match(job?.error ?? "", /重新啟動/);
    assert.equal(
      job?.candidates[0].sources[0].content,
      candidate.sources[0].content,
    );
    assert.deepEqual(job?.previousResult?.opportunities, ready.opportunities);
    await restarted.shutdown();
  } finally {
    await f.cleanup();
  }
});

test("a discovery job records the locale it started in and keeps using it for its messages and output", async () => {
  const prompts: string[] = [];
  const f = await fixture({
    command: async (_executable, _args, commandOptions) => {
      prompts.push(commandOptions!.input!);
      commandOptions?.onLine?.(
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: answer([
              opportunity,
              { ...opportunity, id: "harder", difficulty: "advanced" },
            ]),
          },
        }),
        "stdout",
      );
      return { stdout: "", stderr: "", code: 0 };
    },
  });
  try {
    const { job: started } = await withLocale("en", () => f.service.start({}));
    assert.equal(started.locale, "en");
    assert.equal(started.message, "Looking for GitHub projects that match your criteria");
    // Later requests in another locale neither change nor re-word the job.
    const job = await withLocale("zh-TW", () => finished(f.service));
    assert.equal(job.status, "ready");
    assert.equal(job.locale, "en");
    assert.ok(prompts[0].includes(respondIn("en")));
    assert.doesNotMatch(prompts[0], /Traditional Chinese/);
    assert.equal(
      job.message,
      "Found 1 contribution opportunity backed by sources. Check the maintainers' interest and the scope of the work before you start.",
    );
    assert.match(job.opportunities[0].popularity, /^GitHub snapshot: 1,250 stars, 70 forks/);
    assert.ok(job.warnings.includes("Skipped 1 suggestion above the chosen difficulty."));
    for (const text of [job.message, job.opportunities[0].popularity, ...job.warnings])
      assertNoHan(text);
    const saved = JSON.parse(
      await readFile(path.join(f.directory, "discovery.json"), "utf8"),
    ) as { job: DiscoveryJob };
    assert.equal(saved.job.locale, "en");
    // A zh-TW job started afterwards uses zh-TW, prompt included.
    await withLocale("zh-TW", () => f.service.start({}));
    const chinese = await finished(f.service);
    assert.equal(chinese.locale, "zh-TW");
    assert.ok(prompts[1].includes(respondIn("zh-TW")));
    assert.match(chinese.message, /找到 1 項/);
  } finally {
    await f.cleanup();
  }
});

test("restart words the interruption in the job's locale, or the current one for jobs saved without it", async () => {
  const f = await fixture();
  try {
    await withLocale("en", () => f.service.start({}));
    await finished(f.service);
    await f.service.shutdown();
    const file = path.join(f.directory, "discovery.json");
    const saved = JSON.parse(await readFile(file, "utf8")) as {
      version: number;
      job: DiscoveryJob;
    };
    saved.job.status = "running";
    await writeFile(file, JSON.stringify(saved));
    const english = new DiscoveryService(f.store);
    const { job } = await withLocale("zh-TW", () => english.get());
    assert.equal(job?.status, "failed");
    assert.equal(job?.message, "The last discovery was interrupted");
    assert.match(job?.error ?? "", /^The server restarted and interrupted the discovery\./);
    await english.shutdown();
    delete saved.job.locale;
    await writeFile(file, JSON.stringify(saved));
    const legacy = new DiscoveryService(f.store);
    const { job: legacyJob } = await withLocale("en", () => legacy.get());
    assert.equal(legacyJob?.locale, undefined);
    assert.equal(legacyJob?.message, "The last discovery was interrupted");
    await legacy.shutdown();
  } finally {
    await f.cleanup();
  }
});

test("a discovery job with a locale and a newer field still loads in a build that predates the locale", async () => {
  const f = await fixture();
  try {
    await withLocale("en", () => f.service.start({}));
    await finished(f.service);
    await f.service.shutdown();
    const file = path.join(f.directory, "discovery.json");
    const written = JSON.parse(await readFile(file, "utf8")) as {
      version: number;
      job: DiscoveryJob & Record<string, unknown>;
    };
    assert.equal(written.job.locale, "en");
    written.job.reviewedBy = "a field from a newer build";
    // An older build: the same schema without the locale field.
    const older = lenientRead(
      discoveryFileSchema.extend({
        job: discoveryJobSchema.omit({ locale: true }).nullable(),
      }),
    ).parse(written);
    assert.ok(older.job);
    assert.equal("locale" in older.job, false);
    assert.equal("reviewedBy" in older.job, false);
    assert.equal(older.job.status, "ready");
    assert.equal(older.job.opportunities.length, 1);
    // This build keeps the locale and drops only the unknown field.
    const current = lenientRead(discoveryFileSchema).parse(written);
    assert.equal(current.job?.locale, "en");
    assert.equal("reviewedBy" in (current.job ?? {}), false);
    // The sample flag is optional both ways: older builds drop it, this one keeps it.
    const sample = { ...written, job: { ...written.job, sample: true } };
    assert.equal(lenientRead(discoveryFileSchema).parse(sample).job?.sample, true);
    assert.equal(
      "sample" in
        (lenientRead(
          discoveryFileSchema.extend({
            job: discoveryJobSchema.omit({ sample: true }).nullable(),
          }),
        ).parse(sample).job ?? {}),
      false,
    );
    assert.equal("sample" in (current.job ?? {}), false);
    // A locale a later build may add reads as unknown instead of failing the job.
    const later = lenientRead(discoveryFileSchema).parse({
      ...written,
      job: { ...written.job, locale: "ja" },
    });
    assert.equal(later.job?.locale, undefined);
    assert.equal(later.job?.status, "ready");
    // The service itself loads the file as written.
    await writeFile(file, JSON.stringify(written));
    const reloaded = new DiscoveryService(f.store);
    const { job } = await reloaded.get();
    assert.equal(job?.locale, "en");
    assert.equal(job?.status, "ready");
    await reloaded.shutdown();
  } finally {
    await f.cleanup();
  }
});

test("an initial persistence failure leaves a failed job rather than a permanently running job", async () => {
  const f = await fixture();
  try {
    await f.service.get();
    await mkdir(path.join(f.directory, "discovery.json.tmp"));
    await assert.rejects(f.service.start({}), /無法儲存/);
    const { job } = await f.service.get();
    assert.equal(job?.status, "failed");
    assert.equal(job?.phase, "complete");
    assert.match(job?.error ?? "", /無法儲存/);
  } finally {
    await f.cleanup();
  }
});

test("terminal jobs wait for persistence before reads and concurrent restarts preserve the single-job lock", async () => {
  let releaseInference!: () => void;
  const inferenceGate = new Promise<void>((resolve) => {
    releaseInference = resolve;
  });
  let enteredInference!: () => void;
  const entered = new Promise<void>((resolve) => {
    enteredInference = resolve;
  });
  let releasePersistence!: () => void;
  const persistenceGate = new Promise<void>((resolve) => {
    releasePersistence = resolve;
  });
  const f = await fixture({
    command: async (_executable, _args, options) => {
      enteredInference();
      await inferenceGate;
      options?.onLine?.(
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: answer() },
        }),
        "stdout",
      );
      return { stdout: "", stderr: "", code: 0 };
    },
  });
  try {
    const { job } = await f.service.start({});
    await entered;
    // Hold the existing atomic-write queue to reproduce a slow final flush.
    const writes = Reflect.get(f.service, "writes") as Promise<void>;
    Reflect.set(
      f.service,
      "writes",
      writes.then(() => persistenceGate),
    );
    releaseInference();
    for (let i = 0; job.status === "running" && i < 300; i++) await delay(5);
    assert.equal(job.status, "ready");
    let readSettled = false;
    let restartsSettled = false;
    const reading = f.service.get().then((result) => {
      readSettled = true;
      return result;
    });
    const restarting = Promise.allSettled([
      f.service.start({}),
      f.service.start({}),
    ]).then((results) => {
      restartsSettled = true;
      return results;
    });
    await delay(10);
    assert.equal(readSettled, false);
    assert.equal(restartsSettled, false);
    releasePersistence();
    await reading;
    const results = await restarting;
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.equal(rejected.reason.statusCode, 409);
    assert.match(rejected.reason.message, /已有探索/);
    assert.equal((await finished(f.service)).status, "ready");
  } finally {
    releaseInference();
    releasePersistence();
    await f.cleanup();
  }
});

test("discovery retries a Claude Code analysis that lost the OAuth refresh lock and exited non-zero, shows the wait and can be cancelled during it", async () => {
  const refreshRace =
    "Failed to refresh OAuth token: another Claude Code process is refreshing it or exited mid-refresh. This is usually transient; retry in a minute, and if it persists close other Claude Code processes or sign in again";
  const claudeCatalog = async () => ({
    source: "claude" as const,
    models: [
      {
        id: "sonnet",
        name: "Sonnet",
        description: "Fixture",
        isDefault: true,
        reasoningEfforts: ["low" as const],
        defaultReasoningEffort: "low" as const,
      },
    ],
  });
  const emitRace = (options: Parameters<typeof command>[2]) => {
    options?.onLine?.(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: refreshRace }] },
        error: "server_error",
        is_api_error_message: true,
      }),
      "stdout",
    );
    options?.onLine?.(
      JSON.stringify({
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
      }),
      "stdout",
    );
  };
  // command() flushes the events above through onLine, then rejects on claude's exit code 1.
  const exitFailure = (tail: string) =>
    new AppError(`claude 執行失敗：${tail}`, 422);
  const waits: number[] = [];
  const messages: string[] = [];
  let calls = 0;
  const f = await fixture({
    getModelCatalog: claudeCatalog,
    sleep: async (ms) => {
      waits.push(ms);
      messages.push((await f.service.get()).job!.message);
    },
    command: async (executable, _args, options) => {
      calls++;
      assert.equal(executable, "claude");
      if (calls === 1) {
        emitRace(options);
        throw exitFailure(refreshRace);
      }
      options?.onLine?.(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: answer(),
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 60,
            output_tokens: 20,
          },
        }),
        "stdout",
      );
      return { stdout: "", stderr: "", code: 0 };
    },
  });
  try {
    await f.service.start({ provider: "claude" });
    const job = await finished(f.service);
    assert.equal(job.status, "ready");
    assert.equal(job.opportunities.length, 1);
    assert.equal(calls, 2);
    assert.deepEqual(waits, [15_000]);
    assert.deepEqual(messages, [
      "Claude Code 正在更新登入憑證（其他行程持有更新鎖），15 秒後重試（第 2/3 次）。",
    ]);
    assert.equal(job.modelExecution?.provider, "claude");
    assert.equal(job.efficiency?.calls, 2);
    assert.equal(job.efficiency?.failedCalls, 1);
    assert.equal(job.efficiency?.completedCalls, 1);
    assert.equal(job.efficiency?.cachedInputTokens, 60);
  } finally {
    await f.cleanup();
  }

  // Cancelling while waiting ends the job as cancelled without another invocation.
  calls = 0;
  waits.length = 0;
  const cancelled = await fixture({
    getModelCatalog: claudeCatalog,
    sleep: async (ms) => {
      waits.push(ms);
      const stop = cancelled.service.cancel();
      await delay(1);
      assert.equal(calls, 1);
      void stop;
    },
    command: async (_executable, _args, options) => {
      calls++;
      emitRace(options);
      throw exitFailure(refreshRace);
    },
  });
  try {
    await cancelled.service.start({ provider: "claude" });
    const job = await finished(cancelled.service);
    assert.equal(job.status, "cancelled");
    assert.equal(calls, 1);
    assert.deepEqual(waits, [15_000]);
    assert.equal(job.efficiency?.calls, 1);
    assert.equal(job.efficiency?.failedCalls, 1);
  } finally {
    await cancelled.cleanup();
  }

  // Any other API error plus the non-zero exit fails at once with command()'s own message.
  calls = 0;
  waits.length = 0;
  const plain = await fixture({
    getModelCatalog: claudeCatalog,
    sleep: async (ms) => {
      waits.push(ms);
    },
    command: async (_executable, _args, options) => {
      calls++;
      options?.onLine?.(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: true,
          terminal_reason: "api_error",
          result: "API Error: 500 Internal server error",
        }),
        "stdout",
      );
      throw exitFailure("API Error: 500 Internal server error");
    },
  });
  try {
    await plain.service.start({ provider: "claude" });
    const job = await finished(plain.service);
    assert.equal(job.status, "failed");
    assert.equal(job.error, "claude 執行失敗：API Error: 500 Internal server error");
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
    assert.equal(job.efficiency?.calls, 1);
    assert.equal(job.efficiency?.failedCalls, 1);
  } finally {
    await plain.cleanup();
  }
});

test("discovery passes the Codex baseline timeout and a longer, announced wait for Claude Code at xhigh", async () => {
  const timeouts: number[] = [];
  const plain = await fixture({
    command: async (_executable, _args, options) => {
      timeouts.push(options!.timeoutMs!);
      options?.onLine?.(
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: answer() },
        }),
        "stdout",
      );
      return { stdout: "", stderr: "", code: 0 };
    },
  });
  try {
    await plain.service.start({});
    const job = await finished(plain.service);
    assert.equal(job.status, "ready");
    assert.deepEqual(timeouts, [240_000]);
    assert.doesNotMatch(job.message, /最多等待/);
  } finally {
    await plain.cleanup();
  }
  timeouts.length = 0;
  const messages: string[] = [];
  let timeOut = false;
  const claude = await fixture({
    getModelCatalog: async () => ({
      source: "claude" as const,
      models: [
        {
          id: "opus",
          name: "Opus",
          description: "Fixture",
          isDefault: true,
          reasoningEfforts: ["high" as const, "xhigh" as const],
          defaultReasoningEffort: "high" as const,
        },
      ],
    }),
    command: async (executable, _args, options) => {
      assert.equal(executable, "claude");
      timeouts.push(options!.timeoutMs!);
      messages.push((await claude.service.get()).job!.message);
      if (timeOut) throw new AppError("claude 執行逾時。", 504);
      options?.onLine?.(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: answer(),
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 20,
          },
        }),
        "stdout",
      );
      return { stdout: "", stderr: "", code: 0 };
    },
  });
  try {
    await claude.service.start({
      provider: "claude",
      model: "opus",
      reasoningEffort: "xhigh",
    });
    const job = await finished(claude.service);
    assert.equal(job.status, "ready");
    // 240 s × 2.5 (Claude) × 1.5 (xhigh) = 900 s.
    assert.deepEqual(timeouts, [900_000]);
    assert.deepEqual(messages, [
      "已取得真實 GitHub 來源，正在分析適合的貢獻機會（最多等待 15 分鐘）",
    ]);
    timeOut = true;
    await claude.service.start({
      provider: "claude",
      model: "opus",
      reasoningEffort: "xhigh",
    });
    const failed = await finished(claude.service);
    assert.equal(failed.status, "failed");
    assert.equal(
      failed.error,
      "claude 執行逾時（已等待 15 分鐘）。較高的思考強度或大型專案需要更久；可降低思考強度、改用較快的模型，或提高 BELLPR_AGENT_TIMEOUT_SCALE。",
    );
  } finally {
    await claude.cleanup();
  }
});
