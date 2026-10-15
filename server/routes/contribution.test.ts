// The respect routes over HTTP: strict requests, open on every plan, GitHub
// read only by the refresh and check routes (never by the publish dialog's
// preflight), and the weakened-test reasons. gh is the fake GitHub's, first
// on PATH; nothing reaches the network.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { weakenedTests } from "../../shared/reviewability.js";
import { fakeGitHub, type FakeFacts } from "../../test/fake-github.js";
import { createApp } from "../index.js";
import { readDiff } from "../git.js";
import { fixedLicense } from "../license.js";
import { git } from "../process.js";
import { Store } from "../store.js";
import type { Run } from "../types.js";
import { skipUnderstandingCheckInTests } from "../understanding.js";
import { Workbench } from "../workbench.js";

before(() => skipUnderstandingCheckInTests(true));
after(() => skipUnderstandingCheckInTests());

const issueUrl = "https://github.com/test-owner/example/issues/5";
const testFile = "tests/a.test.ts";

async function serve(t: TestContext, facts: FakeFacts = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-contribution-routes-"));
  const github = await fakeGitHub(directory, {
    files: {
      "src/a.ts": "export const a = 0;\n",
      [testFile]: "it('a', () => {\n  expect(a).toBe(0);\n});\n",
      "CONTRIBUTING.md": "Open an issue before you send a pull request.\n",
    },
  });
  await github.setFacts(facts);
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  const repo = await workbench.importRepository(github.url);
  const baseSha = (await git(repo.path, ["rev-parse", "HEAD"])).stdout.trim();
  const worktreePath = path.join(store.directory, "worktrees", "route-run");
  await git(repo.path, ["worktree", "add", "-q", "-b", "fix/route0001", worktreePath, baseSha]);
  const run: Run = {
    id: "route-run",
    repoId: repo.id,
    title: "Change a",
    prompt: "Change a.",
    status: "review",
    branch: "fix/route0001",
    baseBranch: "main",
    baseSha,
    worktreePath,
    createdAt: new Date().toISOString(),
    locale: "en",
    agents: [],
    logs: [],
    draft: { title: "fix: change a", body: "Changes a and its test." },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  store.data.runs.push(run);
  // A skipped test and a removed assertion: two weakened-test items.
  await writeFile(path.join(worktreePath, "src/a.ts"), "export const a = 1;\n");
  await writeFile(path.join(worktreePath, testFile), "it.skip('a', () => {\n});\n");
  const app = createApp(workbench, {
    staticDirectory: path.join(directory, "missing"),
    license: fixedLicense("free"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    github.restore();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const call = (method: string, endpoint: string, body?: unknown) =>
    new Promise<{ status: number; body: Record<string, ReturnType<typeof JSON.parse>> }>((resolve, reject) => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        `http://127.0.0.1:${port}/api${endpoint}`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            Host: "127.0.0.1:4311",
            "X-Bell-Locale": "en",
            ...(text === undefined ? {} : { "Content-Length": Buffer.byteLength(text) }),
          },
        },
        (response) => {
          let received = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (received += chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode!, body: received ? JSON.parse(received) : {} }),
          );
        },
      );
      req.on("error", reject);
      req.end(text);
    });
  const ghCalls = async () => (await github.calls()).filter((entry) => entry[0] === "gh").length;
  return { call, github, workbench, store, repo, run, ghCalls, directory };
}

test("the rules card reads what is stored, and Check again reads the project again", async (t) => {
  const f = await serve(t);
  const before = await f.ghCalls();
  const stored = await f.call("GET", `/repos/${f.repo.id}/contribution-rules`);
  assert.equal(stored.status, 200);
  assert.deepEqual(stored.body.rules.findings.map((finding: { kind: string }) => finding.kind), ["issue-first"]);
  assert.equal(await f.ghCalls(), before);
  await f.github.setFacts({ door: { archived: true } });
  const refreshed = await f.call("POST", `/repos/${f.repo.id}/contribution-rules/refresh`, {});
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.rules.door.archived, true);
  assert.ok((await f.ghCalls()) > before);
  assert.equal(f.repo.contributionRules?.door?.archived, true);
  assert.equal((await f.call("POST", `/repos/${f.repo.id}/contribution-rules/refresh`, { force: true })).status, 400);
  assert.equal((await f.call("GET", "/repos/missing/contribution-rules")).status, 404);
});

