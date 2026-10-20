import assert from "node:assert/strict";
import test from "node:test";
import type { ContributionFacts, ContributionRules } from "../../shared/contribution";
import { getDemo } from "../demo";
import en from "../i18n/en/mission";
import zhTW from "../i18n/zh-TW/mission";
import { assertNoHan } from "../test-utils/render";
import {
  byHandReasonText,
  byHandStartReason,
  doorClosed,
  doorState,
  factsFrom,
  issueNumber,
  knownDoor,
  rulesFrom,
  sampleRules,
  startReasons,
  suggestedMode,
  unknownParts,
} from "./respect";

const demo = getDemo("en");
const rules = sampleRules(demo);
const facts = demo.contributionFacts!;

test("the door is open, for collaborators only, turned off or archived", () => {
  assert.equal(doorState({ hasPullRequests: true, pullRequestCreationPolicy: "all" }), "open");
  assert.equal(doorState({}), "open");
  assert.equal(doorState({ pullRequestCreationPolicy: "collaborators_only", viewerPermission: "READ" }), "collaborators");
  assert.equal(doorState({ pullRequestCreationPolicy: "collaborators_only" }), "collaborators");
  // Triage and above may open them there.
  assert.equal(doorState({ pullRequestCreationPolicy: "collaborators_only", viewerPermission: "triage" }), "open");
  assert.equal(doorState({ hasPullRequests: false }), "off");
  assert.equal(doorState({ disabled: true }), "off");
  assert.equal(doorState({ archived: true, hasPullRequests: true }), "archived");
  assert.equal(doorClosed({ archived: true }), true);
  assert.equal(doorClosed({ hasPullRequests: true }), false);
});

test("unknown facts split into their part and reason", () => {
  assert.deepEqual(unknownParts(["door: gh failed: exit 1", "issue", "pacing:", "rate limited"], "en"), [
    { part: "door", reason: "gh failed: exit 1" },
    { part: "issue", reason: undefined },
    { part: "pacing", reason: undefined },
    { part: "other", reason: "rate limited" },
  ]);
  assert.deepEqual(unknownParts(undefined, "en"), []);
  // A stored reason code is worded in the reader's language whenever they
  // look; words an older build stored stay as they are.
  const stored = ["door: github-error", "issue: GitHub answered with an error."];
  assert.deepEqual(unknownParts(stored, "en").map((entry) => entry.reason), [
    "GitHub answered with an error.",
    "GitHub answered with an error.",
  ]);
  assert.deepEqual(unknownParts(stored, "zh-TW").map((entry) => entry.reason), [
    "GitHub 回應了錯誤。",
    "GitHub answered with an error.",
  ]);
});

test("only GitHub issue page URLs have an issue number, as the server accepts them", () => {
  assert.equal(issueNumber("https://github.com/acme/widgets/issues/42"), 42);
  assert.equal(issueNumber(" https://github.com/acme/widgets/issues/42/ "), 42);
  assert.equal(issueNumber("https://github.com/acme/widgets/pull/42"), undefined);
  assert.equal(issueNumber("http://github.com/acme/widgets/issues/42"), undefined);
  assert.equal(issueNumber("https://github.com/acme/widgets/issues/0"), undefined);
  assert.equal(issueNumber("#sample-issue-42"), undefined);
  assert.equal(issueNumber(""), undefined);
  assert.equal(issueNumber(), undefined);
});

test("route answers are read bare or wrapped, and anything else is no answer", () => {
  assert.equal(rulesFrom(rules), rules);
  assert.equal(rulesFrom({ rules }), rules);
  assert.equal(rulesFrom({}), undefined);
  assert.equal(rulesFrom({ rules: null }), undefined);
  assert.equal(rulesFrom({ checkedAt: "x", findings: "nope", filesRead: [] }), undefined);
  assert.equal(rulesFrom(undefined), undefined);
  assert.equal(factsFrom(facts), facts);
  assert.equal(factsFrom({ facts }), facts);
  assert.equal(factsFrom({ facts: {} }), undefined);
  assert.equal(factsFrom("text"), undefined);
});

