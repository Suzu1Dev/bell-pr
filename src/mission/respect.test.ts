import assert from "node:assert/strict";
import test from "node:test";
import type { ContributionFacts, ContributionRules } from "../../shared/contribution";
import { getDemo } from "../demo";
import { demoContributionRules } from "../demo/rules";
import {
  doorClosed,
  doorState,
  factsFrom,
  issueNumber,
  rulesFrom,
  sampleRules,
  startReasons,
  unknownParts,
} from "./respect";

const demo = getDemo("en");
const rules = demoContributionRules(demo);
const facts = demo.contributionFacts!;

test("the door is open, for collaborators only, turned off or archived", () => {
  assert.equal(doorState({ hasPullRequests: true, pullRequestCreationPolicy: "all" }), "open");
  assert.equal(doorState({}), "open");
  assert.equal(doorState({ pullRequestCreationPolicy: "collaborators_only", viewerPermission: "READ" }), "collaborators");
  assert.equal(doorState({ pullRequestCreationPolicy: "collaborators_only" }), "collaborators");
  // Triage and above may open them there.
  assert.equal(doorState({ pullRequestCreationPolicy: "collaborators_only", viewerPermission: "triage" }), "open");
  assert.equal(doorState({ hasPullRequests: false }), "off");
  assert.equal(doorState({ disabled: true }), "off");
  assert.equal(doorState({ archived: true, hasPullRequests: true }), "archived");
  assert.equal(doorClosed({ archived: true }), true);
  assert.equal(doorClosed({ hasPullRequests: true }), false);
});

test("unknown facts split into their part and reason", () => {
  assert.deepEqual(unknownParts(["door: gh failed: exit 1", "issue", "pacing:", "rate limited"]), [
    { part: "door", reason: "gh failed: exit 1" },
    { part: "issue", reason: undefined },
    { part: "pacing", reason: undefined },
    { part: "other", reason: "rate limited" },
  ]);
  assert.deepEqual(unknownParts(), []);
});

test("only GitHub issue page URLs have an issue number, as the server accepts them", () => {
  assert.equal(issueNumber("https://github.com/acme/widgets/issues/42"), 42);
  assert.equal(issueNumber(" https://github.com/acme/widgets/issues/42/ "), 42);
  assert.equal(issueNumber("https://github.com/acme/widgets/pull/42"), undefined);
  assert.equal(issueNumber("http://github.com/acme/widgets/issues/42"), undefined);
  assert.equal(issueNumber("https://github.com/acme/widgets/issues/0"), undefined);
  assert.equal(issueNumber("#sample-issue-42"), undefined);
  assert.equal(issueNumber(""), undefined);
  assert.equal(issueNumber(), undefined);
});

test("route answers are read bare or wrapped, and anything else is no answer", () => {
  assert.equal(rulesFrom(rules), rules);
  assert.equal(rulesFrom({ rules }), rules);
  assert.equal(rulesFrom({}), undefined);
  assert.equal(rulesFrom({ rules: null }), undefined);
  assert.equal(rulesFrom({ checkedAt: "x", findings: "nope", filesRead: [] }), undefined);
  assert.equal(rulesFrom(undefined), undefined);
  assert.equal(factsFrom(facts), facts);
  assert.equal(factsFrom({ facts }), facts);
  assert.equal(factsFrom({ facts: {} }), undefined);
  assert.equal(factsFrom("text"), undefined);
});

test("the sample's facts give Start nothing to ask", () => {
  assert.deepEqual(startReasons(facts, rules), []);
  assert.deepEqual(startReasons(), []);
});

test("Start asks once for a closed issue, someone else's PR, a closed door, a ban, a newcomer issue or a full pace", () => {
  const issue = facts.issue!;
  assert.deepEqual(startReasons({ ...facts, issue: { ...issue, state: "CLOSED" } }, rules), [{ id: "issue-closed" }]);
  assert.deepEqual(
    startReasons(
      {
        ...facts,
        issue: {
          ...issue,
          otherPrs: [
            { number: 3, author: "SAMPLE_CONTRIBUTOR", state: "OPEN", willClose: true },
            { number: 5, author: "mentioned_only", state: "OPEN", willClose: false },
            { number: 6, author: "gone", state: "CLOSED" },
            { number: 7, author: "other_dev", state: "OPEN" },
          ],
        },
      },
      rules,
    ),
    [{ id: "other-pr", author: "other_dev", number: 7 }],
  );
  const closedDoor: ContributionRules = {
    ...rules,
    door: { pullRequestCreationPolicy: "collaborators_only", viewerPermission: "READ" },
  };
  assert.deepEqual(startReasons(undefined, closedDoor), [{ id: "door" }]);
  // Facts read now win over the door stored at import.
  assert.deepEqual(startReasons({ checkedAt: "x", door: { hasPullRequests: true } }, closedDoor), []);
  const ban = { kind: "ban" as const, path: "AI_POLICY.md", line: 3, quote: "We do not accept AI-generated pull requests.", contribution: true };
  assert.deepEqual(startReasons(undefined, { ...rules, findings: [ban] }), [{ id: "ban" }]);
  // An ambiguous ban only asks at publish.
  assert.deepEqual(startReasons(undefined, { ...rules, findings: [{ ...ban, contribution: false }] }), []);
  const newcomer: ContributionFacts = { ...facts, issue: { ...issue, labels: ["good first issue"] } };
  assert.deepEqual(startReasons(newcomer, rules), [{ id: "learning" }]);
  const area = { kind: "area" as const, path: "CONTRIBUTING.md", line: 9, quote: "Good first issues are reserved for humans.", contribution: true };
  assert.deepEqual(startReasons(newcomer, { ...rules, findings: [area] }), [{ id: "area" }]);
  assert.deepEqual(startReasons({ ...facts, pacing: { openPrs: 2, mergedPrs: 0 } }, rules), [
    { id: "pacing", open: 2, budget: 1 },
  ]);
  // At the budget it is a confirm at publish only; write access is never paced.
  assert.deepEqual(startReasons({ ...facts, pacing: { openPrs: 1, mergedPrs: 0 } }, rules), []);
  assert.deepEqual(startReasons({ ...facts, pacing: { openPrs: 9, viewerPermission: "WRITE" } }, rules), []);
});

test("the sample's rules are the ones src/demo/rules.ts builds, in both locales", () => {
  for (const locale of ["en", "zh-TW"] as const)
    assert.deepEqual(sampleRules(getDemo(locale)), demoContributionRules(getDemo(locale)), locale);
});
