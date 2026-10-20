// A Learn-by-hand run at approve and publish (DESIGN v1.2 F12): both
// callers fill the respect checks' Learn-by-hand input only for a clean
// run, the blocks stay blocks, the quoted confirm `by-hand-rules` (here
// from a test double of the decision) never blocks approval and must be
// acknowledged at publish, and it can never be overridden. Fake codex,
// claude and gh come first on PATH.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { byHandRulesDecisionInTests, type PolicyFinding } from "../shared/contribution.js";
import { changeFingerprint } from "../shared/change-fingerprint.js";
import { createApp } from "./index.js";
import { readDiff } from "./git.js";
import { git } from "./process.js";
import { publishChecks } from "./publish.js";
import { withLocale } from "./i18n/index.js";
import { Store } from "./store.js";
import { AppError, type Run } from "./types.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";
import { Workbench } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  skipUnderstandingCheckInTests(true);
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-publish-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  skipUnderstandingCheckInTests();
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

const qemu =
  "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.";
const carveOut = {
  line: 297,
  quote:
    "This policy does not apply to other uses of AI, such as researching APIs or algorithms, static analysis, or debugging, provided their output is not included in contributions.",
  kinds: ["explain" as const, "answer" as const, "test" as const],
};
const ban: PolicyFinding = {
  kind: "ban",
  path: "docs/devel/code-provenance.rst",
  line: 293,
  quote: qemu,
  contribution: true,
  allows: [carveOut],
};
const agentCopy = /^The project's rules do not accept AI-assisted contributions, and AI agents wrote this change\./;
const byHandCopy = /^The project's rules decline AI-generated content\. BELL PR's agents had no write access and gave you no code for this change\./;

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-publish-"));
  const repository = path.join(directory, "repo");
  await mkdir(path.join(repository, "src"), { recursive: true });
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "src", "retry.ts"), "export const attempts = 1;\n");
  await git(repository, ["add", "--", "."]);
  await git(repository, ["commit", "-m", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  t.after(async () => {
    byHandRulesDecisionInTests();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(repository);
  repo.contributionRules = {
    checkedAt: new Date().toISOString(),
    findings: [ban],
    filesRead: ["docs/devel/code-provenance.rst"],
  };
  const run: Run = {
    id: "lbh-publish-run",
    repoId: repo.id,
    title: "Retry twice",
    prompt: "Retry a GET twice after a 503.",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    locale: "en",
    learnByHand: true,
    agents: [
      { id: "lead", name: "Atlas", role: "Team lead", status: "complete", detail: "" },
      { id: "reviewer", name: "Lens", role: "Reviewer", status: "waiting", detail: "" },
      { id: "tester", name: "Scout", role: "Test analyst", status: "waiting", detail: "" },
    ],
    logs: [],
    draft: { title: "Retry a GET twice", body: "Retries a GET twice after a 503. I wrote it myself." },
    reviewedFiles: [],
    reviewedFingerprints: {},
    team: {
      config: { maxTeammates: 2, requirePlanApproval: true, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
      phase: "complete",
      planSummary: "",
      tasks: [],
      messages: [],
    },
    byHand: {
      events: [
        { at: new Date().toISOString(), kind: "explain", source: "premise" },
        { at: new Date().toISOString(), kind: "answer", source: "hint", rung: 1 },
      ],
    },
  };
  store.data.runs.push(run);
  await writeFile(path.join(repository, "src", "retry.ts"), "export const attempts = 2;\n");
  const files = await readDiff(run);
  for (const file of files)
    await workbench.review(run.id, file.path, true, file.fingerprint);
  // Approval takes only the version the person marked ready (W2A's Ready check in approve()).
  run.byHand!.ready = { at: new Date().toISOString(), changeFingerprint: changeFingerprint(files), review: false };
  return { directory, store, workbench, repo, run };
}

test("a clean Learn-by-hand run gets its own block copy at publish and approve; an unclean one the agent run's", async (t) => {
  const f = await fixture(t);
  const ids = async () => {
    const checks = await publishChecks(f.run, await readDiff(f.run), f.store.directory, "en", { repo: f.repo });
    return checks.find((check) => check.id === "ai-ban");
  };
  assert.match((await ids())!.message, byHandCopy);
  await assert.rejects(
    withLocale("en", () => f.workbench.approve(f.run.id, { ...f.run.draft })),
    (error: AppError) => error.statusCode === 422 && byHandCopy.test(error.message),
  );
  // The canary saw a write: the run's history withdraws the claim everywhere.
  f.run.byHand!.agentWrites = 1;
  assert.match((await ids())!.message, agentCopy);
  await assert.rejects(
    withLocale("en", () => f.workbench.approve(f.run.id, { ...f.run.draft })),
    (error: AppError) => error.statusCode === 422 && agentCopy.test(error.message),
  );
  // So does a teammate an older build added.
  f.run.byHand!.agentWrites = 0;
  f.run.agents.push({ id: "member-1", name: "Teammate 1", role: "Developer", status: "complete", detail: "" });
  assert.match((await ids())!.message, agentCopy);
});

test("the quoted confirm never blocks approval and is required in acknowledged at publish", async (t) => {
  const f = await fixture(t);
  byHandRulesDecisionInTests(() => ({
    blocked: [],
    confirmable: [{ finding: ban, allows: [carveOut], others: [] }],
  }));
  const preflight = await publishChecks(f.run, await readDiff(f.run), f.store.directory, "en", { repo: f.repo });
  assert.deepEqual(
    preflight.filter((check) => check.id === "by-hand-rules" || check.id === "ai-ban").map((check) => check.kind),
    ["confirm"],
  );
  assert.equal((await withLocale("en", () => f.workbench.approve(f.run.id, { ...f.run.draft }))).status, "approved");
  Object.assign(f.repo, { url: "https://github.com/test-owner/example", fullName: "test-owner/example", owner: "test-owner", name: "example" });
  const confirmFirst = (error: AppError) =>
    error.statusCode === 422 &&
    error.message.includes("The project declines AI-generated contributions, and its own text says some uses of AI are fine.");
  await assert.rejects(
    withLocale("en", () => f.workbench.publish(f.run.id, f.run.approvedFingerprint!, ["facts-unknown"])),
    confirmFirst,
  );
  // Acknowledged, publishing goes past the checks (and stops at the fake gh).
  await assert.rejects(
    withLocale("en", () => f.workbench.publish(f.run.id, f.run.approvedFingerprint!, ["facts-unknown", "by-hand-rules"])),
    (error: AppError) => !confirmFirst(error) && /\bgh\b/.test(error.message),
  );
});

test("an override of ai-ban or by-hand-rules is a 400 at the publish route", async (t) => {
  const f = await fixture(t);
  const app = createApp(f.workbench, { staticDirectory: path.join(f.directory, "missing") });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
  });
  const publish = (overrides: unknown) =>
    new Promise<number>((resolve, reject) => {
      const text = JSON.stringify({ fingerprint: "a".repeat(64), acknowledged: ["by-hand-rules"], overrides });
      const req = request(
        `http://127.0.0.1:${port}/api/runs/${f.run.id}/publish`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Host: "127.0.0.1:4311",
            "Content-Length": Buffer.byteLength(text),
          },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode!));
        },
      );
      req.on("error", reject);
      req.end(text);
    });
  const reason = "The maintainers said on the issue that it fits.";
  assert.equal(await publish([{ id: "by-hand-rules", reason }]), 400);
  assert.equal(await publish([{ id: "ai-ban", reason }]), 400);
  // Acknowledging the confirm is request data; it reaches publishing, which checks the approval first.
  assert.equal(await publish([]), 409);
});

