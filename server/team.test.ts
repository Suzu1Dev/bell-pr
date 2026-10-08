import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  claimReadyTasks,
  consumeTeamInbox,
  hasTeamInbox,
  parseTeamPlan,
  reviewDiffContext,
  scopesOverlap,
  type TeamAgentRunner,
} from "./team.js";
import { git } from "./process.js";
import { readDiff } from "./git.js";
import { Workbench } from "./workbench.js";
import { Store } from "./store.js";
import type { DiffFile, Run } from "./types.js";
import type { AgentTeam, TeamTask } from "../shared/team.js";
import type { ContributionSettings } from "../shared/insights.js";
import { ProjectInsightsService } from "./insights.js";
import { AgentSlots } from "./agent-slots.js";

const settings: ContributionSettings = {
  direction: "feature",
  targetUser: "一般使用者",
  outcome: "一致的輸出",
  constraints: "保留 API",
  acceptance: "既有測試通过",
  maxTeammates: 2,
  requirePlanApproval: true,
};
const makePlan = (
  tasks: { id: string; files: string[]; dependsOn?: string[] }[],
) =>
  JSON.stringify({
    summary: "改善使用者輸出的一致性；先處理兩個獨立模組，再整合。",
    tasks: tasks.map((task) => ({
      title: task.id,
      description: `Implement ${task.id}`,
      dependsOn: [],
      ...task,
    })),
  });
