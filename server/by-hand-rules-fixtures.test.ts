// The real-policy suite of the quoted confirm (DESIGN v1.2 F12): each
// policy text is read the way the rules card reads it (classifier,
// carve-outs, checked list), then checked for a clean Learn-by-hand run
// fitted when it started (the lock from byHandRulesCase), with rules read
// after its start, the help kinds shown and a learning-labelled issue
// where the rule reserves issues; and the same text for an agent run.
// Texts: server/fixtures/policy/real and server/fixtures/policy/by-hand
// (sources and versions in their SOURCES.md); no network, fake codex,
// claude and gh first on PATH for the run that goes through Workbench.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { byHandPreflight, type HelpKind, type HelpLock } from "../shared/by-hand.js";
import { byHandRulesCase, byHandRulesDecision } from "../shared/by-hand-rules.js";
import {
  byHandBlockClause,
  respectChecks,
  type ContributionFacts,
  type ContributionRules,
  type DoorFacts,
  type PolicyFinding,
} from "../shared/contribution.js";
import type { ByHandPreflightInput, DraftCheck } from "../shared/draft-checks.js";
import { policyFindings, type PolicyDocument } from "./contribution-policy.js";
import { readDiff } from "./git.js";
import { withLocale } from "./i18n/index.js";
import { mergeRegistryFindings, policyRegistry, registryFindings, type RegistryEntry } from "./policy-registry.js";
import { git } from "./process.js";
import { publishChecks } from "./publish.js";
import { Store } from "./store.js";
import { AppError, type Run } from "./types.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";
import { Workbench } from "./workbench.js";

const fixtures = path.join(import.meta.dirname, "fixtures", "policy");
const createdAt = "2026-10-20T09:00:00.000Z";
const readAt = "2026-10-20T10:00:00.000Z";
const now = "2026-10-20T12:00:00.000Z";
const body = "Retries a GET twice after a 503.";
const qemuPath = "docs/devel/code-provenance.rst";

/** The rules the card stores for these files (`<path>` read from `fixtures/<file>`), plus listed findings. */
async function readRules(files: [path: string, file: string][], listed: PolicyFinding[] = []): Promise<ContributionRules> {
  const documents: PolicyDocument[] = [];
  for (const [documentPath, file] of files)
    documents.push({ path: documentPath, kind: "contributing", content: await readFile(path.join(fixtures, file), "utf8") });
  return {
    checkedAt: readAt,
    findings: mergeRegistryFindings(policyFindings(documents), listed),
    filesRead: files.map(([documentPath]) => documentPath),
  };
}

const learningIssue: ContributionFacts["issue"] = {
  url: "https://github.com/acme/widgets/issues/7",
  state: "OPEN",
  labels: ["good first issue"],
};
const ids = (checks: DraftCheck[]) => checks.map((check) => `${check.id}:${check.kind}`);

interface Row {
  /** The case before the run (`fitted` with its kinds, or `blocked:<reason>`). */
  case: string;
  lock?: HelpLock;
  /** The Learn-by-hand run's checks, and why each blocked finding stays blocked. */
  lbh: string[];
  reasons: string[];
  lbhChecks: DraftCheck[];
  /** The agent run's checks. */
  agent: string[];
}

/** One row of the suite: the same rules for a fitted, clean Learn-by-hand run and for an agent run. */
function row(
  rules: ContributionRules,
  helps: HelpKind[],
  options: { learning?: boolean; door?: DoorFacts; createdAt?: string | null; lock?: HelpLock | null } = {},
): Row {
  const learning = !!options.learning;
  const fitted = byHandRulesCase(rules, { learningIssue: learning, now: createdAt });
  const lock =
    options.lock === null ? undefined : (options.lock ?? (fitted.case === "fitted" ? { ...fitted.lock, at: createdAt } : undefined));
  const facts: ContributionFacts | undefined =
    learning || options.door
      ? { checkedAt: now, ...(learning ? { issue: learningIssue } : {}), ...(options.door ? { door: options.door } : {}) }
      : undefined;
  const input: ByHandPreflightInput = {
    helps,
    ...(lock ? { helpLock: lock } : {}),
    ...(options.createdAt === null ? {} : { createdAt: options.createdAt ?? createdAt }),
    now,
  };
  const base = { body, rules, ...(facts ? { facts } : {}) };
  const lbhChecks = respectChecks({ ...base, learnByHand: input }, "en");
  const bans = rules.findings.filter((finding) => finding.kind === "ban" && finding.contribution);
  const areas = learning ? rules.findings.filter((finding) => finding.kind === "area") : [];
  const decision = bans.length || areas.length ? byHandRulesDecision({ bans, areas, rules }, input) : undefined;
  return {
    case: fitted.case === "fitted" ? `fitted:${fitted.kinds.join(",")}` : fitted.case === "blocked" ? `blocked:${fitted.reason}` : "none",
    ...(lock ? { lock } : {}),
    lbh: ids(lbhChecks),
    reasons: decision?.blocked.map((entry) => `${entry.reason}${entry.kinds ? `:${entry.kinds.join(",")}` : ""}`) ?? [],
    lbhChecks,
    agent: ids(respectChecks(base, "en")),
  };
}

