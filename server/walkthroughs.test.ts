import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { request } from "node:http";
import { createApp } from "./index.js";
import { git } from "./process.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import type { TeamAgentInput } from "./team.js";
import { AppError, type DiffFile, type Run } from "./types.js";
import {
  changedRanges,
  parseWalkthrough,
  synchronizeWalkthroughs,
  walkthroughFileLimit,
  walkthroughJsonSchema,
  walkthroughPrompt,
} from "./walkthroughs.js";

const file = (overrides: Partial<DiffFile>): DiffFile => ({
  path: "src/a.ts",
  language: "TypeScript",
  additions: 1,
  deletions: 1,
  status: "modified",
  patch: "@@ -4,3 +4,3 @@\n a\n-b\n+c\n d\n",
  fingerprint: "f".repeat(64),
  hunks: [],
  ...overrides,
});

test("changed ranges are the added lines and where lines were deleted, never the context around them", () => {
  const patch = [
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -2,7 +2,7 @@ fn a",
    " a",
    " b",
    " c",
    "-d",
    "+D",
    " e",
    " f",
    " g",
    "@@ -18,7 +18,6 @@ fn b",
    " r",
    " s",
    " t",
    "-u",
    " v",
    " w",
    " x",
    "@@ -40,3 +39,5 @@ fn c",
    " p",
    "+q1",
    "+q2",
    " r",
  ].join("\n");
  assert.deepEqual(changedRanges(patch), [
    // A replacement is located by its added line.
    { startLine: 5, endLine: 5 },
    // A pure deletion sits after the line before it.
    { startLine: 20, endLine: 20 },
    { startLine: 40, endLine: 41 },
  ]);
  // A deletion at the very end of a hunk is still placed.
  assert.deepEqual(changedRanges("@@ -10,2 +10,1 @@\n a\n-b\n"), [{ startLine: 10, endLine: 10 }]);
});

test("only modified code files get a walkthrough, at most a fixed number per run, kept per diff version", () => {
  const run = { walkthroughs: { "gone.ts": { fingerprint: "x", status: "ready" } } } as unknown as Run;
  const code = Array.from({ length: walkthroughFileLimit + 1 }, (_, index) =>
    file({ path: `src/f${String(index).padStart(2, "0")}.ts` }),
  );
  const files = [
    file({ path: "a-blocked.ts", blocked: "敏感檔案" }),
    file({ path: "a-new.ts", status: "added" }),
    file({ path: "a-readme.md", language: "Markdown" }),
    file({ path: "a-huge.ts", patch: "x".repeat(100_001) }),
    ...code,
  ];
  synchronizeWalkthroughs(run, files);
  assert.equal(run.walkthroughs!["gone.ts"], undefined);
  const state = Object.fromEntries(files.map((entry) => [entry.path, entry.walkthroughStatus]));
  assert.equal(state["a-blocked.ts"], "unavailable");
  assert.equal(files[0].walkthroughError, "敏感檔案");
  assert.equal(state["a-new.ts"], "unavailable");
  assert.equal(state["a-readme.md"], "unavailable");
  assert.equal(state["a-huge.ts"], "unavailable");
  assert.deepEqual(
    code.map((entry) => entry.walkthroughStatus),
    [...Array(walkthroughFileLimit).fill("pending"), "unavailable"],
  );
  assert.match(code.at(-1)!.walkthroughError!, /追問 Agent/);
  // When another file leaves the diff, the one past the limit qualifies again.
  synchronizeWalkthroughs(run, files.filter((entry) => entry !== code[0]));
  assert.equal(code.at(-1)!.walkthroughStatus, "pending");
  synchronizeWalkthroughs(run, files);

  // A ready walkthrough is kept for the same diff and dropped when it changes.
  const content = { functions: [] };
  run.walkthroughs!["src/f00.ts"] = { fingerprint: "f".repeat(64), status: "ready", content };
  synchronizeWalkthroughs(run, files);
  assert.equal(code[0].walkthroughStatus, "ready");
  assert.equal(code[0].walkthrough, content);
  code[0].fingerprint = "e".repeat(64);
  synchronizeWalkthroughs(run, files);
  assert.equal(code[0].walkthroughStatus, "pending");
  assert.equal(code[0].walkthrough, undefined);
});

