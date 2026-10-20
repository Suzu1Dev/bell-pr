// The respect checks of a Learn-by-hand run (shared/contribution.ts
// respectChecks with DraftPreflightInput.learnByHand): the input is set
// only for a clean Learn-by-hand run (byHandPreflight), and an agent run's
// checks never change.
import assert from "node:assert/strict";
import test from "node:test";
import type { HelpLock } from "./by-hand.js";
import {
  byHandBlockClause,
  byHandRulesDecisionInTests,
  overridableCheckIds,
  respectChecks,
  type ContributionFacts,
  type ContributionRules,
  type PolicyFinding,
} from "./contribution.js";
import type { ByHandPreflightInput, DraftCheck } from "./draft-checks.js";

const disclosureRules: ContributionRules = {
  checkedAt: "2026-10-20T00:00:00.000Z",
  findings: [
    { kind: "disclose", path: "CONTRIBUTING.md", line: 12, quote: "If you used AI tools, say so in the PR description.", contribution: true },
  ],
  filesRead: ["CONTRIBUTING.md"],
};
const learnByHand: ByHandPreflightInput = {
  helps: ["explain", "answer", "review"],
  now: "2026-10-21T00:00:00.000Z",
};
const disclosureCheck = (body: string, byHand?: ByHandPreflightInput) =>
  respectChecks({ body, rules: disclosureRules, ...(byHand ? { learnByHand: byHand } : {}) }, "en").find(
    (check) => check.id === "ai-disclosure",
  );

test("the guide's help verbs satisfy a disclosure rule only for a clean Learn-by-hand run", () => {
  const honest = "Fixes the cap.\n\nClaude Code explained the parser and pointed out problems in my draft.";
  assert.equal(disclosureCheck(honest, learnByHand), undefined);
  // The same words in an agent run (or an unclean Learn-by-hand run, which gets no input) do not.
  assert.equal(disclosureCheck(honest)?.kind, "block");
  assert.equal(disclosureCheck("Fixes the cap.\n\nNot reviewed by AI.", learnByHand)?.kind, "block");
  assert.equal(disclosureCheck("Fixes the cap.\n\nI used Claude Code to explain the parser.")?.kind, undefined);
});

// Quotes verbatim from real policies (plan/direction-v1.2/research/policies.md).
const gentoo =
  "It is expressly forbidden to contribute to Gentoo any content that has been created with the assistance of Natural Language Processing artificial intelligence tools.";
const qemu =
  "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.";
const qemuCarveOut =
  "This policy does not apply to other uses of AI, such as researching APIs or algorithms, static analysis, or debugging, provided their output is not included in contributions.";
const llvm = 'Using AI tools to fix issues labelled as "good first issues" is forbidden';
const matplotlib = "pull requests that are AI generated will be closed.";
const claim = "BELL PR's agents had no write access and gave you no code for this change.";

const ban = (quote: string, extra: Partial<PolicyFinding> = {}): PolicyFinding => ({
  kind: "ban",
  path: "CONTRIBUTING.md",
  line: 7,
  quote,
  contribution: true,
  ...extra,
});
const area = (quote: string): PolicyFinding => ({ kind: "area", path: "docs/contribute.md", line: 20, quote, contribution: true });
const rulesWith = (...findings: PolicyFinding[]): ContributionRules => ({
  checkedAt: "2026-10-20T08:00:00.000Z",
  findings,
  filesRead: ["CONTRIBUTING.md"],
});
const helpLock: HelpLock = {
  kinds: ["explain", "answer", "test"],
  at: "2026-10-20T09:00:00.000Z",
  rulesCheckedAt: "2026-10-20T08:00:00.000Z",
  rules: [],
};
const goodFirstIssue: ContributionFacts = {
  checkedAt: "2026-10-20T10:00:00.000Z",
  issue: { url: "https://github.com/acme/widgets/issues/7", state: "OPEN", labels: ["good first issue"] },
};
const checksFor = (rules: ContributionRules, byHand?: ByHandPreflightInput, facts?: ContributionFacts) =>
  respectChecks(
    { body: "Fixes the cap.", rules, ...(facts ? { facts } : {}), ...(byHand ? { learnByHand: byHand } : {}) },
    "en",
  );
const ids = (checks: DraftCheck[]) => checks.map((check) => `${check.id}:${check.kind}`);

