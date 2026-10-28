import test, { before, after } from "node:test";
import { skipUnderstandingCheckInTests } from "./understanding.js";
before(() => skipUnderstandingCheckInTests(true));
after(() => skipUnderstandingCheckInTests());
process.env.BELLPR_LOCALE = "zh-TW";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git } from "./process.js";
import { draftFingerprint } from "./drafts.js";
import { readDiff } from "./git.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import {
  parseSessionResult,
  sessionPrompt,
  sessionReport,
  sessionJsonSchema,
  limitationsLimit,
} from "./session.js";
import type { TeamAgentRunner } from "./team.js";
import { AppError, type Run } from "./types.js";
import { createApp } from "./app.js";
import type { SessionMessage } from "../shared/session.js";

/**
 * An unpublished run in a real repository; the agent is whatever `runner` does,
 * or, with `dependencies`, the CLI calls it makes (so command events are real).
 */
async function sessionFixture(
  runner: TeamAgentRunner | undefined,
  dependencies?: (
    baseSha: string,
  ) => ConstructorParameters<typeof Workbench>[2],
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-session-test-"));
  const repository = path.join(directory, "repo");
  await mkdir(repository);
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(
    path.join(repository, "hello.ts"),
    'export const hello = "before";\n',
  );
  await git(repository, ["add", "hello.ts"]);
  await git(repository, ["commit", "-m", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store, runner, dependencies?.(baseSha));
  const repo = await workbench.importRepository(repository);
  const run: Run = {
    id: "session-run",
    repoId: repo.id,
    title: "Update greeting",
    prompt: "Update greeting",
    status: "review",
    locale: "zh-TW",
    branch: "main",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: { title: "Update greeting", body: "Updates the greeting." },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  store.data.runs.push(run);
  return {
    workbench,
    run,
    repository,
    baseSha,
    // Waits for the background refresh a changed turn starts, then removes the checkout.
    cleanup: async () => {
      await workbench.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** Yields to the event loop until the background turn has finished; a hang is ended by the test runner's timeout. */
async function turnEnded(run: Run) {
  while (run.session?.running !== false)
    await new Promise((resolve) => setImmediate(resolve));
}

/** Promise.withResolvers, which the project's TypeScript lib does not declare yet. */
function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const reply = (extra: object = {}) =>
  JSON.stringify({
    reply: "完成。",
    questions: [],
    notRun: [],
    setup: [],
    ...extra,
  });

test("a session turn that edits files records the change, undoes agent commits and withdraws a stale approval", async () => {
  const f = await sessionFixture(async (input) => {
    if (input.role !== "session")
      throw new Error("only the session turn is under test");
    await writeFile(
      path.join(input.cwd, "hello.ts"),
      'export const hello = "after";\n',
    );
    // Despite the boundaries: the agent commits.
    await git(input.cwd, ["commit", "-qam", "agent commit"]);
    return reply({
      reply: "已更新 hello.ts。",
      questions: ["要同時支援英文嗎？"],
      notRun: [{ check: "npm test", reason: "專案沒有 package.json" }],
    });
  });
  try {
    f.run.status = "approved";
    f.run.approvedFingerprint = "a".repeat(64);
    await f.workbench.startSession(f.run.id, "  請修正問候文字  ");
    await turnEnded(f.run);
    const session = f.run.session!;
    assert.deepEqual(
      session.messages.map((message) => message.role),
      ["user", "agent"],
    );
    assert.equal(session.messages[0].content, "請修正問候文字");
    const agent = session.messages[1];
    assert.deepEqual(agent.changedFiles, ["hello.ts"]);
    assert.deepEqual(agent.questions, ["要同時支援英文嗎？"]);
    assert.equal(agent.notRun?.[0].check, "npm test");
    assert.equal(session.revision, 1);
    assert.equal(session.startedAt, undefined);
    // The branch is back on the reviewed base; the edit is an uncommitted change.
    assert.equal(
      (await git(f.repository, ["rev-parse", "HEAD"])).stdout.trim(),
      f.baseSha,
    );
    assert.equal((await readDiff(f.run)).length, 1);
    // The edit invalidated the approval, so the person reviews the new diff.
    assert.equal(f.run.status, "review");
    assert.equal(f.run.approvedFingerprint, undefined);
    // The PR draft reads the session from its messages, so no copy of the raw JSON answer is kept.
    assert.equal(f.run.reports?.session, undefined);
    assert.match(sessionReport(session.messages), /hello\.ts/);
    assert.match(sessionReport(session.messages), /請修正問候文字/);
  } finally {
    await f.cleanup();
  }
});

test("a turn that changes nothing keeps the approval and the diff revision", async () => {
  const f = await sessionFixture(async () =>
    reply({ reply: "程式碼不需要修改。" }),
  );
  try {
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    await f.workbench.review(
      f.run.id,
      "hello.ts",
      true,
      (await readDiff(f.run))[0].fingerprint,
    );
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    const approved = f.run.approvedFingerprint;
    assert.ok(approved);
    await f.workbench.startSession(f.run.id, "這樣的修改還需要補什麼嗎？");
    await turnEnded(f.run);
    assert.equal(f.run.status, "approved");
    assert.equal(f.run.approvedFingerprint, approved);
    assert.equal(f.run.session!.revision, 0);
    assert.equal(f.run.session!.messages[1].changedFiles, undefined);
  } finally {
    await f.cleanup();
  }
});

test("a failed turn keeps the edits it made and says so", async () => {
  const f = await sessionFixture(async (input) => {
    await writeFile(
      path.join(input.cwd, "hello.ts"),
      'export const hello = "half";\n',
    );
    throw new AppError("codex 執行逾時。", 504);
  });
  try {
    await f.workbench.startSession(f.run.id, "修正問候文字");
    await turnEnded(f.run);
    const failed = f.run.session!.messages[1];
    assert.equal(failed.failed, true);
    assert.deepEqual(failed.changedFiles, ["hello.ts"]);
    assert.match(failed.content, /逾時.*已改到的檔案保留/);
    assert.equal(f.run.session!.revision, 1);
    assert.equal(
      f.run.agents.find((agent) => agent.id === "session")!.status,
      "failed",
    );
  } finally {
    await f.cleanup();
  }
});

test("while a turn runs, other edits and publishing are refused and the person can stop it", async () => {
  const entered = gate<void>();
  const f = await sessionFixture(async (input) => {
    entered.resolve();
    const stopped = gate<string>();
    input.signal.addEventListener("abort", () =>
      stopped.reject(new Error("stopped")),
    );
    return stopped.promise;
  });
  const conflict = (pattern: RegExp) => (error: AppError) =>
    error.statusCode === 409 && pattern.test(error.message);
  try {
    f.run.status = "approved";
    f.run.approvedFingerprint = "b".repeat(64);
    await f.workbench.startSession(f.run.id, "補測試");
    await entered.promise;
    assert.equal(f.run.session!.running, true);
    assert.ok(f.run.session!.startedAt);
    await assert.rejects(
      f.workbench.startSession(f.run.id, "再一則"),
      conflict(/Agent 或審查在進行/),
    );
    await assert.rejects(
      f.workbench.draft(f.run.id, { ...f.run.draft, title: "Other" }),
      conflict(/Agent 正在修改程式碼/),
    );
    await assert.rejects(
      f.workbench.approve(f.run.id, { ...f.run.draft }),
      conflict(/Agent 正在修改程式碼/),
    );
    await assert.rejects(
      f.workbench.publish(f.run.id, "b".repeat(64)),
      conflict(/Agent 正在修改程式碼/),
    );
    await assert.rejects(
      f.workbench.rerunReview(f.run.id),
      conflict(/Agent 正在修改程式碼/),
    );
    await assert.rejects(
      f.workbench.split(f.run.id, { contributions: [] }),
      conflict(/Agent 正在修改程式碼/),
    );
    await assert.rejects(
      f.workbench.removeWorkspace(f.run.id),
      (error: AppError) => error.statusCode === 409,
    );
    await assert.rejects(
      f.workbench.removeRun(f.run.id),
      (error: AppError) => error.statusCode === 409,
    );
    await assert.rejects(
      f.workbench.syncRun(f.run.id),
      (error: AppError) => error.statusCode === 409,
    );
    await assert.rejects(
      f.workbench.saveNote(f.run.id, "hello.ts", "A note"),
      conflict(/Agent 正在修改程式碼/),
    );
    await assert.rejects(
      f.workbench.contribution.saveTestReasons(f.run.id, {}),
      conflict(/Agent 正在修改程式碼/),
    );
    await f.workbench.cancel(f.run.id);
    assert.equal(f.run.session!.running, false);
    const stopped = f.run.session!.messages.at(-1)!;
    assert.equal(stopped.failed, true);
    assert.match(stopped.content, /已停止/);
    // Nothing is running any more, so there is nothing to stop.
    await assert.rejects(
      f.workbench.cancelSession(f.run.id),
      conflict(/沒有進行中/),
    );
  } finally {
    await f.cleanup();
  }
});

test("a session needs an unpublished finished run and a message", async () => {
  const f = await sessionFixture(async () => reply());
  try {
    await assert.rejects(
      f.workbench.startSession(f.run.id, "   "),
      (error: AppError) => error.statusCode === 422,
    );
    f.run.status = "published";
    await assert.rejects(
      f.workbench.startSession(f.run.id, "補測試"),
      (error: AppError) =>
        error.statusCode === 409 && /依 review 修正/.test(error.message),
    );
    assert.equal(f.run.session, undefined);
  } finally {
    await f.cleanup();
  }
});

test("an answer that is not the requested JSON is shown as the reply instead of discarding the turn", () => {
  assert.deepEqual(
    parseSessionResult("```json\n" + reply({ reply: " 好 " }) + "\n```"),
    {
      reply: "好",
      questions: [],
      notRun: [],
      setup: [],
      limitations: "",
      validation: "",
    },
  );
  assert.equal(
    parseSessionResult("我改好了，但沒有照格式回答。").reply,
    "我改好了，但沒有照格式回答。",
  );
  const parsed = parseSessionResult(
    reply({
      questions: ["", "需要 API key 嗎？"],
      notRun: [
        { check: "e2e", reason: "" },
        { check: "lint", reason: "沒有設定" },
      ],
    }),
  );
  assert.deepEqual(parsed.questions, ["需要 API key 嗎？"]);
  assert.deepEqual(parsed.notRun, [{ check: "lint", reason: "沒有設定" }]);
});

test("a turn with more commands than fit is shortened, never dropped, and says what was left out", () => {
  // Shaped like the saved rv32emu turn: 40 recorded commands of about 170 characters
  // (over 6,900 in all), two failures among them, and the files that turn changed.
  const checks = Array.from({ length: 40 }, (_, index) => ({
    command: `L=/tmp/check.XXXX/logs; step-${index} ${"x".repeat(150)}`,
    outcome: index === 7 || index === 12 ? "exit 2" : "exit 0",
  }));
  const report = sessionReport([
    { id: "u", role: "user", content: "把 Limitations 的檢查補完", at: "t0" },
    {
      id: "a",
      role: "agent",
      content: "完成",
      at: "turn-1",
      changedFiles: [
        "tests/cache/cache-multi.expect",
        "tests/cache/test-cache.c",
      ],
      checks,
      notRun: [{ check: "macOS job", reason: "沒有 macOS" }],
    },
  ]);
  assert.ok(report.length <= 5_500);
  // The newest turn is there with its files, its latest command and both failures.
  assert.match(report, /turn-1/);
  assert.match(report, /tests\/cache\/test-cache\.c/);
  assert.match(report, /step-39 .* -> exit 0/);
  assert.match(report, /step-7 .* -> exit 2/);
  assert.match(report, /step-12 .* -> exit 2/);
  assert.match(report, /macOS job/);
  // And it says plainly that commands were left out, instead of looking complete.
  const omitted = report.match(
    /\((\d+) of 40 commands left out for length: 0 unsuccessful, (\d+) exit 0\)/,
  );
  assert.ok(omitted, report);
  assert.equal(Number(omitted[1]), Number(omitted[2]));
  assert.ok(Number(omitted[1]) > 0 && Number(omitted[1]) < 40);
  // An older turn gets what remains instead of pushing the newest one out.
  const two = sessionReport([
    {
      id: "a1",
      role: "agent",
      content: "x",
      at: "turn-old",
      checks: [{ command: "old-check", outcome: "exit 0" }],
    },
    { id: "a2", role: "agent", content: "y", at: "turn-new", checks },
  ]);
  assert.ok(two.length <= 5_500);
  assert.match(two, /turn-new/);
});

test("the draft report keeps the newest turns within its budget and flags that older results may be stale", () => {
  const messages: SessionMessage[] = [];
  for (let turn = 1; turn <= 40; turn++)
    messages.push(
      { id: `u${turn}`, role: "user", content: `request ${turn}`, at: "t" },
      {
        id: `a${turn}`,
        role: "agent",
        content: "done",
        at: `turn-${turn}`,
        changedFiles: ["src/a-long-path-to-a-file.ts"],
        checks: [{ command: "npm test -- --runInBand", outcome: "exit 0" }],
      },
    );
  const report = sessionReport(messages);
  assert.ok(report.length <= 5_500);
  assert.match(report, /turn-40/);
  assert.doesNotMatch(report, /turn-1\b/);
  assert.match(report, /may predate later edits/);
  assert.match(report, /npm test -- --runInBand -> exit 0/);
});

test("the prompt carries the person's message and earlier turns as data and forbids publishing", () => {
  const prompt = sessionPrompt({
    boundaries: "Never push, publish, open PRs.",
    contributionContext: "User request:\nUpdate greeting",
    baseBranch: "main",
    draft: {
      title: "T",
      body: "## Validation\nNo checks yet.\n\n## Limitations\nnpm test was not run.",
    },
    changedFiles: [
      { path: "hello.ts", status: "modified", additions: 1, deletions: 1 },
    ],
    reports: { tester: "claims" },
    history: [
      {
        id: "1",
        role: "agent",
        content: "要用哪個版本？",
        at: "t",
        questions: ["Node 版本？"],
      },
    ],
    message: "用 Node 22，並跑測試。",
  });
  assert.match(prompt, /Never push, publish/);
  assert.match(prompt, /"personsMessage":"用 Node 22，並跑測試。"/);
  assert.match(prompt, /"questionsAsked":\["Node 版本？"\]/);
  assert.match(
    prompt,
    /"currentLimitations":"## Limitations\\nnpm test was not run\."/,
  );
  assert.match(
    prompt,
    /the only PR text you may change is the body of its existing, separate Validation and Limitations sections/,
  );
});

test("a turn updates Validation and Limitations together, withdraws approval and preserves Problem and Changes", async () => {
  const f = await sessionFixture(async () =>
    reply({
      reply: "依前一輪記錄更新驗證狀態；macOS 仍未執行。",
      validation:
        "- `make check` exited 0 under `defconfig`; the recorded scope was the local test target.",
      limitations: "- Not run: the macOS job.",
    }),
  );
  try {
    f.run.draft.body =
      "## Problem\nThe greeting is unclear.\n\n## Changes\nUpdates the greeting.\n\n## Validation\n- `make check` was not run.\n\n## Limitations\n- `make check` was not run.\n- Not run: the macOS job.\n\n## Notes\nNone.";
    f.run.session = {
      messages: [
        {
          id: "earlier",
          role: "agent",
          content: "Ran the local test target under defconfig.",
          at: "t",
          checks: [{ command: "make check", outcome: "exit 0" }],
        },
      ],
      revision: 0,
      updatedAt: "t",
    };
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    await f.workbench.review(
      f.run.id,
      "hello.ts",
      true,
      (await readDiff(f.run))[0].fingerprint,
    );
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    assert.equal(f.run.status, "approved");
    await f.workbench.startSession(f.run.id, "把 Limitations 的檢查補完");
    await turnEnded(f.run);
    // The turn edited no file, so only the PR text can have withdrawn the approval.
    assert.equal(f.run.session!.revision, 0);
    assert.equal(
      f.run.draft.body,
      "## Problem\nThe greeting is unclear.\n\n## Changes\nUpdates the greeting.\n\n## Validation\n- `make check` exited 0 under `defconfig`; the recorded scope was the local test target.\n\n## Limitations\n- Not run: the macOS job.\n\n## Notes\nNone.",
    );
    assert.equal(f.run.status, "review");
    assert.equal(f.run.approvedFingerprint, undefined);
    assert.deepEqual(f.run.session!.messages.at(-1)!.draftUpdate, {
      before:
        "## Validation\n- `make check` was not run.\n\n## Limitations\n- `make check` was not run.\n- Not run: the macOS job.",
      after:
        "## Validation\n- `make check` exited 0 under `defconfig`; the recorded scope was the local test target.\n\n## Limitations\n- Not run: the macOS job.",
    });
  } finally {
    await f.cleanup();
  }
});

test("the Limitations rewrite is skipped when it would not be a clean improvement", async () => {
  let limitations = "";
  const f = await sessionFixture(async () => reply({ limitations }));
  const original = "## Summary\nx\n\n## Limitations\n- Not run: `make check`.";
  const turn = async (text: string) => {
    limitations = text;
    await f.workbench.startSession(f.run.id, "更新 Limitations");
    await turnEnded(f.run);
    return f.run.session!.messages.at(-1)!;
  };
  try {
    f.run.draft.body = original;
    // Unfinished text, the same text and an empty answer leave the person's text alone.
    for (const text of [
      "TODO: fill in what was run",
      "- Not run: `make check`.",
      "",
    ]) {
      const message = await turn(text);
      assert.equal(message.draftUpdate, undefined, text);
      assert.equal(f.run.draft.body, original, text);
    }
    // A description without a Limitations section has nothing to rewrite.
    f.run.draft.body = "## Summary\nx";
    assert.equal((await turn("- Everything ran.")).draftUpdate, undefined);
    assert.equal(f.run.draft.body, "## Summary\nx");
  } finally {
    await f.cleanup();
  }
});

test("a turn interrupted by a restart is closed and the edits are left for review", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "bell-session-store-"),
  );
  try {
    const first = new Store(directory);
    await first.initialize();
    first.data.runs.push({
      id: "interrupted",
      repoId: "r",
      title: "t",
      prompt: "t",
      status: "review",
      locale: "zh-TW",
      branch: "main",
      baseBranch: "main",
      baseSha: "a".repeat(40),
      worktreePath: "/tmp/none",
      createdAt: "2026-10-07T00:00:00.000Z",
      agents: [],
      logs: [],
      draft: { title: "t", body: "" },
      reviewedFiles: [],
      reviewedFingerprints: {},
      session: {
        messages: [{ id: "1", role: "user", content: "補測試", at: "t" }],
        running: true,
        startedAt: "2026-10-07T00:00:01.000Z",
        startingHead: "a".repeat(40),
        revision: 0,
        updatedAt: "t",
      },
    });
    await first.save();
    const second = new Store(directory);
    await second.initialize();
    const run = second.data.runs[0];
    assert.equal(run.status, "review");
    assert.equal(run.session!.running, false);
    assert.equal(run.session!.startedAt, undefined);
    assert.equal(run.session!.startingHead, undefined);
    assert.deepEqual(second.interruptedAgents, [
      { runId: "interrupted", head: "a".repeat(40), sync: false },
    ]);
    assert.equal(run.session!.messages.at(-1)!.role, "system");
    assert.match(
      await readFile(path.join(directory, "state.json"), "utf8"),
      /已中斷/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the session routes validate the message and keep the session out of the run list", async () => {
  const release = gate<string>();
  const f = await sessionFixture(() => release.promise);
  const server = createApp(f.workbench, {
    staticDirectory: path.join(os.tmpdir(), "bell-session-missing"),
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  const call = (method: string, route: string, body?: object) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${port}/api${route}`,
        {
          method,
          headers: {
            host: "127.0.0.1:4311",
            "content-type": "application/json",
          },
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode!, json: JSON.parse(text) }),
          );
        },
      );
      req.on("error", reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  try {
    const messages = `/runs/${f.run.id}/session/messages`;
    assert.equal(
      (await call("POST", messages, { content: "   " })).status,
      400,
    );
    assert.equal(
      (await call("POST", messages, { content: "x".repeat(4_001) })).status,
      400,
    );
    assert.equal(
      (await call("POST", messages, { content: "ok", extra: 1 })).status,
      400,
    );
    assert.equal(
      (await call("POST", `/runs/${f.run.id}/session/cancel`)).status,
      409,
    );
    const started = await call("POST", messages, { content: "補測試" });
    assert.equal(started.status, 200);
    assert.equal(started.json.run.session.messages[0].content, "補測試");
    // The list stays small: the session is a detail field of the open run.
    const list = await call("GET", "/runs");
    assert.equal("session" in list.json.runs[0], false);
    assert.equal(
      (await call("GET", `/runs/${f.run.id}`)).json.run.session.messages.length,
      1,
    );
    release.resolve(reply({ reply: "好。" }));
    await turnEnded(f.run);
    assert.equal(f.run.session!.messages.at(-1)!.content, "好。");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.cleanup();
  }
});

test("a turn that only runs checks refreshes the PR suggestion, which then reads the new evidence", async () => {
  const draftPrompts: string[] = [];
  const f = await sessionFixture(undefined, (baseSha) => ({
    collectDraftContext: async () => ({
      sources: [],
      warnings: [],
      checkedAt: "2026-10-03T00:00:00Z",
      baseSha,
    }),
    // The agent CLI itself: JSONL events as Codex prints them.
    command: async (_executable, _args, options = {}) => {
      const prompt = options.input ?? "";
      const say = (text: string) =>
        options.onLine?.(
          JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text },
          }),
          "stdout",
        );
      if (/You are pairing with the person/.test(prompt)) {
        if (/"personsMessage":"請跑測試/.test(prompt))
          options.onLine?.(
            JSON.stringify({
              type: "item.completed",
              item: {
                type: "command_execution",
                command: "npm test",
                exit_code: 0,
              },
            }),
            "stdout",
          );
        say(reply({ reply: "測試通過。" }));
      } else {
        draftPrompts.push(prompt);
        const tested = /npm test -> exit 0/.test(prompt);
        say(
          JSON.stringify({
            title: "Update the greeting",
            body: tested
              ? "## Validation\n\nThe working session ran `npm test` and it exited 0."
              : "## Validation\n\nNo executed test evidence was supplied.",
            policy: "linux",
            summary: "說明驗證狀況。",
            rules: [],
            checklist: [],
            templateSourceId: "",
          }),
        );
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  }));
  const settled = async () => {
    while (f.run.draftPreparation?.status === "generating")
      await new Promise((resolve) => setImmediate(resolve));
  };
  try {
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    await f.workbench.prepareDraft(f.run.id);
    const first = f.run.draftPreparation!;
    assert.equal(first.status, "ready");
    assert.match(first.proposal!.body, /No executed test evidence/);

    // Nothing is edited: the diff, and so the suggestion's fingerprint, stays the same.
    await f.workbench.startSession(
      f.run.id,
      "請跑測試，補上 Limitations 的驗證",
    );
    await turnEnded(f.run);
    const during = f.run.draftPreparation!;
    assert.ok(
      !(
        during.status === "ready" &&
        /No executed test evidence/.test(during.proposal!.body)
      ),
      "the old suggestion must not look current once the turn is over",
    );
    await settled();
    const agent = f.run.session!.messages.at(-1)!;
    assert.deepEqual(agent.checks, [
      { command: "npm test", outcome: "exit 0" },
    ]);
    assert.equal(agent.changedFiles, undefined);
    assert.equal(f.run.session!.revision, 0);
    const refreshed = f.run.draftPreparation!;
    assert.equal(refreshed.status, "ready");
    assert.equal(refreshed.fingerprint, first.fingerprint);
    assert.match(refreshed.proposal!.body, /ran `npm test` and it exited 0/);
    assert.doesNotMatch(refreshed.proposal!.body, /No executed test evidence/);
    assert.equal(draftPrompts.length, 2);
    assert.match(draftPrompts[1], /npm test -> exit 0/);
    // The person's own PR text is never replaced by the suggestion.
    assert.equal(f.run.draft.body, "Updates the greeting.");

    // A turn with no edit and no command has nothing new to write about.
    await f.workbench.startSession(f.run.id, "這個修改的風險是什麼？");
    await turnEnded(f.run);
    await settled();
    assert.equal(draftPrompts.length, 2);
    assert.equal(f.run.draftPreparation!.status, "ready");
  } finally {
    await f.cleanup();
  }
});

test("a collaborative session cannot bypass Learn-by-hand's write refusal", async () => {
  let calls = 0;
  const f = await sessionFixture(async () => {
    calls++;
    return reply();
  });
  try {
    f.run.learnByHand = true;
    await assert.rejects(
      f.workbench.startSession(f.run.id, "Please implement this"),
      (error: AppError) => error.statusCode === 409,
    );
    assert.equal(calls, 0);
    assert.equal(f.run.session, undefined);
  } finally {
    await f.cleanup();
  }
});

test("session evidence preserves an unverified exit status instead of claiming a test pass", () => {
  const report = sessionReport([
    {
      id: "a",
      role: "agent",
      content: "done",
      at: "t",
      checks: [
        {
          command: "npm test | tail",
          outcome: "exit 0 (not verified: pipeline)",
        },
      ],
    },
  ]);
  assert.match(report, /exit 0 \(not verified: pipeline\)/);
  assert.match(report, /no evidence that the command passed/);
});

test("session output remains compatible with old agents and never truncates draft evidence", () => {
  assert.ok(sessionJsonSchema.required.includes("validation"));
  const old = parseSessionResult(reply({ limitations: "Not run: macOS." }));
  assert.equal(old.validation, "");
  assert.equal(old.limitations, "Not run: macOS.");
  for (const field of ["validation", "limitations"] as const) {
    const result = parseSessionResult(
      reply({
        reply: "Evidence remains in this reply.",
        validation: "Existing check result.",
        limitations: "Remaining limitation.",
        [field]: "x".repeat(limitationsLimit + 1),
      }),
    );
    assert.equal(result.reply, "Evidence remains in this reply.");
    assert.equal(result.validation, "");
    assert.equal(result.limitations, "");
  }
});

test("invalid grouped section edits leave both sections intact and legacy limitations-only output still works", async () => {
  let update = { validation: "", limitations: "" };
  const f = await sessionFixture(async () =>
    reply({ reply: "Results remain available here.", ...update }),
  );
  const original =
    "## Problem\nKeep this.\n\n## Validation\nNot run: local checks.\n\n## Limitations\nLocal checks and macOS are unverified.";
  try {
    for (const invalid of [
      "TODO: fill results",
      "## Changes\nOverwrite",
      "x".repeat(limitationsLimit + 1),
    ]) {
      f.run.draft.body = original;
      update = { validation: invalid, limitations: "Not run: macOS." };
      await f.workbench.startSession(f.run.id, "Update the check sections");
      await turnEnded(f.run);
      assert.equal(f.run.draft.body, original);
      assert.equal(f.run.session!.messages.at(-1)!.draftUpdate, undefined);
      assert.equal(
        f.run.session!.messages.at(-1)!.content,
        "Results remain available here.",
      );
    }
    // No independent Validation section: a supplied edit cannot silently disappear while gaps are removed.
    f.run.draft.body =
      "## Problem\nKeep this.\n\n## Limitations\nLocal checks are unverified.";
    const withoutValidation = f.run.draft.body;
    update = {
      validation: "Checks exited 0.",
      limitations: "No remaining gaps in the requested scope.",
    };
    await f.workbench.startSession(f.run.id, "Update the check sections");
    await turnEnded(f.run);
    assert.equal(f.run.draft.body, withoutValidation);
    // A deliberately empty Validation update is the older output contract.
    update = { validation: "", limitations: "Not run: macOS." };
    await f.workbench.startSession(f.run.id, "Record the remaining limitation");
    await turnEnded(f.run);
    assert.match(f.run.draft.body, /## Limitations\nNot run: macOS\./);
    assert.doesNotMatch(f.run.draft.body, /## Validation/);
  } finally {
    await f.cleanup();
  }
});

test("the prompt keeps completed checks out of Limitations and does not turn exit zero into proof", () => {
  const prompt = sessionPrompt({
    boundaries: "No publishing.",
    contributionContext: "Fix a bug",
    baseBranch: "main",
    draft: {
      title: "Fix",
      body: "## Validation and Limitations\nMixed evidence.",
    },
    changedFiles: [],
    reports: { tester: "All checks passed (an unsupported claim)." },
    history: [
      {
        id: "1",
        role: "agent",
        content: "Earlier claim",
        at: "t",
        checks: [
          {
            command: "npm test | tail",
            outcome: "exit 0 (not verified: pipeline)",
          },
        ],
      },
    ],
    message: "Address unfinished work",
  });
  assert.match(prompt, /"currentValidation":null/);
  assert.match(prompt, /"currentLimitations":null/);
  assert.match(
    prompt,
    /containing only remaining gaps, checks not run and material limits, never a list of successful checks/,
  );
  assert.match(prompt, /exit 0 does not mean every subcheck passed/);
  assert.match(
    prompt,
    /never on earlier agent reports or a previous reply alone/,
  );
  assert.match(prompt, /keep the successful evidence in reply/);
  assert.match(prompt, /Combined sections and sections with nested headings are left unchanged/);
  assert.match(prompt, /within 4000 characters/);
  assert.match(prompt, /exit 0 \(not verified: pipeline\)/);
});

test("a draft-only session update refreshes the old ready suggestion without replacing the person's draft", async () => {
  let draftCalls = 0;
  const proposal = {
    title: "Update greeting",
    body: "## Validation\nNo checks were run.",
    policy: "linux",
    summary: "Current evidence.",
    rules: [],
    checklist: [],
    templateSourceId: "",
  };
  const f = await sessionFixture(
    async ({ role }) => {
      if (role === "draft") {
        draftCalls++;
        return JSON.stringify(proposal);
      }
      return reply({
        validation: "No check execution evidence is available.",
        limitations: "Not run: the local checks.",
      });
    },
    (baseSha) => ({
      collectDraftContext: async () => ({
        sources: [],
        warnings: [],
        checkedAt: "2026-10-03T00:00:00Z",
        baseSha,
      }),
    }),
  );
  try {
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    f.run.draft.body =
      "## Problem\nKeep.\n\n## Validation\nUnclear.\n\n## Limitations\nUnknown.";
    f.run.draftPreparation = {
      status: "ready",
      fingerprint: draftFingerprint(f.run, await readDiff(f.run)),
      proposal: { ...proposal, policy: "linux" },
    };
    await f.workbench.startSession(
      f.run.id,
      "Clarify the missing verification evidence",
    );
    await turnEnded(f.run);
    while (f.run.draftPreparation?.status === "generating")
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(draftCalls, 1);
    assert.equal(f.run.session!.revision, 0);
    assert.equal(f.run.session!.messages.at(-1)!.checks, undefined);
    assert.equal(f.run.draftPreparation?.status, "ready");
    assert.equal(
      f.run.draft.body,
      "## Problem\nKeep.\n\n## Validation\nNo check execution evidence is available.\n\n## Limitations\nNot run: the local checks.",
    );
  } finally {
    await f.cleanup();
  }
});

test("the draft report retains scoped agent results as unverified claims while prioritizing observed failures", () => {
  const report = sessionReport([
    {
      id: "latest",
      role: "agent",
      at: "latest-turn",
      content:
        "rv32emu local interpreter checks completed; JIT checks were skipped. " +
        "More reported output. ".repeat(300),
      checks: [
        { command: "run-failed-check", outcome: "exit 2" },
        {
          command: "run-latest-check",
          outcome: "exit 0 (not verified: pipeline)",
        },
      ],
    },
  ]);
  assert.ok(report.length <= 5500);
  assert.match(
    report,
    /Agent-reported summary \(UNVERIFIED; not application-observed evidence; truncated\)/,
  );
  assert.match(
    report,
    /local interpreter checks completed; JIT checks were skipped/,
  );
  assert.match(report, /run-failed-check -> exit 2/);
  assert.match(report, /run-latest-check -> exit 0 \(not verified: pipeline\)/);
  const unsupported = sessionReport([
    { id: "claim", role: "agent", at: "t", content: "All tests passed." },
  ]);
  assert.match(unsupported, /UNVERIFIED; not application-observed evidence/);
  assert.match(unsupported, /Commands BELL saw the agent run .*: none/);
});