test("the task dialog's check reads the issue and the pace, and validates the link like the task form", async (t) => {
  const f = await serve(t, {
    door: { viewerPermission: "READ" },
    issues: {
      5: {
        number: 5,
        title: "Retry errors",
        url: issueUrl,
        state: "OPEN",
        stateReason: null,
        locked: false,
        labels: { nodes: [{ name: "good first issue" }] },
        assignees: { nodes: [] },
        comments: { totalCount: 0, nodes: [] },
        closedByPullRequestsReferences: { nodes: [] },
        timelineItems: { nodes: [] },
      },
    },
    pacing: { open: 1, merged: 0 },
  });
  const checked = await f.call("GET", `/repos/${f.repo.id}/contribution-check?issue=${encodeURIComponent(issueUrl)}`);
  assert.equal(checked.status, 200);
  assert.equal(checked.body.facts.issue.state, "OPEN");
  assert.deepEqual(checked.body.facts.issue.labels, ["good first issue"]);
  assert.deepEqual(checked.body.facts.pacing, { openPrs: 1, mergedPrs: 0, waitingPrs: 0, viewerPermission: "READ" });
  // No door is read here; only the person's login comes back with the facts.
  assert.deepEqual(checked.body.facts.door, { login: "test-owner" });
  // Not stored on any run.
  assert.equal(f.run.contributionFacts, undefined);
  const noIssue = await f.call("GET", `/repos/${f.repo.id}/contribution-check`);
  assert.equal(noIssue.status, 200);
  assert.equal(noIssue.body.facts.issue, undefined);
  for (const query of [
    `?issue=${encodeURIComponent("https://github.com/test-owner/example/pull/5")}`,
    `?issue=${encodeURIComponent(issueUrl)}&issue=${encodeURIComponent(issueUrl)}`,
    `?issue=${encodeURIComponent(issueUrl)}&extra=1`,
  ]) {
    const refused = await f.call("GET", `/repos/${f.repo.id}/contribution-check${query}`);
    assert.equal(refused.status, 400, query);
  }
  // A GitHub failure is an answer with unknown facts, never an error.
  await f.github.setFacts({ fail: { issue: "exit", viewer: "exit", pacing: "exit" } });
  const failed = await f.call("GET", `/repos/${f.repo.id}/contribution-check?issue=${encodeURIComponent(issueUrl)}`);
  assert.equal(failed.status, 200);
  assert.deepEqual(failed.body.facts.unknown, ["issue: github-error", "pacing: github-error"]);
});

test("the publish dialog refreshes the run's facts on its own call; the preflight never calls GitHub", async (t) => {
  const f = await serve(t, { door: { pull_request_creation_policy: "collaborators_only", viewerPermission: "READ" } });
  const before = await f.ghCalls();
  const preflight = await f.call("GET", `/runs/${f.run.id}/preflight`);
  assert.equal(preflight.status, 200);
  assert.ok(!preflight.body.checks.some((check: { id: string }) => check.id === "pr-closed"));
  assert.equal(await f.ghCalls(), before);
  const refreshed = await f.call("POST", `/runs/${f.run.id}/contribution-facts/refresh`, {});
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.run.contributionFacts.door.pullRequestCreationPolicy, "collaborators_only");
  assert.ok((await f.ghCalls()) > before);
  // Saved, and the preflight now shows it without another call.
  const saved = JSON.parse(await readFile(path.join(f.store.directory, "state.json"), "utf8"));
  assert.equal(saved.runs[0].contributionFacts.door.viewerPermission, "READ");
  const afterRefresh = await f.ghCalls();
  const blocked = await f.call("GET", `/runs/${f.run.id}/preflight`);
  assert.ok(blocked.body.checks.some((check: { id: string; kind: string }) => check.id === "pr-closed" && check.kind === "block"));
  assert.equal(await f.ghCalls(), afterRefresh);
  assert.equal((await f.call("POST", `/runs/${f.run.id}/contribution-facts/refresh`, { now: true })).status, 400);
  assert.equal((await f.call("POST", "/runs/missing/contribution-facts/refresh", {})).status, 404);
});