test("a walkthrough keeps only units and steps inside the file, and plain repository paths", () => {
  const unit = (overrides: Record<string, unknown>) => ({
    name: "count",
    kind: "函式",
    startLine: 3,
    endLine: 10,
    summary: "  計算數量。  ",
    change: "改了預設值。",
    steps: [
      { startLine: 3, endLine: 4, explanation: "取得輸入。" },
      { startLine: 9, endLine: 12, explanation: "超出函式範圍。" },
      { startLine: 6, endLine: 5, explanation: "顛倒。" },
    ],
    callers: [
      { name: "main", path: "src/main.ts", line: 8, note: "啟動時呼叫。" },
      { name: "evil", path: "../secret", line: 1, note: "路徑不安全。" },
    ],
    callees: [{ name: "fetch", path: "", line: null, note: "內建。" }],
    analogy: "像點名。",
    selfCheck: { question: "回傳什麼？", answer: "數量。" },
    ...overrides,
  });
  const parsed = parseWalkthrough(
    "```json\n" +
      JSON.stringify({
        functions: [
          unit({}),
          unit({ name: "beyond", startLine: 40, endLine: 50 }),
          unit({ name: "", startLine: 12, endLine: 20 }),
        ],
      }) +
      "\n```",
    20,
  );
  assert.equal(parsed.functions.length, 2);
  const [first, second] = parsed.functions;
  assert.equal(first.summary, "計算數量。");
  assert.deepEqual(first.steps, [{ startLine: 3, endLine: 4, explanation: "取得輸入。" }]);
  assert.deepEqual(first.callers, [
    { name: "main", path: "src/main.ts", line: 8, note: "啟動時呼叫。" },
    { name: "evil", path: "", line: null, note: "路徑不安全。" },
  ]);
  assert.deepEqual(first.callees, [{ name: "fetch", path: "", line: null, note: "內建。" }]);
  assert.equal(second.name, "第 12 行");
  assert.throws(() => parseWalkthrough("not json", 20), (error: AppError) => error.statusCode === 422);
  assert.throws(() => parseWalkthrough("{}", 20), (error: AppError) => error.statusCode === 422);
});

test("the walkthrough schema is closed and fully required, and the prompt is read-only with the changed ranges", () => {
  const closed = (schema: Record<string, unknown>): void => {
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(
        [...(schema.required as string[])].sort(),
        Object.keys(schema.properties as object).sort(),
      );
      for (const value of Object.values(schema.properties as Record<string, Record<string, unknown>>))
        closed(value);
    }
    if (schema.type === "array") closed(schema.items as Record<string, unknown>);
  };
  closed(walkthroughJsonSchema);
  // The prompt asks for 2 to 8 parts; structured output holds the agent to it.
  const steps = walkthroughJsonSchema.properties.functions.items.properties.steps;
  assert.equal(steps.minItems, 2);
  assert.equal(steps.maxItems, 8);
  const prompt = walkthroughPrompt({ contributionContext: "CONTEXT", file: file({}) });
  assert.match(prompt, /Work read-only/);
  assert.match(prompt, /do not modify files, execute code/);
  assert.match(prompt, /\[\{"startLine":5,"endLine":5\}\]/);
  // It explains the code beside the diff explanation and reports, not the diff again.
  assert.match(prompt, /never restate the diff line by line/);
  assert.match(prompt, /Skip code that only sits next to a range/);
  assert.match(prompt, /found by actually searching/);
  assert.match(prompt, /CONTEXT/);
});

