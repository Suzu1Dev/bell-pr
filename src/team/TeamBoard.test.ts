import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoRun } from "../demo";
import type { Run } from "../types";
import { TeamBoard, demoTeam } from "./TeamBoard";

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
