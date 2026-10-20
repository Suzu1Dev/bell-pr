// "LLMs must not be used at any stage of a contribution." and "We do not
// accept contributions where an LLM was used at any stage.": AI that must
// not be used, or was used, in making the contribution is a ban of AI help
// itself (plan README §18.10, W2G verifier follow-up 1). It blocks agent
// runs, and a fitted Learn-by-hand run never gets the quoted confirm for
// it, even with a carve-out beside it. The sentences are written for these
// tests.
import assert from "node:assert/strict";
import test from "node:test";
import { byHandRulesCase } from "./by-hand-rules.js";
import { respectChecks } from "./contribution.js";
import { banReach } from "./policy-reach.js";
import { attachCarveOuts, classifyPolicy } from "./project-policy.js";

const carveOut = "This policy does not apply to using AI to understand the code or to research APIs.";

function read(text: string) {
  const document = `# AI policy\n\n${text}\n\n${carveOut}\n`;
  const findings = attachCarveOuts("CONTRIBUTING.md", document, classifyPolicy("CONTRIBUTING.md", document));
  const rules = { checkedAt: "2026-10-20T10:00:00.000Z", findings, filesRead: ["CONTRIBUTING.md"] };
  return {
    bans: findings.filter((finding) => finding.kind === "ban").map((finding) => [finding.contribution, banReach(finding.quote)]),
    case: byHandRulesCase(rules, { learningIssue: false, now: "2026-10-20T09:00:00.000Z" }),
    agent: respectChecks({ body: "Retries a GET twice.", rules }, "en").map((check) => check.id),
  };
}

test("AI that must not be used at any stage, or was used, in a contribution is a ban of AI help", () => {
  for (const text of [
    "LLMs must not be used at any stage of a contribution.",
    "We do not accept contributions where an LLM was used at any stage.",
    "AI must not be used in the creation of your pull request.",
    "Large language models may not be used for patches.",
    "LLMs **must not** be used\nat any stage of a contribution.",
    "We decline patches in which AI was used.",
    "LLMs mustn’t be used at any stage\r\nof a contribution.",
  ]) {
    const result = read(text);
    assert.deepEqual(result.bans, [[true, "assistance"]], text);
    assert.ok(result.agent.includes("ai-ban"), text);
    assert.deepEqual(result.case.case === "blocked" && result.case.reason, "reach", text);
  }
});

test("AI used as a feature, or a question whether AI was used, is no ban", () => {
  for (const text of [
    "This project does not use AI to rank results.",
    "AI must not be used to rank results.",
    "The enemy AI must not be used in multiplayer matches.",
    "AI is used to rank results; we do not accept PRs that change the ranking.",
    "We will not merge a pull request until we know whether AI was used.",
    "Some projects say LLMs must not be used at any stage; we only ask you to disclose it.",
    "Maintainers decide when AI may be used in the release process.",
    // Godot's rule about who authors the code (contributing.godotengine.org), which the person weighs.
    "AI should not be used to author code.",
  ]) {
    const result = read(text);
    assert.deepEqual(result.bans, [], text);
    assert.ok(!result.agent.includes("ai-ban"), text);
  }
});