const message = (checks: DraftCheck[], id: string) => checks.find((check) => check.id === id)?.message ?? "";
const assistanceCopy = "The project's rules restrict AI help itself, so BELL PR won't publish a run its guide helped with.";
const clause = (reason: Parameters<typeof byHandBlockClause>[0], kinds?: string[]) => byHandBlockClause(reason, "en", { kinds });

before(() => skipUnderstandingCheckInTests(true));
after(() => skipUnderstandingCheckInTests());

test("Gentoo (assistance): blocked by reach, with no lock, for both run kinds", async () => {
  const rules = await readRules([["AI_POLICY.md", "real/gentoo-ai-policy.txt"]]);
  const result = row(rules, ["explain", "answer"]);
  assert.equal(result.case, "blocked:reach");
  assert.equal(result.lock, undefined);
  assert.deepEqual([result.lbh, result.reasons, result.agent], [["ai-ban:block"], ["reach"], ["ai-ban:block"]]);
  assert.equal(message(result.lbhChecks, "ai-ban"), assistanceCopy);
});

test("Zig's README (assistance): blocked by reach for both run kinds", async () => {
  const rules = await readRules([["README.md", "real/zig-README.md"]]);
  const result = row(rules, ["explain", "answer"]);
  assert.deepEqual([result.case, result.reasons], ["blocked:reach", ["reach"]]);
  assert.deepEqual(result.lbh, ["ai-ban:block", "project-rules:confirm"]);
  assert.deepEqual(result.agent, ["ai-ban:block", "project-rules:confirm"]);
  assert.equal(message(result.lbhChecks, "ai-ban"), assistanceCopy);
});

test("an unclear-reach ban (synthetic: no verified text has one) stays blocked by reach", async () => {
  const rules = await readRules([["CONTRIBUTING.md", "by-hand/unclear-reach.md"]]);
  const result = row(rules, ["explain", "answer"]);
  assert.deepEqual([result.case, result.lbh, result.reasons, result.agent], ["blocked:reach", ["ai-ban:block"], ["reach"], ["ai-ban:block"]]);
  assert.ok(message(result.lbhChecks, "ai-ban").endsWith(`and ${clause("reach")}.`));
});

test("Asahi Linux (assistance): blocked by reach for both run kinds", async () => {
  const rules = await readRules([["AI_POLICY.md", "real/asahi-llm-policy.txt"]]);
  const result = row(rules, ["explain", "answer"]);
  assert.deepEqual([result.case, result.lbh, result.reasons, result.agent], ["blocked:reach", ["ai-ban:block"], ["reach", "reach"], ["ai-ban:block"]]);
  assert.equal(message(result.lbhChecks, "ai-ban"), assistanceCopy);
});

test("LLVM's good first issues ('Using AI tools to fix … is forbidden'): reserved, blocked by reach", async () => {
  const rules = await readRules([["llvm/docs/AIToolPolicy.md", "real/llvm-AIToolPolicy.md"]]);
  const result = row(rules, ["explain", "answer"], { learning: true });
  assert.equal(result.case, "blocked:reach");
  assert.deepEqual(result.reasons, ["reach", "reach"]);
  // The project's disclosure rule stands in both runs (the description discloses nothing).
  assert.deepEqual(result.lbh, ["ai-disclosure:block", "area-reserved:block", "project-rules:confirm"]);
  assert.deepEqual(result.agent, ["ai-disclosure:block", "area-reserved:block", "project-rules:confirm"]);
  assert.equal(
    message(result.lbhChecks, "area-reserved"),
    "The project keeps this issue for people learning without AI tools, so BELL PR won't publish a run its guide helped with.",
  );
});