test("the issue check's login tells the person's own pull request from someone else's", () => {
  const issue = { ...facts.issue!, otherPrs: [{ number: 3, author: "Me", state: "OPEN", willClose: true }] };
  // A project imported from a local folder has no stored door, so no login.
  const local: ContributionRules = { ...rules, door: undefined };
  assert.deepEqual(startReasons({ checkedAt: "x", issue }, local), [{ id: "other-pr", author: "Me", number: 3 }]);
  assert.deepEqual(startReasons({ checkedAt: "x", issue, door: { login: "me" } }, local), []);
  assert.deepEqual(knownDoor({ checkedAt: "x", door: { login: "me" } }, local), { login: "me" });
  // With a stored door, the login read now joins it.
  assert.deepEqual(knownDoor({ checkedAt: "x", door: { login: "me" } }, { ...rules, door: { viewerPermission: "READ", login: "old" } }), {
    viewerPermission: "READ",
    login: "me",
  });
  assert.equal(knownDoor(undefined, local), undefined);
});

test("the sample's facts give Start nothing to ask", () => {
  assert.deepEqual(startReasons(facts, rules), []);
  assert.deepEqual(startReasons(), []);
});

test("Start asks once for a closed issue, someone else's PR, a closed door, a ban, a newcomer issue or a full pace", () => {
  const issue = facts.issue!;
  assert.deepEqual(startReasons({ ...facts, issue: { ...issue, state: "CLOSED" } }, rules), [{ id: "issue-closed" }]);
  assert.deepEqual(
    startReasons(
      {
        ...facts,
        issue: {
          ...issue,
          otherPrs: [
            { number: 3, author: "SAMPLE_CONTRIBUTOR", state: "OPEN", willClose: true },
            { number: 5, author: "mentioned_only", state: "OPEN", willClose: false },
            { number: 6, author: "gone", state: "CLOSED" },
            { number: 7, author: "other_dev", state: "OPEN" },
          ],
        },
      },
      rules,
    ),
    [{ id: "other-pr", author: "other_dev", number: 7 }],
  );
  const closedDoor: ContributionRules = {
    ...rules,
    door: { pullRequestCreationPolicy: "collaborators_only", viewerPermission: "READ" },
  };
  assert.deepEqual(startReasons(undefined, closedDoor), [{ id: "door" }]);
  // Facts read now win over the door stored at import.
  assert.deepEqual(startReasons({ checkedAt: "x", door: { hasPullRequests: true } }, closedDoor), []);
  // The issue check reads only the person's login: the stored door stays.
  assert.deepEqual(startReasons({ checkedAt: "x", door: { login: "me" } }, closedDoor), [{ id: "door" }]);
  const ban = { kind: "ban" as const, path: "AI_POLICY.md", line: 3, quote: "We do not accept AI-generated pull requests.", contribution: true };
  assert.deepEqual(startReasons(undefined, { ...rules, findings: [ban] }), [{ id: "ban" }]);
  // An ambiguous ban only asks at publish.
  assert.deepEqual(startReasons(undefined, { ...rules, findings: [{ ...ban, contribution: false }] }), []);
  const newcomer: ContributionFacts = { ...facts, issue: { ...issue, labels: ["good first issue"] } };
  assert.deepEqual(startReasons(newcomer, rules), [{ id: "learning" }]);
  const area = { kind: "area" as const, path: "CONTRIBUTING.md", line: 9, quote: "Good first issues are reserved for humans.", contribution: true };
  assert.deepEqual(startReasons(newcomer, { ...rules, findings: [area] }), [{ id: "area" }]);
  assert.deepEqual(startReasons({ ...facts, pacing: { openPrs: 2, mergedPrs: 0 } }, rules), [
    { id: "pacing", open: 2, budget: 1 },
  ]);
  // At the budget it is a confirm at publish only; write access is never paced.
  assert.deepEqual(startReasons({ ...facts, pacing: { openPrs: 1, mergedPrs: 0 } }, rules), []);
  assert.deepEqual(startReasons({ ...facts, pacing: { openPrs: 9, viewerPermission: "WRITE" } }, rules), []);
});

