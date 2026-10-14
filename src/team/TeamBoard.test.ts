import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentTeam } from "../../shared/team";
import { demoRun, demoTeam, getDemo } from "../demo";
import { LocaleProvider } from "../i18n";
import en from "../i18n/en";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Run } from "../types";
import { TeamBoard } from "./TeamBoard";

const board = (run: Run, demo: boolean, onRetry?: () => Promise<void>) =>
  createElement(TeamBoard, {
    run,
    demo,
    onApprove() {},
    async onRevise() {},
    async onMessage() {},
    onRetry,
    busy: false,
  });
const render = (run: Run, demo = true) => renderZh(board(run, demo));

test("demo team renders its phase, members, tasks and messages", () => {
  const html = render({ ...demoRun, team: demoTeam });
  assert.match(html, /aria-label="共享任務與團隊訊息"/);
  assert.match(html, /團隊工作已完成/);
  assert.match(html, /4 \/ 4 子任務完成/);
  for (const task of demoTeam.tasks) {
    assert.ok(html.includes(task.owner));
    assert.ok(html.includes(task.title));
  }
  assert.match(html, /RetryOptions 已準備好/);
  assert.match(html, /團隊協作示範/);
  // The plan was never sent back, so no revision history or form appears.
  assert.doesNotMatch(html, /退回並補充意見/);
  // Application-observed checks and integrated paths sit on the task card; tasks without them render nothing extra.
  assert.match(html, /應用程式觀察到 2 次指令執行/);
  assert.match(html, /<code>npm test -- retry<\/code><span>exit 0<\/span>/);
  assert.match(html, /已整合：src\/utils\/retry.ts、src\/types.ts/);
  assert.equal(html.match(/應用程式觀察到/g)?.length, 1);
});

test("a failed real run offers the retry form, opens failure reasons and marks cleaned worktrees", () => {
  const [first, second] = demoTeam.tasks;
  const run: Run = {
    ...demoRun,
    status: "failed",
    team: {
      ...demoTeam,
      phase: "failed",
      tasks: [
        { ...first, worktreePath: "/tmp/team/task-1", worktreeRemoved: true },
        {
          ...second,
          status: "failed",
          report: undefined,
          error: "Teammate 修改了未分配的檔案 c.ts",
          worktreePath: "/tmp/team/task-2",
        },
      ],
    },
  };
  const html = renderZh(board(run, false, async () => {}));
  assert.match(html, /重試失敗的子任務/);
  assert.match(html, /1 個已整合的子任務不會重跑；1 個失敗或被阻擋的子任務/);
  assert.match(html, /aria-label="給重試任務的補充說明"/);
  assert.match(html, /獨立 worktree 已清理/);
  assert.match(html, /查看失敗原因/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Teammate 修改了未分配的檔案 c.ts/);
  // Without a retry handler (or in the demo) the form stays hidden.
  assert.doesNotMatch(
    render({ ...demoRun, team: demoTeam }),
    /重試失敗的子任務/,
  );
});

test("a run without team data falls back to the legacy notice", () => {
  const html = render(demoRun);
  assert.match(html, /這是舊版流程的任務/);
  assert.doesNotMatch(html, /子任務完成/);
});

test("a plan awaiting approval offers 退回並補充意見 with the revision history and counter", () => {
  const html = render(
    {
      ...demoRun,
      status: "awaiting_plan",
      team: {
        ...demoTeam,
        phase: "awaiting_approval",
        planRevisions: [
          {
            feedback: "請把測試拆成獨立任務。",
            previousSummary: "舊摘要",
            previousTasks: [
              { id: "all-in-one", title: "一次做完", files: ["src/"], dependsOn: [] },
            ],
            createdAt: "2026-10-03T01:00:00+08:00",
            revisionNotes: "已新增 task-4 專門負責驗證。",
          },
        ],
      },
    },
    false,
  );
  assert.match(html, /確認計畫並開始開發/);
  assert.match(html, /aria-label="退回計畫的意見"/);
  assert.match(html, /已重擬 1\/3/);
  assert.match(html, /第 1 次退回/);
  assert.match(html, /一次做完/);
  assert.match(html, /請把測試拆成獨立任務。/);
  assert.match(html, /已新增 task-4 專門負責驗證。/);
  // Messaging the lead is pointed at the revision action instead.
  assert.match(html, /讓 Lead 重擬|退回並補充意見/);
});

