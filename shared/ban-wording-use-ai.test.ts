// "Please do not use AI at all when contributing." and "You may not use AI
// for contributions.": using AI itself, refused to the contributor, is a
// ban of AI help (plan README §18.10, W2G verifier follow-up 1). It blocks
// agent runs, and a fitted Learn-by-hand run never gets the quoted confirm
// for it, even with a carve-out beside it. The sentences are written for
// these tests.
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

test("using AI itself, refused to the contributor in a contribution, is a ban of AI help", () => {
  for (const text of [
    "Please do not use AI at all when contributing.",
    "You may not use AI for contributions.",
    "Never use AI for your pull requests.",
    "Contributors must not use AI in their patches.",
    "Using AI for contributions is forbidden.",
    "We do not allow the use of AI in contributions.",
    "Please **don’t** use AI\r\nwhen contributing to this project.",
    "DO NOT USE AI AT ALL WHEN CONTRIBUTING.",
  ]) {
    const result = read(text);
    assert.deepEqual(result.bans, [[true, "assistance"]], text);
    assert.ok(result.agent.includes("ai-ban"), text);
    assert.deepEqual(result.case.case === "blocked" && result.case.reason, "reach", text);
  }
});

test("AI the project uses, AI in a game, a condition, or what the person needn't do is no ban", () => {
  for (const text of [
    "This project does not use AI to rank results.",
    "We do not use AI for code review.",
    "Maintainers do not use AI for code reviews.",
    "Do not use AI opponents in ranked matches when testing patches.",
    "You cannot use AI features without a license key.",
    "If you don't use AI, you don't need to fill in this section of the pull request template.",
    "You don't have to use AI for your patches.",
    "Some projects say you must not use AI at all when contributing; we only ask for a note.",
  ]) {
    const result = read(text);
    assert.deepEqual(result.bans, [], text);
    assert.ok(!result.agent.includes("ai-ban"), text);
  }
});