test("the sample's rules come from its CONTRIBUTING.md, its door and its merged sizes, in both locales", () => {
  for (const locale of ["en", "zh-TW"] as const) {
    const demo = getDemo(locale);
    const built = sampleRules(demo);
    assert.deepEqual(built.door, demo.contributionFacts?.door, locale);
    assert.deepEqual(built.mergedSizes, demo.mergedSizes, locale);
    assert.equal(built.checkedAt, demo.draftPreparation.context?.checkedAt, locale);
    assert.deepEqual(built.filesRead, ["CONTRIBUTING.md", ".github/PULL_REQUEST_TEMPLATE.md"], locale);
    assert.deepEqual(built.findings.map((finding) => finding.kind), ["issue-first", "understand", "disclose"], locale);
  }
});

// Learn by hand (DESIGN v1.2 F1, F12): the case of the project's rules,
// said in the task dialog before the first line is written.
const gentoo =
  "It is expressly forbidden to contribute to Gentoo any content that has been created with the assistance of Natural Language Processing artificial intelligence tools.";
const llvm = 'Using AI tools to fix issues labelled as "good first issues" is forbidden.';
const qemuRule =
  "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.";
const ruleSet = (...findings: ContributionRules["findings"]): ContributionRules => ({
  checkedAt: "2026-10-20T00:00:00.000Z",
  findings,
  filesRead: ["CONTRIBUTING.md"],
});
const newcomerIssue: ContributionFacts = {
  checkedAt: "2026-10-20T00:00:00.000Z",
  issue: { number: 7, url: "https://github.com/octo/widgets/issues/7", state: "OPEN", labels: ["good first issue"] },
};

test("a learn-by-hand run says its own case at Start, instead of the agent team's ban and lesson", () => {
  const ban = ruleSet({ kind: "ban", path: "CONTRIBUTING.md", line: 3, quote: gentoo, contribution: true });
  const rulesCase = { case: "blocked", finding: ban.findings[0], reach: "assistance", reason: "reach" } as const;
  assert.deepEqual(startReasons(newcomerIssue, ban), [{ id: "ban" }, { id: "learning" }]);
  assert.deepEqual(startReasons(newcomerIssue, ban, { rulesCase }), [
    { id: "by-hand-ban", reach: "assistance", reason: "reach" },
  ]);
  // A reserved issue blocks a learn-by-hand run with its own reason.
  const area = ruleSet({ kind: "area", path: "CONTRIBUTING.md", line: 9, quote: llvm, contribution: false });
  assert.deepEqual(
    startReasons(newcomerIssue, area, {
      rulesCase: { case: "blocked", finding: area.findings[0], reach: "use", reason: "reach" },
    }),
    [{ id: "by-hand-area", reach: "use", reason: "reach" }],
  );
  // No rule applies: the person writes it, so there is no newcomer lesson.
  assert.deepEqual(startReasons(newcomerIssue, ruleSet(), { rulesCase: { case: "none" } }), []);
  // A checked-list finding carries its date for the clause.
  const listed = {
    ...ban.findings[0],
    source: { registry: "checked list", url: "https://example.org/policy", checkedOn: "2026-06-01" },
  };
  assert.deepEqual(
    byHandStartReason({ case: "blocked", finding: listed, reach: "output", reason: "registry-stale" }),
    { id: "by-hand-ban", reach: "output", reason: "registry-stale", checkedOn: "2026-06-01" },
  );
});

