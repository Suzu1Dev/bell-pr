import assert from "node:assert/strict";
import test from "node:test";
import type { DraftCheck } from "../../shared/draft-checks";
import { rulesUnread } from "./rulesRecheck";

const ban: DraftCheck = { id: "ai-ban", kind: "block", message: "Not published here.", details: ["why", "docs/policy.md:4"], reason: "rules-unread" };

test("Check again is offered on any Learn-by-hand block whose reason is rules not read during the run", () => {
  assert.equal(rulesUnread([ban]), true);
  assert.equal(rulesUnread([{ ...ban, id: "area-reserved" }]), true);
  // A clean run that was not fitted gets the same block, and the same button (W2F verifier).
  assert.equal(rulesUnread([{ id: "issue-closed", kind: "block", message: "Closed.", details: [] }, ban]), true);
});

test("no Check again for another condition, a confirm, a check without a reason, or no block", () => {
  for (const reason of ["reach", "no-carve-out", "kind-not-named", "registry-stale", "not-fitted", "rules-changed", "held"] as const)
    assert.equal(rulesUnread([{ ...ban, reason }]), false, reason);
  assert.equal(rulesUnread([{ ...ban, kind: "confirm" }]), false);
  // An agent run's block, and a server that sent no reason: the block's text is never read.
  assert.equal(rulesUnread([{ ...ban, reason: undefined, message: "BELL PR hasn't read the project's rules since this run started (check them again)." }]), false);
  assert.equal(rulesUnread([]), false);
});
