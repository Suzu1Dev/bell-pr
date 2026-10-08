import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  explanationBatches,
  explanationPrompt,
  guidePrompt,
  parseExplanations,
  synchronizeExplanations,
} from "./explanations.js";
import type { DiffFile, Run } from "./types.js";
import type { TeamAgentRunner } from "./team.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import { git } from "./process.js";

const diff = (name: string, patch = "+example"): DiffFile => ({
  path: name,
  patch,
  fingerprint: "a".repeat(64),
  language: "TypeScript",
  additions: 1,
  deletions: 0,
  status: "modified",
  hunks: [],
});
const example = {
  scenario: "使用者打開頁面，查看這個模組提供的數字。",
  before: "原本提供的數字是 1。",
  after: "現在提供的數字是 2；其他顯示方式不變。",
};
const alternatives =
  "也可以改成由呼叫端傳入數字；這次沒有這樣做，因為只有一個呼叫者。當數字需要依環境變動時再改採。";
const lookup = ["dependency injection", "configuration"];
const selfCheck = {
  question: "這次修改後，呼叫者拿到的數字是多少？",
  answer: "是 2；diff 只改了常數值，呼叫方式不變。",
};
const context = "Consistent output\nUser request:\nImprove a";

test("explanations retain bounded complete diffs, exclude blocked content, and reject missing or invented file responses", () => {
  const files = Array.from({ length: 9 }, (_, i) => diff(`${i}.ts`));
  const blocked = {
    ...diff(".env", "hidden secret"),
    blocked: "Sensitive file",
  };
  assert.deepEqual(
    explanationBatches([...files, blocked]).map((batch) => batch.length),
    [8, 1],
  );
  const prompt = explanationPrompt(
    explanationBatches([blocked, files[0]])[0],
    context,
  );
  assert.doesNotMatch(prompt, /hidden secret|\.env/);
  // Task context is background before the diffs, never after them.
  assert.match(
    prompt,
    /Task context \(background[^\n]*\nConsistent output\nUser request:\nImprove a\nProvided diffs:\n\[\{"path":"0\.ts"/,
  );
  assert.match(prompt, /user-stated or inferred/);
  assert.match(prompt, /"alternatives":"at least one other viable approach/);
  assert.match(prompt, /"lookup":\["1 to 3 searchable keywords/);
  assert.match(prompt, /"selfCheck":\{"question":"one question/);
  assert.throws(
    () => explanationBatches([diff("huge.ts", "字".repeat(40_000))]),
    /100 KB/,
  );
  const answer = {
    files: [
      {
        path: "0.ts",
        summary: "更清楚的輸出",
        reason: "避免理解錯誤",
        concept: "命名表達意圖",
        tip: "確認呼叫處",
        example,
        alternatives,
        lookup,
        selfCheck,
      },
    ],
  };
  const parsed = parseExplanations(JSON.stringify(answer), [files[0]])[0];
  assert.equal(parsed.summary, "更清楚的輸出");
  assert.deepEqual(parsed.lookup, lookup);
  assert.deepEqual(parsed.selfCheck, selfCheck);
  // Alternatives, lookup keywords and the self-check are required on the
  // model output side, exactly like the example.
  for (const incomplete of [
    { ...answer.files[0], alternatives: undefined },
    { ...answer.files[0], lookup: [] },
    { ...answer.files[0], lookup: ["a", "b", "c", "d"] },
    { ...answer.files[0], selfCheck: undefined },
    { ...answer.files[0], selfCheck: { question: "只有問題" } },
    { ...answer.files[0], selfCheck: { ...selfCheck, answer: " " } },
  ])
    assert.throws(
      () =>
        parseExplanations(JSON.stringify({ files: [incomplete] }), [files[0]]),
      /格式不完整/,
    );
  for (const invalidExample of [
    undefined,
    { scenario: "情境", before: "原本" },
    { scenario: "情境", before: "原本", after: "  " },
  ])
    assert.throws(
      () =>
        parseExplanations(
          JSON.stringify({
            files: [{ ...answer.files[0], example: invalidExample }],
          }),
          [files[0]],
        ),
      /格式不完整/,
    );
  assert.throws(
    () => parseExplanations(JSON.stringify(answer), files.slice(0, 2)),
    /完整對應/,
  );
  assert.throws(
    () => parseExplanations(JSON.stringify(answer), [files[1]]),
    /完整對應/,
  );
  assert.throws(
    () =>
      parseExplanations(
        JSON.stringify({ files: [answer.files[0], answer.files[0]] }),
        files.slice(0, 2),
      ),
    /完整對應/,
  );
});

test("ready cards saved without alternatives or a self-check stay ready; only a missing example migrates", () => {
  const files = [diff("a.ts"), diff("b.ts")];
  const legacy = {
    summary: "舊摘要",
    reason: "舊原因",
    concept: "舊概念",
    tip: "舊建議",
  };
  const run = {
    explanations: {
      "a.ts": {
        fingerprint: files[0].fingerprint,
        status: "ready",
        content: { ...legacy, example },
      },
      "b.ts": {
        fingerprint: files[1].fingerprint,
        status: "ready",
        content: legacy,
      },
    },
  } as unknown as Run;
  synchronizeExplanations(run, files);
  assert.equal(files[0].explanationStatus, "ready");
  assert.equal(files[0].explanation?.selfCheck, undefined);
  assert.equal(files[1].explanationStatus, "pending");
});

test("guide prompt carries contribution context, the ready explanation card and named reports before the conversation", () => {
  const run = {
    prompt: "Improve a",
    reports: {
      reviewer: `審查：${"r".repeat(7000)}`,
      tester: "測試分析：缺少邊界案例",
      implementer: "整合摘要",
      guide: "先前的導師回答",
      alpha: '{"report":"teammate json"}',
    },
  } as unknown as Run;
  const base = {
    contributionContext: "User request:\nImprove a\nContribution settings:\n{}",
    run,
    messages: [] as string[],
    question: "為什麼這樣寫？",
  };
  const pending = guidePrompt({
    ...base,
    file: {
      ...diff("a.ts"),
      explanationStatus: "pending",
      explanation: { summary: "舊卡片", reason: "", concept: "", tip: "" },
    },
  });
  assert.match(pending, /Contribution settings:\n\{\}/);
  assert.doesNotMatch(pending, /User task:/);
  assert.match(pending, /Current diff \(JSON\):\n\{"path":"a\.ts","patch":"\+example"\}/);
  assert.match(pending, /not generated yet\):\nnull\n/);
  assert.doesNotMatch(pending, /舊卡片/);
  assert.match(pending, /UNTRUSTED DATA/);
  assert.match(pending, /"tester":"測試分析：缺少邊界案例"/);
  assert.doesNotMatch(pending, /整合摘要|先前的導師回答|teammate json/);
  assert.equal(pending.match(/r{7000}/), null);
  assert.match(pending, /審查：r{5997}"/);
  assert.match(pending, /Prior conversation:\n\nQuestion: 為什麼這樣寫？$/);
  assert.ok(
    pending.indexOf("UNTRUSTED DATA") < pending.indexOf("Prior conversation:"),
  );

  const ready = guidePrompt({
    ...base,
    run: { ...run, reports: undefined },
    messages: ["User: 之前的問題", "Mentor: 之前的回答"],
    file: {
      ...diff("a.ts"),
      explanationStatus: "ready",
      explanation: {
        summary: "更新輸出",
        reason: "改善一致性",
        concept: "單一責任",
        tip: "確認呼叫者",
        example,
      },
    },
  });
  assert.match(
    ready,
    /do not restate it; null when not generated yet\):\n\{"summary":"更新輸出","reason":"改善一致性","concept":"單一責任","tip":"確認呼叫者"\}/,
  );
  assert.doesNotMatch(ready, /使用者打開頁面/);
  assert.match(ready, /\{"reviewer":null,"tester":null\}/);
  assert.match(
    ready,
    /Prior conversation:\nUser: 之前的問題\nMentor: 之前的回答\nQuestion:/,
  );
  assert.match(ready, /answer the question directly first/);
  assert.match(ready, /English terms in parentheses/);
});

function response(prompt: string) {
  const files = JSON.parse(
    prompt.split("Provided diffs:\n")[1].split("\n\nBELL Ponytail")[0],
  ) as { path: string }[];
  return JSON.stringify({
    files: files.map(({ path }) => ({
      path,
      summary: "更新輸出",
      reason: "改善一致性",
      concept: "單一責任\n每個模組維持相同契約。",
      tip: "確認呼叫者的既有測試。",
      example,
      alternatives,
      lookup,
      selfCheck,
    })),
  });
}

async function fixture(runner: TeamAgentRunner) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "bell-explanation-test-"),
  );
  const repository = path.join(directory, "repo");
  await mkdir(repository);
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  for (const file of ["a.ts", "b.ts"])
    await writeFile(path.join(repository, file), "export const value = 1;\n");
  await git(repository, ["add", "."]);
  await git(repository, ["commit", "-m", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store, runner);
  const repo = await workbench.importRepository(repository);
  const run: Run = {
    id: "explanation-run",
    repoId: repo.id,
    title: "Consistent output",
    prompt: "Improve output consistency",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: { title: "Consistent output", body: "Completed change." },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  store.data.runs.push(run);
  for (const file of ["a.ts", "b.ts"])
    await writeFile(path.join(repository, file), "export const value = 2;\n");
  return {
    directory,
    repository,
    store,
    workbench,
    run,
    cleanup: async () => {
      await workbench.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("completed runs generate one isolated batch, deduplicate callers, persist results, and invalidate only changed fingerprints", async () => {
  let calls = 0;
  const f = await fixture(async (input) => {
    assert.deepEqual(input.modelExecution, {
      model: "test-model",
      reasoningEffort: "low",
      source: "selected",
    });
    if (input.role === "guide") {
      assert.match(input.prompt, /Prior conversation:\n\nQuestion:/);
      // The synchronized card for a.ts is attached; the example stays out.
      assert.match(input.prompt, /"summary":"更新輸出"/);
      assert.doesNotMatch(input.prompt, /使用者打開頁面/);
      return "獨立的追問回答";
    }
    calls++;
    assert.equal(input.readonly, true);
    assert.deepEqual(await readdir(input.cwd), ["response-schema.json"]);
    assert.doesNotMatch(input.prompt, /\.env|hidden secret|large\.txt/);
    // The run title and the shared contribution context precede the diffs.
    assert.match(
      input.prompt,
      /Consistent output\nUser request:\nImprove output consistency\nContribution settings[^\n]*\n\{\}\nProvided diffs:/,
    );
    return response(input.prompt);
  });
  try {
    f.run.modelExecution = {
      model: "test-model",
      reasoningEffort: "low",
      source: "selected",
    };
    await writeFile(path.join(f.repository, ".env"), "hidden secret\n");
    await writeFile(path.join(f.repository, "large.txt"), "a".repeat(110_000));
    const [first, second] = await Promise.all([
      f.workbench.explanations(f.run.id),
      f.workbench.explanations(f.run.id),
    ]);
    assert.equal(calls, 1);
    assert.equal(
      first.files.find((file) => file.path === "a.ts")?.explanation?.summary,
      "更新輸出",
    );
    assert.deepEqual(
      first.files.find((file) => file.path === "a.ts")?.explanation?.selfCheck,
      selfCheck,
    );
    assert.equal(
      second.files.find((file) => file.path === ".env")?.explanationStatus,
      "unavailable",
    );
    assert.equal(
      second.files.find((file) => file.path === "large.txt")?.explanationStatus,
      "unavailable",
    );
    assert.equal(f.run.reports?.explanations, undefined);
    await f.workbench.explanations(f.run.id);
    assert.equal(calls, 1);
    const saved = new Store(f.store.directory);
    await saved.initialize();
    assert.deepEqual(
      saved.data.runs[0].explanations,
      JSON.parse(JSON.stringify(f.run.explanations)),
    );
    await f.workbench.chat(f.run.id, "a.ts", "為什麼這樣寫？");
    await writeFile(
      path.join(f.repository, "a.ts"),
      "export const value = 3;\n",
    );
    const stale = await f.workbench.diff(f.run.id);
    assert.equal(
      stale.find((file) => file.path === "a.ts")?.explanation,
      undefined,
    );
    assert.equal(
      stale.find((file) => file.path === "a.ts")?.explanationStatus,
      "pending",
    );
    assert.equal(
      stale.find((file) => file.path === "b.ts")?.explanationStatus,
      "ready",
    );
    await f.workbench.explanations(f.run.id);
    assert.equal(calls, 2);
    await assert.rejects(
      f.workbench.explanations(f.run.id, { filePath: "missing.ts" }),
      /找不到/,
    );
  } finally {
    await f.cleanup();
  }
});

test("explanation failure preserves completed work, requires explicit retry, and interrupted stored generation recovers separately", async () => {
  let calls = 0;
  const f = await fixture(async (input) =>
    ++calls === 1 ? "invalid JSON" : response(input.prompt),
  );
  try {
    await f.workbench.explanations(f.run.id);
    assert.equal(f.run.status, "review");
    assert.equal(f.run.explanations?.["a.ts"].status, "failed");
    await f.workbench.explanations(f.run.id);
    assert.equal(calls, 1);
    const retried = await f.workbench.explanations(f.run.id, {
      retry: true,
      filePath: "a.ts",
    });
    assert.equal(calls, 2);
    assert.equal(
      retried.files.find((file) => file.path === "a.ts")?.explanationStatus,
      "ready",
    );
    assert.equal(
      retried.files.find((file) => file.path === "b.ts")?.explanationStatus,
      "failed",
    );
    f.run.explanations!["b.ts"].status = "generating";
    const existingContent = {
      summary: "先前的解說",
      reason: "先前的原因",
      concept: "先前的概念",
      tip: "先前的建議",
    };
    f.run.explanations!["b.ts"].content = existingContent;
    await f.store.save();
    const reopened = new Store(f.store.directory);
    await reopened.initialize();
    assert.equal(reopened.data.runs[0].status, "review");
    assert.equal(reopened.data.runs[0].explanations?.["b.ts"].status, "failed");
    assert.match(
      reopened.data.runs[0].explanations?.["b.ts"].error ?? "",
      /重新啟動/,
    );
    assert.deepEqual(
      reopened.data.runs[0].explanations?.["b.ts"].content,
      existingContent,
    );
  } finally {
    await f.cleanup();
  }
});

test("legacy explanations remain readable during one automatic example migration and failed migrations only retry explicitly", async () => {
  let calls = 0;
  let start!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runner: TeamAgentRunner = async (input) => {
    if (++calls === 1) {
      start();
      await gate;
      return "invalid JSON";
    }
    return response(input.prompt);
  };
  const f = await fixture(runner);
  const legacy = {
    summary: "已保存的變更摘要",
    reason: "已保存的修改原因",
    concept: "已保存的程式概念",
    tip: "已保存的檢查建議",
  };
  try {
    const files = await f.workbench.diff(f.run.id);
    for (const file of files)
      f.run.explanations![file.path] = {
        fingerprint: file.fingerprint,
        status: "ready",
        content: legacy,
      };
    const pending = await f.workbench.diff(f.run.id);
    assert.ok(pending.every((file) => file.explanationStatus === "pending"));
    assert.ok(pending.every((file) => file.explanation === legacy));
    const generating = f.workbench.explanations(f.run.id);
    await started;
    const inProgress = await f.workbench.diff(f.run.id);
    assert.ok(
      inProgress.every((file) => file.explanationStatus === "generating"),
    );
    assert.ok(inProgress.every((file) => file.explanation === legacy));
    release();
    const failed = await generating;
    assert.ok(
      failed.files.every((file) => file.explanationStatus === "failed"),
    );
    assert.ok(failed.files.every((file) => file.explanation === legacy));
    await f.workbench.explanations(f.run.id);
    assert.equal(
      calls,
      1,
      "a missing example must not reset failed migration to pending",
    );
    const retried = await f.workbench.explanations(f.run.id, { retry: true });
    assert.equal(calls, 2);
    assert.ok(
      retried.files.every((file) => file.explanationStatus === "ready"),
    );
    for (const file of retried.files)
      assert.deepEqual(file.explanation?.example, example);
    const reopened = new Store(f.store.directory);
    await reopened.initialize();
    const restarted = new Workbench(reopened, runner);
    try {
      const persisted = await restarted.explanations(f.run.id);
      assert.equal(
        calls,
        2,
        "saved examples must not generate again after reopening",
      );
      for (const file of persisted.files)
        assert.deepEqual(file.explanation?.example, example);
    } finally {
      await restarted.shutdown();
    }
  } finally {
    release();
    await f.cleanup();
  }
});

test("late explanation results never label a newer diff and shutdown waits for isolated generation cleanup", async () => {
  let start!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let temporary = "";
  const f = await fixture(async (input) => {
    temporary = input.cwd;
    start();
    await gate;
    return response(input.prompt);
  });
  try {
    const generating = f.workbench.explanations(f.run.id);
    await started;
    await writeFile(
      path.join(f.repository, "a.ts"),
      "export const value = 4;\n",
    );
    release();
    const result = await generating;
    assert.equal(
      result.files.find((file) => file.path === "a.ts")?.explanation,
      undefined,
    );
    assert.equal(
      result.files.find((file) => file.path === "a.ts")?.explanationStatus,
      "pending",
    );
    assert.equal(
      result.files.find((file) => file.path === "b.ts")?.explanationStatus,
      "ready",
    );
    await assert.rejects(
      readFile(path.join(temporary, "response-schema.json")),
      /ENOENT/,
    );
  } finally {
    release();
    await f.cleanup();
  }

  let startAbort!: () => void;
  const abortStarted = new Promise<void>((resolve) => {
    startAbort = resolve;
  });
  const stopped = await fixture(async (input) => {
    temporary = input.cwd;
    startAbort();
    await new Promise<void>((resolve) =>
      input.signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    throw new Error("Aborted");
  });
  try {
    const generating = stopped.workbench.explanations(stopped.run.id);
    await abortStarted;
    await stopped.workbench.shutdown();
    await generating;
    assert.equal(stopped.run.status, "review");
    assert.equal(stopped.run.explanations?.["a.ts"].status, "failed");
    await assert.rejects(
      readFile(path.join(temporary, "response-schema.json")),
      /ENOENT/,
    );
    await assert.rejects(
      stopped.workbench.explanations(stopped.run.id),
      /正在關閉/,
    );
  } finally {
    await stopped.cleanup();
  }
});

test("a request waiting for the run lock cannot start a new explanation agent after shutdown", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(async (input) => {
    calls++;
    return response(input.prompt);
  });
  try {
    const lock = f.workbench.lock(f.run.id, () => gate);
    const pending = f.workbench.explanations(f.run.id);
    await f.workbench.shutdown();
    release();
    await lock;
    await assert.rejects(pending, /正在關閉/);
    assert.equal(calls, 0);
  } finally {
    release();
    await f.cleanup();
  }
});
