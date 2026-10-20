// The quoted confirm end to end over HTTP (DESIGN v1.2 F12, owner answer 2):
// the real classifier reads a QEMU-shaped project's rules from the clone,
// POST /api/runs fits a Learn-by-hand run to them (the real
// byHandRulesCase), and a clean run in review then goes through the
// preflight, "Check again", Ready, approve and publish routes with the real
// byHandRulesDecision: publishing is refused (422) until `by-hand-rules`
// is acknowledged with the digest of the words the preflight showed (other
// or changed words are refused), an override with that id is a 400, and
// acknowledged it publishes. An assistance ban stays a block with no
// confirm; an agent run's checks carry no digest. A local bare
// repository stands in for GitHub (fake git and gh); agent turns never run.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { changeFingerprint } from "../shared/change-fingerprint.js";
import { byHandRulesCase } from "../shared/by-hand-rules.js";
import { byHandBlockClause } from "../shared/contribution.js";
import { defaultContributionSettings } from "../shared/insights.js";
import type { DraftCheck } from "../shared/draft-checks.js";
import { fakeGitHub } from "../test/fake-github.js";
import { createApp } from "./index.js";
import { readDiff } from "./git.js";
import { git } from "./process.js";
import { Store } from "./store.js";
import type { TeamAgentRunner } from "./team.js";
import type { Run } from "./types.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";
import { Workbench } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  skipUnderstandingCheckInTests(true);
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-rules-routes-bin-"));
  for (const name of ["codex", "claude"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  skipUnderstandingCheckInTests();
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

/** Agent turns wait until the run stops, so nothing runs past creation. */
const workUntilStopped: TeamAgentRunner = (input) =>
  new Promise((_resolve, reject) => {
    if (input.signal.aborted) reject(new Error("stopped"));
    input.signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
  });

const qemuPath = "docs/devel/code-provenance.rst";
const qemuBan =
  "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.";
const qemuCarveOut =
  "This policy does not apply to other uses of AI, such as researching APIs or algorithms, static analysis, or debugging, provided their output is not included in contributions.";
const gentoo =
  "It is expressly forbidden to contribute to Gentoo any content that has been created with the assistance of Natural Language Processing artificial intelligence tools.";
const prompt = "Retry a GET twice after a 503.";
const branch = "fix/rules0001";

/** A project on the fake GitHub with `files`, imported (its rules read now), served over HTTP. */
async function serve(t: TestContext, files: Record<string, string>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-rules-routes-"));
  const github = await fakeGitHub(directory, {
    files: { "src/retry.ts": "export const attempts = 1;\n", "README.md": "# Example\n", ...files },
  });
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store, workUntilStopped, {
    getModelCatalog: async (provider) => ({ models: [], source: provider ?? "codex" }),
  });
  workbench.status = async () => ({
    codex: true,
    codexAuthenticated: true,
    claude: true,
    claudeAuthenticated: true,
    github: true,
  });
  const repo = await workbench.importRepository(github.url);
  const app = createApp(workbench, { staticDirectory: path.join(directory, "missing") });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    github.restore();
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
          response.on("end", () => resolve({ status: response.statusCode!, body: received ? JSON.parse(received) : {} }));
        },
      );
      req.on("error", reject);
      req.end(text);
    });
  return { directory, store, workbench, repo, call };
}

type Served = Awaited<ReturnType<typeof serve>>;

/**
 * A clean Learn-by-hand run in review, as the person leaves it: one change
 * written by hand, the guide's explanations, answers and test help used,
 * every file reviewed, the change marked Ready; fitted with `helpLock`.
 */