test("a fitted case names the kinds of help and quotes the first carve-out", () => {
  const carveOut = "This policy does not apply to other uses of AI, such as researching APIs or algorithms.";
  const reason = byHandStartReason({
    case: "fitted",
    kinds: ["explain", "answer"],
    lock: {
      kinds: ["explain", "answer"],
      rulesCheckedAt: "2026-10-20T00:00:00.000Z",
      rules: [
        { kind: "ban", path: "docs/a.rst", line: 1, quote: qemuRule, allows: [] },
        { kind: "ban", path: "docs/b.rst", line: 4, quote: qemuRule, allows: [{ line: 6, quote: carveOut, kinds: ["explain", "answer"] }] },
      ],
    },
  });
  assert.deepEqual(reason, { id: "by-hand-fitted", kinds: ["explain", "answer"], quote: carveOut });
  const m = en.startConfirm.byHand;
  const text = byHandReasonText(reason!, m, "en");
  assertNoHan(text);
  assert.equal(
    text,
    `BELL PR can publish a learn-by-hand run here only if the guide stays within what the project's own text says is fine (explanations and answers: "${carveOut}"), and only after you confirm the project's quoted rule. The maintainers decide whether your change fits.`,
  );
  assert.match(byHandReasonText(reason!, zhTW.startConfirm.byHand, "zh-TW"), /解說和回答/);
});

test("the reasons a learn-by-hand run won't publish are worded by the rule's reach and the failed condition", () => {
  const m = en.startConfirm.byHand;
  const ban = (reach: "assistance" | "output" | "unknown", reason: "reach" | "no-carve-out") =>
    byHandReasonText({ id: "by-hand-ban", reach, reason }, m, "en");
  assert.equal(
    ban("assistance", "reach"),
    "BELL PR won't publish a learn-by-hand run here: the project's rules restrict AI help itself, not only AI-written code.",
  );
  assert.equal(
    ban("output", "no-carve-out"),
    "BELL PR won't publish a learn-by-hand run here: the project's rules decline AI-generated content, and its text doesn't say which uses of AI are fine.",
  );
  assert.equal(
    ban("unknown", "reach"),
    "BELL PR won't publish a learn-by-hand run here: BELL PR can't tell from the project's rule what it covers.",
  );
  assert.equal(
    byHandReasonText({ id: "by-hand-area", reach: "use", reason: "reach" }, m, "en"),
    "BELL PR won't publish a learn-by-hand run for this issue: the project keeps it for people learning without AI tools.",
  );
  assert.equal(
    byHandReasonText({ id: "by-hand-area", reach: "output", reason: "no-carve-out" }, m, "en"),
    "BELL PR won't publish a learn-by-hand run for this issue: the project closes AI-generated pull requests for issues like it, and its text doesn't say which uses of AI are fine.",
  );
  for (const reach of ["assistance", "output", "unknown"] as const)
    assert.ok(byHandReasonText({ id: "by-hand-ban", reach, reason: "reach" }, zhTW.startConfirm.byHand, "zh-TW").length > 0);
});

test("Learn by hand is suggested only on projects whose rules neither ban AI nor reserve issues", () => {
  const ban = ruleSet({ kind: "ban", path: "CONTRIBUTING.md", line: 3, quote: gentoo, contribution: true });
  const area = ruleSet({ kind: "area", path: "CONTRIBUTING.md", line: 9, quote: llvm, contribution: false });
  const open = ruleSet({ kind: "disclose", path: "CONTRIBUTING.md", line: 5, quote: "Say how you used AI.", contribution: true });
  assert.equal(suggestedMode({ preferred: "hand", learningIssue: false, rules: open }), "hand");
  assert.equal(suggestedMode({ learningIssue: true, rules: open }), "hand");
  assert.equal(suggestedMode({ learningIssue: false, rules: open }), "agents");
  // A banning project is never a reason to preselect it.
  assert.equal(suggestedMode({ preferred: "hand", learningIssue: true, rules: ban }), "agents");
  assert.equal(suggestedMode({ preferred: "hand", learningIssue: true, rules: area }), "agents");
  // Rules not read yet: no preselection.
  assert.equal(suggestedMode({ preferred: "hand", learningIssue: true }), "agents");
  // Handed back to the agent team.
  assert.equal(suggestedMode({ preferred: "agents", learningIssue: true, rules: open }), "agents");
});