async function waitUntil(
  predicate: () => boolean,
  message = "state transition",
) {
  const end = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${message}`);
    await delay(10);
  }
}

async function fixture(
  runner?: TeamAgentRunner,
  dependencies: { agentSlots?: AgentSlots } = {},
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-team-test-"));
  const repository = path.join(directory, "repo");
  await mkdir(repository);
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  for (const file of ["a.ts", "b.ts", "c.ts"])
    await writeFile(
      path.join(repository, file),
      `export const value = "${file}-before";\n`,
    );
  await git(repository, ["add", "--", "a.ts", "b.ts", "c.ts"]);
  await git(repository, ["commit", "-m", "initial"]);
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(
    store,
    runner
      ? async (input) => {
          if (input.role === "draft")
            return JSON.stringify({
              title: "Improve consistent output",
              body: "## Problem\n\nOutputs differ.\n\n## Changes\n\nAlign the output.\n\n## Validation\n\nStatic review only.\n\nDeveloped with AI assistance; human review is required.",
              policy: "linux",
              summary: "依 Linux 投稿寫作原則整理。",
              rules: [],
              checklist: ["確認測試證據。"],
              templateSourceId: "",
            });
          if (input.role === "explanations") {
            const files = JSON.parse(
              input.prompt
                .split("Provided diffs:\n")[1]
                .split("\n\nBELL Ponytail")[0],
            ) as { path: string }[];
            return JSON.stringify({
              files: files.map(({ path }) => ({
                path,
                summary: "調整輸出",
                reason: "一致性",
                concept: "單一責任",
                tip: "檢查呼叫處",
                example: {
                  scenario: "使用者查看模組提供的文字。",
                  before: "文字是各檔案原本的內容。",
                  after: "文字更新為這次任務指定的內容。",
                },
                alternatives: "也可以集中成一個常數；這次沒有，因為各模組獨立。",
                lookup: ["single source of truth"],
                selfCheck: {
                  question: "這次任務改了哪些文字？",
                  answer: "只改了各檔案輸出的字串內容。",
                },
              })),
            });
          }
          return runner(input);
        }
      : undefined,
    {
      getModelCatalog: async () => ({ models: [], source: "codex" }),
      ...dependencies,
    },
  );
  workbench.status = async () => ({
    codex: true,
    codexAuthenticated: true,
    github: false,
    claude: false,
    claudeAuthenticated: false,
  });
  const repo = await workbench.importRepository(repository);
  return {
    directory,
    repository,
    store,
    workbench,
    repo,
    cleanup: async () => {
      await workbench.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("team plans validate DAGs, concrete scopes, and preserve literal bracket filenames", () => {
  const parsed = parseTeamPlan(
    makePlan([
      { id: "route", files: ["src/[id].ts"] },
      { id: "docs", files: ["docs/"], dependsOn: ["route"] },
    ]),
    2,
  );
  assert.equal(parsed.tasks[0].owner, "member-1");
  assert.equal(parsed.tasks[1].status, "pending");
  assert.throws(
    () =>
      parseTeamPlan(
        makePlan([
          { id: "a", files: ["a.ts"], dependsOn: ["b"] },
          { id: "b", files: ["b.ts"], dependsOn: ["a"] },
        ]),
        2,
      ),
    /循環/,
  );
  assert.throws(
    () =>
      parseTeamPlan(
        makePlan([{ id: "a", files: ["a.ts"], dependsOn: ["missing"] }]),
        2,
      ),
    /依賴/,
  );
  for (const invalid of [
    "../outside",
    ".",
    "src/*",
    "/absolute",
    ".git/config",
    ".env",
    "src//file.ts",
  ])
    assert.throws(
      () => parseTeamPlan(makePlan([{ id: "a", files: [invalid] }]), 2),
      /範圍/,
    );
  assert.throws(() => parseTeamPlan("invented prose", 2), /JSON/);
});

test("shared scheduler enforces dependencies, file ownership locks, and member capacity", () => {
  const { tasks } = parseTeamPlan(
    makePlan([
      { id: "a", files: ["src/"] },
      { id: "b", files: ["src/a.ts"] },
      { id: "c", files: ["docs/"] },
      { id: "d", files: ["test.ts"], dependsOn: ["a"] },
    ]),
    4,
  );
  assert.equal(scopesOverlap(["src/"], ["src2/a.ts"]), false);
  assert.deepEqual(
    claimReadyTasks(tasks, 3).map((task) => task.id),
    ["a", "c"],
  );
  assert.deepEqual(claimReadyTasks(tasks, 3), []);
  tasks[0].status = "complete";
  assert.deepEqual(
    claimReadyTasks(tasks, 3).map((task) => task.id),
    ["b", "d"],
  );
  tasks[0].status = "failed";
  tasks[3].status = "pending";
  claimReadyTasks(tasks, 0);
  assert.equal(tasks[3].status, "blocked");
});

test("broadcast inbox delivery is persisted separately for each recipient", () => {
  const team: AgentTeam = {
    config: {
      maxTeammates: 2,
      requirePlanApproval: true,
      provider: "codex",
      protocol: "bell-shared-tasks",
      messageDelivery: "between-turns",
    },
    phase: "developing",
    planSummary: "plan",
    tasks: [],
    messages: [
      {
        id: "one",
        from: "user",
        to: "all",
        content: "Keep API",
        createdAt: new Date().toISOString(),
        status: "queued",
        recipients: ["lead", "member-1"],
        deliveredTo: [],
      },
    ],
  };
  assert.equal(consumeTeamInbox(team, "member-1").length, 1);
  assert.equal(team.messages[0].status, "queued");
  assert.equal(hasTeamInbox(team, "member-1"), false);
  assert.equal(hasTeamInbox(team, "lead"), true);
  consumeTeamInbox(team, "lead");
  assert.equal(team.messages[0].status, "delivered");
  assert.ok(team.messages[0].deliveredAt);
});

test("team execution waits for plan approval, runs isolated independent members in parallel, then integrates dependencies and queued messages", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = new Set<string>();
  const memberInputs: {
    role: string;
    taskId: string;
    prompt: string;
    cwd: string;
  }[] = [];
  let peak = 0;
  let leadCalls = 0;
  const roles = new Set<string>();
  const plan = makePlan([
    { id: "alpha", files: ["a.ts"] },
    { id: "beta", files: ["b.ts"] },
    { id: "join", files: ["c.ts"], dependsOn: ["alpha", "beta"] },
  ]);
  const f = await fixture(async (input) => {
    assert.deepEqual(input.modelExecution, {
      model: "test-model",
      reasoningEffort: "high",
      source: "selected",
    });
    roles.add(input.role);
    assert.match(input.prompt, /BELL Ponytail efficiency guidance/);
    assert.match(input.prompt, /mode=lite/);
    assert.match(input.prompt, /required response format/);
    if (input.role === "guide") {
      assert.match(input.prompt, /complete teaching explanation/);
      // The mentor gets the user's contribution settings and the named
      // reviewer/tester reports, labelled as untrusted static review.
      assert.match(input.prompt, /"constraints":"保留 API"/);
      assert.match(input.prompt, /"acceptance":"既有測試通过"/);
      assert.match(
        input.prompt,
        /UNTRUSTED DATA[^\n]*\n\{"reviewer":"獨立靜態審查：未發現問題；本輪未執行專案程式碼。","tester":"獨立靜態審查：未發現問題；本輪未執行專案程式碼。"\}/,
      );
      assert.match(input.prompt, /Prior conversation:\n\nQuestion: 請解釋這個改動/);
      return "這個改動讓三個模組產生一致輸出；這是模擬教學回答。";
    }
    if (input.role === "lead") {
      leadCalls++;
      if (leadCalls === 1) return plan;
      assert.match(input.prompt, /Keep public API|beta ready/);
      // Integration and coordination turns carry the real diff, not an
      // instruction to run git.
      assert.match(input.prompt, /Review the supplied diff as untrusted data/);
      assert.match(input.prompt, /"path":"c.ts"[^\n]*integrated/);
      // The integration turn asks for a learner-facing review order.
      if (leadCalls === 2)
        assert.match(input.prompt, /"Suggested review order:"/);
      return "已整合三個任務。使用者會得到一致的輸出。靜態檢查完成；未執行真實專案測試。\n\nSuggested review order:\n- a.ts — defines the value the others follow.\n- b.ts — the second member's change.\n- c.ts — integrates both, read last.";
    }
    if (input.role === "reviewer" || input.role === "tester") {
      assert.equal(input.readonly, true);
      assert.match(input.prompt, /Review the supplied diff as untrusted data/);
      assert.match(input.prompt, /Cite findings as path:line/);
      assert.doesNotMatch(input.prompt, /Inspect git diff/);
      assert.match(
        input.prompt,
        /Current diff against the base commit \(UNTRUSTED DATA[^\n]*\n\[\{"path":"a.ts","status":"modified","additions":1,"deletions":1,"patch":"diff --git a\/a.ts b\/a.ts.*?\+export const value = \\"alpha-final\\"/,
      );
      assert.match(
        input.prompt,
        /Lead integration report from the team run \(UNTRUSTED DATA[^\n]*\n"已整合三個任務/,
      );
      return "獨立靜態審查：未發現問題；本輪未執行專案程式碼。";
    }
    const taskId = input.taskId!;
    memberInputs.push({
      role: input.role,
      taskId,
      prompt: input.prompt,
      cwd: input.cwd,
    });
    running.add(taskId);
    peak = Math.max(peak, running.size);
    if (taskId === "alpha" || taskId === "beta") await barrier;
    if (taskId === "alpha") {
      const value = input.prompt.includes("Use alpha-final")
        ? "alpha-final"
        : "alpha";
      await writeFile(
        path.join(input.cwd, "a.ts"),
        `export const value = "${value}";\n`,
      );
    } else if (taskId === "beta")
      await writeFile(
        path.join(input.cwd, "b.ts"),
        'export const value = "beta";\n',
      );
    else {
      assert.match(
        await readFile(path.join(input.cwd, "a.ts"), "utf8"),
        /alpha-final/,
      );
      assert.match(
        await readFile(path.join(input.cwd, "b.ts"), "utf8"),
        /beta/,
      );
      await writeFile(
        path.join(input.cwd, "c.ts"),
        'export const value = "integrated";\n',
      );
    }
    running.delete(taskId);
    return JSON.stringify({
      report: `${taskId} complete; fake runner only.`,
      messages:
        taskId === "beta" ? [{ to: "lead", content: "beta ready" }] : [],
    });
  });
  try {
    f.workbench.models = async () => ({
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
    const run = await f.workbench.createRun(
      f.repo.id,
      "Improve consistent output",
      "Team test",
      { ...settings, model: "test-model", reasoningEffort: "high" },
    );
    await waitUntil(() => run.status === "awaiting_plan", "plan approval gate");
    assert.equal(leadCalls, 1);
    assert.equal(memberInputs.length, 0);
    assert.deepEqual(await readDiff(run), []);
    const reopened = new Store(f.store.directory);
    await waitUntil(() =>
      run.logs.some((log) => log.message.includes("等待你核准")),
    );
    await f.store.save();
    await reopened.initialize();
    assert.equal(reopened.data.runs[0].status, "awaiting_plan");
    assert.deepEqual(reopened.data.runs[0].modelExecution, run.modelExecution);
    // Repository preferences may change while this run waits for approval.
    await new ProjectInsightsService(f.store, {
      getModelCatalog: () => f.workbench.models(),
    }).setSettings(f.repo.id, {
      ...settings,
      model: "test-model",
      reasoningEffort: "low",
    });
    f.workbench.models = async () => ({
      source: "codex",
      models: [],
      error: "Catalog changed after the run started",
    });
    await f.workbench.sendTeamMessage(run.id, {
      to: "lead",
      content: "Keep public API",
    });
    await f.workbench.approvePlan(run.id);
    await waitUntil(() => running.size === 2, "parallel member barrier");
    assert.deepEqual(await readDiff(run), []);
    await f.workbench.sendTeamMessage(run.id, {
      to: "alpha",
      content: "Use alpha-final",
    });
    assert.equal(
      run.team!.messages.find((message) => message.to === "alpha")?.status,
      "queued",
    );
    release();
    await waitUntil(
      () =>
        run.status === "failed" ||
        (run.status === "review" &&
          Object.values(run.explanations ?? {}).length === 3 &&
          Object.values(run.explanations ?? {}).every(
            (entry) => entry.status === "ready",
          )),
      "team completion",
    );
    assert.equal(run.status, "review", run.error);
    assert.equal(peak, 2);
    assert.equal(
      memberInputs.filter((input) => input.taskId === "alpha").length,
      2,
    );
    assert.equal(new Set(memberInputs.map((input) => input.cwd)).size, 3);
    assert.ok(run.team!.tasks.every((task) => task.status === "complete"));
    assert.ok(
      run.team!.messages.every((message) => message.status === "delivered"),
    );
    assert.deepEqual(
      (await readDiff(run)).map((file) => file.path),
      ["a.ts", "b.ts", "c.ts"],
    );
    assert.match(
      await readFile(path.join(f.repository, "a.ts"), "utf8"),
      /before/,
    );
    assert.equal(
      (await git(run.worktreePath, ["rev-parse", "HEAD"])).stdout.trim(),
      run.baseSha,
    );
    assert.equal(run.approvedFingerprint, undefined);
    assert.equal(run.prUrl, undefined);
    assert.match(
      await f.workbench.chat(run.id, "a.ts", "請解釋這個改動"),
      /一致輸出/,
    );
    assert.ok(
      ["lead", "member-1", "member-2", "reviewer", "tester", "guide"].every(
        (role) => roles.has(role),
      ),
    );
    assert.equal(run.efficiency?.calls, 11);
    assert.equal(run.efficiency?.completedCalls, 11);
    assert.equal(run.efficiency?.measuredCalls, 0);
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(f.store.directory, "state.json"), "utf8"),
      ).runs[0].efficiency,
      run.efficiency,
    );
    await assert.rejects(f.workbench.approvePlan(run.id), /沒有等待/);
  } finally {
    release();
    await f.cleanup();
  }
});

test("out-of-scope member edits are retained in isolation and never enter the review workspace", async () => {
  const f = await fixture(async (input) => {
    if (input.role === "lead")
      return makePlan([{ id: "alpha", files: ["a.ts"] }]);
    await writeFile(
      path.join(input.cwd, "a.ts"),
      'export const value = "allowed";\n',
    );
    await writeFile(
      path.join(input.cwd, "b.ts"),
      'export const value = "not-owned";\n',
    );
    return "Changed both files";
  });
  try {
    const run = await f.workbench.createRun(
      f.repo.id,
      "Improve a only",
      undefined,
      { ...settings, requirePlanApproval: false },
    );
    await waitUntil(() => run.status === "failed", "ownership rejection");
    assert.match(run.error!, /未分配的檔案 b.ts/);
    assert.deepEqual(await readDiff(run), []);
    assert.equal(run.team!.tasks[0].status, "failed");
    assert.match(
      await readFile(
        path.join(run.team!.tasks[0].worktreePath!, "b.ts"),
        "utf8",
      ),
      /not-owned/,
    );
  } finally {
    await f.cleanup();
  }
});

test("cancellation waits for active teammates to exit and returns their final persisted states", async () => {
  let started = false;
  let sawAbort = false;
  let releaseExit!: () => void;
  const exitGate = new Promise<void>((resolve) => {
    releaseExit = resolve;
  });
  const f = await fixture(async (input) => {
    if (input.role === "lead")
      return makePlan([{ id: "alpha", files: ["a.ts"] }]);
    started = true;
    await new Promise<void>((resolve) => {
      if (input.signal.aborted) resolve();
      else
        input.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    sawAbort = true;
    await exitGate;
    throw new Error("cancelled");
  });
  try {
    const run = await f.workbench.createRun(f.repo.id, "Improve a", undefined, {
      ...settings,
      requirePlanApproval: false,
    });
    await waitUntil(() => started);
    let returned = false;
    const cancelling = f.workbench.cancel(run.id).then((result) => {
      returned = true;
      return result;
    });
    await waitUntil(() => sawAbort);
    await delay(40);
    assert.equal(
      returned,
      false,
      "Cancellation must wait for the member's actual exit",
    );
    releaseExit();
    const stopped = await cancelling;
    assert.equal(stopped.status, "cancelled");
    assert.equal(stopped.team!.phase, "cancelled");
    assert.equal(stopped.team!.tasks[0].status, "failed");
    assert.ok(stopped.agents.every((agent) => agent.status !== "running"));
    const persisted = JSON.parse(
      await readFile(path.join(f.store.directory, "state.json"), "utf8"),
    );
    assert.equal(persisted.runs[0].team.tasks[0].status, "failed");
    assert.deepEqual(await readDiff(run), []);
  } finally {
    releaseExit();
    await f.cleanup();
  }
});

test("dependency snapshots preserve added and deleted files and allow later owners to update predecessor output", async () => {
  let leadCalls = 0;
  const f = await fixture(async (input) => {
    if (input.role === "lead")
      return leadCalls++ === 0
        ? makePlan([
            { id: "first", files: ["docs/", "a.ts"] },
            { id: "next", files: ["docs/"], dependsOn: ["first"] },
          ])
        : "整合完成。";
    if (input.taskId === "first") {
      await mkdir(path.join(input.cwd, "docs"));
      await writeFile(
        path.join(input.cwd, "docs", "new guide.md"),
        "Initial guide\n",
      );
      await rm(path.join(input.cwd, "a.ts"));
    } else if (input.taskId === "next") {
      assert.match(
        await readFile(path.join(input.cwd, "docs", "new guide.md"), "utf8"),
        /Initial/,
      );
      await assert.rejects(readFile(path.join(input.cwd, "a.ts")), /ENOENT/);
      await writeFile(
        path.join(input.cwd, "docs", "new guide.md"),
        "Final guide\n",
      );
    }
    return "Completed; no real agent checks executed.";
  });
  try {
    const run = await f.workbench.createRun(
      f.repo.id,
      "Update guide",
      undefined,
      { ...settings, requirePlanApproval: false },
    );
    await waitUntil(() => ["review", "failed"].includes(run.status));
    assert.equal(run.status, "review", run.error);
    assert.deepEqual(
      (await readDiff(run)).map(({ path, status }) => ({ path, status })),
      [
        { path: "a.ts", status: "deleted" },
        { path: "docs/new guide.md", status: "added" },
      ],
    );
    assert.match(
      await readFile(
        path.join(run.worktreePath, "docs", "new guide.md"),
        "utf8",
      ),
      /Final/,
    );
    assert.match(
      await readFile(path.join(f.repository, "a.ts"), "utf8"),
      /before/,
    );
  } finally {
    await f.cleanup();
  }
});

test("cancellation while a completed member waits for integration prevents its patch from being applied", async () => {
  let integrationWaiting = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(async (input) => {
    if (input.role === "lead")
      return makePlan([{ id: "alpha", files: ["a.ts"] }]);
    await writeFile(
      path.join(input.cwd, "a.ts"),
      'export const value = "unintegrated";\n',
    );
    return "Completed scoped change";
  });
  const originalLock = f.workbench.lock.bind(f.workbench);
  let integrationLocks = 0;
  f.workbench.lock = async <T>(
    id: string,
    task: () => Promise<T>,
  ): Promise<T> => {
    if (id.startsWith("integration:") && ++integrationLocks === 2) {
      integrationWaiting = true;
      await gate;
    }
    return originalLock(id, task);
  };
  try {
    const run = await f.workbench.createRun(f.repo.id, "Improve a", undefined, {
      ...settings,
      requirePlanApproval: false,
    });
    await waitUntil(() => integrationWaiting);
    const cancelling = f.workbench.cancel(run.id);
    release();
    await cancelling;
    assert.equal(run.team!.tasks[0].status, "failed");
    assert.equal(run.status, "cancelled");
    assert.deepEqual(await readDiff(run), []);
    assert.match(
      await readFile(
        path.join(run.team!.tasks[0].worktreePath!, "a.ts"),
        "utf8",
      ),
      /unintegrated/,
    );
  } finally {
    release();
    await f.cleanup();
  }
});

test("terminal Codex turn.failed rejects earlier agent text even when the CLI exits successfully", async () => {
  const f = await fixture();
  const previousPath = process.env.PATH;
  try {
    const bin = path.join(f.directory, "fake-bin");
    await mkdir(bin);
    const plan = makePlan([{ id: "alpha", files: ["a.ts"] }]);
    const events = [
      { type: "item.completed", item: { type: "agent_message", text: plan } },
      {
        type: "turn.completed",
        usage: {
          input_tokens: 120,
          cached_input_tokens: 90,
          output_tokens: 15,
        },
      },
      {
        type: "turn.failed",
        error: { message: "Simulated terminal provider failure" },
      },
    ];
    // Local stand-in only: the real Codex executable is never invoked.
    await writeFile(
      path.join(bin, "codex"),
      `#!/usr/bin/env node\nfor (const event of ${JSON.stringify(events)}) process.stdout.write(JSON.stringify(event) + "\\n");\n`,
      { mode: 0o700 },
    );
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    const run = await f.workbench.createRun(
      f.repo.id,
      "Improve a",
      undefined,
      settings,
    );
    await waitUntil(() => ["failed", "awaiting_plan"].includes(run.status));
    assert.equal(run.status, "failed");
    assert.match(run.error!, /terminal provider failure/);
    assert.equal(run.team!.tasks.length, 0);
    assert.equal(run.efficiency?.calls, 1);
    assert.equal(run.efficiency?.failedCalls, 1);
    assert.equal(run.efficiency?.measuredCalls, 1);
    assert.equal(run.efficiency?.inputTokens, 120);
    assert.equal(run.efficiency?.cachedInputTokens, 90);
    assert.equal(run.efficiency?.outputTokens, 15);
    assert.deepEqual(await readDiff(run), []);
  } finally {
    await f.workbench.shutdown();
    process.env.PATH = previousPath;
    await f.cleanup();
  }
});

