// "Contributions must not involve AI in any way.", "AI may not be involved
// in any contribution.": AI involvement in a contribution, refused, is a
// ban of AI help (a close variant of plan README §18.10's "LLMs must not
// be used at any stage"; Mesa's word). It blocks agent runs, and a fitted
// Learn-by-hand run never gets the quoted confirm for it. The sentences
// are written for these tests.
import assert from "node:assert/strict";
import test from "node:test";
import { byHandRulesCase } from "./by-hand-rules.js";
import { respectChecks } from "./contribution.js";
import { banReach } from "./policy-reach.js";
import { attachCarveOuts, classifyPolicy } from "./project-policy.js";

const carveOut = "This policy does not apply to using AI to understand the code or to research APIs.";

function read(text: string) {
  const document = `# Contributing\n\n${text}\n\n${carveOut}\n`;
  const findings = attachCarveOuts("CONTRIBUTING.md", document, classifyPolicy("CONTRIBUTING.md", document));
  const rules = { checkedAt: "2026-10-20T10:00:00.000Z", findings, filesRead: ["CONTRIBUTING.md"] };
  return {
    bans: findings.filter((finding) => finding.kind === "ban").map((finding) => [finding.contribution, banReach(finding.quote)]),
    case: byHandRulesCase(rules, { learningIssue: false, now: "2026-10-20T09:00:00.000Z" }),
    agent: respectChecks({ body: "Retries a GET twice.", rules }, "en").map((check) => check.id),
  };
}

test("AI involvement in a contribution, refused, is a ban of AI help", () => {
  for (const text of [
    "Contributions must not involve AI in any way.",
    "AI may not be involved in any contribution.",
    "Contributions that involve AI will be rejected.",
    "Pull requests involving AI will be closed.",
    "We do not accept any AI involvement in contributions.",
    "We decline patches where AI was involved.",
  ]) {
    const result = read(text);
    assert.deepEqual(result.bans, [[true, "assistance"]], text);
    assert.ok(result.agent.includes("ai-ban"), text);
    assert.deepEqual(result.case.case === "blocked" && result.case.reason, "reach", text);
  }
});

test("AI involved in a feature, a crash or a disclosure is no ban", () => {
  for (const text of [
    "Changes that involve AI features need a design doc first.",
    'Disclosure is always required when "AI" was involved in the creative process of coming up with the code.',
    "Crashes that involve the AI module must not be filed without a backtrace.",
    "Tell us whether AI was involved; we will not merge a patch until you do.",
  ]) {
    const result = read(text);
    assert.deepEqual(result.bans, [], text);
    assert.ok(!result.agent.includes("ai-ban"), text);
  }
});
