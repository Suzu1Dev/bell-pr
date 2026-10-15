// The respect facts against a fake GitHub (test/fake-github.ts): the
// project's rules and door at import, the run's live facts at publish, the
// ways a read fails, and GitHub's open-PR cap. gh is the fake's, first on
// PATH; nothing reaches the network.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { draftPreflight } from "../shared/draft-checks.js";
import type { ContributionFacts } from "../shared/contribution.js";
import type { ContributionSettings } from "../shared/insights.js";
import { fakeGitHub, prCapMessage, type FakeFacts } from "../test/fake-github.js";
import { explainPrCreateFailure, refreshRunFacts } from "./contribution-facts.js";
import { readDiff } from "./git.js";
import { withLocale } from "./i18n/index.js";
import { git } from "./process.js";
import { Store } from "./store.js";
import { AppError, type Run } from "./types.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";
import { Workbench } from "./workbench.js";

before(() => skipUnderstandingCheckInTests(true));
after(() => skipUnderstandingCheckInTests());

const identity = {
  GIT_AUTHOR_NAME: "Facts Test",
  GIT_AUTHOR_EMAIL: "facts@example.invalid",
  GIT_COMMITTER_NAME: "Facts Test",
  GIT_COMMITTER_EMAIL: "facts@example.invalid",
};

const issueUrl = "https://github.com/test-owner/example/issues/5";

/** A GraphQL issue as the fake GitHub answers it. */
const issueNode = (overrides: Record<string, unknown> = {}) => ({
  number: 5,
  title: "Explain the retry error",
  url: issueUrl,
  state: "OPEN",
  stateReason: null,
  locked: false,
  author: { login: "reporter" },
  labels: { nodes: [] },
  assignees: { nodes: [] },
  comments: { totalCount: 0, nodes: [] },
  closedByPullRequestsReferences: { nodes: [] },
  timelineItems: { nodes: [] },
  ...overrides,
});

/**
 * BELL's clone of a fake GitHub repository with policy files, imported
 * through the GitHub path, and a run on it with one reviewed change.
 */
