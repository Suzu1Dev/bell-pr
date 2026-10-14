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
