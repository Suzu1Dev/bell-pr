// The quote of an issue's reservation (plan README §18.10): with the
// reservation flags, the server marks the evidence quote whose rule keeps
// the issue for people learning without AI tools, and the discovery card
// quotes that one, so the client needs no classifier and the card and the
// server agree by construction. Never taken from the agent's answer; an
// optional field of the saved job, read leniently. The policy sentences are
// verbatim from LLVM's llvm/docs/AIToolPolicy.md and matplotlib's
// doc/devel/contribute.rst (server/fixtures/policy/real).
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import {
  defaultDiscoveryPreferences,
  type ContributionOpportunity,
  type DiscoveryCandidate,
} from "../shared/discovery.js";
import { LearnByHandFooter } from "../src/discovery/LearnByHandFooter.js";
import { renderEn } from "../src/test-utils/render.js";
import { discoveryJobSchema, parseDiscoveryResult } from "./discovery.js";
import { lenientRead } from "./persisted-schema.js";

const llvm = '**Using AI tools to fix issues labelled as "good first issues" is forbidden**.';
const matplotlib =
  "Good first issues are intended to onboard newcomers with a genuine interest in improving Matplotlib, in the hopes that they will continue to participate in our development community; therefore, pull requests that are :ref:`AI generated <generative_ai>` will be closed.";
const plain = "Please run the tests before you open a pull request.";

const candidate = (rules: string): DiscoveryCandidate => ({
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
      title: "doc/devel/contribute.rst",
      url: "https://github.com/owner/project/blob/main/doc/devel/contribute.rst",
      content: `Please discuss larger changes first.\n\n${rules}\n`,
    },
  ],
});
const opportunity = (rules: string[], extra: Partial<ContributionOpportunity> = {}): ContributionOpportunity => ({
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
    ...rules.map((rule) => ({ sourceId: "owner/project:contributing", quote: rule, reason: "The rule for this issue." })),
  ],
  learnByHand: true,
  ...extra,
});
const parse = (rules: string[], extra: Partial<ContributionOpportunity> = {}) =>
  parseDiscoveryResult(
    JSON.stringify({ opportunities: [opportunity(rules, extra)] }),
    [candidate(rules.join("\n\n"))],
    defaultDiscoveryPreferences,
  ).opportunities[0];
const footer = (item: ContributionOpportunity) =>
  renderEn(createElement(LearnByHandFooter, { item, choosing: false, disabled: false, onStart() {} }));
const quoted = (html: string) => [...html.matchAll(/<blockquote>([\s\S]*?)<\/blockquote>/g)].map((match) => match[1]);
const escaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

test("LLVM's 'use' wording is quoted on the card, as the server marked it", () => {
  const item = parse([llvm]);
  assert.deepEqual([item.byHandReserved, item.byHandReservedOutput, item.byHandReservedQuote], [true, undefined, llvm]);
  const html = footer(item);
  assert.doesNotMatch(html, /Start learning by hand/);
  assert.deepEqual(quoted(html), [escaped(llvm)]);
});

test("an output-only reservation has no quote; with a 'use' rule beside it, the 'use' rule is the one quoted", () => {
  const output = parse([matplotlib]);
  assert.deepEqual([output.byHandReserved, output.byHandReservedOutput, output.byHandReservedQuote], [true, true, undefined]);
  assert.deepEqual(quoted(footer(output)), []);
  const both = parse([matplotlib, llvm]);
  assert.deepEqual([both.byHandReserved, both.byHandReservedOutput, both.byHandReservedQuote], [true, undefined, llvm]);
  assert.deepEqual(quoted(footer(both)), [escaped(llvm)]);
  // No reservation, or not a learning opportunity: no quote.
  assert.equal(parse([plain]).byHandReservedQuote, undefined);
  assert.equal(parse([llvm], { learnByHand: false }).byHandReservedQuote, undefined);
});

test("a quote in the agent's answer is dropped before the server derives it", () => {
  assert.equal(parse([plain], { byHandReserved: true, byHandReservedQuote: plain }).byHandReservedQuote, undefined);
  assert.equal(parse([llvm], { byHandReservedQuote: "Something else entirely." }).byHandReservedQuote, llvm);
});

/** A saved job whose one opportunity carries the reservation and its quote. */
function job() {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    status: "ready",
    phase: "complete",
    message: "Done.",
    preferences: { ...defaultDiscoveryPreferences },
    createdAt: "2026-10-20T00:00:00.000Z",
    candidates: [],
    opportunities: [{ ...opportunity([llvm]), byHandReserved: true, byHandReservedQuote: llvm }],
    warnings: [],
  };
}

test("a build that predates byHandReservedQuote still reads an opportunity that has it", () => {
  const written = job();
  const older = lenientRead(
    discoveryJobSchema.extend({
      opportunities: discoveryJobSchema.shape.opportunities.element.omit({ byHandReservedQuote: true }).array().max(6),
    }),
  ).parse(written) as { opportunities: Record<string, unknown>[] };
  assert.equal(older.opportunities.length, 1);
  assert.equal("byHandReservedQuote" in older.opportunities[0], false);
  assert.equal(older.opportunities[0].byHandReserved, true);
  // This build keeps it on read; a job without it still loads.
  assert.equal(lenientRead(discoveryJobSchema).parse(written).opportunities[0].byHandReservedQuote, llvm);
  const { byHandReservedQuote: _quote, ...without } = written.opportunities[0];
  assert.equal(
    "byHandReservedQuote" in lenientRead(discoveryJobSchema).parse({ ...written, opportunities: [without] }).opportunities[0],
    false,
  );
});
