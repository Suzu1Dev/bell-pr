import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { appSettingsSchema } from "../shared/app-settings.js";
import {
  defaultDiscoveryPreferences,
  type ContributionOpportunity,
  type DiscoveryCandidate,
  type DiscoveryJob,
} from "../shared/discovery.js";
import { defaultContributionSettings } from "../shared/insights.js";
import { DiscoveryService } from "./discovery.js";
import { ProjectInsightsService } from "./insights.js";
import { lenientRead } from "./persisted-schema.js";
import { Store } from "./store.js";
import type { Database, Repository, Run } from "./types.js";

test("objects strip unknown keys at every depth instead of rejecting them", () => {
  const schema = z
    .object({
      name: z.string(),
      nested: z.object({ count: z.number() }).strict(),
      items: z.array(z.object({ id: z.string() }).strict()),
    })
    .strict();
  const written = {
    name: "a",
    fromNewerBuild: true,
    nested: { count: 1, alsoNew: "x" },
    items: [{ id: "1", extra: 2 }],
  };
  assert.equal(schema.safeParse(written).success, false);
  assert.deepEqual(lenientRead(schema).parse(written), {
    name: "a",
    nested: { count: 1 },
    items: [{ id: "1" }],
  });
});

test("string and array maximums grow by the cap factor while minimums stay", () => {
  const schema = z.object({
    text: z.string().trim().min(2).max(10),
    list: z.array(z.string()).min(1).max(3),
  });
  const lenient = lenientRead(schema);
  const doubled = { text: "x".repeat(20), list: ["a", "b", "c", "d", "e", "f"] };
  assert.equal(schema.safeParse(doubled).success, false);
  assert.deepEqual(lenient.parse(doubled), doubled);
  // The relaxed cap still holds (4x by default), and so do the minimums.
  assert.equal(lenient.safeParse({ text: "x".repeat(41), list: ["a"] }).success, false);
  assert.equal(lenient.safeParse({ text: "x", list: ["a"] }).success, false);
  assert.equal(lenient.safeParse({ text: "xx", list: [] }).success, false);
  assert.equal(
    lenient.safeParse({ text: "xx", list: Array(13).fill("a") }).success,
    false,
  );
  // Transforming checks such as trim still apply.
  assert.equal(lenient.parse({ text: "  ok  ", list: ["a"] }).text, "ok");
});