test("weakened-test reasons are saved per current item, at least 3 words each, and clear the block", async (t) => {
  const f = await serve(t);
  const skip = "tests/a.test.ts#1";
  const removed = "tests/a.test.ts#-2";
  assert.deepEqual(
    weakenedTests(await readDiff(f.run)).map((item) => item.id).sort(),
    [removed, skip],
  );
  const blocks = async () =>
    ((await f.call("GET", `/runs/${f.run.id}/preflight`)).body.checks as { id: string }[])
      .filter((check) => check.id === "tests-weakened").length;
  assert.equal(await blocks(), 1);
  // Too short, too long, not strict, too many, not text.
  for (const body of [
    { reasons: { [skip]: "flaky" } },
    { reasons: { [skip]: "x ".repeat(160) } },
    { reasons: { [skip]: "The case is flaky upstream." }, extra: true },
    { reasons: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`x#${index}`, "a b c"])) },
    { reasons: { [skip]: 3 } },
  ]) {
    const refused = await f.call("PUT", `/runs/${f.run.id}/test-reasons`, body);
    assert.ok([400, 422].includes(refused.status), JSON.stringify(body).slice(0, 80));
  }
  assert.equal(f.run.reviewability, undefined);
  const first = await f.call("PUT", `/runs/${f.run.id}/test-reasons`, {
    reasons: { [skip]: "  The case is flaky upstream, see issue 12.  ", "tests/gone.test.ts#4": "An item that no longer exists." },
  });
  assert.equal(first.status, 200);
  // Trimmed, and a key the change does not have dropped.
  assert.deepEqual(first.body.run.reviewability, { testReasons: { [skip]: "The case is flaky upstream, see issue 12." } });
  assert.equal(await blocks(), 1);
  const second = await f.call("PUT", `/runs/${f.run.id}/test-reasons`, {
    reasons: { [removed]: "The skipped case takes its assertion with it." },
  });
  // Merged with the reasons already saved; every item explained, no block.
  assert.deepEqual(Object.keys(second.body.run.reviewability.testReasons).sort(), [removed, skip]);
  assert.equal(await blocks(), 0);
  // An empty line removes that reason again.
  const cleared = await f.call("PUT", `/runs/${f.run.id}/test-reasons`, { reasons: { [skip]: "" } });
  assert.deepEqual(Object.keys(cleared.body.run.reviewability.testReasons), [removed]);
  assert.equal(await blocks(), 1);
  // Once the change edits the assertion instead of removing it, its reason goes.
  await writeFile(path.join(f.run.worktreePath, testFile), "it.skip('a', () => {\n  expect(a).toBe(1);\n});\n");
  const moved = await f.call("PUT", `/runs/${f.run.id}/test-reasons`, { reasons: {} });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.run.reviewability, undefined);
  assert.equal(await blocks(), 1);
  // Only while the run is open for review.
  f.run.status = "published";
  assert.equal((await f.call("PUT", `/runs/${f.run.id}/test-reasons`, { reasons: {} })).status, 409);
});

test("every respect route is open on the Free plan", async (t) => {
  const f = await serve(t);
  for (const [method, endpoint, body] of [
    ["GET", `/repos/${f.repo.id}/contribution-rules`, undefined],
    ["POST", `/repos/${f.repo.id}/contribution-rules/refresh`, {}],
    ["GET", `/repos/${f.repo.id}/contribution-check`, undefined],
    ["POST", `/runs/${f.run.id}/contribution-facts/refresh`, {}],
    ["PUT", `/runs/${f.run.id}/test-reasons`, { reasons: {} }],
  ] as const) {
    const response = await f.call(method, endpoint, body);
    assert.equal(response.status, 200, `${method} ${endpoint}: ${JSON.stringify(response.body)}`);
  }
  const source = await readFile(path.join(import.meta.dirname, "contribution.ts"), "utf8");
  assert.doesNotMatch(source, /requirePro|assertModelEntitlement/);
});
