import assert from "node:assert/strict";
import test from "node:test";
import type { AgentTeam } from "../../../shared/team";
import { getDemo } from "../../demo";
import type { Run } from "../../types";
import { premiseCheckable } from "./usePremiseCheck";

const team: AgentTeam = {
  config: { maxTeammates: 2, requirePlanApproval: false, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
  phase: "complete",
  planSummary: "",
  tasks: [],
  messages: [],
};
const run: Run = {
  ...getDemo("en").run,
  id: "run-1",
  status: "review",
  prompt: "Assumption (unverified): the caller hands the browser an id it made itself.",
  team,
};

test("a finished run offers a premise check when its request states an assumption, in either language, or it has one", () => {
  assert.equal(premiseCheckable(run, false, false), true);
  assert.equal(premiseCheckable({ ...run, prompt: "假設（未驗證）：呼叫端交出自己的 id。" }, false, false), true);
  const plain = { ...run, prompt: "Make the greeting consistent." };
  assert.equal(premiseCheckable(plain, false, false), false);
  // A check already made can be made again.
  assert.equal(
    premiseCheckable({ ...plain, team: { ...team, premise: { verdict: "holds", statement: "s", evidence: "a.ts:1" } } }, false, false),
    true,
  );
  // Never on the sample, a run still working or publishing, one without a team or its files.
  assert.equal(premiseCheckable(run, true, false), false);
  assert.equal(premiseCheckable(run, false, true), false);
  assert.equal(premiseCheckable({ ...run, publishing: true }, false, false), false);
  assert.equal(premiseCheckable({ ...run, team: undefined }, false, false), false);
  assert.equal(premiseCheckable({ ...run, workspaceRemovedAt: "2026-10-15T00:00:00Z" }, false, false), false);
  assert.equal(premiseCheckable({ ...run, status: "running" }, false, false), false);
});
