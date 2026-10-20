// The quoted confirm's policy (DESIGN v1.2 F12): the case reader before a
// run and the decision at approve and publish. Each condition is tested
// failing alone, against a QEMU-shaped finding that passes every one of
// them; the quotes are verbatim from plan research/policies.md (QEMU
// docs/devel/code-provenance.rst, Gentoo's council policy, LLVM's and
// matplotlib's good-first-issue rules, Rust's rust-forge llm-usage.md).
import assert from "node:assert/strict";
import test from "node:test";
import type { HelpKind, HelpLock } from "./by-hand.js";
import {
  byHandRulesCase,
  byHandRulesDecision,
  carveOutKinds,
  registryStale,
  type ByHandBlockReason,
} from "./by-hand-rules.js";
import type { ContributionRules, PolicyAllowance, PolicyFinding } from "./contribution.js";
import type { ByHandPreflightInput } from "./draft-checks.js";

const qemuBan =
  "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.";
const qemuCarveOut =
  "This policy does not apply to other uses of AI, such as researching APIs or algorithms, static analysis, or debugging, provided their output is not included in contributions.";
const gentoo =
  "It is expressly forbidden to contribute to Gentoo any content that has been created with the assistance of Natural Language Processing artificial intelligence tools.";
const llvm = 'Using AI tools to fix issues labelled as "good first issues" is forbidden';
const matplotlib = "therefore, pull requests that are AI generated will be closed.";
const nodejs = 'It\'s prohibited to use AI to automate fixes to issues marked as "good first issue".';
const unclear = "We do not accept AI contributions.";
const rust = "But not to **create**.";

const qemuAllows: PolicyAllowance[] = [{ line: 10, quote: qemuCarveOut, kinds: ["explain", "answer", "test"] }];
const finding = (kind: "ban" | "area", quote: string, extra: Partial<PolicyFinding> = {}): PolicyFinding => ({
  kind,
  path: "docs/devel/code-provenance.rst",
  line: 6,
  quote,
  contribution: true,
  ...extra,
});
const qemu = () => finding("ban", qemuBan, { allows: qemuAllows.map((allowance) => ({ ...allowance })) });
const rulesOf = (...findings: PolicyFinding[]): ContributionRules => ({
  checkedAt: "2026-10-20T10:00:00.000Z",
  findings,
  filesRead: ["docs/devel/code-provenance.rst"],
});
const now = "2026-10-21T00:00:00.000Z";
const createdAt = "2026-10-20T09:00:00.000Z";

/** The lock createRun stores for these rules (the case reader's, with `at`). */
function lockFor(rules: ContributionRules, learningIssue = false, at = createdAt): HelpLock {
  const fitted = byHandRulesCase(rules, { learningIssue, now: at });
  assert.equal(fitted.case, "fitted");
  return { ...(fitted as Extract<typeof fitted, { case: "fitted" }>).lock, at };
}

/** A clean, fitted run that used `helps`, at publish (`createdAt` given). */
const input = (lock: HelpLock | undefined, helps: HelpKind[] = ["explain", "answer"], extra: Partial<ByHandPreflightInput> = {}): ByHandPreflightInput => ({
  helps,
  ...(lock ? { helpLock: lock } : {}),
  createdAt,
  now,
  ...extra,
});

/** The decision for one finding's run: its blocked reason (and kinds), or "confirm". */
function decide(rules: ContributionRules, byHand: ByHandPreflightInput, which: PolicyFinding = rules.findings[0]) {
  const decision = byHandRulesDecision(
    {
      bans: which.kind === "ban" ? [which] : [],
      areas: which.kind === "area" ? [which] : [],
      rules,
    },
    byHand,
  );
  const blocked = decision.blocked[0];
  const result: { reason: ByHandBlockReason | "confirm"; kinds?: HelpKind[]; entry?: (typeof decision.confirmable)[number] } =
    blocked ? { reason: blocked.reason, ...(blocked.kinds ? { kinds: blocked.kinds } : {}) } : { reason: "confirm", entry: decision.confirmable[0] };
  return result;
}