test("cancelling a queued run does not wait for or abort other active runs", async () => {
  const started = new Set<string>();
  const f = await fixture(async (input) => {
    started.add(input.cwd);
    await new Promise<void>((_, reject) => {
      if (input.signal.aborted) reject(new Error("cancelled"));
      else
        input.signal.addEventListener(
          "abort",
          () => reject(new Error("cancelled")),
          { once: true },
        );
    });
    return "unreachable";
  });
  try {
    const first = await f.workbench.createRun(
      f.repo.id,
      "First active job",
      undefined,
      settings,
    );
    const second = await f.workbench.createRun(
      f.repo.id,
      "Second active job",
      undefined,
      settings,
    );
    await waitUntil(() => started.size === 2);
    const queued = await f.workbench.createRun(
      f.repo.id,
      "Queued job only",
      undefined,
      settings,
    );
    assert.equal(queued.status, "queued");
    const stopped = await Promise.race([
      f.workbench.cancel(queued.id),
      delay(1500).then(() => {
        throw new Error("Queued cancellation waited for unrelated workers");
      }),
    ]);
    assert.equal(stopped.status, "cancelled");
    assert.equal(stopped.baseSha, "");
    assert.equal(first.status, "running");
    assert.equal(second.status, "running");
    await f.workbench.cancel(first.id);
    assert.equal(first.efficiency?.calls, 1);
    assert.equal(first.efficiency?.failedCalls, 1);
    assert.equal(first.efficiency?.measuredCalls, 0);
  } finally {
    await f.cleanup();
  }
});

