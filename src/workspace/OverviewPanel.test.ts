import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { getDemo } from "../demo";
import type { ProjectOverviewProps } from "../mission/ProjectOverview";
import { assertNoHan, renderEn } from "../test-utils/render";
import type { Run } from "../types";
import { OverviewPanel } from "./OverviewPanel";

const apt = { need: "GLib headers", command: "sudo apt-get install -y libglib2.0-dev", reason: "cargo test needs them." };

/** A run in review whose teammate reported one setup need. */
const run = (extra: Partial<Run> = {}): Run => {
  const { run: demo, team } = getDemo("en");
  return {
    ...demo,
    status: "review",
    team: { ...team, tasks: [{ ...team.tasks[0], setup: [apt] }] },
    ...extra,
  };
};

const props = (value: Run, extra: { onSetupTurn?: (commands: string[]) => Promise<void> } = {}) =>
  createElement(OverviewPanel, {
    repo: { id: "r", name: "n", owner: "o", fullName: "o/n", path: "/tmp/n", defaultBranch: "main", url: "" },
    run: value,
    insights: null,
    loading: false,
    error: "",
    recommending: false,
    recommendationError: "",
    recommendationPreferences: { order: [], hidden: [] },
    savingPreferences: false,
    preferenceError: "",
    stale: false,
    onAnalyze() {},
    onRecommendMore() {},
    onSavePreferences() {},
    onChooseRecommendation() {},
    onReadCode() {},
    ...extra,
  } as ProjectOverviewProps & { run: Run; onSetupTurn?: (commands: string[]) => Promise<void> });

test("the overview offers the hand-off only when the workspace passes one, and says so once every item is handled", () => {
  const offered = renderEn(props(run(), { async onSetupTurn() {} }));
  assertNoHan(offered);
  assert.match(offered, /Let the Agent set this up/);
  assert.doesNotMatch(renderEn(props(run())), /Let the Agent set this up/);
  const handled = run({
    session: {
      messages: [{ id: "1", role: "agent", content: "", at: "2026-11-01T00:00:00Z", setupResults: [{ ...apt, outcome: "installed", detail: "" }] }],
      revision: 0,
      updatedAt: "2026-11-01T00:00:00Z",
    },
  });
  const done = renderEn(props(handled, { async onSetupTurn() {} }));
  assert.doesNotMatch(done, /Let the Agent set this up/);
  assert.match(done, /The Agent reports every item it can take as installed or already present/);
  assert.match(done, /Agent reports: installed/);
});

test("when every item left is one the agent is never handed, nothing claims an agent report", () => {
  const unsafe = { need: "Deno", command: "curl -fsSL https://deno.land/install.sh | sh", reason: "The benchmark needs it." };
  const value = run();
  const html = renderEn(
    props({ ...value, team: { ...value.team!, tasks: [{ ...value.team!.tasks[0], setup: [unsafe] }] } }, { async onSetupTurn() {} }),
  );
  assert.doesNotMatch(html, /Let the Agent set this up/);
  assert.doesNotMatch(html, /The Agent reports every item/);
  assert.match(html, /never hands this command to an Agent/);
});