/** Each lane's markup, in display order. */
const lanes = (html: string) =>
  html.split('<section class="team-lane">').slice(1).map((lane) => lane.split("</section>")[0]);

test("lanes keep their grouping and the empty running lane has its own message", () => {
  const [first, second, third, fourth] = demoTeam.tasks;
  const html = render(
    {
      ...demoRun,
      team: {
        ...demoTeam,
        phase: "developing",
        tasks: [
          { ...first, status: "blocked" },
          { ...second, status: "pending" },
          { ...third, status: "failed" },
          { ...fourth, status: "complete" },
        ],
      },
    },
    false,
  );
  const [todo, running, done] = lanes(html);
  assert.match(todo, /^<h3>待處理<span>2<\/span><\/h3>/);
  assert.ok(todo.includes(first.title) && todo.includes(second.title));
  assert.match(running, /^<h3>進行中<span>0<\/span><\/h3>/);
  assert.match(running, /目前沒有正在執行的子任務/);
  // Failed tasks sit in the done lane.
  assert.match(done, /^<h3>已完成<span>2<\/span><\/h3>/);
  assert.ok(done.includes(third.title) && done.includes(fourth.title));
  const empty = lanes(
    render({ ...demoRun, team: { ...demoTeam, phase: "planning", tasks: [] } }, false),
  );
  assert.deepEqual(
    empty.map((lane) => /team-lane-empty">([^<]*)</.exec(lane)?.[1]),
    ["目前沒有任務", "目前沒有正在執行的子任務", "目前沒有任務"],
  );
});

// English sample data with the demo team's structure (ids, owners, files,
// statuses and checks), so English renders carry no Chinese fixture text.
const englishText: Record<string, { title: string; description: string; report: string }> = {
  "task-1": {
    title: "Define the retry policy and types",
    description: "Add RetryOptions and the backoff helper.",
    report: "RetryOptions is ready; the delays are covered by tests.",
  },
  "task-2": {
    title: "Retry the client's GET requests",
    description: "Use the helper for idempotent requests only.",
    report: "GET requests retry; POST requests do not.",
  },
  "task-3": {
    title: "Document usage and limits",
    description: "Explain the options and when retries stop.",
    report: "The README lists the options and their defaults.",
  },
  "task-4": {
    title: "Test the limits and the integration",
    description: "Cover the attempt limit and the client wiring.",
    report: "The edge cases pass.",
  },
};
const englishMessages: Record<string, string> = {
  m1: "Keep the public API unchanged.",
  m2: "RetryOptions is exported from src/types.ts.",
};
const englishTeam: AgentTeam = {
  ...demoTeam,
  planSummary: "Add retries to the client in four small, reviewable tasks.",
  tasks: demoTeam.tasks.map((task) => ({ ...task, ...englishText[task.id] })),
  messages: demoTeam.messages.map((message) => ({
    ...message,
    content: englishMessages[message.id],
  })),
};
const englishRun: Run = { ...demoRun, team: englishTeam };

// ModelSummary and EfficiencySummary are other components with tests of
// their own; this file checks the board's own copy.
const boardOnly = (html: string) =>
  html.replace(
    /<section class="(?:model|efficiency)-summary"[\s\S]*?<\/section>/g,
    "",
  );

test("the English board renders every phase without Han", () => {
  const [first, second, third, fourth] = englishTeam.tasks;
  const runs: [string, Run, boolean][] = [
    ["sample", englishRun, true],
    ["legacy", { ...englishRun, team: undefined }, false],
    [
      "planning",
      {
        ...englishRun,
        status: "running",
        team: { ...englishTeam, phase: "planning", planSummary: "", tasks: [], messages: [] },
      },
      false,
    ],
    [
      "awaiting approval",
      {
        ...englishRun,
        status: "awaiting_plan",
        team: {
          ...englishTeam,
          phase: "awaiting_approval",
          tasks: englishTeam.tasks.map((task) => ({ ...task, status: "pending" })),
          planRevisions: [
            {
              feedback: "Split the tests into their own task.",
              previousSummary: "One task",
              previousTasks: [
                { id: "a", title: "Do it all", files: ["src/"], dependsOn: [] },
                { id: "b", title: "Ship it", files: [], dependsOn: ["a"] },
              ],
              createdAt: "2026-10-03T01:00:00Z",
            },
          ],
        },
      },
      false,
    ],
    [
      "failed",
      {
        ...englishRun,
        status: "failed",
        team: {
          ...englishTeam,
          phase: "failed",
          tasks: [
            { ...first, worktreeRemoved: true },
            { ...second, status: "failed", error: "The teammate changed c.ts, which it does not own." },
            { ...third, status: "blocked", acceptsMessages: false },
            { ...fourth, status: "running", files: [] },
          ],
          messages: [
            { ...englishTeam.messages[0], from: "user", status: "queued" },
          ],
        },
      },
      false,
    ],
  ];
  for (const [name, run, demo] of runs) {
    const html = renderEn(board(run, demo, async () => {}));
    assert.doesNotThrow(() => assertNoHan(boardOnly(html)), name);
  }
  const sample = renderEn(board(englishRun, true));
  assert.match(sample, /aria-label="Shared tasks and team messages"/);
  assert.match(sample, /Team work is complete/);
  assert.match(sample, /4 \/ 4 subtasks done/);
  assert.match(sample, /Up to 3 members work at the same time/);
  assert.match(sample, /Integrated: src\/utils\/retry.ts, src\/types.ts/);
  assert.match(sample, /Waits for task-2, task-3/);
  assert.match(sample, /The app saw 2 commands run/);
  assert.match(sample, /Delivered · Sample/);
  assert.match(sample, /BELL PR coordinates the team/);
});

test("English plan revisions and retries use whole sentences with English plurals", () => {
  const [first, second] = englishTeam.tasks;
  const approval = renderEn(
    board(
      {
        ...englishRun,
        status: "awaiting_plan",
        team: {
          ...englishTeam,
          phase: "awaiting_approval",
          planRevisions: [
            {
              feedback: "Split the tests out.",
              previousSummary: "One task",
              previousTasks: [
                { id: "a", title: "Do it all", files: ["src/"], dependsOn: [] },
                { id: "b", title: "Ship it", files: [], dependsOn: [] },
              ],
              createdAt: "2026-10-03T01:00:00Z",
            },
          ],
        },
      },
      false,
    ),
  );
  assert.match(approval, /Sent back, round 1/);
  assert.match(approval, /The previous plan had 2 tasks: Do it all, Ship it/);
  assert.match(approval, /<b>Your feedback: <\/b>Split the tests out\./);
  assert.match(approval, /The lead did not describe the changes/);
  assert.match(approval, /Revised 1\/3\. Each revision is one read-only planning turn/);
  assert.match(approval, /aria-label="Feedback on the plan"/);
  const retry = renderEn(
    board(
      {
        ...englishRun,
        status: "failed",
        team: {
          ...englishTeam,
          phase: "failed",
          tasks: [first, { ...second, status: "failed", error: "Stopped." }],
        },
      },
      false,
      async () => {},
    ),
  );
  assert.match(
    retry,
    /1 subtask already integrated will not run again\. 1 subtask that failed or was blocked will discard its old isolated directory/,
  );
  assert.match(retry, /View the failure reason/);
  assert.match(retry, /Retry failed subtasks/);
});

test("the empty running lane message is chosen by lane id, not by its label", () => {
  // Swap the running and done labels: the second lane is still "running".
  const messages = {
    ...en,
    team: {
      ...en.team,
      lanes: { todo: "To do", running: "Done", done: "In progress" },
    },
  };
  const html = renderToStaticMarkup(
    createElement(
      LocaleProvider,
      { locale: "en", messages },
      board({ ...englishRun, team: { ...englishTeam, phase: "planning", tasks: [] } }, false),
    ),
  );
  const [todo, running, done] = lanes(html);
  assert.match(todo, /^<h3>To do<span>0<\/span><\/h3>[\s\S]*No tasks right now/);
  assert.match(running, /^<h3>Done<span>0<\/span><\/h3>[\s\S]*No subtask is running right now/);
  assert.match(done, /^<h3>In progress<span>0<\/span><\/h3>[\s\S]*No tasks right now/);
  assert.doesNotMatch(done, /No subtask is running/);
});

test(
  "the English demo team renders without Han",
  {
    skip:
      getDemo("en") === getDemo("zh-TW") &&
      "the English demo content is not filled in yet",
  },
  () => {
    const sample = getDemo("en");
    assertNoHan(renderEn(board({ ...sample.run, team: sample.team }, true)));
  },
);
