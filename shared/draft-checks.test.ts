// The respect checks (DESIGN §5.4) as draftPreflight reports them. The
// PR-text checks have their tests in server/drafts.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { assertNoHan } from "../src/test-utils/render.js";
import type {
  ContributionFacts,
  ContributionRules,
  PolicyFinding,
} from "./contribution.js";
import {
  draftPreflight,
  type DraftCheck,
  type DraftPreflightInput,
} from "./draft-checks.js";
import { aiDisclosureLine, type DraftSource } from "./drafts.js";
import { reviewabilitySnapshot, type ReviewabilitySnapshot } from "./reviewability.js";

const finding = (
  kind: PolicyFinding["kind"],
  quote: string,
  contribution = true,
  line = 3,
): PolicyFinding => ({ kind, path: "CONTRIBUTING.md", line, quote, contribution });

const rules = (...findings: PolicyFinding[]): ContributionRules => ({
  checkedAt: "2026-10-15T00:00:00.000Z",
  findings,
  filesRead: ["CONTRIBUTING.md"],
});

const facts = (extra: Partial<ContributionFacts>): ContributionFacts => ({
  checkedAt: "2026-10-15T00:00:00.000Z",
  door: { hasPullRequests: true, pullRequestCreationPolicy: "all", viewerPermission: "READ", login: "me" },
  ...extra,
});

const snapshot = (extra: Partial<ReviewabilitySnapshot> = {}): ReviewabilitySnapshot => ({
  changedLines: 40,
  files: 2,
  testFilesChanged: 1,
  sourceChanged: true,
  docsOnly: false,
  newDependencies: [],
  outsidePlan: [],
  whitespaceOnly: [],
  weakened: [],
  band: "small",
  ...extra,
});

const body = "Fixes the retry cap.\n\nI tested it with a server that fails twice.";

const ids = (input: Partial<DraftPreflightInput>, locale: "en" | "zh-TW" = "en") =>
  draftPreflight({ body, ...input }, locale).map((check) => `${check.id}:${check.kind}`);

const check = (input: Partial<DraftPreflightInput>, id: DraftCheck["id"]) =>
  draftPreflight({ body, ...input }).find((value) => value.id === id);

test("without rules, facts or a snapshot no respect check runs", () => {
  assert.deepEqual(ids({}), []);
  // Facts that were read and are fine raise nothing either.
  assert.deepEqual(
    ids({
      rules: rules(),
      facts: facts({ issue: { url: "#42", state: "OPEN" }, pacing: { openPrs: 0, mergedPrs: 0 } }),
      changes: snapshot(),
      issueUrl: "#42",
    }),
    [],
  );
});

test("pr-closed blocks when pull requests are off, the repository is archived, or only collaborators may open them", () => {
  for (const door of [
    { hasPullRequests: false },
    { archived: true },
    { disabled: true },
    { pullRequestCreationPolicy: "collaborators_only", viewerPermission: "READ" },
  ]) {
    const found = check({ facts: facts({ door }) }, "pr-closed");
    assert.equal(found?.kind, "block", JSON.stringify(door));
    assert.match(found.details[1], /^GitHub /);
  }
  assert.equal(
    check({ facts: facts({ door: { pullRequestCreationPolicy: "collaborators_only", viewerPermission: "TRIAGE" } }) }, "pr-closed"),
    undefined,
  );
});

test("ai-ban blocks on a ban with contribution context; an ambiguous one is a project-rules confirm", () => {
  const ban = finding("ban", "Pull requests made with AI tools are not accepted.");
  const found = check({ rules: rules(ban) }, "ai-ban");
  assert.equal(found?.kind, "block");
  assert.deepEqual(found.details.slice(1), ['CONTRIBUTING.md:3: "Pull requests made with AI tools are not accepted."']);
  const ambiguous = finding("ban", "We do not use AI tools for releases.", false);
  assert.deepEqual(ids({ rules: rules(ambiguous) }), ["project-rules:confirm"]);
});

