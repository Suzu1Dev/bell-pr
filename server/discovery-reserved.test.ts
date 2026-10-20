// Discovery's reservation flags (DESIGN v1.2 F1, F12): an opportunity for
// a learning-labelled issue whose evidence quotes reserve such issues for
// people learning without AI is `byHandReserved`, and `byHandReservedOutput`
// only when the rule is worded around AI-generated or automated pull
// requests. The flags are derived by the server from the evidence; an
// agent's own are dropped. The policy sentences are verbatim from LLVM's
// llvm/docs/AIToolPolicy.md and matplotlib's doc/devel/contribute.rst
// (server/fixtures/policy/real).
import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultDiscoveryPreferences,
  type ContributionOpportunity,
  type DiscoveryCandidate,
} from "../shared/discovery.js";
import { areaReach } from "../shared/policy-reach.js";
import { parseDiscoveryResult } from "./discovery.js";

const llvm =
  'AI tools must not be used to fix GitHub issues labelled [`good first issue`][good-first-issue].';
const llvmForbidden = '**Using AI tools to fix issues labelled as "good first issues" is forbidden**.';
const matplotlib =
  "Good first issues are intended to onboard newcomers with a genuine interest in improving Matplotlib, in the hopes that they will continue to participate in our development community; therefore, pull requests that are :ref:`AI generated <generative_ai>` will be closed.";

const candidate = (rules: string, path = "CONTRIBUTING.md"): DiscoveryCandidate => ({
  fullName: "owner/project",
  url: "https://github.com/owner/project",
  description: "A small library",
  language: "TypeScript",
  stars: 100,
  forks: 10,
  pushedAt: "2026-10-03T00:00:00Z",
  openIssues: 5,
  warnings: [],
  sources: [
    {
      id: "owner/project:issue:7",
      kind: "issue",
      title: "#7 Clarify the retry error",
      url: "https://github.com/owner/project/issues/7",
      content: "The retry error message does not say which request failed.",
    },
    {
      id: "owner/project:contributing",
      kind: "contributing",
      title: path,
      url: `https://github.com/owner/project/blob/main/${path}`,
      content: `Please discuss larger changes first.\n\n${rules}\n`,
    },
  ],
});
const opportunity = (rule: string, extra: Partial<ContributionOpportunity> = {}): ContributionOpportunity => ({
  id: "retry-error",
  repository: "owner/project",
  title: "Clarify the retry error",
  summary: "Say which request failed.",
  userNeed: "People can tell which request to retry.",
  contributionRules: "Discuss larger changes first.",
  popularity: "replaced",
  feasibility: "Small change to one message.",
  difficulty: "beginner",
  effort: "An hour.",
  firstSteps: ["Read the issue."],
  acceptanceChecks: ["The message names the request."],
  risks: ["Not reproduced yet."],
  evidence: [
    { sourceId: "owner/project:issue:7", quote: "does not say which request failed", reason: "The need." },
    { sourceId: "owner/project:contributing", quote: rule, reason: "The rule for this issue." },
  ],
  learnByHand: true,
  ...extra,
});
const parse = (rules: string, item: ContributionOpportunity, path?: string) =>
  parseDiscoveryResult(JSON.stringify({ opportunities: [item] }), [candidate(rules, path)], defaultDiscoveryPreferences)
    .opportunities[0];
const flags = (item: ContributionOpportunity) => [item.learnByHand, item.byHandReserved, item.byHandReservedOutput];

test("LLVM's 'use' wording reserves the issue, with no output flag", () => {
  assert.equal(areaReach(llvm), "use");
  assert.deepEqual(flags(parse(llvm, opportunity(llvm))), [true, true, undefined]);
  assert.deepEqual(flags(parse(llvmForbidden, opportunity(llvmForbidden))), [true, true, undefined]);
});

test("matplotlib's AI-generated pull requests wording reserves it with the output flag", () => {
  assert.deepEqual(flags(parse(matplotlib, opportunity(matplotlib), "doc/devel/contribute.rst")), [true, true, true]);
  // One "use" rule among the quotes takes the output flag away.
  const both = opportunity(matplotlib);
  both.evidence = [...both.evidence, { sourceId: "owner/project:contributing", quote: llvm, reason: "Another rule." }];
  assert.deepEqual(flags(parse(`${matplotlib}\n\n${llvm}`, both, "doc/devel/contribute.rst")), [true, true, undefined]);
});

test("automating fixes is the automate wording, which the output flag covers (unit case)", () => {
  // Node.js's sentence is not classified as a reserved-issue rule (no finding
  // on dev/next; plan README §18.7), so only its wording is pinned here.
  assert.equal(areaReach('It\'s prohibited to use AI to automate fixes to issues marked as "good first issue".'), "automate");
});

test("an opportunity without a reservation, or not for learning by hand, gets neither flag", () => {
  const plain = "Please run the tests before you open a pull request.";
  assert.deepEqual(flags(parse(plain, opportunity(plain))), [true, undefined, undefined]);
  // Not a learning opportunity: no flag, whatever the quotes say.
  const agentWork = opportunity(matplotlib, { learnByHand: false });
  assert.deepEqual(flags(parse(matplotlib, agentWork)), [undefined, undefined, undefined]);
});

test("an agent's answer that carries either flag has it dropped before the server derives them", () => {
  const plain = "Please run the tests before you open a pull request.";
  const claimed = opportunity(plain, { byHandReserved: true, byHandReservedOutput: true });
  assert.deepEqual(flags(parse(plain, claimed)), [true, undefined, undefined]);
  // And an output flag the agent claims for LLVM's wording never survives.
  assert.deepEqual(flags(parse(llvm, opportunity(llvm, { byHandReservedOutput: true }))), [true, true, undefined]);
  const agentWork = opportunity(plain, { learnByHand: false, byHandReserved: true });
  assert.deepEqual(flags(parse(plain, agentWork)), [undefined, undefined, undefined]);
});
