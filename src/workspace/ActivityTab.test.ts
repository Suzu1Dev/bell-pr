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
    run: demo.run,
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

/** The Run details disclosure, from its opening tag to its end. */
const details = (html: string) =>
  html.match(/<details class="run-details"[^>]*>.*?<\/details>/)?.[0] ?? "";

test("the model and usage cards wait in a closed Run details disclosure without data", () => {
  const html = renderEn(element());
  const disclosure = details(html);
  assert.match(disclosure, /^<details class="run-details"><summary>Run details<\/summary>/);
  assert.match(disclosure, /class="model-summary"/);
  assert.match(disclosure, /class="efficiency-summary"/);
  // It follows the team board, before the run log.
  assert.ok(html.indexOf("run-details") > html.indexOf("team-board"));
  assert.ok(html.indexOf("run-details") < html.indexOf("activity-layout"));
  assertNoHan(html);
  assert.match(renderZh(element()), /<summary>執行細節<\/summary>/);
});

test("a run that recorded its model or usage opens Run details", () => {
  const run: Run = {
    ...demo.run,
    id: "run-1",
    modelExecution: { provider: "codex", model: "gpt-5" } as Run["modelExecution"],
  };
  assert.match(
    details(renderEn(element({ run, demo: false }))),
    /^<details class="run-details" open="">/,
  );
  assert.match(
    details(renderEn(element({ run: { ...run, modelExecution: undefined }, demo: false }))),
    /^<details class="run-details">/,
  );
});