test("ai-disclosure blocks until the description discloses what the project asks", () => {
  const disclose = finding("disclose", "If you used AI tools, say so in the PR description.");
  assert.equal(check({ rules: rules(disclose) }, "ai-disclosure")?.kind, "block");
  assert.equal(check({ rules: rules(disclose), body: `${body}\n\n${aiDisclosureLine}` }, "ai-disclosure"), undefined);
  assert.equal(
    check({ rules: rules(disclose), commitMessage: "Fix the cap\n\nAssisted-by: Codex CLI" }, "ai-disclosure"),
    undefined,
  );
  // The contributing guide's own rule counts while no rules were read yet.
  const sources: DraftSource[] = [
    { id: "c", kind: "contributing", label: "CONTRIBUTING.md", content: "Please disclose any use of AI assistance in your pull request." },
  ];
  const found = check({ sources }, "ai-disclosure");
  assert.equal(found?.kind, "block");
  assert.deepEqual(found.details.slice(1), ['CONTRIBUTING.md: "Please disclose any use of AI assistance in your pull request."']);
});

test("own-words: unrevised suggested text is a confirm everywhere and a block where the project asks for own words", () => {
  const proposalBody = body;
  assert.deepEqual(ids({ proposalBody }), ["own-words:confirm"]);
  assert.deepEqual(ids({ proposalBody, rules: rules(finding("own-words", "Describe your change in your own words.")) }), [
    "own-words:block",
  ]);
  // Ticking boxes or adding BELL's disclosure line is no rewrite; editing the prose is.
  assert.deepEqual(ids({ proposalBody, body: `${body}\n\n${aiDisclosureLine}` }), ["own-words:confirm"]);
  assert.deepEqual(ids({ proposalBody, body: `${body} Rewritten by me.` }), []);
  // A project with a brevity rule keeps its brevity confirm for it, quoting the rule.
  const sources: DraftSource[] = [
    { id: "c", kind: "contributing", label: "CONTRIBUTING.md", content: "Write short, focused descriptions in your own words." },
  ];
  assert.deepEqual(ids({ proposalBody, sources }), ["brevity:confirm"]);
  assert.deepEqual(
    ids({ proposalBody, sources, rules: rules(finding("own-words", "Write short, focused descriptions in your own words.")) }),
    ["own-words:block"],
  );
});

test("issue-closed blocks on a closed linked issue", () => {
  const found = check({ facts: facts({ issue: { url: "#42", state: "CLOSED", stateReason: "COMPLETED" } }) }, "issue-closed");
  assert.equal(found?.kind, "block");
  assert.equal(found.details[1], "GitHub state: CLOSED (COMPLETED)");
});

test("issue-has-pr blocks on someone else's open PR until a reason of 20 to 200 characters lifts it", () => {
  const issue = {
    url: "#42",
    state: "OPEN",
    otherPrs: [{ number: 7, author: "someone", state: "OPEN", willClose: true }],
  };
  assert.equal(check({ facts: facts({ issue }) }, "issue-has-pr")?.kind, "block");
  assert.deepEqual(check({ facts: facts({ issue }) }, "issue-has-pr")?.details.slice(1), [
    "GitHub closedByPullRequestsReferences: #7 by @someone",
  ]);
  const override = (reason: string) => [{ id: "issue-has-pr", reason, at: "2026-10-15T00:00:00.000Z" }];
  assert.equal(check({ facts: facts({ issue }), overrides: override("Their PR has been abandoned since June.") }, "issue-has-pr"), undefined);
  assert.equal(check({ facts: facts({ issue }), overrides: override("too short") }, "issue-has-pr")?.kind, "block");
  // The person's own PR, a merged one or one that only mentions the issue is no competition.
  for (const other of [
    { number: 8, author: "Me", state: "OPEN", willClose: true },
    { number: 9, author: "someone", state: "MERGED", willClose: true },
    { number: 10, author: "someone", state: "OPEN", willClose: false },
  ])
    assert.equal(check({ facts: facts({ issue: { ...issue, otherPrs: [other] } }) }, "issue-has-pr"), undefined);
});

test("area-reserved blocks a learning-labelled issue in a project that reserves them", () => {
  const issue = { url: "#42", state: "OPEN", labels: ["good first issue", "bug"] };
  const area = finding("area", "Using AI tools on good first issues is forbidden.");
  const found = check({ facts: facts({ issue }), rules: rules(area) }, "area-reserved");
  assert.equal(found?.kind, "block");
  assert.equal(found.details[1], "GitHub labels: good first issue");
  assert.equal(check({ facts: facts({ issue }) }, "area-reserved"), undefined);
});