async function reviewRun(f: Served, extra: Pick<Run, "createdAt"> & { helpLock?: NonNullable<Run["byHand"]>["helpLock"] }) {
  const baseSha = (await git(f.repo.path, ["rev-parse", "HEAD"])).stdout.trim();
  const worktreePath = path.join(f.store.directory, "worktrees", "rules-run");
  await git(f.repo.path, ["worktree", "add", "-q", "-b", branch, worktreePath, baseSha]);
  await git(worktreePath, ["config", "user.name", "BELL Test"]);
  await git(worktreePath, ["config", "user.email", "test@example.invalid"]);
  const at = extra.createdAt;
  const run: Run = {
    id: "rules-run",
    repoId: f.repo.id,
    title: "Retry twice",
    prompt,
    status: "review",
    branch,
    baseBranch: "main",
    baseSha,
    worktreePath,
    createdAt: at,
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
    reports: {},
    team: {
      config: { maxTeammates: 2, requirePlanApproval: true, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
      phase: "developing",
      planSummary: "",
      tasks: [],
      messages: [],
    },
    byHand: {
      ...(extra.helpLock ? { helpLock: extra.helpLock } : {}),
      plan: { steps: [{ id: "s1", title: "Retry the GET" }], savedAt: at, confirmedAt: at },
      events: [
        { at, kind: "explain", source: "premise" },
        { at, kind: "answer", source: "hint", rung: 1 },
        { at, kind: "test", source: "test" },
      ],
    },
  };
  f.store.data.runs.push(run);
  await writeFile(path.join(worktreePath, "src/retry.ts"), "export const attempts = 2;\n");
  const files = await readDiff(run);
  const ready = await f.call("POST", `/runs/${run.id}/by-hand/ready`, { changeFingerprint: changeFingerprint(files), review: false });
  assert.equal(ready.status, 200, JSON.stringify(ready.body));
  for (const file of files) {
    const reviewed = await f.call("POST", `/runs/${run.id}/review`, { filePath: file.path, reviewed: true, fingerprint: file.fingerprint });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  }
  return run;
}

const preflight = async (f: Served, run: Run) => {
  const answer = await f.call("GET", `/runs/${run.id}/preflight`);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  return answer.body.checks as DraftCheck[];
};
const rulesRows = (checks: DraftCheck[]) =>
  checks.filter((check) => ["ai-ban", "area-reserved", "by-hand-rules"].includes(check.id)).map((check) => `${check.id}:${check.kind}`);

test("a QEMU-shaped project: the fitted run's quoted confirm, required at publish, never an override, then published", async (t) => {
  const qemu = await readFile(path.join(import.meta.dirname, "fixtures", "policy", "real", "qemu-code-provenance.rst"), "utf8");
  const f = await serve(t, { [qemuPath]: qemu });
  // The task dialog's "Fit the guide to the project's rules": createRun fixes the help set from the rules read at import.
  const created = await f.call("POST", "/runs", {
    repoId: f.repo.id,
    prompt,
    settings: defaultContributionSettings,
    learnByHand: true,
    byHandFit: { learningIssue: false },
  });
  assert.equal(created.status, 202, JSON.stringify(created.body));
  const lock = created.body.run.byHand.helpLock as NonNullable<NonNullable<Run["byHand"]>["helpLock"]>;
  assert.deepEqual(lock.kinds, ["explain", "answer", "test"]);
  assert.deepEqual(lock.rules.map((rule) => [rule.kind, rule.path, rule.quote]), [["ban", qemuPath, qemuBan]]);
  assert.deepEqual(lock.rules[0].allows.map((allowance) => allowance.quote), [qemuCarveOut]);
  await f.workbench.cancel(created.body.run.id);

  // The same lock on a run in review, written by hand and clean.
  const run = await reviewRun(f, { createdAt: created.body.run.createdAt, helpLock: lock });
  // The rules were read at import, before the run started: blocked, and the block says to check them again (d).
  const stale = await preflight(f, run);
  assert.deepEqual(rulesRows(stale), ["ai-ban:block"]);
  assert.ok(stale.find((check) => check.id === "ai-ban")!.message.includes(byHandBlockClause("rules-unread", "en")));
  // "Check again" reads them now; the quoted confirm replaces the block, quoting the rule and its carve-out.
  assert.equal((await f.call("POST", `/repos/${f.repo.id}/contribution-rules/refresh`, {})).status, 200);
  const checks = await preflight(f, run);
  assert.deepEqual(rulesRows(checks), ["by-hand-rules:confirm"]);
  const quoted = checks.find((check) => check.id === "by-hand-rules")!;
  assert.match(quoted.message, /^The project declines AI-generated contributions, and its own text says some uses of AI are fine\./);
  assert.ok(quoted.details.some((detail) => detail === `${qemuPath}:6: "${qemuBan}"`), quoted.details.join("\n"));
  assert.ok(quoted.details.some((detail) => detail === `The same rules say: ${qemuPath}:10: "${qemuCarveOut}"`), quoted.details.join("\n"));
  assert.ok(quoted.details.some((detail) => detail.startsWith("Fitted at the start, the guide offered only explanations, answers, and test help.")));
  assert.deepEqual(checks.filter((check) => check.kind === "block"), []);

  // The confirm never blocks approval.
  const approved = await f.call("POST", `/runs/${run.id}/approve`, { draft: run.draft });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const fingerprint = approved.body.run.approvedFingerprint as string;
  const confirms = checks.filter((check) => check.kind === "confirm").map((check) => check.id);
  const publish = (body: Record<string, unknown>) => f.call("POST", `/runs/${run.id}/publish`, { fingerprint, ...body });
  // Every other confirm ticked, the quoted one not: 422, naming it.
  const unticked = await publish({ acknowledged: confirms.filter((id) => id !== "by-hand-rules") });
  assert.equal(unticked.status, 422, JSON.stringify(unticked.body));
  assert.match(unticked.body.error, /its own text says some uses of AI are fine/);
  // Never an override.
  const override = await publish({ acknowledged: confirms, overrides: [{ id: "by-hand-rules", reason: "The maintainers said it fits." }] });
  assert.equal(override.status, 400);
  assert.equal(run.status, "approved");
  // Ticked for the words read: published.
  const published = await publish({ acknowledged: confirms, rulesDigest: quoted.digest });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.run.status, "published");
  assert.match(published.body.run.prUrl, /^https:\/\/github\.com\/test-owner\/example\/pull\/\d+$/);
});

