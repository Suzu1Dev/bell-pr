import assert from "node:assert/strict";
import test from "node:test";
import type { ContributionFacts } from "../../shared/contribution";
import { draftPreflight } from "../../shared/draft-checks";
import { formatters } from "../../shared/i18n/locale";
import { reviewabilitySnapshot } from "../../shared/reviewability";
import { getDemo } from "../demo";
import { demoContributionRules } from "../demo/rules";
import en from "../i18n/en";
import {
  checklistCheck,
  checklistRowIds,
  checklistRows,
  type ChecklistInput,
} from "./checklist";

const demo = getDemo("en");
const rules = demoContributionRules(demo);
const facts = demo.contributionFacts!;
const changes = reviewabilitySnapshot({ files: demo.files, mergedSizes: demo.mergedSizes });
const body = demo.run.draft.body;
const sources = demo.draftPreparation.context!.sources;
const issueUrl = demo.run.contributionSettings!.issueUrl;

const preflight = (overrides: Partial<Parameters<typeof draftPreflight>[0]> = {}) =>
  draftPreflight(
    {
      body,
      sources,
      proposalBody: demo.draftPreparation.proposal!.body,
      rules,
      facts,
      changes,
      issueUrl,
      ...overrides,
    },
    "en",
  );
const rows = (input: ChecklistInput) =>
  checklistRows(input, en.draft.guidance.checklist, formatters("en"), en.draft.reviewability.bands);
const statuses = (input: ChecklistInput) =>
  Object.fromEntries(rows(input).map((row) => [row.id, row.status]));
const full: ChecklistInput = {
  checks: preflight(),
  rules,
  facts,
  changes,
  issueUrl,
  understanding: { required: true, passed: true, off: false },
};