test("capFactor sets the margin and must not tighten the schema", () => {
  const schema = z.string().max(10);
  assert.equal(lenientRead(schema, { capFactor: 2 }).safeParse("x".repeat(20)).success, true);
  assert.equal(lenientRead(schema, { capFactor: 2 }).safeParse("x".repeat(21)).success, false);
  assert.equal(lenientRead(schema, { capFactor: 1 }).safeParse("x".repeat(11)).success, false);
  for (const capFactor of [0.5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    assert.throws(() => lenientRead(schema, { capFactor }), RangeError);
});

test("unknown enum and literal values, numbers out of range and wrong types still fail", () => {
  const schema = z
    .object({
      kind: z.enum(["a", "b"]),
      version: z.literal(1),
      count: z.number().int().max(5),
      flag: z.boolean(),
      maxTeammates: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    })
    .strict();
  const lenient = lenientRead(schema);
  const valid = { kind: "a", version: 1, count: 5, flag: true, maxTeammates: 2 };
  assert.deepEqual(lenient.parse(valid), valid);
  for (const invalid of [
    { ...valid, kind: "c" },
    { ...valid, version: 2 },
    { ...valid, count: 6 },
    { ...valid, count: 1.5 },
    { ...valid, flag: "yes" },
    { ...valid, maxTeammates: 5 },
    { ...valid, kind: undefined },
  ])
    assert.equal(lenient.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test("refinements, formats, transforms and defaults still run", () => {
  const ids = z
    .array(z.string().regex(/^[a-z]+$/).max(4))
    .max(2)
    .refine((values) => new Set(values).size === values.length, "duplicate");
  const schema = z
    .object({
      ids,
      url: z
        .string()
        .url()
        .max(30)
        .refine((value) => value.startsWith("https://"), "https only"),
      at: z.string().datetime(),
      label: z.string().transform((value) => value.toUpperCase()),
      mode: z.enum(["lite", "full"]).default("lite"),
      preferences: z
        .object({ order: z.array(z.string()) })
        .strict()
        .default({ order: [] }),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.label === "BAD")
        context.addIssue({ code: z.ZodIssueCode.custom, message: "bad label" });
    });
  const lenient = lenientRead(schema);
  const valid = {
    ids: ["ab", "cd"],
    url: "https://example.test/path",
    at: "2026-10-07T00:00:00.000Z",
    label: "ok",
  };
  assert.deepEqual(lenient.parse(valid), {
    ...valid,
    label: "OK",
    mode: "lite",
    preferences: { order: [] },
  });
  // Leniency reaches inside refinements and defaults too.
  const newer = {
    ...valid,
    ids: ["ab", "cd", "ef"],
    preferences: { order: ["a"], fromNewerBuild: true },
    fromNewerBuild: true,
  };
  assert.equal(schema.safeParse(newer).success, false);
  assert.deepEqual(lenient.parse(newer), {
    ...valid,
    ids: ["ab", "cd", "ef"],
    label: "OK",
    mode: "lite",
    preferences: { order: ["a"] },
  });
  for (const invalid of [
    { ...valid, ids: ["ab", "ab"] },
    { ...valid, ids: ["AB"] },
    { ...valid, url: "http://example.test" },
    { ...valid, url: "not a url" },
    { ...valid, at: "yesterday" },
    { ...valid, label: "bad" },
  ])
    assert.equal(lenient.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test("optional, nullable, union, discriminated union, record, tuple and intersection are mapped", () => {
  const event = z.discriminatedUnion("type", [
    z.object({ type: z.literal("note"), text: z.string().max(3) }).strict(),
    z.object({ type: z.literal("count"), value: z.number() }).strict(),
  ]);
  const schema = z
    .object({
      maybe: z.object({ a: z.string() }).strict().optional(),
      nothing: z.object({ a: z.string() }).strict().nullable(),
      either: z.union([z.string().max(2), z.object({ b: z.number() }).strict()]),
      events: z.array(event),
      byRole: z.record(
        z.string().max(3),
        z.object({ calls: z.number() }).strict(),
      ),
      pair: z.tuple([z.string().max(2), z.object({ c: z.boolean() }).strict()]),
      both: z
        .object({ left: z.string() })
        .strict()
        .and(z.object({ right: z.string() }).passthrough()),
    })
    .strict();
  const written = {
    maybe: { a: "x", newer: 1 },
    nothing: null,
    either: { b: 1, newer: 1 },
    events: [
      { type: "note", text: "abcdef", newer: 1 },
      { type: "count", value: 2, newer: 1 },
    ],
    byRole: { leader: { calls: 1, newer: 1 } },
    pair: ["abc", { c: true, newer: 1 }],
    both: { left: "l", right: "r" },
  };
  assert.equal(schema.safeParse(written).success, false);
  const parsed = lenientRead(schema).parse(written);
  assert.deepEqual(parsed, {
    maybe: { a: "x" },
    nothing: null,
    either: { b: 1 },
    events: [
      { type: "note", text: "abcdef" },
      { type: "count", value: 2 },
    ],
    byRole: { leader: { calls: 1 } },
    pair: ["abc", { c: true }],
    both: { left: "l", right: "r" },
  });
  // An unknown discriminator value is still rejected.
  assert.equal(
    lenientRead(event).safeParse({ type: "other", text: "a" }).success,
    false,
  );
  assert.equal(
    lenientRead(event).safeParse({ type: "note", text: "x".repeat(13) }).success,
    false,
  );
});

test("catch, readonly, pipeline and branded schemas are mapped", () => {
  const inner = () => z.object({ a: z.string() }).strict();
  const schema = z
    .object({
      caught: inner().catch({ a: "fallback" }),
      frozen: inner().readonly(),
      piped: z.string().pipe(z.string().max(2)),
      branded: inner().brand<"Branded">(),
    })
    .strict();
  const written = {
    caught: { a: "kept", newer: 1 },
    frozen: { a: "x", newer: 1 },
    piped: "abc",
    branded: { a: "y", newer: 1 },
  };
  assert.equal(schema.safeParse(written).success, false);
  assert.deepEqual(lenientRead(schema).parse(written), {
    caught: { a: "kept" },
    frozen: { a: "x" },
    piped: "abc",
    branded: { a: "y" },
  });
});

test("passthrough objects keep unknown keys, so a round trip preserves them", () => {
  const schema = z.object({ version: z.literal(1) }).passthrough();
  assert.deepEqual(lenientRead(schema).parse({ version: 1, newer: { a: 1 } }), {
    version: 1,
    newer: { a: 1 },
  });
});

test("recursive and shared sub-schemas are rebuilt once and stay lenient", () => {
  interface Node {
    name: string;
    children: Node[];
  }
  const node: z.ZodType<Node> = z.lazy(() =>
    z.object({ name: z.string().max(2), children: z.array(node) }).strict(),
  );
  const tree = { name: "abc", extra: 1, children: [{ name: "de", children: [], extra: 2 }] };
  assert.equal(node.safeParse(tree).success, false);
  assert.deepEqual(lenientRead(node).parse(tree), {
    name: "abc",
    children: [{ name: "de", children: [] }],
  });
  const text = z.string().max(2);
  const shared = z.object({ a: text, b: text }).strict();
  assert.deepEqual(lenientRead(shared).parse({ a: "abc", b: "def" }), {
    a: "abc",
    b: "def",
  });
});

test("a lazy schema is rebuilt once, not on every parse", () => {
  let built = 0;
  const item: z.ZodType<{ name: string }> = z.lazy(() => {
    built += 1;
    return z.object({ name: z.string().max(2) }).strict();
  });
  const lenient = lenientRead(z.array(item));
  const items = Array.from({ length: 5 }, () => ({ name: "abc", extra: 1 }));
  for (let parse = 0; parse < 3; parse += 1)
    assert.deepEqual(lenient.parse(items), items.map(() => ({ name: "abc" })));
  assert.equal(built, 1);
});

test("the original schema is left unchanged", () => {
  const schema = z.object({ text: z.string().max(2) }).strict();
  lenientRead(schema);
  assert.equal(schema.safeParse({ text: "abc" }).success, false);
  assert.equal(schema.safeParse({ text: "ab", extra: 1 }).success, false);
  // A strict object rejects unknown keys through a catchall of never.
  assert.ok(schema._zod.def.catchall instanceof z.ZodNever);
});

// Persisted files as the services read them. A file written by a newer
// build may carry fields this build does not know and longer text.

async function dataDirectory(t: test.TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-persisted-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  return store;
}

const repository: Repository = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "greeting",
  owner: "local",
  fullName: "local/greeting",
  // Missing on purpose: the cache is then reported stale without git.
  path: "/nonexistent/bell-persisted-schema/greeting",
  defaultBranch: "main",
  url: "",
};

/** The insights cache fixture of server/store.test.ts. */
function storeTestCache() {
  return {
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
}

async function readCache(store: Store, cache: unknown) {
  store.data.repos.push(repository);
  const directory = path.join(store.directory, "insights");
  await mkdir(directory, { recursive: true });
  const file = createHash("sha256").update(repository.id).digest("hex");
  await writeFile(path.join(directory, `${file}.json`), JSON.stringify(cache));
  return new ProjectInsightsService(store);
}

test("the insights cache fixture of server/store.test.ts loads unchanged", async (t) => {
  const store = await dataDirectory(t);
  const cache = storeTestCache();
  const service = await readCache(store, cache);
  assert.deepEqual(await service.get(repository.id), {
    insights: cache.insights,
    stale: true,
    recommendationPreferences: cache.recommendationPreferences,
  });
});

test("an insights cache from a newer build loads without its unknown fields", async (t) => {
  const store = await dataDirectory(t);
  const cache = storeTestCache();
  const [recommendation] = cache.insights.recommendations;
  const longSummary = "x".repeat(4_800); // twice today's 2,400 cap
  const newer = {
    ...cache,
    fromNewerBuild: { anything: true },
    settings: { ...cache.settings, newSetting: "on" },
    insights: {
      ...cache.insights,
      summary: longSummary,
      newSection: ["a"],
      recommendations: [
        {
          ...recommendation,
          newScore: 3,
          evidenceDetails: [
            { ...recommendation.evidenceDetails[0], newNote: "n" },
          ],
        },
      ],
    },
  };
  const service = await readCache(store, newer);
  const result = await service.get(repository.id);
  assert.deepEqual(result.insights, {
    ...cache.insights,
    summary: longSummary,
  });
  assert.deepEqual(
    await service.getSettings(repository.id),
    defaultContributionSettings,
  );
});

test("an insights cache with an unknown enum value is still rejected", async (t) => {
  const store = await dataDirectory(t);
  const cache = storeTestCache();
  cache.insights.recommendations[0].direction = "rewrite";
  const service = await readCache(store, cache);
  await assert.rejects(
    service.get(repository.id),
    (error: { statusCode?: number }) => error.statusCode === 500,
  );
});

test("model settings from a newer build load without their unknown fields", async (t) => {
  const store = await dataDirectory(t);
  const file = path.join(store.directory, "model-settings.json");
  const settings = {
    provider: "claude",
    model: "claude-sonnet",
    reasoningEffort: "high",
    webAccess: true,
  };
  await writeFile(file, JSON.stringify({ ...settings, newKnob: 1 }));
  const service = new ProjectInsightsService(store);
  assert.deepEqual(await service.getModelSettings(), settings);
  await writeFile(file, JSON.stringify({ ...settings, reasoningEffort: "galaxy" }));
  await assert.rejects(
    service.getModelSettings(),
    (error: { statusCode?: number }) => error.statusCode === 500,
  );
});

/** The candidate and opportunity fixtures of server/discovery.test.ts. */
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
  ],
};
const opportunity: ContributionOpportunity = {
  id: "keyboard-docs",
  repository: candidate.fullName,
  title: "釐清鍵盤操作說明",
  summary: "有使用者回報操作說明不清楚，先確認目前內容與需求。",
  userNeed: "初次使用者可能比較容易找到鍵盤操作。",
  contributionRules: "應先討論提案。",
  popularity: "GitHub 查詢快照：1,250 stars",
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
  ],
};
const readyJob: DiscoveryJob = {
  id: "22222222-2222-4222-8222-222222222222",
  status: "ready",
  phase: "complete",
  message: "探索完成",
  preferences: { ...defaultDiscoveryPreferences },
  createdAt: "2026-10-07T00:00:00.000Z",
  completedAt: "2026-10-07T00:05:00.000Z",
  candidates: [candidate],
  opportunities: [opportunity],
  warnings: [],
};

async function readJob(t: test.TestContext, file: unknown) {
  const store = await dataDirectory(t);
  await writeFile(
    path.join(store.directory, "discovery.json"),
    JSON.stringify(file),
  );
  const service = new DiscoveryService(store);
  t.after(() => service.shutdown());
  return service.get();
}

test("a saved discovery job loads unchanged", async (t) => {
  assert.deepEqual(await readJob(t, { version: 1, job: readyJob }), {
    job: readyJob,
  });
  assert.deepEqual(await readJob(t, { version: 1, job: null }), { job: null });
});

test("a discovery job from a newer build loads without its unknown fields", async (t) => {
  const longWarning = "w".repeat(4_800); // twice today's 2,400 cap
  const newer = {
    version: 1,
    fromNewerBuild: true,
    job: {
      ...readyJob,
      newJobField: 1,
      preferences: { ...readyJob.preferences, newPreference: "x" },
      candidates: [
        {
          ...candidate,
          newCandidateField: 1,
          sources: [{ ...candidate.sources[0], newSourceField: 1 }],
        },
      ],
      opportunities: [
        {
          ...opportunity,
          newOpportunityField: 1,
          evidence: [{ ...opportunity.evidence[0], newEvidenceField: 1 }],
        },
      ],
      warnings: [longWarning],
    },
  };
  assert.deepEqual(await readJob(t, newer), {
    job: { ...readyJob, warnings: [longWarning] },
  });
});

test("a discovery job with an unknown status is still rejected", async (t) => {
  await assert.rejects(
    readJob(t, { version: 1, job: { ...readyJob, status: "paused" } }),
  );
});

test("state.json keeps loading runs that carry the new optional fields", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-persisted-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const run: Run & { fromNewerBuild: string } = {
    id: "run00000-0000-4000-8000-000000000002",
    repoId: repository.id,
    title: "Add greeting tests",
    prompt: "Add greeting tests",
    status: "review",
    branch: "bellpr/run00000",
    baseBranch: "main",
    baseSha: "a".repeat(40),
    worktreePath: "/tmp/state/worktrees/run00000",
    createdAt: "2026-10-07T00:00:00.000Z",
    agents: [],
    logs: [],
    draft: { title: "Add greeting tests", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    locale: "en",
    unsandboxed: true,
    workspaceRemovedAt: "2026-10-08T00:00:00.000Z",
    workspaceBytes: 1024,
    fromNewerBuild: "kept",
  };
  const fixture: Database = { version: 1, repos: [repository], runs: [run] };
  await writeFile(path.join(directory, "state.json"), JSON.stringify(fixture));
  const store = new Store(directory);
  await store.initialize();
  assert.deepEqual(store.data, fixture);
  const saved = JSON.parse(
    await readFile(path.join(directory, "state.json"), "utf8"),
  ) as Database;
  assert.deepEqual(saved, fixture);
});

test("an app settings file with a field this build does not know still loads", () => {
  // Simulates the older build: the field is missing from its schema.
  const older = lenientRead(appSettingsSchema.omit({ retentionDays: true }));
  assert.deepEqual(older.parse({ locale: "en", retentionDays: 30 }), {
    locale: "en",
  });
});

test("an app settings file that still has the retired eulaAcceptedVersion field loads without it", () => {
  assert.deepEqual(
    lenientRead(appSettingsSchema).parse({
      locale: "en",
      eulaAcceptedVersion: "1.0-draft-2026-10-14",
    }),
    { locale: "en" },
  );
});