test("with learnByHand, ai-ban still blocks every ban the quoted confirm keeps blocked, by reach", () => {
  const withLock = { ...learnByHand, helpLock, createdAt: "2026-10-20T09:00:00.000Z" };
  for (const [name, finding, message] of [
    [
      "assistance reach (Gentoo)",
      ban(gentoo),
      "The project's rules restrict AI help itself, so BELL PR won't publish a run its guide helped with.",
    ],
    [
      "unknown reach",
      ban("We do not accept AI contributions."),
      `The project's rules decline AI-generated content. ${claim} BELL PR publishes here only through the project's own text, and its rule restricts AI help itself, or BELL PR can't tell what it covers.`,
    ],
    [
      "output ban without a carve-out (QEMU)",
      ban(qemu),
      `The project's rules decline AI-generated content. ${claim} BELL PR publishes here only through the project's own text, and its text doesn't say which uses of AI are fine.`,
    ],
    [
      "output ban with a carve-out, not fitted at the start",
      ban(qemu, { allows: [{ line: 297, quote: qemuCarveOut, kinds: ["explain", "answer", "test"] }] }),
      undefined,
    ],
  ] as const) {
    for (const byHand of [learnByHand, withLock]) {
      const checks = checksFor(rulesWith(finding), byHand);
      const block = checks.find((check) => check.id === "ai-ban");
      assert.equal(block?.kind, "block", name);
      if (message) assert.equal(block!.message, message, name);
      assert.deepEqual(block!.details, [
        "Maintainers decide what their rules cover; BELL PR only quotes them. If you're not sure, ask the project's people.",
        `CONTRIBUTING.md:7: "${finding.quote}"`,
      ]);
      assert.ok(!checks.some((check) => check.id === "by-hand-rules"), name);
    }
  }
});

test("with learnByHand, area-reserved still blocks LLVM's 'use' wording and an output reservation", () => {
  const llvmBlock = checksFor(rulesWith(area(llvm)), learnByHand, goodFirstIssue).find(
    (check) => check.id === "area-reserved",
  )!;
  assert.equal(llvmBlock.kind, "block");
  assert.equal(
    llvmBlock.message,
    "The project keeps this issue for people learning without AI tools, so BELL PR won't publish a run its guide helped with.",
  );
  assert.deepEqual(llvmBlock.details.slice(1), ["GitHub labels: good first issue", `docs/contribute.md:20: "${llvm}"`]);
  const matplotlibBlock = checksFor(rulesWith(area(matplotlib)), learnByHand, goodFirstIssue).find(
    (check) => check.id === "area-reserved",
  )!;
  assert.equal(matplotlibBlock.kind, "block");
  assert.equal(
    matplotlibBlock.message,
    "The project closes AI-generated pull requests for issues like this one. BELL PR publishes them only through the project's own text, and its text doesn't say which uses of AI are fine.",
  );
  // Without a learning label the reservation doesn't apply, as for agent runs.
  assert.ok(!checksFor(rulesWith(area(llvm)), learnByHand).some((check) => check.id === "area-reserved"));
});

