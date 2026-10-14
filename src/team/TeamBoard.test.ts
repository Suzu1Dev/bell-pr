import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoRun, demoTeam } from "../demo";
import type { Run } from "../types";
import { TeamBoard } from "./TeamBoard";

const render = (run: Run, demo = true) =>
  renderToStaticMarkup(
    createElement(TeamBoard, {
      run,
      demo,
      onApprove() {},
      async onRevise() {},
      async onMessage() {},
      busy: false,
    }),
  );

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
  const html = renderToStaticMarkup(
    createElement(TeamBoard, {
      run,
      demo: false,
      onApprove() {},
      async onMessage() {},
      async onRevise() {},
      async onRetry() {},
      busy: false,
    }),
  );
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