async function githubProject(facts: FakeFacts = {}, files: Record<string, string> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-facts-"));
  const github = await fakeGitHub(directory, {
    files: { "hello.ts": "export const hello = 1;\n", ...files },
  });
  await github.setFacts(facts);
  const previous = Object.fromEntries(Object.keys(identity).map((key) => [key, process.env[key]]));
  Object.assign(process.env, identity);
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  const repo = await workbench.importRepository(github.url);
  const baseSha = (await git(repo.path, ["rev-parse", "HEAD"])).stdout.trim();
  const worktreePath = path.join(store.directory, "worktrees", "facts-run");
  await git(repo.path, ["worktree", "add", "-q", "-b", "fix/facts0001", worktreePath, baseSha]);
  const run: Run = {
    id: "facts-run",
    repoId: repo.id,
    title: "Update hello",
    prompt: "Update hello",
    status: "review",
    branch: "fix/facts0001",
    baseBranch: "main",
    baseSha,
    worktreePath,
    createdAt: new Date().toISOString(),
    locale: "en",
    agents: [],
    logs: [],
    draft: { title: "fix: update hello", body: "Changes the exported value of hello." },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  store.data.runs.push(run);
  return {
    directory,
    github,
    store,
    workbench,
    repo,
    run,
    approve: async () => {
      await writeFile(path.join(worktreePath, "hello.ts"), "export const hello = 2;\n");
      for (const file of await readDiff(run))
        await workbench.review(run.id, file.path, true, file.fingerprint);
      await workbench.approve(run.id, { ...run.draft });
    },
    cleanup: async () => {
      github.restore();
      for (const [key, value] of Object.entries(previous))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      await workbench.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** Contribution settings that link the run to issue 5. */
const withIssue: ContributionSettings = {
  direction: "bugfix",
  targetUser: "",
  outcome: "",
  constraints: "",
  acceptance: "",
  maxTeammates: 2,
  requirePlanApproval: true,
  ponytailMode: "lite",
  issueUrl,
};

const ghCalls = async (f: { github: { calls(): Promise<string[][]> } }) =>
  (await f.github.calls()).filter((call) => call[0] === "gh");
const ids = (facts: ContributionFacts, body = "Changes the exported value of hello.") =>
  draftPreflight({ body, facts }).map((check) => `${check.id}:${check.kind}`);

test("a GitHub import reads the project's rules, its door and the size reference", async () => {
  const f = await githubProject(
    {
      door: { pull_request_creation_policy: "collaborators_only", viewerPermission: "READ" },
      mergedSizes: [{ number: 9, additions: 12, deletions: 3, changedFiles: 2 }],
      accountDefaults: {
        "PULL_REQUEST_TEMPLATE.md": "## Summary\n\n<!-- Describe the change in your own words. -->\n",
      },
    },
    {
      "AI_POLICY.md": "# AI policy\n\nAll AI usage must be disclosed in the pull request.\n",
      ".gitattributes": "gen/** linguist-generated\n",
    },
  );
  try {
    const rules = f.repo.contributionRules!;
    assert.equal(rules.baseSha, (await git(f.repo.path, ["rev-parse", "HEAD"])).stdout.trim());
    assert.deepEqual(rules.door, {
      viewerPermission: "READ",
      login: "test-owner",
      hasPullRequests: true,
      archived: false,
      disabled: false,
      pullRequestCreationPolicy: "collaborators_only",
    });
    assert.deepEqual(rules.mergedSizes, [{ number: 9, additions: 12, deletions: 3, changedFiles: 2 }]);
    assert.deepEqual(rules.generated, ["gen/**"]);
    assert.equal(rules.orgDefaults, "test-owner/.github");
    assert.deepEqual(rules.filesRead, ["AI_POLICY.md", "test-owner/.github/PULL_REQUEST_TEMPLATE.md"]);
    assert.deepEqual(
      rules.findings.map((finding) => [finding.kind, finding.path, finding.line]),
      [
        ["disclose", "AI_POLICY.md", 3],
        ["own-words", "test-owner/.github/PULL_REQUEST_TEMPLATE.md", 3],
      ],
    );
    assert.equal(rules.unknown, undefined);
    // Saved with the project.
    const saved = new Store(f.store.directory);
    await saved.initialize();
    assert.deepEqual(saved.data.repos[0].contributionRules, rules);
    const calls = await ghCalls(f);
    assert.ok(calls.some((call) => call.at(-1) === "repos/test-owner/example" && call.includes("--hostname")));
    assert.ok(calls.some((call) => call.some((arg) => arg.startsWith("query=query BellDoor"))));
  } finally {
    await f.cleanup();
  }
});

test("a local-folder import reads the project's files and runs no gh at all", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-facts-local-"));
  // The fake's gh records every call, so a call would show.
  const github = await fakeGitHub(directory, { files: { "a.txt": "a\n" } });
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  try {
    for (const [name, origin] of [
      ["plain", undefined],
      ["checkout", "https://github.com/test-owner/example.git"],
    ] as const) {
      const local = path.join(directory, name);
      await mkdir(local);
      await git(local, ["init", "-q", "-b", "main"]);
      await git(local, ["config", "user.name", "Local"]);
      await git(local, ["config", "user.email", "local@example.invalid"]);
      await writeFile(path.join(local, "CONTRIBUTING.md"), "Open an issue before you send a pull request.\n");
      await git(local, ["add", "."]);
      await git(local, ["commit", "-qm", "local"]);
      if (origin) await git(local, ["remote", "add", "origin", origin]);
      const repo = await workbench.importRepository(local);
      assert.deepEqual(repo.contributionRules?.unknown, ["door"], name);
      assert.deepEqual(repo.contributionRules?.filesRead, ["CONTRIBUTING.md"]);
      assert.deepEqual(repo.contributionRules?.findings.map((finding) => finding.kind), ["issue-first"]);
      assert.equal(repo.contributionRules?.door, undefined);
    }
    assert.deepEqual((await github.calls()).filter((call) => call[0] === "gh"), []);
  } finally {
    github.restore();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an import whose GitHub reads fail still imports and records why", async () => {
  const f = await githubProject({
    fail: { door: "exit", doorGraph: "invalid", accountDefaults: "rate-limited" },
  });
  try {
    assert.equal(f.store.data.repos.length, 1);
    assert.deepEqual(f.repo.contributionRules?.unknown, [
      "door: 無法讀取 GitHub 的回應。",
      "orgDefaults: 已達 GitHub 的速率上限。請等幾分鐘，再檢查一次。",
    ]);
    // "Check again" reads it again, in the request's language.
    await f.github.setFacts({});
    const rules = await withLocale("en", () => f.workbench.contribution.refreshRules(f.repo.id));
    assert.equal(rules?.unknown, undefined);
    assert.equal(rules?.door?.viewerPermission, "WRITE");
    assert.equal(f.repo.contributionRules, rules);
    await f.github.setFacts({ fail: { door: "exit", doorGraph: "exit" } });
    const failed = await withLocale("en", () => f.workbench.contribution.refreshRules(f.repo.id));
    assert.deepEqual(failed?.unknown, ["door: GitHub answered with an error."]);
  } finally {
    await f.cleanup();
  }
});

test("a collaborators-only repository without write access gives pr-closed; triage may still open pull requests", async () => {
  const f = await githubProject();
  try {
    for (const [door, closed] of [
      [{ pull_request_creation_policy: "collaborators_only", viewerPermission: "READ" }, true],
      [{ pull_request_creation_policy: "collaborators_only", viewerPermission: null }, true],
      [{ pull_request_creation_policy: "collaborators_only", viewerPermission: "TRIAGE" }, false],
      [{ has_pull_requests: false, viewerPermission: "ADMIN" }, true],
      [{ archived: true }, true],
      [{ viewerPermission: "READ" }, false],
    ] as const) {
      await f.github.setFacts({ door });
      const facts = (await refreshRunFacts({ store: f.store } as never, f.run))!;
      assert.equal(facts.unknown, undefined, JSON.stringify(facts.unknown));
      assert.equal(ids(facts).includes("pr-closed:block"), closed, JSON.stringify(door));
    }
  } finally {
    await f.cleanup();
  }
});

test("the linked issue and the person's pace come from the live facts", async () => {
  const f = await githubProject();
  f.run.contributionSettings = withIssue;
  const read = async (facts: FakeFacts) => {
    await f.github.setFacts(facts);
    return (await refreshRunFacts({ store: f.store } as never, f.run))!;
  };
  try {
    const closed = await read({ issues: { 5: issueNode({ state: "CLOSED", stateReason: "COMPLETED" }) } });
    assert.ok(ids(closed).includes("issue-closed:block"));
    const taken = await read({
      door: { viewerPermission: "READ" },
      issues: {
        5: issueNode({
          closedByPullRequestsReferences: {
            nodes: [{ number: 8, state: "OPEN", isDraft: false, merged: false, url: "https://github.com/test-owner/example/pull/8", author: { login: "someone" } }],
          },
        }),
      },
      pacing: { open: 1, merged: 0 },
    });
    assert.deepEqual(taken.issue?.otherPrs?.map((pr) => [pr.number, pr.willClose]), [[8, true]]);
    assert.ok(ids(taken).includes("issue-has-pr:block"));
    assert.ok(ids(taken).includes("pacing:confirm"));
    assert.deepEqual(taken.pacing, { openPrs: 1, mergedPrs: 0, waitingPrs: 0, viewerPermission: "READ" });
    const busy = await read({ door: { viewerPermission: "READ" }, issues: { 5: issueNode() }, pacing: { open: 2, merged: 0 } });
    assert.ok(ids(busy).includes("pacing-max:block"));
    // With write access the pace is not read at all.
    const before = (await ghCalls(f)).length;
    const maintainer = await read({ door: { viewerPermission: "MAINTAIN" }, issues: { 5: issueNode() }, pacing: { open: 9 } });
    assert.deepEqual(maintainer.pacing, { viewerPermission: "MAINTAIN" });
    assert.ok(!ids(maintainer).some((id) => id.startsWith("pacing")));
    const calls = (await ghCalls(f)).slice(before);
    assert.ok(!calls.some((call) => call.some((arg) => arg.includes("BellPacing"))));
  } finally {
    await f.cleanup();
  }
});

test("a GitHub failure gives facts-unknown with its reason, never a pass", async () => {
  const f = await githubProject();
  f.run.contributionSettings = withIssue;
  const all = { door: true, doorGraph: true, issue: true, pacing: true, viewer: true };
  try {
    for (const [mode, reason] of [
      ["exit", "GitHub answered with an error."],
      ["invalid", "GitHub's answer could not be read."],
      ["rate-limited", "GitHub's rate limit was reached. Wait a few minutes, then check again."],
      ["not-found", "GitHub did not find it, or it is not visible to your account."],
      ["timeout", "GitHub did not answer in time."],
    ] as const) {
      await f.github.setFacts({
        // Facts that would block, were they read.
        door: { has_pull_requests: false },
        issues: { 5: issueNode({ state: "CLOSED" }) },
        pacing: { open: 9 },
        fail: Object.fromEntries(Object.keys(all).map((key) => [key, mode])),
      });
      const started = Date.now();
      const facts = (await withLocale("en", () =>
        refreshRunFacts({ store: f.store } as never, f.run, { timeoutMs: mode === "timeout" ? 1_500 : 10_000 }),
      ))!;
      assert.ok(Date.now() - started < 9_000, mode);
      assert.deepEqual(facts.unknown, [`door: ${reason}`, `issue: ${reason}`, `pacing: ${reason}`], mode);
      assert.equal(facts.door, undefined);
      assert.equal(facts.issue, undefined);
      assert.deepEqual(ids(facts), ["facts-unknown:confirm"], mode);
    }
    // No gh at all.
    const previous = process.env.PATH;
    process.env.PATH = path.join(f.directory, "no-binaries");
    try {
      const facts = (await withLocale("en", () => refreshRunFacts({ store: f.store } as never, f.run)))!;
      assert.equal(facts.unknown?.[0], "door: The GitHub CLI (gh) is not installed.");
      assert.deepEqual(ids(facts), ["facts-unknown:confirm"]);
    } finally {
      process.env.PATH = previous;
    }
    // A project without a GitHub origin runs no gh and is never a pass.
    const before = (await ghCalls(f)).length;
    const local = { ...f.repo, id: "local-repo", url: "", fullName: "local/example" };
    f.store.data.repos.push(local);
    const facts = (await withLocale("en", () =>
      refreshRunFacts({ store: f.store } as never, { ...f.run, repoId: local.id }),
    ))!;
    assert.equal((await ghCalls(f)).length, before);
    assert.deepEqual(facts.unknown?.map((entry) => entry.split(":")[0]), ["door", "issue", "pacing"]);
  } finally {
    await f.cleanup();
  }
});

test("publish reads the facts live: a closed issue stops it before anything is pushed", async () => {
  const f = await githubProject();
  try {
    f.run.contributionSettings = withIssue;
    await f.approve();
    // The stored snapshot says open; GitHub now says closed.
    f.run.contributionFacts = { checkedAt: "2026-10-01T00:00:00.000Z", issue: { url: issueUrl, state: "OPEN" } };
    await f.github.setFacts({ issues: { 5: issueNode({ state: "CLOSED", stateReason: "COMPLETED" }) } });
    await assert.rejects(
      withLocale("en", () => f.workbench.publish(f.run.id, f.run.approvedFingerprint!)),
      (error: AppError) => error.statusCode === 422 && /^The linked issue is closed\./.test(error.message),
    );
    assert.equal(f.run.contributionFacts?.issue?.state, "CLOSED");
    assert.equal(f.run.publishCommit, undefined);
    assert.ok(!(await f.github.calls()).some((call) => call.includes("push")));
  } finally {
    await f.cleanup();
  }
});

test("GitHub's limit on open pull requests is explained in plain words", async () => {
  const f = await githubProject({ prCreate: "cap" });
  try {
    await f.approve();
    await assert.rejects(
      withLocale("en", () => f.workbench.publish(f.run.id, f.run.approvedFingerprint!)),
      (error: AppError) =>
        error.statusCode === 422 &&
        error.message.startsWith("GitHub limits how many pull requests one person can have open in this repository"),
    );
    assert.equal(f.run.status, "approved");
    assert.match(f.run.error ?? "", /GitHub limits how many pull requests/);
  } finally {
    await f.cleanup();
  }
});

test("only a failure that names GitHub's open pull request limit is explained", () => {
  const failure = (stderr: string) =>
    new AppError(`gh failed: ${stderr}`, 422, { details: { stderr, exitCode: 1 } });
  const explained = withLocale("en", () => explainPrCreateFailure(failure(prCapMessage)));
  assert.equal(explained?.statusCode, 422);
  assert.match(explained!.message, /^GitHub limits how many pull requests/);
  for (const stderr of [
    "You have reached the limit of open pull requests for this repository.",
    "pull request create failed: too many open pull requests by this user",
    "Open pull requests limit exceeded (createPullRequest)",
  ])
    assert.ok(explainPrCreateFailure(failure(stderr)), stderr);
  for (const stderr of [
    "a pull request for branch \"fix\" into branch \"main\" already exists",
    "gh: API rate limit exceeded for user. (HTTP 403)",
    "GraphQL: Head sha can't be blank (createPullRequest)",
  ])
    assert.equal(explainPrCreateFailure(failure(stderr)), undefined, stderr);
  assert.equal(explainPrCreateFailure(new Error(prCapMessage)), undefined);
  assert.equal(explainPrCreateFailure("open pull requests limit"), undefined);
});
