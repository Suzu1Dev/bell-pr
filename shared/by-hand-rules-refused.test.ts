// Any rule in the same rules that refuses AI help itself, or whose reach
// BELL can't tell, stops the quoted confirm, even where it names no
// contribution ("AI assistance of any kind is not accepted."): the case
// stays blocked, by reach (plan README §18.10, W2G verifier follow-up 3).
// A rule the person weighs for something else doesn't. QEMU's ban and
// carve-out are verbatim (docs/devel/code-provenance.rst, plan
// research/policies.md §3.3); the other sentences are written for these
// tests.
import assert from "node:assert/strict";
import test from "node:test";
import type { HelpLock } from "./by-hand.js";
import { byHandRulesCase, byHandRulesDecision } from "./by-hand-rules.js";
import { respectChecks, type ContributionRules } from "./contribution.js";
import { attachCarveOuts, classifyPolicy } from "./project-policy.js";

const qemu = [
  "Use of AI-generated content",
  "~~~~~~~~~~~~~~~~~~~~~~~~~~~",
  "",
  "**Current QEMU project policy is to DECLINE any contributions which are",
  "believed to include or derive from AI generated content. This includes",
  "ChatGPT, Claude, Copilot, Llama and similar tools.**",
  "",
  "**This policy does not apply to other uses of AI, such as researching APIs",
  "or algorithms, static analysis, or debugging, provided their output is not",
  "included in contributions.**",
].join("\n");
const qemuPath = "docs/devel/code-provenance.rst";
const createdAt = "2026-10-20T09:00:00.000Z";

function rulesOf(documents: [path: string, text: string][]): ContributionRules {
  return {
    checkedAt: "2026-10-20T10:00:00.000Z",
    findings: documents.flatMap(([path, text]) => attachCarveOuts(path, text, classifyPolicy(path, text))),
    filesRead: documents.map(([path]) => path),
  };
}
/** QEMU's text with `sentence` in the same document, or in CONTRIBUTING.md. */
const withRule = (sentence: string, elsewhere = false) =>
  rulesOf(elsewhere ? [[qemuPath, qemu], ["CONTRIBUTING.md", sentence]] : [[qemuPath, `${qemu}\n\n${sentence}\n`]]);
const caseOf = (rules: ContributionRules) => byHandRulesCase(rules, { learningIssue: false, now: createdAt });

/** The lock a run fitted to QEMU's text alone holds. */
function qemuLock(): HelpLock {
  const fitted = caseOf(rulesOf([[qemuPath, qemu]]));
  assert.equal(fitted.case, "fitted");
  return { ...(fitted as Extract<typeof fitted, { case: "fitted" }>).lock, at: createdAt };
}

const refusing = [
  "AI assistance of any kind is not accepted.",
  "AI is not welcome here.",
  "LLMs must not be used.",
  // Reach BELL can't tell.
  "Anything made with AI tools is not accepted.",
  // An exception for something else is no condition the person meets.
  "Do not use AI, except for translations.",
];

test("a rule refusing AI help, or of unclear reach, anywhere in the rules keeps a fitted case blocked by reach", () => {
  assert.equal(caseOf(rulesOf([[qemuPath, qemu]])).case, "fitted");
  for (const sentence of refusing)
    for (const elsewhere of [false, true]) {
      const result = caseOf(withRule(sentence, elsewhere));
      assert.equal(result.case, "blocked", sentence);
      assert.deepEqual(
        result.case === "blocked" && [result.reason, result.finding.kind, result.finding.contribution],
        ["reach", "ban", false],
        sentence,
      );
    }
});

test("a run fitted before such a rule appeared never gets the quoted confirm", () => {
  const lock = qemuLock();
  for (const sentence of refusing) {
    const rules = withRule(sentence);
    const bans = rules.findings.filter((finding) => finding.kind === "ban" && finding.contribution);
    const decision = byHandRulesDecision(
      { bans, areas: [], rules },
      { helps: ["explain", "answer"], helpLock: lock, createdAt, now: "2026-10-20T12:00:00.000Z" },
    );
    assert.deepEqual([decision.confirmable, decision.blocked.map((entry) => entry.reason)], [[], ["reach"]], sentence);
    const checks = respectChecks(
      {
        body: "Retries a GET twice.",
        rules,
        learnByHand: { helps: ["explain", "answer"], helpLock: lock, createdAt, now: "2026-10-20T12:00:00.000Z" },
      },
      "en",
    ).map((check) => `${check.id}:${check.kind}`);
    assert.ok(checks.includes("ai-ban:block") && !checks.includes("by-hand-rules:confirm"), `${sentence}: ${checks}`);
    // An agent run's checks are the same as before: the ban, and the rule to weigh.
    assert.deepEqual(
      respectChecks({ body: "Retries a GET twice.", rules }, "en").map((check) => check.id),
      ["ai-ban", "project-rules"],
      sentence,
    );
  }
});

test("a rule the person weighs for something else, or the project's own practice, doesn't stop the confirm", () => {
  for (const sentence of [
    "You may use AI tools to explore the code, but do not submit code you do not understand.",
    "Listing AI tooling as a co-author, co-signing commits using an AI tool, or using the `assisted-by` trailer is not allowed.",
    "Do not use AI-generated text in human-to-human communication.",
    "Do not use AI to generate substantial pieces of code.",
    "We do not use AI tools in our own release process.",
    "Do not use AI tools unless you have reviewed every line yourself.",
    "No AI-generated media is allowed (art, images, videos, audio, etc.).",
  ]) {
    const rules = withRule(sentence);
    assert.ok(
      rules.findings.some((finding) => finding.kind === "ban" && !finding.contribution),
      `${sentence} is a rule to weigh`,
    );
    const result = caseOf(rules);
    assert.equal(result.case, "fitted", sentence);
  }
});