test("the sample's checks are all clear, so every row is green", () => {
  assert.deepEqual(full.checks?.filter(checklistCheck), []);
  assert.deepEqual(statuses(full), Object.fromEntries(checklistRowIds.map((id) => [id, "ok"])));
  const byId = Object.fromEntries(rows(full).map((row) => [row.id, row]));
  assert.deepEqual(byId.rules.lines, ["3 rules quoted from the project's files; nothing in them stops this change."]);
  assert.equal(byId.rules.sources.length, 3);
  assert.match(byId.rules.sources[0], /^CONTRIBUTING\.md:\d+: "Open an issue before changing behavior\."$/);
  assert.deepEqual(byId.door.lines, ["Pull requests: open to you."]);
  assert.deepEqual(byId.door.sources, ["GitHub pull_request_creation_policy: all"]);
  assert.deepEqual(byId.issue.lines, ["Issue #42 is open, and nobody else is on it."]);
  assert.match(byId.issue.sources.join("\n"), /GitHub state: OPEN/);
  assert.match(byId.issue.sources.join("\n"), /A maintainer said: “PRs welcome for the retry cap\.”/);
  assert.deepEqual(byId.pacing.lines, ["Your open PRs here: 0 of 1 (BELL PR default, the same on every plan)."]);
  assert.match(byId.reviewability.lines[0], /^Small by BELL PR's default bands: \d+ changed lines in \d+ files\.$/);
  assert.deepEqual(byId.disclosure.lines, ["The project asks for a disclosure, and the description has one."]);
  assert.deepEqual(byId.understanding.lines, ["You explained the change back."]);
});

test("without checks or facts every row says it couldn't check, never OK", () => {
  assert.deepEqual(
    statuses({}),
    Object.fromEntries(checklistRowIds.map((id) => [id, id === "issue" ? "ok" : "unknown"])),
  );
  // With an issue link but no facts, the issue is unknown too.
  assert.equal(statuses({ issueUrl })["issue"], "unknown");
  const lines = Object.fromEntries(rows({ issueUrl }).map((row) => [row.id, row.lines[0]]));
  assert.equal(lines.rules, "BELL PR hasn't read this project's rules yet.");
  assert.equal(lines.door, "Not read from GitHub for this run yet; the publish dialog reads it.");
  assert.equal(lines.words, "The saved draft hasn't been checked yet.");
  assert.equal(lines.reviewability, "The change hasn't been measured yet.");
  assert.equal(lines.understanding, "Not checked yet.");
});

test("facts that could not be read leave their rows at Couldn't check, with the reason", () => {
  const unknownFacts: ContributionFacts = {
    checkedAt: facts.checkedAt,
    unknown: ["door: gh is not signed in", "issue", "pacing: timed out"],
  };
  const input = { ...full, facts: unknownFacts, checks: preflight({ facts: unknownFacts }) };
  const byId = Object.fromEntries(rows({ ...input, rules: { ...rules, door: undefined } }).map((row) => [row.id, row]));
  assert.equal(byId.door.status, "unknown");
  assert.deepEqual(byId.door.lines, ["Couldn't check: gh is not signed in"]);
  assert.equal(byId.issue.status, "unknown");
  assert.deepEqual(byId.issue.lines, ["Couldn't check this on GitHub."]);
  assert.equal(byId.pacing.status, "unknown");
  assert.deepEqual(byId.pacing.lines, ["Couldn't check: timed out"]);
  // The facts-unknown confirm itself is shown through these rows.
  assert.ok(input.checks.some((check) => check.id === "facts-unknown"));
  assert.ok(input.checks.filter((check) => check.id === "facts-unknown").every(checklistCheck));
});

test("blocks and confirms set their rows, with the check's sources", () => {
  const closed: ContributionFacts = {
    ...facts,
    door: { ...facts.door!, pullRequestCreationPolicy: "collaborators_only", viewerPermission: "READ" },
    issue: {
      ...facts.issue!,
      assignees: ["someone_else"],
      otherPrs: [{ number: 7, author: "other_dev", state: "OPEN", willClose: true }],
    },
    pacing: { openPrs: 1, mergedPrs: 0, waitingPrs: 0, viewerPermission: "READ" },
  };
  const weakFiles = [
    ...demo.files,
    { path: "tests/old.test.ts", additions: 0, deletions: 9, status: "deleted" },
  ];
  const weakChanges = reviewabilitySnapshot({ files: weakFiles });
  const checks = preflight({ facts: closed, changes: weakChanges, body: demo.draftPreparation.proposal!.body.replace(/\n\n.*$/, "") });
  const byId = Object.fromEntries(
    rows({ ...full, facts: closed, changes: weakChanges, checks }).map((row) => [row.id, row]),
  );
  assert.equal(byId.door.status, "block");
  assert.match(byId.door.sources.join(), /pull_request_creation_policy: collaborators_only \(viewerPermission READ\)/);
  assert.equal(byId.issue.status, "block");
  assert.match(byId.issue.sources.join("\n"), /#7 by @other_dev/);
  assert.match(byId.issue.sources.join("\n"), /Assigned to @someone_else\./);
  assert.equal(byId.pacing.status, "confirm");
  assert.equal(byId.reviewability.status, "block");
  assert.match(byId.reviewability.sources.join("\n"), /tests\/old\.test\.ts: test file deleted/);
  assert.equal(byId.disclosure.status, "block");
  assert.equal(byId.disclosure.lines[0], "The project requires a disclosure, and publishing waits for it.");
  assert.match(byId.disclosure.sources.join("\n"), /CONTRIBUTING\.md:\d+: "If you used AI tools, say so in the PR description\."/);
  // The why sentence is the row's own, never repeated from the check.
  for (const row of Object.values(byId))
    assert.ok(!row.sources.some((source) => /Maintainers rely|Maintainers decide|split the maintainers/.test(source)), row.id);
});

test("facts that close the door or the issue are never shown as OK, even without a check", () => {
  const closedDoor = statuses({
    ...full,
    checks: [],
    facts: { ...facts, door: { ...facts.door!, archived: true } },
  });
  assert.equal(closedDoor.door, "block");
  const closedIssue = statuses({
    ...full,
    checks: [],
    facts: { ...facts, issue: { ...facts.issue!, state: "CLOSED" } },
  });
  assert.equal(closedIssue.issue, "block");
});

test("the understanding row is passed, required or off", () => {
  assert.equal(statuses({ ...full, understanding: { required: true, passed: false, off: false } }).understanding, "block");
  assert.equal(statuses({ ...full, understanding: { required: false, passed: false, off: true } }).understanding, "confirm");
  assert.equal(statuses({ ...full, understanding: undefined }).understanding, "unknown");
});

test("rules not found name the files read, and never say there are none", () => {
  const byId = Object.fromEntries(
    rows({ ...full, rules: { ...rules, findings: [] } }).map((row) => [row.id, row]),
  );
  assert.equal(byId.rules.status, "ok");
  assert.match(byId.rules.lines[0], /^Not found in the 2 files BELL PR read\. Some projects publish their rules on a website or wiki/);
  assert.doesNotMatch(JSON.stringify(rows(full)), /no policy/i);
  // No disclosure rule found in the files read: disclosing is a choice.
  const choice = rows({ ...full, rules: { ...rules, findings: [] }, checks: [] }).find((row) => row.id === "disclosure")!;
  assert.deepEqual(choice.lines, ["The files BELL PR read don't ask for a disclosure; adding one is your choice."]);
});