test("tests-weakened blocks until each item has a one-line reason", () => {
  const changes = reviewabilitySnapshot({
    files: [
      { path: "tests/old.test.ts", additions: 0, deletions: 20, status: "deleted", patch: "" },
      {
        path: "tests/a.test.ts",
        additions: 1,
        deletions: 1,
        patch: "@@ -4,1 +4,1 @@\n-  expect(x).toBe(1);\n+  it.skip('x', () => {});\n",
      },
    ],
  });
  const found = check({ changes }, "tests-weakened");
  assert.equal(found?.kind, "block");
  assert.deepEqual(found.details.slice(1), [
    "tests/old.test.ts: test file deleted",
    "tests/a.test.ts:4 removed: expect(x).toBe(1);",
    "tests/a.test.ts:4 added: it.skip('x', () => {});",
  ]);
  const reasons = {
    "tests/old.test.ts#0": "Its cases moved to a.test.ts.",
    "tests/a.test.ts#-4": "The value is checked below now.",
    "tests/a.test.ts#4": "too short",
  };
  assert.deepEqual(check({ changes, testReasons: reasons }, "tests-weakened")?.details.slice(1), [
    "tests/a.test.ts:4 added: it.skip('x', () => {});",
  ]);
  reasons["tests/a.test.ts#4"] = "Flaky upstream, tracked in #12.";
  assert.equal(check({ changes, testReasons: reasons }, "tests-weakened"), undefined);
});