test("all conditions holding give the confirm, with the carve-outs to quote", () => {
  const rules = rulesOf(qemu());
  const result = decide(rules, input(lockFor(rules), ["explain", "answer", "test"]));
  assert.equal(result.reason, "confirm");
  assert.deepEqual(result.entry!.allows, qemuAllows);
  assert.deepEqual(result.entry!.others, []);
});

test("(a) an assistance ban, an unclear ban and 'use' wording never confirm, whatever else holds", () => {
  for (const quote of [gentoo, unclear]) {
    const ban = finding("ban", quote, { allows: qemuAllows });
    const rules = rulesOf(ban);
    // A lock naming it, as if a run had been fitted to it.
    const lock: HelpLock = { kinds: ["explain", "answer", "test"], at: createdAt, rulesCheckedAt: rules.checkedAt, rules: [{ ...ban, allows: qemuAllows }] };
    assert.equal(decide(rules, input(lock)).reason, "reach", quote);
    assert.equal(byHandRulesCase(rules, { learningIssue: false, now }).case, "blocked");
  }
  const use = finding("area", llvm, { allows: qemuAllows });
  const rules = rulesOf(use);
  const lock: HelpLock = { kinds: ["explain", "answer"], at: createdAt, rulesCheckedAt: rules.checkedAt, rules: [{ ...use, allows: qemuAllows }] };
  assert.equal(decide(rules, input(lock)).reason, "reach");
  const blocked = byHandRulesCase(rules, { learningIssue: true, now });
  assert.deepEqual(blocked.case === "blocked" && [blocked.reason, blocked.reach], ["reach", "use"]);
  // Output and automate wordings pass (a): matplotlib's and Node.js's.
  for (const quote of [matplotlib, nodejs]) {
    const area = finding("area", quote, { allows: qemuAllows });
    const areaRules = rulesOf(area);
    assert.equal(decide(areaRules, input(lockFor(areaRules, true))).reason, "confirm", quote);
  }
});

test("(b) no carve-out, a used kind the text doesn't name, and a stale checked-list entry block", () => {
  const bare = rulesOf(finding("ban", qemuBan));
  assert.equal(decide(bare, input(undefined)).reason, "no-carve-out");
  // A run fitted to QEMU's text that used a review the text doesn't name.
  const rules = rulesOf(qemu());
  assert.deepEqual(decide(rules, input(lockFor(rules), ["explain", "answer", "review", "plan"])), {
    reason: "kind-not-named",
    kinds: ["review", "plan"],
  });
  // A checked-list finding 91 days after its quotes were checked still blocks, and never lifts.
  const listed = finding("ban", rust, {
    path: "forge.rust-lang.org/policies/llm-usage",
    line: 24,
    source: { registry: "rust-lang/rust", url: "https://forge.rust-lang.org/policies/llm-usage.html", version: "67096ec0a6", checkedOn: "2026-07-22" },
    allows: [{ line: 62, quote: "Asking an LLM questions about an existing codebase", kinds: ["explain", "answer"] }],
  });
  const listedRules = rulesOf(listed);
  const fresh = lockFor(listedRules, false, "2026-10-19T00:00:00.000Z");
  assert.equal(decide(listedRules, input(fresh, ["explain"], { now: "2026-10-20T00:00:00.000Z" })).reason, "confirm");
  assert.equal(decide(listedRules, input(fresh, ["explain"], { now: "2026-10-21T00:00:00.000Z" })).reason, "registry-stale");
  const stale = byHandRulesCase(listedRules, { learningIssue: false, now: "2026-10-21T00:00:00.000Z" });
  assert.deepEqual(stale.case === "blocked" && stale.reason, "registry-stale");
});

test("registryStale is past 90 days, and an unreadable date is stale", () => {
  assert.equal(registryStale("2026-07-22", "2026-10-20T00:00:00.000Z"), false);
  assert.equal(registryStale("2026-07-22", "2026-10-20T00:00:01.000Z"), true);
  assert.equal(registryStale("2026-07-21", "2026-10-20T00:00:00.000Z"), true);
  assert.equal(registryStale("not a date", now), true);
});