test("cancelling a paused plan completes without starting any teammate", async () => {
  let memberCalls = 0;
  const f = await fixture(async (input) => {
    if (input.role !== "lead") memberCalls++;
    return makePlan([{ id: "alpha", files: ["a.ts"] }]);
  });
  try {
    const run = await f.workbench.createRun(
      f.repo.id,
      "Plan before editing",
      undefined,
      settings,
    );
    await waitUntil(() => run.status === "awaiting_plan");
    const stopped = await f.workbench.cancel(run.id);
    assert.equal(stopped.status, "cancelled");
    assert.equal(stopped.team!.phase, "cancelled");
    assert.equal(memberCalls, 0);
    assert.deepEqual(await readDiff(stopped), []);
    await assert.rejects(f.workbench.approvePlan(run.id), /沒有等待/);
  } finally {
    await f.cleanup();
  }
});

test("shared agent slots bound simultaneous CLI invocations across teammates while every task completes", async () => {
  const slots = new AgentSlots(2);
  const running = new Set<string>();
  let peak = 0;
  let leadCalls = 0;
  let saturated = false;
  const files: Record<string, string> = {
    alpha: "a.ts",
    beta: "b.ts",
    gamma: "c.ts",
    delta: "d.ts",
  };
  const plan = makePlan(
    Object.entries(files).map(([id, file]) => ({ id, files: [file] })),
  );
  const f = await fixture(
    async (input) => {
      if (input.role === "lead") {
        leadCalls++;
        return leadCalls === 1 ? plan : "已整合四個任務。靜態檢查完成。";
      }
      if (input.role === "reviewer" || input.role === "tester")
        return "獨立靜態審查：未發現問題。";
      const taskId = input.taskId!;
      running.add(taskId);
      peak = Math.max(peak, running.size);
      // Hold the first pair until the other two members are queued for a slot.
      await waitUntil(() => {
        saturated ||= running.size + slots.waiting === 4;
        return saturated;
      }, "queued teammates");
      await writeFile(
        path.join(input.cwd, files[taskId]),
        `export const value = "${taskId}";\n`,
      );
      running.delete(taskId);
      return JSON.stringify({
        report: `${taskId} complete; fake runner only.`,
        messages: [],
      });
    },
    { agentSlots: slots },
  );
  try {
    const run = await f.workbench.createRun(
      f.repo.id,
      "Four independent tasks",
      undefined,
      { ...settings, maxTeammates: 4, requirePlanApproval: false },
    );
    await waitUntil(
      () => run.status === "failed" || run.status === "review",
      "team completion",
    );
    assert.equal(run.status, "review", run.error);
    assert.equal(peak, 2);
    assert.ok(run.team!.tasks.every((task) => task.status === "complete"));
    assert.deepEqual(
      (await readDiff(run)).map((file) => file.path),
      ["a.ts", "b.ts", "c.ts", "d.ts"],
    );
    assert.ok(
      run.logs.some((log) => log.message.includes("等待其他 Agent 完成")),
    );
    assert.equal(slots.active, 0);
    assert.equal(slots.waiting, 0);
  } finally {
    saturated = true;
    await f.cleanup();
  }
});