test("NetBSD (output, no carve-out): blocked because the text says no use of AI is fine", async () => {
  const rules = await readRules([["commit-guidelines.txt", "real/netbsd-commit-guidelines.txt"]]);
  const result = row(rules, ["explain", "answer"]);
  assert.deepEqual([result.case, result.lbh, result.reasons, result.agent], ["blocked:no-carve-out", ["ai-ban:block"], ["no-carve-out"], ["ai-ban:block"]]);
  assert.ok(message(result.lbhChecks, "ai-ban").endsWith(`and ${clause("no-carve-out")}.`));
});

test("Kubernetes' AI Guidance gives neither run an AI ban: its rules are quoted to weigh", async () => {
  // The section's first two paragraphs (lines 626-633): disclosure, and the trailer rule.
  const section = await readFile(path.join(fixtures, "real/kubernetes-pull-requests.md"), "utf8");
  const trailer = section.split("\n").slice(0, 8).join("\n");
  const rules: ContributionRules = {
    checkedAt: readAt,
    findings: policyFindings([{ path: "contributors/guide/pull-requests.md", kind: "contributing", content: trailer }]),
    filesRead: ["contributors/guide/pull-requests.md"],
  };
  for (const helps of [[], ["explain", "answer"]] as HelpKind[][]) {
    const result = row(rules, helps);
    assert.equal(result.case, "none");
    // The disclosure rule stands until the description says how AI helped.
    assert.deepEqual(result.lbh, ["ai-disclosure:block", "project-rules:confirm"]);
    assert.deepEqual(result.agent, ["ai-disclosure:block", "project-rules:confirm"]);
  }
  // The whole section (lines 626-646): each other AI sentence, by its source
  // line, with whether it still reads as a contribution ban; a rule that
  // doesn't is quoted in the project-rules confirm for the person to weigh.
  const sectionBans = new Map<number, boolean>([
    // "[Large AI generated](#large-or-automatic-edits) PRs and AI generated commit messages are not allowed."
    [638, true],
    // "Do not leave the first review of AI generated changes to the reviewers."
    [640, true],
  ]);
  const whole = row(await readRules([["contributors/guide/pull-requests.md", "real/kubernetes-pull-requests.md"]]), ["explain", "answer"]);
  const blocking = [...sectionBans].filter(([, ban]) => ban).map(([line]) => line);
  const weighed = [...sectionBans].filter(([, ban]) => !ban).map(([line]) => line);
  // The source line of each rule a check quotes (the excerpt starts at line 626).
  const lines = (check: DraftCheck | undefined) =>
    (check?.details ?? []).flatMap((detail) => {
      const at = /^contributors\/guide\/pull-requests\.md:(\d+):/.exec(detail);
      return at ? [Number(at[1]) + 625] : [];
    });
  for (const checks of [whole.lbhChecks, respectChecks({ body, rules: await readRules([["contributors/guide/pull-requests.md", "real/kubernetes-pull-requests.md"]]) }, "en")]) {
    assert.deepEqual(checks.filter((check) => check.kind === "block").map((check) => check.id), [...(blocking.length ? ["ai-ban"] : []), "ai-disclosure"]);
    assert.deepEqual(lines(checks.find((check) => check.id === "ai-ban")), blocking);
    const toWeigh = lines(checks.find((check) => check.id === "project-rules"));
    for (const line of weighed) assert.ok(toWeigh.includes(line), `line ${line} is a rule to weigh`);
  }
});

test("AI bans next to the words of the Kubernetes fixes stay bans for both run kinds", async () => {
  const text = await readFile(path.join(fixtures, "by-hand/bans-kept.md"), "utf8");
  const sentences = text.split("\n").filter((line) => line && !line.startsWith("#"));
  assert.equal(sentences.length, 17);
  for (const sentence of sentences) {
    const rules: ContributionRules = {
      checkedAt: readAt,
      findings: policyFindings([{ path: "CONTRIBUTING.md", kind: "contributing", content: sentence }]),
      filesRead: ["CONTRIBUTING.md"],
    };
    assert.deepEqual(rules.findings.map((finding) => [finding.kind, finding.contribution]), [["ban", true]], sentence);
    const result = row(rules, ["explain", "answer"]);
    assert.deepEqual([result.agent, result.lbh], [["ai-ban:block"], ["ai-ban:block"]], sentence);
  }
});

const qemuRules = () => readRules([[qemuPath, "real/qemu-code-provenance.rst"]]);

