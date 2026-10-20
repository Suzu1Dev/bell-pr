import assert from "node:assert/strict";
import test from "node:test";
import type { DraftCheck } from "../../shared/draft-checks";
import { getDemo } from "../demo";
import type { Run } from "../types";
import { namesRulesUnread } from "./rulesRecheck";

const run: Run = { ...getDemo("en").run, status: "approved" };

test("Check again is offered on a fitted run's block when the rules were read before the run started", () => {
  const lock = { kinds: ["explain", "answer"], at: "2026-10-20T09:00:00.000Z", rulesCheckedAt: "2026-10-01T00:00:00.000Z", rules: [] };
  const fitted: Run = {
    ...run,
    learnByHand: true,
    agents: run.agents.filter((agent) => agent.id === "lead"),
    createdAt: "2026-10-20T09:00:00.000Z",
    byHand: { helpLock: lock },
  };
  const rules = {
    checkedAt: "2026-10-01T00:00:00.000Z",
    findings: [{ kind: "ban" as const, path: "docs/policy.md", line: 4, quote: "We decline AI-generated contributions.", contribution: true }],
    filesRead: ["docs/policy.md"],
  };
  const ban: DraftCheck = { id: "ai-ban", kind: "block", message: "Not published here.", details: ["why", "docs/policy.md:4"] };
  const area: DraftCheck = { ...ban, id: "area-reserved" };
  assert.equal(namesRulesUnread(fitted, rules, [ban]), true);
  assert.equal(namesRulesUnread(fitted, rules, [area]), true);
  // Rules read during the run, no block, an unfitted, unclean or agent run, or no rules: nothing to read again.
  assert.equal(namesRulesUnread(fitted, { ...rules, checkedAt: "2026-10-20T09:30:00.000Z" }, [ban]), false);
  assert.equal(namesRulesUnread(fitted, rules, [{ ...ban, kind: "confirm" }]), false);
  assert.equal(namesRulesUnread({ ...fitted, byHand: {} }, rules, [ban]), false);
  assert.equal(namesRulesUnread({ ...fitted, byHand: { helpLock: lock, agentWrites: 1 } }, rules, [ban]), false);
  assert.equal(namesRulesUnread({ ...fitted, learnByHand: undefined }, rules, [ban]), false);
  assert.equal(namesRulesUnread(fitted, undefined, [ban]), false);
});
