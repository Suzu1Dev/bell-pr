import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  freeEntitlements,
  proEntitlements,
  type Entitlements,
} from "../../shared/plans";
import type { AgentTeam } from "../../shared/team";
import { getDemo } from "../demo";
import { createDemoPlayback, type PlaybackClock } from "../demo/playback";
import { LocaleProvider } from "../i18n";
import en from "../i18n/en";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Run } from "../types";
import { TeamBoard } from "./TeamBoard";

const { run: demoRun, team: demoTeam } = getDemo("zh-TW");

const board = (
  run: Run,
  demo: boolean,
  onRetry?: () => Promise<void>,
  entitlements?: Entitlements,
) =>
  createElement(TeamBoard, {
    run,
    demo,
    onApprove() {},
    async onRevise() {},
    async onMessage() {},
    onRetry,
    busy: false,
    entitlements,
  });
const render = (run: Run, demo = true) => renderZh(board(run, demo));
const demoRunZh: Run = { ...demoRun, team: demoTeam };

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
  html
    .split(/<section class="team-lane[^"]*">/)
    .slice(1)
    .map((lane) => lane.split("</section>")[0]);

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
    [
      "Lead 的計畫完成後，子任務會出現在這裡。",
      "目前沒有正在執行的子任務",
      "還沒有完成的子任務",
    ],
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
  premise: getDemo("en").team.premise,
  tasks: demoTeam.tasks.map((task) => ({ ...task, ...englishText[task.id] })),
  messages: demoTeam.messages.map((message) => ({
    ...message,
    content: englishMessages[message.id],
  })),
};
const englishRun: Run = { ...demoRun, team: englishTeam };

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
    ...(["developing", "integrating", "reviewing", "cancelled"] as const).map(
      (phase): [string, Run, boolean] => [
        phase,
        {
          ...englishRun,
          status: phase === "cancelled" ? "cancelled" : "running",
          team: {
            ...englishTeam,
            phase,
            config: { ...englishTeam.config, requirePlanApproval: false },
          },
        },
        false,
      ],
    ),
  ];
  for (const [name, run, demo] of runs) {
    const html = renderEn(board(run, demo, async () => {}));
    assert.doesNotThrow(() => assertNoHan(html), name);
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
  const integrating = renderEn(
    board(runs.find(([name]) => name === "integrating")![1], false),
  );
  assert.match(integrating, /The lead is integrating/);
  assert.match(integrating, /Plan runs automatically/);
  assert.match(integrating, /Codex · BELL PR team engine/);
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
  assert.match(todo, /^<h3>To do<span>0<\/span><\/h3>[\s\S]*Subtasks appear here once the lead&#x27;s plan is ready\./);
  assert.match(running, /^<h3>Done<span>0<\/span><\/h3>[\s\S]*No subtask is running right now/);
  assert.match(done, /^<h3>In progress<span>0<\/span><\/h3>[\s\S]*No subtask has finished yet/);
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

/** The English board for `run` on a real (non-demo) run, checked for Han. */
const english = (run: Run, entitlements?: Entitlements) => {
  const html = renderEn(board(run, false, undefined, entitlements));
  assertNoHan(html);
  return html;
};

test("a queued run says it waits to start, with no progress count yet", () => {
  const html = english({
    ...englishRun,
    status: "queued",
    team: { ...englishTeam, phase: "planning", planSummary: "", tasks: [], messages: [] },
  });
  // A queued run is not at work yet: no spinner.
  assert.match(html, /<h3><svg[^>]*lucide-layers[^>]*>[\s\S]*?<\/svg>Waiting to start<\/h3>/);
  assert.match(html, /The run is in the queue\. The lead starts planning as soon as it can run\./);
  assert.doesNotMatch(html, /subtasks done/);
  // No flow step is current while the run waits.
  assert.doesNotMatch(html, /aria-current/);
});

test("a team that stopped before its plan says so instead of planning", () => {
  for (const phase of ["failed", "cancelled"] as const) {
    const html = english({
      ...englishRun,
      status: phase,
      team: { ...englishTeam, phase, planSummary: "", tasks: [], messages: [] },
    });
    assert.match(html, /The team stopped before the lead finished a plan\./, phase);
    assert.doesNotMatch(html, /Reading the project/, phase);
  }
});

test("the English planning phase shows the lead at work and lane messages chosen by id", () => {
  const html = english({
    ...englishRun,
    status: "running",
    team: { ...englishTeam, phase: "planning", planSummary: "", tasks: [], messages: [] },
  });
  assert.match(html, /<h3><svg[^>]*class="[^"]*spin[^"]*"[^>]*>[\s\S]*?<\/svg>The lead is planning<\/h3>/);
  assert.match(html, /Reading the project and building a plan/);
  assert.doesNotMatch(html, /subtasks done/);
  assert.match(html, /<span class="is-current" aria-current="step"><svg[^>]*>[\s\S]*?<\/svg>Lead plans<\/span>/);
  assert.equal(html.match(/aria-current="step"/g)?.length, 1);
  assert.deepEqual(
    lanes(html).map((lane) => /team-lane-empty">([^<]*)</.exec(lane)?.[1]),
    [
      "Subtasks appear here once the lead&#x27;s plan is ready.",
      "No subtask is running right now",
      "No subtask has finished yet",
    ],
  );
  // Every lane is empty, so none of them is hidden on a phone.
  assert.match(html, /<div class="team-kanban ">/);
  assert.match(html, /The lead is planning\. Once the plan is ready, you can send the members more instructions\./);
  assert.match(html, /<textarea aria-label="Team message"[^>]*disabled=""/);
});

test("the English approval phase offers the approve button and says subtasks wait for it", () => {
  const html = english({
    ...englishRun,
    status: "awaiting_plan",
    team: {
      ...englishTeam,
      phase: "awaiting_approval",
      tasks: englishTeam.tasks.map((task) => ({ ...task, status: "pending" })),
      messages: [],
    },
  });
  assert.match(html, /class="team-plan needs-approval"/);
  assert.match(html, /Waiting for you to approve the plan/);
  assert.match(html, /0 \/ 4 subtasks done/);
  assert.match(html, /<button class="button primary">[\s\S]*?Approve the plan and start development<\/button>/);
  assert.match(html, /<span class="is-current" aria-current="step"><svg[^>]*>[\s\S]*?<\/svg>You approve the plan<\/span>/);
  const [todo, running, done] = lanes(html);
  assert.match(todo, /^<h3>To do<span>4<\/span><\/h3>/);
  assert.match(running, /Subtasks start once you approve the plan\./);
  assert.match(done, /No subtask has finished yet/);
  // With tasks on the board, empty lanes may fold away on a phone.
  assert.match(html, /<div class="team-kanban has-tasks">/);
  assert.match(html, /<section class="team-lane is-empty">/);
});

test("the English developing phase marks the running lane's tasks and the parallel step", () => {
  const [first, second, third, fourth] = englishTeam.tasks;
  const html = english({
    ...englishRun,
    status: "running",
    team: {
      ...englishTeam,
      phase: "developing",
      tasks: [
        { ...first, status: "complete" },
        { ...second, status: "running" },
        { ...third, status: "running" },
        { ...fourth, status: "pending" },
      ],
    },
  });
  assert.match(html, /<h3><svg[^>]*spin[^>]*>[\s\S]*?<\/svg>Teammates are working together<\/h3>/);
  assert.match(html, /<span class="is-current" aria-current="step"><svg[^>]*>[\s\S]*?<\/svg>Teammates work in parallel<\/span>/);
  const [, running] = lanes(html);
  assert.match(running, /^<h3>In progress<span>2<\/span><\/h3>/);
  assert.doesNotMatch(running, /team-lane-empty/);
});

test("the runtime badge shows the plan's member limit from the entitlements", () => {
  const run: Run = {
    ...englishRun,
    status: "running",
    team: {
      ...englishTeam,
      phase: "developing",
      config: { ...englishTeam.config, maxTeammates: 2 },
    },
  };
  const free = english(run, freeEntitlements);
  assert.match(free, /Up to 2 members work at the same time/);
  assert.match(free, /<small class="team-plan-limit">Free plan: up to 2 members at once<\/small>/);
  const pro = english(run, proEntitlements(2));
  assert.match(pro, /<small class="team-plan-limit">Pro: up to 4 members at once<\/small>/);
  const trial = english(run, { ...proEntitlements(2), plan: "trial" });
  assert.match(trial, /Pro trial: up to 4 members at once/);
  // A run that started on Pro with 4 members keeps them after a downgrade.
  const kept = english(
    { ...run, team: { ...run.team!, config: { ...run.team!.config, maxTeammates: 4 } } },
    freeEntitlements,
  );
  assert.match(kept, /Up to 4 members work at the same time/);
  assert.match(
    kept,
    /Free plan: up to 2 members at once<\/small><small class="team-plan-limit">This run keeps the team size it started with\.<\/small>/,
  );
  // Until the plan is known, and in the sample, no plan line is shown.
  assert.doesNotMatch(english(run), /team-plan-limit/);
  assert.doesNotMatch(
    renderEn(board(englishRun, true, undefined, freeEntitlements)),
    /team-plan-limit/,
  );
  assert.match(
    renderZh(board(run, false, undefined, freeEntitlements)),
    /免費方案：最多 2 位成員同時工作/,
  );
});

test("the protocol note sits in a How it works disclosure", () => {
  const html = english(englishRun);
  assert.match(
    html,
    /<details class="team-how"><summary><svg[^>]*>[\s\S]*?<\/svg>How it works<svg[^>]*>[\s\S]*?<\/svg><\/summary><p class="team-protocol-note"><svg[^>]*>[\s\S]*?<\/svg>BELL PR coordinates the team[^<]*it is not Claude Code&#x27;s native Agent Teams\.<\/p><\/details>/,
  );
  assert.match(renderZh(board(demoRunZh, true)), /<summary>[\s\S]*?運作方式[\s\S]*?並非 Claude Code 原生 Agent Teams/);
});

test("the message list can take focus and is named for screen readers", () => {
  const html = english(englishRun);
  assert.match(
    html,
    /<div class="team-messages" role="log" aria-live="polite" aria-label="Team messages" tabindex="0">/,
  );
});

test("the model and usage cards fold into Run details, whose summary names what the run recorded", () => {
  const sample = renderEn(board(englishRun, true));
  assert.match(sample, /<details class="team-run-details"><summary><strong>Run details<\/strong><span>Model, reasoning effort and AI usage<\/span>/);
  assert.match(sample, /class="team-run-details-body"><section class="model-summary"/);
  const recorded = english({
    ...englishRun,
    modelExecution: { provider: "claude", model: "opus", source: "selected", reported: { model: "claude-opus-4-1" } },
    efficiency: {
      policyVersion: "bell-ponytail-v1",
      mode: "lite",
      calls: 9,
      completedCalls: 9,
      failedCalls: 0,
      measuredCalls: 9,
      durationMs: 1000,
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 1,
    },
  });
  // Folded even with data, so the board stays in the first screen.
  assert.match(recorded, /<details class="team-run-details"><summary><strong>Run details<\/strong><span>Claude Code · claude-opus-4-1 · 9 AI calls · 10 input · 1 output tokens<\/span>/);
  assert.match(
    english({ ...englishRun, modelExecution: { source: "cli-default" }, efficiency: undefined }),
    /<span>Codex<\/span>/,
  );
  const older = english({ ...englishRun, modelExecution: undefined, efficiency: undefined });
  assert.match(older, /<span>Model, reasoning effort and AI usage<\/span>/);
});

test(
  "the English board renders every state the demo playback goes through",
  {
    skip:
      getDemo("en") === getDemo("zh-TW") &&
      "the English demo content is not filled in yet",
  },
  () => {
    // Time moves only when the test fires the next timer.
    let now = Date.parse("2026-10-03T01:30:00.000Z");
    const timers: { at: number; callback: () => void }[] = [];
    const clock: PlaybackClock = {
      now: () => now,
      setTimeout(callback, ms) {
        const timer = { at: now + ms, callback };
        timers.push(timer);
        return timer;
      },
      clearTimeout(handle) {
        timers.splice(timers.indexOf(handle as (typeof timers)[number]), 1);
      },
    };
    const fireNext = () => {
      timers.sort((a, b) => a.at - b.at);
      const timer = timers.shift();
      if (!timer) return false;
      now = timer.at;
      timer.callback();
      return true;
    };
    const playback = createDemoPlayback({ demo: getDemo("en"), clock });
    const seen = new Map<string, string>();
    playback.subscribe((event) => {
      if (event.kind !== "run" || !event.run.team) return;
      const key = event.run.status === "queued" ? "queued" : event.run.team.phase;
      const html = renderEn(board(event.run, true));
      assert.doesNotThrow(() => assertNoHan(html), key);
      assert.doesNotMatch(html, /Invalid Date|NaN/, key);
      seen.set(key, html);
    });
    playback.start();
    for (let steps = 0; steps < 500 && playback.current()?.run.status !== "awaiting_plan"; steps++)
      fireNext();
    assert.equal(playback.current()?.run.status, "awaiting_plan");
    assert.ok(playback.approvePlan());
    for (let steps = 0; steps < 500 && fireNext(); steps++);
    assert.deepEqual(
      [...seen.keys()],
      ["queued", "planning", "awaiting_approval", "developing", "integrating", "reviewing", "complete"],
    );
    assert.match(seen.get("queued")!, /Waiting to start/);
    assert.match(seen.get("planning")!, /The lead is planning/);
    assert.match(seen.get("planning")!, /Subtasks appear here once the lead&#x27;s plan is ready\./);
    // The sample's approve button calls onApprove, which 5B points at the playback.
    assert.match(seen.get("awaiting_approval")!, /Approve the plan and start development/);
    assert.match(seen.get("awaiting_approval")!, /Subtasks start once you approve the plan\./);
    assert.match(seen.get("developing")!, /aria-current="step"><svg[^>]*>[\s\S]*?<\/svg>Teammates work in parallel/);
    assert.match(seen.get("complete")!, /Team work is complete/);
    playback.stop();
  },
);

test("the lead's premise check shows under the plan, in each language", () => {
  const html = render({ ...demoRun, team: demoTeam });
  assert.match(html, /<section class="premise-notice premise-holds" aria-label="前提查核"><h3>.*前提查核：假設成立/);
  assert.match(html, /src\/client\.ts:12/);
  const english = renderEn(board(englishRun, true));
  assert.match(english, /Premise check: the assumption holds/);
  // A run whose request stated no assumption shows none.
  assert.doesNotMatch(render({ ...demoRun, team: { ...demoTeam, premise: undefined } }), /premise-notice/);
});


test("the folded Run details name the tokens, and a long plan opens to its first lines unless it awaits approval", () => {
  const plan = Array.from({ length: 12 }, (_, index) => `【第 ${index + 1} 段】說明`).join("\n");
  const efficiency = {
    policyVersion: "1",
    mode: "lite" as const,
    calls: 3,
    completedCalls: 3,
    failedCalls: 0,
    measuredCalls: 2,
    durationMs: 1000,
    inputTokens: 5349122,
    cachedInputTokens: 0,
    outputTokens: 197068,
  };
  const run: Run = {
    ...demoRun,
    modelExecution: { provider: "claude", model: "opus", source: "selected", reported: { model: "claude-opus-5-5" } },
    efficiency,
    team: { ...demoTeam, planSummary: plan },
  };
  const html = render(run, false);
  assert.match(
    html,
    /<details class="team-run-details"><summary><strong>執行細節<\/strong><span>Claude Code · claude-opus-5-5 · 3 次 AI 呼叫 · 輸入 5,349,122 · 輸出 197,068 tokens（部分回報）<\/span>/,
  );
  // The cards themselves stay inside, unchanged.
  assert.match(html, /team-run-details.*class="model-summary".*class="efficiency-summary/s);
  assert.match(html, /<p class="team-plan-folded">【第 1 段】/);
  assert.match(html, /aria-expanded="false">顯示完整計畫/);
  // Unreported usage is unknown, not zero.
  assert.match(
    render({ ...run, efficiency: { ...efficiency, measuredCalls: 0 } }, false),
    /<span>Claude Code · claude-opus-5-5 · 3 次 AI 呼叫 · 用量未回報<\/span>/,
  );
  const awaiting = render({ ...run, team: { ...demoTeam, phase: "awaiting_approval", planSummary: plan } }, false);
  assert.doesNotMatch(awaiting, /team-plan-folded|顯示完整計畫/);
  assert.doesNotMatch(render({ ...run, team: { ...demoTeam, planSummary: "短計畫" } }, false), /顯示完整計畫/);
  // So does a long task description in its narrow lane; short ones stay as they are.
  const [first, second] = demoTeam.tasks;
  const tasks = render({ ...run, team: { ...demoTeam, tasks: [{ ...first, description: "範圍說明。".repeat(60) }, second] } }, false);
  assert.equal(tasks.match(/class="team-task-folded"/g)?.length, 1);
  assert.equal(tasks.match(/顯示完整說明/g)?.length, 1);

  const english = renderEn(
    board(
      {
        ...run,
        efficiency: { ...efficiency, measuredCalls: 3 },
        team: { ...englishTeam, planSummary: Array.from({ length: 9 }, (_, index) => `Step ${index + 1}.`).join("\n") },
      },
      false,
    ),
  );
  assert.match(english, /<span>Claude Code · claude-opus-5-5 · 3 AI calls · 5,349,122 input · 197,068 output tokens<\/span>/);
  assert.match(english, /aria-expanded="false">Show the whole plan<\/button>/);
  assertNoHan(english);
});

test("a learn-by-hand run plans with the guide instead of approving a team plan, and retries only before its plan", () => {
  const sample = getDemo("en");
  const byHand = (status: Run["status"], phase: AgentTeam["phase"], extra: Partial<Run> = {}): Run => ({
    ...sample.run,
    status,
    learnByHand: true,
    team: { ...sample.team, phase, tasks: [], planSummary: "", messages: [] },
    ...extra,
  });
  const element = (run: Run) =>
    createElement(TeamBoard, {
      run,
      demo: false,
      onApprove() {},
      async onRevise() {},
      async onMessage() {},
      async onRetry() {},
      busy: false,
      entitlements: freeEntitlements,
      byHand: { onSave: async () => {}, onReveal: async () => {}, onAskQuestions: async () => {}, onConfirm: async () => {} },
    });
  const planning = renderEn(element(byHand("awaiting_plan", "awaiting_approval")));
  assertNoHan(planning);
  // The plan panel loads with the byhand chunk; no team approval or "send back".
  assert.match(planning, /<svg[^>]*lucide-loader-circle[^>]*spin/);
  assert.doesNotMatch(planning, /Approve the plan and start development|Send back with feedback/);
  // Failed before the person confirmed a plan: the retry goes back to planning, with no note to subtasks.
  const failed = renderEn(element(byHand("failed", "failed")));
  assertNoHan(failed);
  assert.ok(failed.includes("A retry takes this run back to planning with the guide."));
  assert.doesNotMatch(failed, /Note for the retried subtasks/);
  // After the person confirmed their plan, no retry can bring agents back.
  const confirmed = byHand("failed", "failed", { byHand: { plan: { steps: [{ id: "s1", title: "Cap" }], savedAt: sample.run.createdAt, confirmedAt: sample.run.createdAt } } });
  assert.doesNotMatch(renderEn(element(confirmed)), /A retry takes this run back|Retry failed subtasks/);
  assert.match(renderZh(element(byHand("failed", "failed"))), /重試會讓這個任務回到和嚮導一起規劃的階段/);
});