test("QEMU (in-repo carve-out): the quoted confirm only when every help used is named", async () => {
  const rules = await qemuRules();
  const confirmed = row(rules, ["explain", "answer", "test"]);
  assert.equal(confirmed.case, "fitted:explain,answer,test");
  assert.deepEqual([confirmed.lbh, confirmed.reasons, confirmed.agent], [["by-hand-rules:confirm"], [], ["ai-ban:block"]]);
  const confirm = confirmed.lbhChecks[0];
  assert.deepEqual(confirm.details.slice(1, 3), [
    `${qemuPath}:6: "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content."`,
    `The same rules say: ${qemuPath}:10: "This policy does not apply to other uses of AI, such as researching APIs or algorithms, static analysis, or debugging, provided their output is not included in contributions."`,
  ]);
  assert.match(confirm.details[3], /^Fitted at the start, the guide offered only explanations, answers, and test help\./);
  // A review the text doesn't name blocks, and no fitted lock ever holds it.
  const reviewed = row(rules, ["explain", "answer", "review"]);
  assert.deepEqual([reviewed.lbh, reviewed.reasons, reviewed.agent], [["ai-ban:block"], ["kind-not-named:review"], ["ai-ban:block"]]);
  assert.ok(message(reviewed.lbhChecks, "ai-ban").endsWith(`and ${clause("kind-not-named", ["review"])}.`));
  assert.ok(!reviewed.lock!.kinds.includes("review"));
});

test("QEMU on GitHub, where pull requests are off: the confirm, and the pr-closed block that stops it", async () => {
  const result = row(await qemuRules(), ["explain", "answer"], { door: { hasPullRequests: false } });
  assert.deepEqual(result.lbh, ["pr-closed:block", "by-hand-rules:confirm"]);
  assert.deepEqual(result.agent, ["pr-closed:block", "ai-ban:block"]);
});

test("QEMU, one condition failing alone each time: the block names it", async () => {
  const rules = await qemuRules();
  const fitted = row(rules, ["explain", "answer"]);
  assert.deepEqual(fitted.lbh, ["by-hand-rules:confirm"]);
  // (c) The same run made unclean gets no Learn-by-hand input: the agent run's outcome and copy.
  const run = { learnByHand: true as const, createdAt, agents: [{ id: "lead" }], team: { tasks: [] }, byHand: { helpLock: fitted.lock } };
  assert.ok(byHandPreflight(run, now));
  assert.equal(byHandPreflight({ ...run, byHand: { ...run.byHand, agentWrites: 1 } }, now), undefined);
  assert.deepEqual(row(rules, ["explain", "answer"]).agent, ["ai-ban:block"]);
  assert.match(message(respectChecks({ body, rules }, "en"), "ai-ban"), /AI agents wrote this change/);
  // (d) Rules read before the run started: blocked at publish, still the confirm at approve.
  const early = { ...rules, checkedAt: "2026-10-20T08:00:00.000Z" };
  const lock = fitted.lock!;
  assert.deepEqual(row(early, ["explain", "answer"], { lock }).reasons, ["rules-unread"]);
  assert.deepEqual(row(early, ["explain", "answer"], { lock, createdAt: null }).lbh, ["by-hand-rules:confirm"]);
  // (e) No lock.
  const unlocked = row(rules, ["explain", "answer"], { lock: null });
  assert.deepEqual([unlocked.lbh, unlocked.reasons], [["ai-ban:block"], ["not-fitted"]]);
  assert.ok(message(unlocked.lbhChecks, "ai-ban").endsWith(`and ${clause("not-fitted")}.`));
  // (e) The carve-out sentence the run was fitted to is no longer in the rules.
  const text = await readFile(path.join(fixtures, "real/qemu-code-provenance.rst"), "utf8");
  const banOnly = text.split("\n").slice(0, 9).join("\n");
  const changed: ContributionRules = {
    checkedAt: readAt,
    findings: policyFindings([{ path: qemuPath, kind: "contributing", content: banOnly }]),
    filesRead: [qemuPath],
  };
  assert.deepEqual(row(changed, ["explain", "answer"], { lock }).reasons, ["rules-changed"]);
  // (b) The carve-out moved to another file of the same repository: it is not this rule's carve-out.
  const carveOut = text.split("\n").slice(9).join("\n");
  const elsewhere: ContributionRules = {
    checkedAt: readAt,
    findings: policyFindings([
      { path: qemuPath, kind: "contributing", content: banOnly },
      { path: "docs/devel/ai-research.rst", kind: "documentation", content: carveOut },
    ]),
    filesRead: [qemuPath, "docs/devel/ai-research.rst"],
  };
  const moved = row(elsewhere, ["explain", "answer"]);
  assert.deepEqual([moved.case, moved.reasons], ["blocked:no-carve-out", ["no-carve-out"]]);
});