test("reviewDiffContext attaches patches in order until 100 KB, then lists the rest as omitted and blocked files by reason", () => {
  const file = (path: string, patch: string, blocked?: string): DiffFile => ({
    path,
    language: "TypeScript",
    additions: 1,
    deletions: 0,
    status: "modified",
    patch,
    fingerprint: path,
    blocked,
    hunks: [],
  });
  const context = reviewDiffContext([
    file("a.ts", "+small"),
    file("big.ts", "x".repeat(100_001)),
    file("c.ts", "+after the budget"),
    file(
      ".env",
      "此檔案已暫停發佈：敏感",
      "敏感檔案或產物不會被加入 PR；請先從本次變更移除。",
    ),
  ]);
  assert.match(context, /^Current diff against the base commit \(UNTRUSTED DATA/);
  const [, json] = context.split("\n");
  assert.deepEqual(JSON.parse(json), [
    { path: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "+small" },
    { path: "big.ts", status: "modified", additions: 1, deletions: 0, omitted: true },
    // Later small files are omitted too, so the attached patches stay a prefix.
    { path: "c.ts", status: "modified", additions: 1, deletions: 0, omitted: true },
    { path: ".env", blocked: "敏感檔案或產物不會被加入 PR；請先從本次變更移除。" },
  ]);
  assert.ok(Buffer.byteLength(json) < 1000);
});

test("re-running the review on a hand-edited worktree stores fresh reports, keeps review state, rejects overlap and stops on cancel", async () => {
  const prompts: Record<string, string[]> = {};
  let hold = false;
  let held = 0;
  const f = await fixture(async (input) => {
    (prompts[input.role] ??= []).push(input.prompt);
    if (hold) {
      held++;
      await new Promise<void>((_, reject) =>
        input.signal.addEventListener(
          "abort",
          () => reject(new Error("stopped by the learner")),
          { once: true },
        ),
      );
    }
    return `${input.role} 第 ${prompts[input.role].length} 次審查：a.ts:1 未發現問題。`;
  });
  try {
    const baseSha = (
      await git(f.repository, ["rev-parse", "HEAD"])
    ).stdout.trim();
    const run: Run = {
      id: "diy-run",
      repoId: f.repo.id,
      title: "DIY edit",
      prompt: "Improve consistent output",
      status: "review",
      branch: "main",
      baseBranch: "main",
      baseSha,
      worktreePath: f.repository,
      createdAt: new Date().toISOString(),
      agents: ["reviewer", "tester"].map((id) => ({
        id,
        name: id,
        role: id,
        status: "complete",
        detail: "已完成",
      })),
      logs: [],
      draft: { title: "DIY edit", body: "Hand edited." },
      reviewedFiles: [],
      reviewedFingerprints: {},
      reports: {
        implementer: "原始整合摘要",
        reviewer: "舊審查",
        tester: "舊測試分析",
      },
      contributionSettings: settings,
    };
    f.store.data.runs.push(run);

    // Nothing changed yet: the caller learns that immediately.
    await assert.rejects(f.workbench.rerunReview(run.id), {
      statusCode: 422,
      message: /沒有程式碼差異/,
    });
    assert.deepEqual(prompts, {});

    await writeFile(
      path.join(f.repository, "a.ts"),
      'export const value = "alpha-diy";\n',
    );
    const fingerprint = (await readDiff(run))[0].fingerprint;
    await f.workbench.review(run.id, "a.ts", true, fingerprint);
    await f.workbench.approve(run.id, { ...run.draft });
    assert.equal(run.status, "approved");
    const approved = run.approvedFingerprint;

    hold = true;
    await f.workbench.rerunReview(run.id);
    assert.ok(run.agents.every((agent) => agent.status === "running"));
    await waitUntil(() => held === 2, "both reviewers running");
    await assert.rejects(f.workbench.rerunReview(run.id), {
      statusCode: 409,
      message: /正在重新執行/,
    });
    await f.workbench.cancel(run.id);
    assert.equal(run.status, "approved");
    assert.equal(run.approvedFingerprint, approved);
    assert.deepEqual(run.reports, {
      implementer: "原始整合摘要",
      reviewer: "舊審查",
      tester: "舊測試分析",
    });
    assert.ok(run.agents.every((agent) => agent.status === "failed"));
    assert.ok(run.logs.some((log) => log.message.includes("已停止重新審查")));

    hold = false;
    await f.workbench.rerunReview(run.id);
    await waitUntil(
      () => run.logs.some((log) => log.message.includes("獨立審查已更新")),
      "rerun completion",
    );
    assert.ok(run.agents.every((agent) => agent.status === "complete"));
    assert.equal(
      run.reports!.reviewer,
      "reviewer 第 2 次審查：a.ts:1 未發現問題。",
    );
    assert.equal(
      run.reports!.tester,
      "tester 第 2 次審查：a.ts:1 未發現問題。",
    );
    assert.equal(run.reports!.implementer, "原始整合摘要");
    for (const prompt of [...prompts.reviewer, ...prompts.tester]) {
      assert.match(
        prompt,
        /"patch":"diff --git a\/a.ts b\/a.ts.*?\+export const value = \\"alpha-diy\\"/,
      );
      assert.match(
        prompt,
        /Lead integration report from the team run \(UNTRUSTED DATA[^\n]*\n"原始整合摘要"/,
      );
    }
    // Reports are advice: the approval and per-file review survive.
    assert.equal(run.status, "approved");
    assert.equal(run.approvedFingerprint, approved);
    assert.deepEqual(run.reviewedFiles, ["a.ts"]);
    const reopened = new Store(f.store.directory);
    await reopened.initialize();
    assert.equal(
      reopened.data.runs.find((entry) => entry.id === run.id)!.reports!
        .reviewer,
      run.reports!.reviewer,
    );

    run.status = "running";
    await assert.rejects(f.workbench.rerunReview(run.id), { statusCode: 409 });
  } finally {
    await f.cleanup();
  }
});