test("(d) rules read before the run started block at publish, never at approve", () => {
  const rules = { ...rulesOf(qemu()), checkedAt: "2026-10-20T08:00:00.000Z" };
  const lock = lockFor(rules);
  assert.equal(decide(rules, input(lock)).reason, "rules-unread");
  // Approve passes no createdAt.
  assert.equal(decide(rules, input(lock, ["explain"], { createdAt: undefined })).reason, "confirm");
  assert.equal(decide({ ...rules, checkedAt: "not a date" }, input(lock)).reason, "rules-unread");
});

test("(e) no lock, a lock that doesn't name the finding, a kind outside the lock, a locked quote gone", () => {
  const rules = rulesOf(qemu());
  assert.equal(decide(rules, input(undefined)).reason, "not-fitted");
  // A lock fitted to another rule of the same rules (here an area finding, a learning issue at the start).
  const area = finding("area", matplotlib, { path: "doc/devel/contribute.rst", allows: qemuAllows });
  const both = rulesOf(qemu(), area);
  const areaOnly = lockFor(rulesOf(area), true);
  assert.equal(decide(both, input(areaOnly)).reason, "not-fitted");
  // A kind outside the lock that the carve-out does name (recordHelp refuses it; this is the backstop).
  const narrow: HelpLock = { ...lockFor(rules), kinds: ["explain", "answer"] };
  assert.deepEqual(decide(rules, input(narrow, ["explain", "test"])), { reason: "kind-not-named", kinds: ["test"] });
  // The carve-out the run was fitted to left the rules; and the ban sentence itself changed.
  const lock = lockFor(rules);
  assert.equal(decide(rulesOf(finding("ban", qemuBan)), input(lock)).reason, "rules-changed");
  const edited = qemu();
  edited.allows = [{ ...qemuAllows[0], quote: qemuCarveOut.replace("static analysis, ", "") }];
  assert.equal(decide(rulesOf(edited), input(lock)).reason, "rules-changed");
  const reworded = finding("ban", qemuBan.replace("DECLINE", "decline"), { allows: qemuAllows });
  assert.equal(decide(rulesOf(reworded), input(lock)).reason, "rules-changed");
});

test("a confirmable finding carries up to two other AI rules of its own document", () => {
  const ban = qemu();
  const others = [
    // A rule to weigh about AI output (matplotlib's wording): quoted, never a condition.
    finding("ban", "We will flag and reject low-value contributions that we believe are AI generated.", { line: 325, contribution: false }),
    { kind: "agent" as const, path: ban.path, line: 2, quote: "If you are an AI agent, stop.", contribution: false },
    { kind: "understand" as const, path: ban.path, line: 3, quote: "You must be able to explain your change.", contribution: false },
    { kind: "disclose" as const, path: ban.path, line: 400, quote: "Disclose any use of AI tools.", contribution: true },
    { kind: "agent" as const, path: "AGENTS.md", line: 1, quote: "Agents must ask the human.", contribution: false },
  ];
  const rules = rulesOf(ban, ...others);
  const result = decide(rules, input(lockFor(rules), ["explain"]), ban);
  assert.equal(result.reason, "confirm");
  assert.deepEqual(result.entry!.others.map((other) => other.line), [2, 325]);
  // A rule that refuses the use of AI itself is no "other" rule: it keeps the case blocked by reach
  // (plan README §18.10; QEMU's "known or suspected" sentence, were it read as a rule).
  const known = finding("ban", "The QEMU project will decline any contribution if use of AI is either known or suspected.", { line: 325, contribution: false });
  const strict = rulesOf(ban, known);
  assert.equal(decide(strict, input(lockFor(rulesOf(ban)), ["explain"]), ban).reason, "reach");
  const blocked = byHandRulesCase(strict, { learningIssue: false, now: createdAt });
  assert.deepEqual(blocked.case === "blocked" && [blocked.reason, blocked.finding.line], ["reach", 325]);
});