test("a run's walkthrough is generated from the checkout, cached by fingerprint, and recovers after a restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-walkthrough-test-"));
  const repository = path.join(directory, "repo");
  const inputs: TeamAgentInput[] = [];
  let answer = "";
  try {
    await git(directory, ["init", "-q", "-b", "main", repository]);
    await git(repository, ["config", "user.name", "Walkthrough Test"]);
    await git(repository, ["config", "user.email", "walkthrough@example.invalid"]);
    const source = ["export function count(items: number[]) {", "  const total = items.length;", "  return total;", "}"];
    await writeFile(path.join(repository, "count.ts"), source.join("\n") + "\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-qm", "base"]);
    const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
    const store = new Store(path.join(directory, "state"));
    await store.initialize();
    const workbench = new Workbench(store, async (input) => {
      inputs.push(input);
      return answer;
    });
    const repo = await workbench.importRepository(repository);
    const run: Run = {
      id: "walk-run",
      repoId: repo.id,
      title: "Count items",
      prompt: "Count items",
      status: "running",
      branch: "main",
      baseBranch: "main",
      baseSha,
      worktreePath: repository,
      createdAt: new Date().toISOString(),
      agents: [],
      logs: [],
      draft: { title: "t", body: "b" },
      reviewedFiles: [],
      reviewedFingerprints: {},
    };
    store.data.runs.push(run);
    await writeFile(
      path.join(repository, "count.ts"),
      source.join("\n").replace("items.length", "items.length + 0") + "\n",
    );
    await assert.rejects(workbench.walkthrough(run.id, "count.ts"), /開發完成後/);
    run.status = "review";
    answer = JSON.stringify({
      functions: [
        {
          name: "count",
          kind: "函式",
          startLine: 1,
          endLine: 4,
          summary: "回傳陣列長度。",
          change: "多加了 0。",
          steps: [{ startLine: 2, endLine: 3, explanation: "計算並回傳。" }],
          callers: [],
          callees: [],
          analogy: "像數人頭。",
          selfCheck: { question: "空陣列回傳什麼？", answer: "0。" },
        },
      ],
    });
    const { files } = await workbench.walkthrough(run.id, "count.ts");
    const counted = files.find((entry) => entry.path === "count.ts")!;
    assert.equal(counted.walkthroughStatus, "ready");
    assert.equal(counted.walkthrough!.functions[0].name, "count");
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].role, "walkthrough");
    assert.equal(inputs[0].readonly, true);
    assert.equal(inputs[0].cwd, repository);
    assert.match(inputs[0].prompt, /"count\.ts"/);
    // Cached for this diff version: asking again does not call the agent.
    await workbench.walkthrough(run.id, "count.ts");
    assert.equal(inputs.length, 1);
    await assert.rejects(workbench.walkthrough(run.id, "missing.ts"), (error: AppError) => error.statusCode === 404);
    // The route takes exactly a file path and an optional retry flag.
    const server = createApp(workbench, { staticDirectory: path.join(directory, "missing") }).listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing server port");
      const post = (body: unknown) =>
        new Promise<number>((resolve, reject) => {
          const sent = request(
            `http://127.0.0.1:${address.port}/api/runs/${run.id}/walkthroughs`,
            {
              method: "POST",
              headers: { "content-type": "application/json", host: "127.0.0.1:4311" },
            },
            (response) => {
              response.resume();
              response.on("end", () => resolve(response.statusCode ?? 0));
            },
          );
          sent.on("error", reject);
          sent.end(JSON.stringify(body));
        });
      assert.equal(await post({ filePath: "count.ts", extra: true }), 400);
      assert.equal(await post({ retry: true }), 400);
      assert.equal(await post({ filePath: "count.ts" }), 200);
      assert.equal(inputs.length, 1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // A broken answer fails the file, which a retry asks again.
    await writeFile(path.join(repository, "count.ts"), source.join("\n").replace("total;", "total ?? 0;") + "\n");
    answer = "not json";
    const failed = (await workbench.walkthrough(run.id, "count.ts")).files[0];
    assert.equal(failed.walkthroughStatus, "failed");
    assert.match(failed.walkthroughError!, /格式不完整/);
    assert.equal((await workbench.walkthrough(run.id, "count.ts")).files[0].walkthroughStatus, "failed");
    assert.equal(inputs.length, 2);

    // A restart in the middle of a walkthrough leaves it failed, not generating.
    run.walkthroughs!["count.ts"].status = "generating";
    await store.save();
    const reopened = new Store(store.directory);
    await reopened.initialize();
    assert.equal(reopened.data.runs[0].walkthroughs!["count.ts"].status, "failed");
    await workbench.shutdown();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
