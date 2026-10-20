import assert from "node:assert/strict";
import test from "node:test";
import type { ContributionFacts } from "../../shared/contribution";
import { draftPreflight } from "../../shared/draft-checks";
import { formatters } from "../../shared/i18n/locale";
import { reviewabilitySnapshot } from "../../shared/reviewability";
import { getDemo } from "../demo";
import { sampleRules } from "../mission/respect";
import en from "../i18n/en";
import {
  checklistCheck,
  checklistRowIds,
  checklistRows,
  withFactChecks,
  type ChecklistInput,
} from "./checklist";

const demo = getDemo("en");
const rules = sampleRules(demo);
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
  checklistRows(input, en.draft.guidance.checklist, formatters("en"), en.draft.reviewability.bands, "en");
const statuses = (input: ChecklistInput) =>
  Object.fromEntries(rows(input).map((row) => [row.id, row.status]));
const full: ChecklistInput = {
  checks: preflight(),
  rules,
  facts,
  changes,
  issueUrl,
  understanding: { required: true, passed: true, off: false },
  suggestion: true,
};

test("the sample's checks are all clear, so every row is green", () => {
  assert.deepEqual(full.checks?.filter(checklistCheck), []);
  assert.deepEqual(statuses(full), Object.fromEntries(checklistRowIds.map((id) => [id, "ok"])));
  const byId = Object.fromEntries(rows(full).map((row) => [row.id, row]));
  assert.deepEqual(byId.rules.lines, ["3 rules quoted from the project's files. The rows below check this change against them."]);
  assert.equal(byId.rules.sources.length, 3);
  assert.match(byId.rules.sources[0], /^CONTRIBUTING\.md:\d+: "Open an issue before changing behavior\."$/);
  assert.deepEqual(byId.door.lines, ["Pull requests: open to you."]);
  assert.deepEqual(byId.door.sources, ["GitHub pull_request_creation_policy: all"]);
  assert.deepEqual(byId.issue.lines, ["Issue #42 is open. BELL PR found no one else assigned to it, claiming it or with a pull request linked to it."]);
  assert.match(byId.issue.sources.join("\n"), /GitHub state: OPEN/);
  assert.match(byId.issue.sources.join("\n"), /A maintainer said: “PRs welcome for the retry cap\.”/);
  assert.deepEqual(byId.pacing.lines, ["Your open PRs here: 0 of 1 (BELL PR default, the same on every plan)."]);
  assert.match(byId.reviewability.lines[0], /^Small by BELL PR's default bands: \d+ changed lines in \d+ files\.$/);
  assert.deepEqual(byId.disclosure.lines, ["The project asks for a disclosure, and the description has one."]);
  assert.deepEqual(byId.understanding.lines, ["You explained the change back."]);
  // The sample's description was never edited: the row says what was compared, not who wrote it.
  assert.deepEqual(byId.words.lines, [
    "The description isn't BELL PR's suggested wording. Only you can tell whether it says what you understood, in your own words.",
  ]);
});

test("without a suggested description to compare with, the words row couldn't check", () => {
  const words = rows({ ...full, suggestion: false }).find((row) => row.id === "words")!;
  assert.equal(words.status, "unknown");
  assert.deepEqual(words.lines, [
    "BELL PR has no suggested description to compare with. Check that it says what you understood, in your own words.",
  ]);
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

test("checks computed without the facts get the fact checks they lack, so no row is OK against its facts", () => {
  const banned = {
    ...rules,
    findings: [
      ...rules.findings,
      { kind: "ban" as const, path: "AI_POLICY.md", line: 3, quote: "We do not accept AI-generated pull requests.", contribution: true },
    ],
  };
  const busy: ContributionFacts = {
    ...facts,
    issue: { ...facts.issue!, assignees: ["someone_else"] },
    pacing: { openPrs: 2, mergedPrs: 0, viewerPermission: "READ" },
  };
  // The editor's own checks: the text only, before the server's arrive.
  const textOnly = draftPreflight({ body, sources, proposalBody: demo.draftPreparation.proposal!.body }, "en");
  const local = draftPreflight({ body, sources, rules: banned, facts: busy, changes, issueUrl }, "en");
  const merged = withFactChecks(textOnly, local);
  assert.deepEqual(
    merged.filter((check) => !textOnly.includes(check)).map((check) => check.id),
    ["ai-ban", "pacing-max", "issue-state"],
  );
  const byId = statuses({ checks: merged, rules: banned, facts: busy, changes, issueUrl, understanding: { required: true, passed: true, off: false } });
  assert.equal(byId.rules, "block");
  assert.equal(byId.pacing, "block");
  assert.equal(byId.issue, "confirm");
  // A check the checks already have is not doubled, and the ones a saved
  // override or test reason lifts come only from the checks.
  const weak = draftPreflight(
    { body, sources, changes: { ...changes, weakened: [{ id: "tests/a.test.ts#0", path: "tests/a.test.ts", line: 0, text: "" }] },
      facts: { ...busy, issue: { ...busy.issue!, otherPrs: [{ number: 7, author: "other_dev", state: "OPEN", willClose: true }] } } },
    "en",
  );
  assert.ok(["tests-weakened", "issue-has-pr"].every((id) => weak.some((check) => check.id === id)));
  const lifted = withFactChecks(textOnly, weak).map((check) => check.id);
  assert.ok(!lifted.includes("tests-weakened"));
  assert.ok(!lifted.includes("issue-has-pr"));
  assert.equal(withFactChecks(local, local).length, local.length);
});

test("another person's pull request on the issue is never shown as nobody else on it", () => {
  const competing: ContributionFacts = {
    ...facts,
    issue: { ...facts.issue!, otherPrs: [{ number: 7, author: "other_dev", state: "OPEN", willClose: true }] },
  };
  const issue = rows({ ...full, facts: competing, checks: [] }).find((row) => row.id === "issue")!;
  assert.equal(issue.status, "confirm");
  assert.deepEqual(issue.lines, ["@other_dev's pull request #7 would also close this issue."]);
  // The person's own pull request is not someone else's.
  const own = rows({
    ...full,
    checks: [],
    facts: { ...competing, door: { ...facts.door!, login: "Other_Dev" } },
  }).find((row) => row.id === "issue")!;
  assert.equal(own.status, "ok");
});

test("the understanding row is passed, required or off", () => {
  assert.equal(statuses({ ...full, understanding: { required: true, passed: false, off: false } }).understanding, "block");
  // Off asks nothing at publish: a neutral row, not a confirm.
  assert.equal(statuses({ ...full, understanding: { required: false, passed: false, off: true } }).understanding, "off");
  // The check is not required only while it is turned off.
  assert.equal(statuses({ ...full, understanding: { required: false, passed: false, off: false } }).understanding, "off");
  // A check taken and passed while the setting is off counts as passed.
  assert.equal(statuses({ ...full, understanding: { required: false, passed: true, off: true } }).understanding, "ok");
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

test("the issue-link and brevity text checks show on the issue and words rows, with their rules", () => {
  const ruled = [
    {
      id: "contributing",
      kind: "contributing" as const,
      label: "CONTRIBUTING.md",
      content: "Every PR must reference an existing issue.\n\nKeep descriptions short and in your own words.",
    },
  ];
  const proposal = "## Summary\n\nAdds retries.";
  const checks = draftPreflight({ body: proposal, proposalBody: proposal, sources: ruled }, "en");
  assert.deepEqual(checks.map((check) => check.id), ["issue", "brevity"]);
  assert.ok(checks.every(checklistCheck));
  const byId = Object.fromEntries(rows({ ...full, checks }).map((row) => [row.id, row]));
  assert.equal(byId.issue.status, "confirm");
  assert.deepEqual(byId.issue.sources, ['CONTRIBUTING.md: "Every PR must reference an existing issue."']);
  assert.equal(byId.words.status, "confirm");
  assert.match(byId.words.lines[0], /suggested text, unrevised/);
  assert.deepEqual(byId.words.sources, ['CONTRIBUTING.md: "Keep descriptions short and in your own words."']);
});

test("the quoted confirm of Learn by hand is the rules row, and rows awaiting the server's list wait", () => {
  const quoted = { id: "by-hand-rules" as const, kind: "confirm" as const, message: "Quoted.", details: ["Why.", "docs/policy.md:4: \"…\"", "You used: answers."] };
  assert.ok(checklistCheck(quoted));
  const byId = Object.fromEntries(rows({ ...full, checks: [...preflight(), quoted] }).map((row) => [row.id, row]));
  assert.equal(byId.rules.status, "confirm");
  assert.deepEqual(byId.rules.lines, ["Quoted."]);
  assert.deepEqual(byId.rules.sources, ["docs/policy.md:4: \"…\"", "You used: answers."]);
  // Before the server's list, a row whose check only the server decides waits,
  // whatever else fired in it; the other rows read as before.
  const waiting = Object.fromEntries(
    rows({ ...full, checks: undefined, awaiting: ["ai-ban", "area-reserved"] }).map((row) => [row.id, row]),
  );
  for (const id of ["rules", "issue"] as const) {
    assert.equal(waiting[id].status, "unknown");
    assert.deepEqual(waiting[id].lines, [en.draft.guidance.checklist.draftUnknown]);
  }
  assert.equal(waiting.door.status, "ok");
});
