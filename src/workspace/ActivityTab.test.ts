import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Run } from "../types";
import { ActivityTab } from "./ActivityTab";

type Props = Parameters<typeof ActivityTab>[0];

const demo = getDemo("en");

const element = (props: Partial<Props> = {}) =>
  createElement(ActivityTab, {
    run: { ...demo.run, team: demo.team },
    demo: true,
    busy: false,
    active: false,
    reviewRerunning: false,
    logFilter: "all",
    setLogFilter() {},
    actions: {
      async approveTeamPlan() {},
      async reviseTeamPlan() {},
      async sendTeamMessage() {},
      async retryTeam() {},
      async cancel() {},
    },
    ...props,
  });

const count = (html: string, pattern: RegExp) =>
  html.match(new RegExp(pattern, "g"))?.length ?? 0;

test("the model and usage cards show once, in the team board's folded Run details", () => {
  const html = renderEn(element());
  // TeamBoard owns the disclosure; the Activity tab adds no second one.
  assert.equal(count(html, /<details class="team-run-details">/), 1);
  assert.equal(count(html, /<details class="run-details"/), 0);
  assert.equal(count(html, /class="model-summary"/), 1);
  assert.equal(count(html, /class="efficiency-summary[ "]/), 1);
  const disclosure = html.slice(html.indexOf('<details class="team-run-details">'));
  assert.ok(disclosure.indexOf('class="model-summary"') < disclosure.indexOf("</details>"));
  assert.match(disclosure, /<strong>Run details<\/strong>/);
  // It sits on the board, before the run log.
  assert.ok(html.indexOf("team-run-details") > html.indexOf("team-board"));
  assert.ok(html.indexOf("team-run-details") < html.indexOf("activity-layout"));
  assertNoHan(html);
  assert.match(renderZh(element()), /<strong>執行細節<\/strong>/);
});

test("a run that recorded its model names it on the folded Run details", () => {
  const run: Run = {
    ...demo.run,
    team: demo.team,
    id: "run-1",
    modelExecution: { provider: "codex", model: "gpt-5" } as Run["modelExecution"],
  };
  const html = renderEn(element({ run, demo: false }));
  assert.equal(count(html, /class="model-summary"/), 1);
  assert.match(html, /<details class="team-run-details"><summary><strong>Run details<\/strong><span>[^<]*gpt-5/);
});

test("the run log takes the full width; the request is not repeated beside it, the worktree note moves into the description", () => {
  const html = renderEn(element());
  assert.doesNotMatch(html, /task-brief/);
  assert.doesNotMatch(html.slice(html.indexOf('class="activity-layout"')), /<aside/);
  // The request reads in full on the overview; the branch is in the header.
  assert.ok(!html.includes(demo.run.prompt));
  assert.match(
    html,
    /<h2>How it ran<\/h2><p>The task board is above; the full log, error messages and the stop button stay here\. Development runs in a separate Git worktree, and after the review you decide when to submit\.<\/p>/,
  );
  const zh = renderZh(element({ run: { ...getDemo("zh-TW").run, team: getDemo("zh-TW").team } }));
  assert.match(zh, /開發在獨立的 Git worktree 中執行，審查完成後由你決定何時送出。<\/p>/);
  assert.doesNotMatch(zh, /這次的貢獻目標/);
});