test("pacing confirms at the budget, blocks at twice it, and spares people with write access", () => {
  const pacing = (openPrs: number, mergedPrs = 0, extra = {}) =>
    ids({ rules: rules(), facts: facts({ pacing: { openPrs, mergedPrs, ...extra } }) });
  assert.deepEqual(pacing(0), []);
  assert.deepEqual(pacing(1), ["pacing:confirm"]);
  assert.deepEqual(pacing(2), ["pacing-max:block"]);
  // A merged PR here raises the budget to 2.
  assert.deepEqual(pacing(1, 1), []);
  assert.deepEqual(pacing(2, 1), ["pacing:confirm"]);
  assert.deepEqual(pacing(4, 3), ["pacing-max:block"]);
  assert.deepEqual(pacing(0, 0, { waitingPrs: 1 }), ["pacing:confirm"]);
  assert.deepEqual(pacing(9, 0, { viewerPermission: "WRITE" }), []);
  // An unknown count is not a pass or a block: facts-unknown says so.
  assert.deepEqual(ids({ facts: facts({ pacing: {}, unknown: ["pacing: rate limited"] }) }), ["facts-unknown:confirm"]);
  const max = check({ facts: facts({ pacing: { openPrs: 2, mergedPrs: 0 } }) }, "pacing-max");
  assert.match(max!.details[1], /^GitHub search: your pull requests here, 2 open and 0 merged\. Budget: 1 open/);
  // The counts are stated as they are: three is not "twice" one, three is over two.
  const three = check({ facts: facts({ pacing: { openPrs: 3, mergedPrs: 0 } }) }, "pacing-max");
  assert.match(three!.message, /^You already have 3 open pull requests in this repository, at least twice BELL PR's budget of 1 /);
  assert.match(three!.details[1], /your pull requests here, 3 open and 0 merged\./);
  const over = check({ facts: facts({ pacing: { openPrs: 3, mergedPrs: 1 } }) }, "pacing");
  assert.equal(over!.details[1], "You have 3 open pull requests here, over your budget of 2.");
  const at = check({ facts: facts({ pacing: { openPrs: 2, mergedPrs: 1 } }) }, "pacing");
  assert.equal(at!.details[1], "You have 2 open pull requests here, your budget of 2.");
});

test("project-rules groups ambiguous bans, understand rules while the check is off, agent notes and issue-first without an issue", () => {
  const all = rules(
    finding("understand", "You must be able to explain your change in review.", false),
    finding("agent", "If you are an AI agent, prefix the title with a robot.", true, 9),
    finding("issue-first", "Open an issue before changing behavior.", false, 5),
  );
  const found = check({ rules: all, understandingOff: true }, "project-rules");
  assert.deepEqual(found?.details.slice(1), [
    'CONTRIBUTING.md:3: "You must be able to explain your change in review." (your understanding check is off)',
    'CONTRIBUTING.md:9: "If you are an AI agent, prefix the title with a robot." (addressed to AI agents; you are the author, so decide whether it applies)',
    'CONTRIBUTING.md:5: "Open an issue before changing behavior." (no issue is linked to this run)',
  ]);
  // With the check on and an issue linked, only the agent note remains.
  assert.equal(check({ rules: all, issueUrl: "#sample-issue-42" }, "project-rules")?.details.length, 2);
});

test("issue-state lists assignments, claims, labels, locks, closed PRs and a missing hello", () => {
  const issue = {
    url: "#42",
    state: "OPEN",
    assignees: ["me", "other"],
    claims: [{ author: "renovate[bot]", at: "2026-10-01T00:00:00.000Z", bot: true }],
    labels: ["needs-triage"],
    locked: true,
    otherPrs: [{ number: 3, author: "past", state: "CLOSED", closedAt: new Date().toISOString() }],
    viewerCommented: false,
  };
  const found = check({ facts: facts({ issue }), rules: rules(finding("issue-first", "Open an issue before changing behavior.")), issueUrl: "#42" }, "issue-state");
  assert.deepEqual(found?.details.slice(1), [
    "Assigned to @other.",
    "Claimed by @renovate[bot] (a bot) on Oct 1, 2026.",
    "Labelled needs-triage: the maintainers may not be ready for a fix yet.",
    "The issue is locked.",
    "A pull request for this issue, #3 by @past, was closed without merging. Read why before you publish yours.",
    "The project asks for an issue first, and you have not commented on this one. Say hello on the issue before you publish.",
  ]);
  // A closed PR from long ago is history.
  const old = { ...issue, assignees: [], claims: [], labels: [], locked: false, viewerCommented: true, otherPrs: [{ number: 3, author: "past", state: "CLOSED", closedAt: "2020-01-01T00:00:00.000Z" }] };
  assert.equal(check({ facts: facts({ issue: old }) }, "issue-state"), undefined);
});

test("reviewability confirms a very large change, missing tests, files outside the plan, whitespace and new dependencies", () => {
  const found = check(
    {
      changes: snapshot({
        changedLines: 1500,
        files: 25,
        testFilesChanged: 0,
        band: "very-large",
        outsidePlan: ["src/extra.ts"],
        whitespaceOnly: ["src/format.ts"],
        newDependencies: [{ path: "package.json", name: "left-pad" }],
        mergedSizes: [{ number: 1, additions: 30, deletions: 12, changedFiles: 2 }],
      }),
    },
    "reviewability",
  );
  assert.deepEqual(found?.details.slice(1), [
    "1,500 changed lines in 25 files is above BELL PR's default of 1,000 lines or 20 files. Could this be split into separate changes?",
    "Source code changed, but no test did.",
    "Outside every task of the plan: src/extra.ts.",
    "Changes that only touch whitespace: src/format.ts.",
    "New dependencies: left-pad.",
    "For comparison, the project's last merged pull requests changed 42 lines.",
  ]);
  // Small source changes, docs-only changes and changes with tests do not ask about tests.
  assert.equal(check({ changes: snapshot({ changedLines: 15, testFilesChanged: 0 }) }, "reviewability"), undefined);
  assert.equal(check({ changes: snapshot({ changedLines: 90, testFilesChanged: 0, docsOnly: true, sourceChanged: false }) }, "reviewability"), undefined);
});

test("facts-unknown names what could not be read, and why", () => {
  const found = check({ rules: rules(), facts: facts({ unknown: ["door: HTTP 502", "issue", "something else"] }) }, "facts-unknown");
  assert.deepEqual(found?.details.slice(1), [
    "Couldn't check whether pull requests are open to you: HTTP 502",
    "Couldn't check the linked issue.",
    "Couldn't check a GitHub fact: something else",
  ]);
});

test("with facts, rules never read or files that could not be read are unknown too, never a pass", () => {
  // A project imported by an earlier build has no rules yet: an AI ban or a
  // required disclosure may be in them.
  assert.deepEqual(check({ facts: facts({}) }, "facts-unknown")?.details.slice(1), [
    "Couldn't check the project's rules: BELL PR hasn't read them yet.",
  ]);
  const unread = {
    ...rules(),
    unknown: ["rules: The project's files could not be read.", "orgDefaults: GitHub answered with an error.", "door"],
  };
  // The door is a GitHub fact, read again for the run; the rule files are not.
  assert.deepEqual(check({ rules: unread, facts: facts({}) }, "facts-unknown")?.details.slice(1), [
    "Couldn't check the project's rules: The project's files could not be read.",
    "Couldn't check the account's default contribution files: GitHub answered with an error.",
  ]);
  assert.equal(check({ rules: rules(), facts: facts({}) }, "facts-unknown"), undefined);
  // Without facts (approval, the Draft tab's text checks) it waits for publishing.
  assert.equal(check({ rules: unread }, "facts-unknown"), undefined);
  assert.equal(check({}, "facts-unknown"), undefined);
  const zh = draftPreflight({ body, facts: facts({}) }, "zh-TW").find((value) => value.id === "facts-unknown");
  assert.match(zh?.details[1] ?? "", /無法確認專案的規則/);
});

/** One input per confirm draftPreflight can emit, with every confirm it can raise at once. */
function everyConfirm(): DraftPreflightInput[] {
  const sources: DraftSource[] = [
    { id: "c", kind: "contributing", label: "CONTRIBUTING.md", content: "All PRs must reference an existing issue.\n\nWrite short, focused descriptions." },
  ];
  const busy = facts({
    issue: { url: "#1", state: "OPEN", assignees: ["other"] },
    pacing: { openPrs: 1, mergedPrs: 0 },
    unknown: ["door"],
  });
  return [
    {
      body: "- [ ] Tested\n\nSee /home/someone/project for details.",
      proposalBody: "- [ ] Tested\n\nSee /home/someone/project for details.",
      sources,
      changedPaths: [".github/workflows/ci.yml"],
      commitEmails: ["me@company.dev"],
      rules: rules(finding("ban", "We do not use AI tools for releases.", false)),
      facts: busy,
      changes: snapshot({ band: "very-large" }),
    },
    { body, proposalBody: body, facts: busy },
  ];
}

test("every confirm draftPreflight can emit is listed, and there are at most 16 for the publish dialog", () => {
  const confirms = new Set(
    everyConfirm().flatMap((input) =>
      draftPreflight(input).filter((value) => value.kind === "confirm").map((value) => value.id),
    ),
  );
  assert.deepEqual([...confirms].sort(), [
    "author-email",
    "brevity",
    "facts-unknown",
    "issue",
    "issue-state",
    "local-paths",
    "own-words",
    "pacing",
    "project-rules",
    "reviewability",
    "unchecked",
    "workflows",
  ]);
  // POST /api/runs/:id/publish accepts at most 16 acknowledged ids.
  assert.ok(confirms.size <= 16);
});

test("every respect message has a why line, no Han in English, and the same ids in zh-TW", () => {
  const inputs: DraftPreflightInput[] = [
    ...everyConfirm(),
    {
      body,
      proposalBody: body,
      rules: rules(
        finding("ban", "Pull requests made with AI tools are not accepted."),
        finding("disclose", "Disclose AI use."),
        finding("own-words", "Use your own words."),
        finding("area", "No AI on good first issues."),
      ),
      facts: facts({
        door: { hasPullRequests: false },
        issue: { url: "#1", state: "CLOSED", labels: ["good first issue"], otherPrs: [{ number: 2, author: "x", state: "OPEN" }] },
        pacing: { openPrs: 5, mergedPrs: 0 },
      }),
      changes: snapshot({ weakened: [{ id: "t.test.ts#0", path: "t.test.ts", line: 0, text: "" }] }),
    },
  ];
  const respectIds = new Set([
    "pr-closed", "ai-ban", "ai-disclosure", "own-words", "issue-closed", "issue-has-pr",
    "area-reserved", "tests-weakened", "pacing-max", "project-rules", "issue-state",
    "reviewability", "pacing", "facts-unknown",
  ]);
  const seen = new Set<string>();
  for (const input of inputs) {
    const english = draftPreflight(input, "en");
    const chinese = draftPreflight(input, "zh-TW");
    assert.deepEqual(
      chinese.map(({ id, kind }) => [id, kind]),
      english.map(({ id, kind }) => [id, kind]),
    );
    for (const value of english) {
      for (const text of [value.message, ...value.details]) assertNoHan(text);
      if (!respectIds.has(value.id)) continue;
      seen.add(value.id);
      assert.ok(value.details.length >= 1, value.id);
      assert.ok(value.details[0].length > 20, `${value.id} starts with why maintainers care`);
    }
    for (const value of chinese) assert.match(value.message, /\p{Script=Han}/u, value.id);
  }
  assert.deepEqual([...seen].sort(), [...respectIds].sort());
});
