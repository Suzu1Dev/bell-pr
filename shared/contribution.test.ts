import test from "node:test";
import assert from "node:assert/strict";
import {
  claimComment,
  collaboratorPermission,
  learningLabel,
  maintainerAssociation,
  notReadyLabel,
  openPrBudget,
  overridableCheckIds,
  pacingExempt,
  policyKinds,
} from "./contribution.js";

test("the open-PR budget is 1 before a first merged PR in the repository and 2 after", () => {
  assert.equal(openPrBudget(0), 1);
  assert.equal(openPrBudget(false), 1);
  assert.equal(openPrBudget(1), 2);
  assert.equal(openPrBudget(12), 2);
  assert.equal(openPrBudget(true), 2);
});

test("people with write access are exempt from pacing; triage may still open PRs where collaborators may", () => {
  for (const permission of ["WRITE", "MAINTAIN", "ADMIN", "admin"])
    assert.ok(pacingExempt(permission), permission);
  for (const permission of ["TRIAGE", "READ", "", undefined])
    assert.ok(!pacingExempt(permission), String(permission));
  assert.ok(collaboratorPermission("TRIAGE"));
  assert.ok(!collaboratorPermission("READ"));
  assert.ok(!collaboratorPermission(undefined));
});

test("learning and not-ready labels are read from the repository's own names", () => {
  for (const name of ["good first issue", "Good-First-Issue", "good_first_issue", "first-timers-only", "beginner", "beginner-friendly", "E-easy", "starter", "newcomer"])
    assert.ok(learningLabel(name), name);
  for (const name of ["help wanted", "bug", "documentation", "easy-to-review-later", "uneasy"])
    assert.ok(!learningLabel(name), name);
  for (const name of ["needs-triage", "status: triage", "needs design", "blocked", "on hold", "needs: decision", "waiting for upstream"])
    assert.ok(notReadyLabel(name), name);
  for (const name of ["bug", "good first issue", "enhancement"])
    assert.ok(!notReadyLabel(name), name);
});

test("claim comments and maintainer associations", () => {
  for (const body of ["I'd like to work on this!", "/assign", "Can I take this?", "I'm working on it.", "Please assign this to me", "I will take this one"])
    assert.ok(claimComment(body), body);
  for (const body of ["Is anyone working on this?", "This also happens on Windows.", "I would like this fixed too."])
    assert.ok(!claimComment(body), body);
  for (const value of ["OWNER", "MEMBER", "COLLABORATOR", "member"])
    assert.ok(maintainerAssociation(value), value);
  for (const value of ["CONTRIBUTOR", "NONE", "FIRST_TIME_CONTRIBUTOR", undefined])
    assert.ok(!maintainerAssociation(value), String(value));
});

test("the vocabularies are frozen at their v1.1 values", () => {
  assert.deepEqual(
    [...policyKinds],
    ["ban", "disclose", "understand", "area", "agent", "own-words", "issue-first"],
  );
  assert.deepEqual([...overridableCheckIds], ["issue-has-pr"]);
});