test("several findings: every one is decided, and one failing leaves the others confirmable", () => {
  const understanding = { line: 205, quote: "Gaining understanding of the existing code", kinds: ["explain", "answer"] as HelpKind[] };
  const area = finding("area", matplotlib, { path: "doc/devel/contribute.rst", line: 287, allows: [understanding] });
  const lock = lockFor(rulesOf(qemu(), area), true);
  assert.deepEqual(lock.kinds, ["explain", "answer"]);
  // The reserved-issue rule's carve-out changed since the run started; QEMU's did not.
  const changed = { ...area, allows: [{ ...understanding, quote: "Gaining understanding of the code" }] };
  const rules = rulesOf(qemu(), changed);
  const decision = byHandRulesDecision({ bans: [rules.findings[0]], areas: [changed], rules }, input(lock, ["explain"]));
  assert.deepEqual(decision.blocked.map((entry) => [entry.finding.path, entry.reason]), [
    ["doc/devel/contribute.rst", "rules-changed"],
  ]);
  assert.deepEqual(decision.confirmable.map((entry) => entry.finding.path), ["docs/devel/code-provenance.rst"]);
  // A kind both texts name but the lock (their intersection) leaves out: the backstop blocks both.
  const both = byHandRulesDecision({ bans: [rules.findings[0]], areas: [area], rules: rulesOf(qemu(), area) }, input(lock, ["explain", "test"]));
  assert.deepEqual(both.blocked.map((entry) => [entry.reason, entry.kinds]), [
    ["kind-not-named", ["test"]],
    ["kind-not-named", ["test"]],
  ]);
});

test("the case reader: none, blocked for each reason, and fitted with the intersection", () => {
  assert.deepEqual(byHandRulesCase(undefined, { learningIssue: true, now }), { case: "none" });
  assert.deepEqual(byHandRulesCase(rulesOf(), { learningIssue: true, now }), { case: "none" });
  // A ban without contribution context and an area finding without a learning issue don't apply.
  const ambiguous = finding("ban", "Do not use AI to generate substantial pieces of code.", { contribution: false });
  assert.deepEqual(byHandRulesCase(rulesOf(ambiguous, finding("area", llvm)), { learningIssue: false, now }), { case: "none" });
  const reasonOf = (rules: ContributionRules, learningIssue = false) => {
    const result = byHandRulesCase(rules, { learningIssue, now });
    return result.case === "blocked" ? [result.reason, result.finding.quote] : result.case;
  };
  assert.deepEqual(reasonOf(rulesOf(finding("ban", gentoo))), ["reach", gentoo]);
  assert.deepEqual(reasonOf(rulesOf(finding("ban", qemuBan))), ["no-carve-out", qemuBan]);
  // The first failing finding is named.
  assert.deepEqual(reasonOf(rulesOf(qemu(), finding("area", llvm)), true), ["reach", llvm]);
  const planOnly = finding("ban", qemuBan, { allows: [{ line: 2, quote: "Getting solution ideas", kinds: ["plan"] }] });
  assert.deepEqual(reasonOf(rulesOf(planOnly)), ["too-few-kinds", qemuBan]);
  const five = Array.from({ length: 5 }, (_, index) => ({ ...qemu(), line: index + 1, quote: `${qemuBan} (${index})` }));
  assert.equal(reasonOf(rulesOf(...five))[0], "not-fitted");
  // Fitted: the intersection of what each finding's carve-outs name, in vocabulary order.
  const area = finding("area", matplotlib, { path: "doc/devel/contribute.rst", line: 287, allows: [
    { line: 205, quote: "Gaining understanding of the existing code", kinds: ["explain", "answer"] },
    { line: 206, quote: "Getting solution ideas", kinds: ["plan"] },
  ] });
  const rules = rulesOf(qemu(), area);
  const fitted = byHandRulesCase(rules, { learningIssue: true, now });
  assert.equal(fitted.case, "fitted");
  if (fitted.case !== "fitted") return;
  assert.deepEqual(fitted.kinds, ["explain", "answer"]);
  assert.deepEqual(fitted.lock.kinds, ["explain", "answer"]);
  assert.equal(fitted.lock.rulesCheckedAt, rules.checkedAt);
  assert.deepEqual(
    fitted.lock.rules.map((rule) => [rule.kind, rule.path, rule.line, rule.quote, rule.allows.length]),
    [
      ["ban", "docs/devel/code-provenance.rst", 6, qemuBan, 1],
      ["area", "doc/devel/contribute.rst", 287, matplotlib, 2],
    ],
  );
  // Without the learning issue only the ban applies: its own kinds.
  const banOnly = byHandRulesCase(rules, { learningIssue: false, now });
  assert.deepEqual(banOnly.case === "fitted" && banOnly.kinds, ["explain", "answer", "test"]);
  // The lock is a copy: changing it never changes the rules it came from.
  fitted.lock.rules[0].allows[0].kinds.push("review");
  assert.deepEqual(rules.findings[0].allows![0].kinds, ["explain", "answer", "test"]);
  // A checked-list finding's source goes into the lock.
  const listed = { ...qemu(), source: { registry: "x/y", url: "https://example.org/policy", checkedOn: "2026-10-19" } };
  const listedCase = byHandRulesCase(rulesOf(listed), { learningIssue: false, now });
  assert.deepEqual(listedCase.case === "fitted" && listedCase.lock.rules[0].source, listed.source);
});