test("an assistance ban: no fitted run, the block stands with no confirm, approval refused", async (t) => {
  const f = await serve(t, { "CONTRIBUTING.md": `# Contributing\n\n${gentoo}\n` });
  const fit = await f.call("POST", "/runs", {
    repoId: f.repo.id,
    prompt,
    settings: defaultContributionSettings,
    learnByHand: true,
    byHandFit: { learningIssue: false },
  });
  assert.equal(fit.status, 409, JSON.stringify(fit.body));
  assert.match(fit.body.error, /restricts AI help itself/);
  const run = await reviewRun(f, { createdAt: new Date(Date.now() - 60_000).toISOString() });
  assert.equal((await f.call("POST", `/repos/${f.repo.id}/contribution-rules/refresh`, {})).status, 200);
  const checks = await preflight(f, run);
  assert.deepEqual(rulesRows(checks), ["ai-ban:block"]);
  const ban = checks.find((check) => check.id === "ai-ban")!;
  assert.match(ban.message, /^The project's rules restrict AI help itself, so BELL PR won't publish a run its guide helped with\./);
  assert.ok(ban.details.some((detail) => detail === `CONTRIBUTING.md:3: "${gentoo}"`), ban.details.join("\n"));
  const approved = await f.call("POST", `/runs/${run.id}/approve`, { draft: run.draft });
  assert.equal(approved.status, 422);
  assert.match(approved.body.error, /restrict AI help itself/);
  // Acknowledging the confirm that isn't there changes nothing; an override is still a 400.
  const publish = (body: Record<string, unknown>) =>
    f.call("POST", `/runs/${run.id}/publish`, { fingerprint: "a".repeat(64), ...body });
  assert.equal((await publish({ acknowledged: ["by-hand-rules"], overrides: [{ id: "ai-ban", reason: "The maintainers said it fits." }] })).status, 400);
  assert.equal((await publish({ acknowledged: ["by-hand-rules"] })).status, 409);
  assert.equal(run.status, "review");
});

/** A fitted, clean run in review on the QEMU-shaped project, its rules read during the run; approved. */
async function fittedAndApproved(t: TestContext) {
  const qemu = await readFile(path.join(import.meta.dirname, "fixtures", "policy", "real", "qemu-code-provenance.rst"), "utf8");
  const f = await serve(t, { [qemuPath]: qemu });
  const created = await f.call("POST", "/runs", {
    repoId: f.repo.id,
    prompt,
    settings: defaultContributionSettings,
    learnByHand: true,
    byHandFit: { learningIssue: false },
  });
  assert.equal(created.status, 202, JSON.stringify(created.body));
  await f.workbench.cancel(created.body.run.id);
  const run = await reviewRun(f, { createdAt: created.body.run.createdAt, helpLock: created.body.run.byHand.helpLock });
  assert.equal((await f.call("POST", `/repos/${f.repo.id}/contribution-rules/refresh`, {})).status, 200);
  const approved = await f.call("POST", `/runs/${run.id}/approve`, { draft: run.draft });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const fingerprint = approved.body.run.approvedFingerprint as string;
  const publish = (body: Record<string, unknown>) => f.call("POST", `/runs/${run.id}/publish`, { fingerprint, ...body });
  return { f, qemu, run, publish };
}