test("matplotlib's good first issues (output wording, 'Acceptable uses' in the same file)", async () => {
  const rules = await readRules([["doc/devel/contribute.rst", "by-hand/matplotlib-contribute.rst"]]);
  const confirmed = row(rules, ["explain", "answer", "plan"], { learning: true });
  assert.equal(confirmed.case, "fitted:explain,answer,plan");
  assert.deepEqual(confirmed.reasons, []);
  assert.deepEqual(confirmed.lbh, ["by-hand-rules:confirm", "project-rules:confirm"]);
  assert.deepEqual(confirmed.agent, ["area-reserved:block", "project-rules:confirm"]);
  const confirm = confirmed.lbhChecks[0];
  assert.match(confirm.message, /^The project closes AI-generated pull requests for issues like this one/);
  // The carve-outs, then the same file's other AI rules ("others"). Its
  // "Solving topics that you wouldn't be able to solve yourself without AI"
  // is a list item the classifier finds no rule in, so it is not quoted here.
  assert.deepEqual(
    confirm.details.filter((detail) => detail.startsWith("The same rules say: ")).map((detail) => detail.replace(/: ".*$/, "")),
    [
      "The same rules say: doc/devel/contribute.rst:20",
      "The same rules say: doc/devel/contribute.rst:21",
      "The same rules say: doc/devel/contribute.rst:29",
      "The same rules say: doc/devel/contribute.rst:38",
    ],
  );
  const reviewed = row(rules, ["explain", "answer", "review"], { learning: true });
  assert.deepEqual([reviewed.reasons, reviewed.lbh], [["kind-not-named:review"], ["area-reserved:block", "project-rules:confirm"]]);
  assert.ok(message(reviewed.lbhChecks, "area-reserved").endsWith(`and ${clause("kind-not-named", ["review"])}.`));
  assert.deepEqual(reviewed.agent, ["area-reserved:block", "project-rules:confirm"]);
});

const rustEntry = policyRegistry.find((entry) => entry.key === "rust-lang/rust")!;
/** Rust's rules as BELL reads them for rust-lang/rust: its checked-list entry (rust-forge llm-usage.md). */
const rustRules = (entry: RegistryEntry) => readRules([], registryFindings("rust-lang/rust", readAt, [entry]));

test("Rust (a signed checked-list entry): the quoted confirm for every kind its text names", async () => {
  const rules = await rustRules({ ...rustEntry, signedOff: rustEntry.checkedOn });
  const result = row(rules, ["explain", "answer", "review", "plan"]);
  assert.equal(result.case, "fitted:explain,answer,plan,review");
  assert.deepEqual([result.lbh, result.reasons, result.agent], [["by-hand-rules:confirm"], [], ["ai-ban:block"]]);
  assert.match(result.lbhChecks[0].details[1], /^BELL PR's checked list, .*, https:\/\/forge\.rust-lang\.org\/policies\/llm-usage\.html: "But not to \*\*create\*\*\."$/);
  // A kind its text doesn't name (test help) blocks.
  assert.deepEqual(row(rules, ["explain", "answer", "test"]).reasons, ["kind-not-named:test"]);
});

test("Rust, an entry checked 91 days before now: it still blocks and never lifts", async () => {
  // Checked on 2026-07-21, 91 days before the suite's now (2026-10-20).
  const rules = await rustRules({ ...rustEntry, checkedOn: "2026-07-21", signedOff: "2026-07-22" });
  const result = row(rules, ["explain", "answer"]);
  assert.deepEqual([result.case, result.lbh, result.reasons, result.agent], [
    "blocked:registry-stale",
    ["ai-ban:block"],
    ["registry-stale"],
    ["ai-ban:block"],
  ]);
  assert.match(message(result.lbhChecks, "ai-ban"), /checked list entry is more than 90 days old \(Jul 21, 2026\)\.$/);
});

test("Rust, the entry unsigned (as shipped): no finding at all", async () => {
  const rules = await rustRules(rustEntry);
  assert.deepEqual(rules.findings, []);
  const result = row(rules, ["explain", "answer"]);
  assert.deepEqual([result.case, result.lbh, result.agent], ["none", [], []]);
});

test("a project with no AI rule: no confirm and no block in either run", async () => {
  const rules = await readRules([["docs/CONTRIBUTE.md", "real/curl-CONTRIBUTE.md"]]);
  for (const helps of [[], ["explain", "answer"], ["explain", "answer", "plan", "review", "test"]] as HelpKind[][]) {
    const result = row(rules, helps);
    assert.deepEqual([result.case, result.lbh, result.agent], ["none", [], []]);
  }
});

/** A QEMU-shaped project and a clean, fitted Learn-by-hand run with one reviewed change, through Workbench. */
async function qemuRun(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-rules-"));
  const fakeBin = path.join(directory, "bin");
  await mkdir(fakeBin);
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
  const repository = path.join(directory, "repo");
  await mkdir(path.join(repository, "docs", "devel"), { recursive: true });
  await writeFile(path.join(repository, qemuPath), await readFile(path.join(fixtures, "real/qemu-code-provenance.rst"), "utf8"));
  await writeFile(path.join(repository, "retry.ts"), "export const attempts = 1;\n");
  await git(repository, ["init", "-q", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await git(repository, ["add", "--", "."]);
  await git(repository, ["commit", "-qm", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  t.after(async () => {
    process.env.PATH = previousPath;
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(repository);
  // The rules were read at import, before the run started: fit the run to them as createRun does.
  const fitted = byHandRulesCase(repo.contributionRules, { learningIssue: false, now: new Date().toISOString() });
  assert.equal(fitted.case, "fitted");
  const started = new Date(Date.now() + 1000).toISOString();
  const run: Run = {
    id: "lbh-qemu-run",
    repoId: repo.id,
    title: "Retry twice",
    prompt: "Retry a GET twice after a 503.",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: started,
    locale: "en",
    learnByHand: true,
    agents: [
      { id: "lead", name: "Atlas", role: "Team lead", status: "complete", detail: "" },
      { id: "reviewer", name: "Lens", role: "Reviewer", status: "waiting", detail: "" },
      { id: "tester", name: "Scout", role: "Test analyst", status: "waiting", detail: "" },
    ],
    logs: [],
    draft: { title: "Retry a GET twice", body },
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
      helpLock: fitted.case === "fitted" ? { ...fitted.lock, at: started } : undefined,
      events: [
        { at: started, kind: "explain", source: "premise" },
        { at: started, kind: "answer", source: "hint", rung: 1 },
        { at: started, kind: "test", source: "test" },
      ],
    },
  };
  store.data.runs.push(run);
  await writeFile(path.join(repository, "retry.ts"), "export const attempts = 2;\n");
  for (const file of await readDiff(run)) await workbench.review(run.id, file.path, true, file.fingerprint);
  return { store, workbench, repo, run };
}

test("through Workbench: the confirm never blocks approval, publish needs it acknowledged, and old rules block publish", async (t) => {
  const f = await qemuRun(t);
  const checks = async () =>
    (await publishChecks(f.run, await readDiff(f.run), f.store.directory, "en", { repo: f.repo }))
      .filter((check) => ["by-hand-rules", "ai-ban"].includes(check.id))
      .map((check) => `${check.id}:${check.kind}`);
  // The rules were read before the run started: publishing is blocked until they are read again.
  assert.deepEqual(await checks(), ["ai-ban:block"]);
  assert.equal((await withLocale("en", () => f.workbench.approve(f.run.id, { ...f.run.draft }))).status, "approved");
  f.repo.contributionRules = { ...f.repo.contributionRules!, checkedAt: new Date(Date.parse(f.run.createdAt) + 1000).toISOString() };
  assert.deepEqual(await checks(), ["by-hand-rules:confirm"]);
  Object.assign(f.repo, { url: "https://github.com/test-owner/example", fullName: "test-owner/example", owner: "test-owner", name: "example" });
  const confirmFirst = (error: AppError) =>
    error.statusCode === 422 && error.message.includes("its own text says some uses of AI are fine");
  await assert.rejects(withLocale("en", () => f.workbench.publish(f.run.id, f.run.approvedFingerprint!, ["facts-unknown"])), confirmFirst);
  // Acknowledged, publishing goes past the checks (and stops at the fake gh).
  await assert.rejects(
    withLocale("en", () => f.workbench.publish(f.run.id, f.run.approvedFingerprint!, ["facts-unknown", "by-hand-rules"])),
    (error: AppError) => !confirmFirst(error) && /\bgh\b/.test(error.message),
  );
});