test("a Learn-by-hand run's empty PR title reaches approval's own 422 at the route, never a schema error", async (t) => {
  const f = await fixture(t);
  // As the server starts a Learn-by-hand run: the PR title is the person's to write (DESIGN v1.2 F11).
  f.run.draft = { title: "", body: "Retries a GET twice after a 503. I wrote it myself." };
  // A project without AI rules, so approval stops only at the PR text.
  f.repo.contributionRules = { ...f.repo.contributionRules!, findings: [] };
  const app = createApp(f.workbench, { staticDirectory: path.join(f.directory, "missing") });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
  });
  const approve = (draft: Run["draft"]) =>
    new Promise<{ status: number; error?: string }>((resolve, reject) => {
      const text = JSON.stringify({ draft });
      const req = request(
        `http://127.0.0.1:${port}/api/runs/${f.run.id}/approve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Bell-Locale": "en",
            Host: "127.0.0.1:4311",
            "Content-Length": Buffer.byteLength(text),
          },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => (body += chunk));
          response.on("end", () => resolve({ status: response.statusCode!, error: (JSON.parse(body) as { error?: string }).error }));
        },
      );
      req.on("error", reject);
      req.end(text);
    });
  assert.deepEqual(await approve({ ...f.run.draft }), { status: 422, error: "Fill in the PR title and description first." });
  assert.equal(f.run.status, "review");
  // The title the person writes and saves is approved as before.
  f.run.draft = { ...f.run.draft, title: "Retry a GET twice" };
  assert.equal((await approve({ ...f.run.draft })).status, 200);
  assert.equal(f.run.status, "approved");
});