test("an agent run's ai-ban and area-reserved copy and outcome do not change", () => {
  const agent = checksFor(rulesWith(ban(gentoo), area(llvm)), undefined, goodFirstIssue);
  assert.deepEqual(ids(agent), ["ai-ban:block", "area-reserved:block"]);
  assert.match(agent[0].message, /^The project's rules do not accept AI-assisted contributions, and AI agents wrote this change\./);
  assert.match(agent[1].message, /pick an issue that isn't reserved\.$/);
  assert.deepEqual([...overridableCheckIds], ["issue-has-pr"]);
});

test("a by-hand-rules confirm from the decision renders as one confirm with every detail line", (t) => {
  const finding = ban(qemu, { allows: [{ line: 297, quote: qemuCarveOut, kinds: ["explain", "answer", "test"] }] });
  const other = ban("The QEMU project will decline any contribution if use of AI is either known or suspected.", { line: 325, contribution: false });
  byHandRulesDecisionInTests(() => ({
    blocked: [],
    confirmable: [{ finding, allows: finding.allows!, others: [other] }],
  }));
  t.after(() => byHandRulesDecisionInTests());
  const checks = checksFor(rulesWith(finding), { ...learnByHand, helpLock });
  assert.ok(!checks.some((check) => check.id === "ai-ban"));
  const confirms = checks.filter((check) => check.id === "by-hand-rules");
  assert.equal(confirms.length, 1);
  assert.equal(confirms[0].kind, "confirm");
  assert.equal(
    confirms[0].message,
    "The project declines AI-generated contributions, and its own text says some uses of AI are fine. BELL PR is quoting the project, not deciding for it: the maintainers decide whether your change fits.",
  );
  assert.deepEqual(confirms[0].details, [
    "Maintainers decide what their rules cover; BELL PR only quotes them. If you're not sure, ask the project's people.",
    `CONTRIBUTING.md:7: "${qemu}"`,
    `The same rules say: CONTRIBUTING.md:297: "${qemuCarveOut}"`,
    `The same rules say: CONTRIBUTING.md:325: "${other.quote}"`,
    `Fitted at the start, the guide offered only explanations, answers, and test help. ${claim} You used: explanations, answers, and reviews.`,
    "BELL PR can't see other tools you used, such as editor autocomplete.",
  ]);
  // The reserved-issue variant, and a checked-list finding's source line.
  const listed = { ...area(matplotlib), source: { registry: "bell", url: "https://example.org/policy", checkedOn: "2026-10-19" } };
  byHandRulesDecisionInTests(() => ({ blocked: [], confirmable: [{ finding: listed, allows: [], others: [] }] }));
  const reserved = checksFor(rulesWith(listed), learnByHand, goodFirstIssue).find((check) => check.id === "by-hand-rules")!;
  assert.match(reserved.message, /^The project closes AI-generated pull requests for issues like this one, and its own text/);
  assert.match(reserved.details[1], /^BELL PR's checked list, .*2026, https:\/\/example\.org\/policy: "pull requests that are AI generated will be closed\."$/);
  assert.equal(reserved.details[2], `${claim} You used: explanations, answers, and reviews.`);
});

test("while any finding is blocked, no confirm appears and the passing ones stay quoted in their block", (t) => {
  const passing = ban(qemu, { allows: [{ line: 297, quote: qemuCarveOut, kinds: ["explain"] }] });
  const failing = area(matplotlib);
  byHandRulesDecisionInTests(() => ({
    blocked: [{ finding: failing, reason: "kind-not-named", kinds: ["review"] }],
    confirmable: [{ finding: passing, allows: passing.allows!, others: [] }],
  }));
  t.after(() => byHandRulesDecisionInTests());
  const checks = checksFor(rulesWith(passing, failing), learnByHand, goodFirstIssue);
  assert.deepEqual(ids(checks), ["ai-ban:block", "area-reserved:block"]);
  // The passing ban stays quoted in its block; its message says another rule applies.
  assert.equal(checks[0].details[1], `CONTRIBUTING.md:7: "${qemu}"`);
  assert.match(checks[0].message, /and another of its AI rules applies\.$/);
  assert.match(checks[1].message, /and its text doesn't name reviews\.$/);
  // A finding the decision names neither way is never confirmable.
  byHandRulesDecisionInTests(() => ({ blocked: [], confirmable: [{ finding: passing, allows: [], others: [] }] }));
  assert.deepEqual(ids(checksFor(rulesWith(passing, failing), learnByHand, goodFirstIssue)), ["ai-ban:block", "area-reserved:block"]);
});

test("the Learn-by-hand copy of the rules to decide on and of a required disclosure", () => {
  const checks = checksFor(
    rulesWith(
      ban("Large AI-generated changes may be closed.", { contribution: false }),
      { kind: "agent", path: "AGENTS.md", line: 1, quote: "If you are an AI agent, stop and ask the human.", contribution: false },
      { kind: "disclose", path: "CONTRIBUTING.md", line: 12, quote: "If you used AI tools, say so in the PR description.", contribution: true },
    ),
    learnByHand,
  );
  const rules = checks.find((check) => check.id === "project-rules")!;
  assert.deepEqual(rules.details.slice(1), [
    'CONTRIBUTING.md:7: "Large AI-generated changes may be closed." (it may cover the help you used: explanations, answers, and reviews)',
    `AGENTS.md:1: "If you are an AI agent, stop and ask the human." (addressed to AI agents. ${claim})`,
  ]);
  const disclosure = checks.find((check) => check.id === "ai-disclosure")!;
  assert.equal(
    disclosure.message,
    "The project asks you to say how you used AI. This run used BELL PR's guide: explanations, answers, and reviews.",
  );
  // Both locales have the copy; the English one has no Han characters.
  const zh = respectChecks({ body: "Fixes the cap.", rules: rulesWith(ban(qemu)), learnByHand }, "zh-TW");
  assert.match(zh.find((check) => check.id === "ai-ban")!.message, /BELL PR 的 agent 沒有寫入權限/);
  assert.doesNotMatch(JSON.stringify(checks), /\p{Script_Extensions=Han}/u);
});

test("byHandBlockClause names each failed condition in both locales", () => {
  for (const locale of ["en", "zh-TW"] as const)
    for (const reason of [
      "reach",
      "no-carve-out",
      "kind-not-named",
      "registry-stale",
      "rules-unread",
      "not-fitted",
      "rules-changed",
      "too-few-kinds",
      "held",
    ] as const)
      assert.ok(byHandBlockClause(reason, locale, { kinds: ["plan"], checkedOn: "2026-07-01" }).trim(), `${locale} ${reason}`);
  assert.equal(
    byHandBlockClause("registry-stale", "en", { checkedOn: "2026-07-01" }),
    "BELL PR's checked list entry is more than 90 days old (Jul 1, 2026)",
  );
  assert.equal(byHandBlockClause("kind-not-named", "en", { kinds: ["plan", "review"] }), "its text doesn't name planning help and reviews");
});