test("the decision is pure: the same input gives the same answer and nothing it reads changes", () => {
  const rules = rulesOf(qemu());
  const byHand = input(lockFor(rules), ["explain", "answer", "test"]);
  const before = JSON.stringify([rules, byHand]);
  const first = byHandRulesDecision({ bans: rules.findings, areas: [], rules }, byHand);
  const second = byHandRulesDecision({ bans: rules.findings, areas: [], rules }, byHand);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify([rules, byHand]), before);
});

test("the carve-out word table: each row names its kinds, and nothing else names any", () => {
  for (const [text, kinds] of [
    // understand, understanding (of the existing code), explain, learning aid
    ["help me understand Servo's codebase better", ["explain", "answer"]],
    ["Gaining understanding of the existing code", ["explain", "answer"]],
    ["to explain the code", ["explain", "answer"]],
    ["explanations of the parser", ["explain", "answer"]],
    ["to use AI as a learning aid", ["explain", "answer"]],
    // research, researching
    ["research", ["explain", "answer"]],
    ["researching APIs or algorithms", ["explain", "answer"]],
    // questions (about the code or codebase), answer questions
    ["Asking an LLM questions about an existing codebase", ["explain", "answer"]],
    ["to answer questions", ["explain", "answer"]],
    // debug, debugging
    ["debugging", ["test"]],
    ["to debug a failing test", ["test"]],
    // review (of your own code, privately)
    ["Asking an LLM to privately review your code or prose", ["review"]],
    ["private review", ["review"]],
    ["reviewing your own code", ["review"]],
    // possible solutions, solution ideas
    ["generate possible solutions to an issue", ["plan"]],
    ["Getting solution ideas", ["plan"]],
    // Several rows at once, in vocabulary order.
    ["researching APIs or algorithms, static analysis, or debugging", ["explain", "answer", "test"]],
  ] as const)
    assert.deepEqual(carveOutKinds(text), kinds, text);
  for (const text of [
    "static analysis",
    "find bugs",
    "finding bugs",
    "analyze",
    "analyze, distill, refine, check",
    "suggest",
    "suggestions",
    "review",
    "an AI review tool for my pull request",
    "understand the output",
    "questions",
    "solutions",
    "brainstorming",
    "code completions",
    "translation",
    "researchers",
    "debugger",
    "",
  ])
    assert.deepEqual(carveOutKinds(text), [], text);
});
