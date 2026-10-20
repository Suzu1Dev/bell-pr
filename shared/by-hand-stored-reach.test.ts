// The quoted confirm and the Learn-by-hand block copy read the reach the
// server stored with each rule (plan README §18.10), never the classifier:
// the client and the server read the same stored values, and a rule stored
// without them reads the strict way.
import assert from "node:assert/strict";
import test from "node:test";
import type { HelpLock } from "./by-hand.js";
import { byHandRulesCase, byHandRulesDecision } from "./by-hand-rules.js";
import { respectChecks, type ContributionRules, type PolicyFinding } from "./contribution.js";
import { withStoredReach } from "./project-policy.js";

const qemu =
  "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.";
const carveOut =
  "This policy does not apply to other uses of AI, such as researching APIs or algorithms, static analysis, or debugging, provided their output is not included in contributions.";
const refusal = "AI assistance of any kind is not accepted.";
const now = "2026-10-21T00:00:00.000Z";
const createdAt = "2026-10-20T09:00:00.000Z";

const ban = (extra: Partial<PolicyFinding> = {}): PolicyFinding => ({
  kind: "ban",
  path: "docs/devel/code-provenance.rst",
  line: 6,
  quote: qemu,
  contribution: true,
  allows: [{ line: 10, quote: carveOut, kinds: ["explain", "answer", "test"] }],
  ...extra,
});
const rulesOf = (...findings: PolicyFinding[]): ContributionRules => ({
  checkedAt: "2026-10-20T10:00:00.000Z",
  findings,
  filesRead: ["docs/devel/code-provenance.rst"],
});
const caseOf = (rules: ContributionRules) => byHandRulesCase(rules, { learningIssue: false, now: createdAt });

test("the case reader and the decision read the stored reach, not the quote", () => {
  const stored = withStoredReach(ban());
  assert.equal(stored.reach, "output");
  assert.equal(caseOf(rulesOf(stored)).case, "fitted");
  // The same quote stored with another reach reads as stored.
  const assistance = caseOf(rulesOf({ ...stored, reach: "assistance" }));
  assert.deepEqual(assistance.case === "blocked" && [assistance.reason, assistance.reach], ["reach", "assistance"]);
  // None stored, or a value this build doesn't know: the strict reading, never a lift.
  for (const reach of [undefined, "later-reach"]) {
    const finding = { ...ban(), ...(reach ? { reach: reach as never } : {}) };
    const read = caseOf(rulesOf(finding));
    assert.equal(read.case === "blocked" && read.reason, "reach", String(reach));
  }
  const fitted = caseOf(rulesOf(stored));
  const lock: HelpLock = { ...(fitted as Extract<typeof fitted, { case: "fitted" }>).lock, at: createdAt };
  const decide = (finding: PolicyFinding, ...others: PolicyFinding[]) =>
    byHandRulesDecision(
      { bans: [finding], areas: [], rules: rulesOf(finding, ...others) },
      { helps: ["explain", "answer"], helpLock: lock, createdAt, now },
    );
  assert.equal(decide(stored).confirmable.length, 1);
  assert.equal(decide({ ...stored, reach: "unknown" }).blocked[0]?.reason, "reach");
  assert.equal(decide(ban()).blocked[0]?.reason, "reach");
});

test("a ban the server marked stopsConfirm, or one stored without a reach, stops the quoted confirm anywhere in the rules", () => {
  const stored = withStoredReach(ban());
  const elsewhere: PolicyFinding = { kind: "ban", path: "CONTRIBUTING.md", line: 40, quote: refusal, contribution: false };
  const marked = withStoredReach(elsewhere);
  assert.deepEqual([marked.reach, marked.stopsConfirm], ["assistance", true]);
  const read = (other: PolicyFinding) => {
    const result = caseOf(rulesOf(stored, other));
    return result.case === "blocked" ? [result.reason, result.finding.quote] : [result.case];
  };
  assert.deepEqual(read(marked), ["reach", refusal]);
  // The mark is read, not the quote: the same quote without it and with a reach does not stop it.
  assert.deepEqual(read({ ...marked, stopsConfirm: undefined }), ["fitted"]);
  // A ban stored without a reach can't be read: it stops the confirm.
  assert.deepEqual(read(elsewhere), ["reach", refusal]);
});

test("a Learn-by-hand run's block copy says the stored reach", () => {
  const learnByHand = { helps: ["explain" as const], now };
  const message = (finding: PolicyFinding) =>
    respectChecks({ body: "Fixes the timer.", rules: rulesOf(finding), learnByHand }, "en").find((check) => check.id === "ai-ban")?.message;
  const output = message({ ...withStoredReach(ban()), allows: undefined });
  const assistance = message({ ...withStoredReach(ban()), allows: undefined, reach: "assistance" });
  const unknown = message({ ...ban(), allows: undefined });
  assert.match(output!, /decline AI-generated content/);
  assert.match(assistance!, /restrict AI help itself/);
  assert.match(unknown!, /can't tell/);
  // An agent run's checks never read the reach.
  const agent = (finding: PolicyFinding) => respectChecks({ body: "Fixes the timer.", rules: rulesOf(finding) }, "en");
  assert.deepEqual(agent(withStoredReach(ban())), agent({ ...ban(), reach: "assistance" }));
});