test("the quoted confirm's tick is bound to its words: missing, other or changed words are refused", async (t) => {
  const { f, qemu, run, publish } = await fittedAndApproved(t);
  const read = await preflight(f, run);
  const quoted = read.find((check) => check.id === "by-hand-rules")!;
  assert.match(quoted.digest ?? "", /^[a-f0-9]{64}$/);
  // Only the quoted confirm carries its words' digest.
  assert.deepEqual(read.filter((check) => check.digest).map((check) => check.id), ["by-hand-rules"]);
  const confirms = read.filter((check) => check.kind === "confirm").map((check) => check.id);
  // The tick alone, or with words the server never showed: refused, naming the confirm.
  for (const body of [{}, { rulesDigest: "0".repeat(64) }]) {
    const refused = await publish({ acknowledged: confirms, ...body });
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
    assert.match(refused.body.error, /its own text says some uses of AI are fine/);
  }
  // Another tab: the project's rules file changed and "Check again" read it, so the quoted lines moved.
  await git(f.repo.path, ["config", "user.name", "BELL Test"]);
  await git(f.repo.path, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(f.repo.path, qemuPath), `.. _code-provenance:\n\n${qemu}`);
  await git(f.repo.path, ["commit", "-qam", "Label the provenance section"]);
  assert.equal((await f.call("POST", `/repos/${f.repo.id}/contribution-rules/refresh`, {})).status, 200);
  const reread = (await preflight(f, run)).find((check) => check.id === "by-hand-rules")!;
  assert.ok(reread.details.includes(`${qemuPath}:8: "${qemuBan}"`), reread.details.join("\n"));
  assert.notEqual(reread.digest, quoted.digest);
  // This tab's tick was for the words it read: refused, nothing sent.
  const stale = await publish({ acknowledged: confirms, rulesDigest: quoted.digest });
  assert.equal(stale.status, 422, JSON.stringify(stale.body));
  assert.match(stale.body.error, /its own text says some uses of AI are fine/);
  assert.equal(f.store.data.runs.find((value) => value.id === run.id)!.status, "approved");
  // Ticked for the words the server shows now: published.
  const published = await publish({ acknowledged: confirms, rulesDigest: reread.digest });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.run.status, "published");
});

test("a quoted confirm whose checked-list entry passes 90 days between the read and the publish is refused", async (t) => {
  const day = 24 * 60 * 60 * 1000;
  const checkedOn = "2026-07-01";
  // A minute before the entry is 90 days old.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(checkedOn) + 90 * day - 60_000 });
  const f = await serve(t, {});
  const label = "rust-lang/rust (rust-forge llm-usage.md)";
  const finding = {
    kind: "ban" as const,
    path: label,
    line: 12,
    quote: "But not to create.",
    contribution: true,
    reach: "output" as const,
    source: { registry: "rust-lang/rust", url: "https://forge.rust-lang.org/policies/llm-usage.html", checkedOn },
    allows: [
      { line: 8, quote: "Asking an LLM questions about an existing codebase", kinds: ["explain" as const, "answer" as const] },
      { line: 9, quote: "Using an LLM to help with debugging", kinds: ["test" as const] },
    ],
  };
  const createdAt = new Date(Date.now() - 60 * 60_000).toISOString();
  f.repo.contributionRules = { checkedAt: new Date(Date.now() - 30 * 60_000).toISOString(), findings: [finding], filesRead: [] };
  const fitted = byHandRulesCase(f.repo.contributionRules, { learningIssue: false, now: createdAt });
  assert.equal(fitted.case, "fitted");
  const run = await reviewRun(f, { createdAt, helpLock: fitted.case === "fitted" ? { ...fitted.lock, at: createdAt } : undefined });
  const read = await preflight(f, run);
  assert.deepEqual(rulesRows(read), ["by-hand-rules:confirm"]);
  const quoted = read.find((check) => check.id === "by-hand-rules")!;
  const approved = await f.call("POST", `/runs/${run.id}/approve`, { draft: run.draft });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const confirms = read.filter((check) => check.kind === "confirm").map((check) => check.id);
  // Two minutes later the entry is more than 90 days old: it blocks, and the tick for the words read counts for nothing.
  t.mock.timers.setTime(Date.parse(checkedOn) + 90 * day + 60_000);
  const refused = await f.call("POST", `/runs/${run.id}/publish`, {
    fingerprint: approved.body.run.approvedFingerprint,
    acknowledged: confirms,
    rulesDigest: quoted.digest,
  });
  assert.equal(refused.status, 422, JSON.stringify(refused.body));
  assert.match(refused.body.error, /more than 90 days old/);
  assert.equal(f.store.data.runs.find((value) => value.id === run.id)!.status, "approved");
});

test("an agent run's checks carry no digest and its confirms publish as before", async (t) => {
  const f = await serve(t, {});
  const run = await reviewRun(f, { createdAt: new Date(Date.now() - 60_000).toISOString() });
  delete run.learnByHand;
  delete run.byHand;
  const checks = await preflight(f, run);
  assert.equal(checks.some((check) => "digest" in check), false);
  const approved = await f.call("POST", `/runs/${run.id}/approve`, { draft: run.draft });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const published = await f.call("POST", `/runs/${run.id}/publish`, {
    fingerprint: approved.body.run.approvedFingerprint,
    acknowledged: checks.filter((check) => check.kind === "confirm").map((check) => check.id),
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.run.status, "published");
});
