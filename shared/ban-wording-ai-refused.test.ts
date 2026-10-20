// "AI is banned from this project.": AI itself refused outright is a ban of
// AI help (plan README §18.10, W2G verifier follow-up 1). It blocks agent
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
  const document = `# Contributing\n\n${text}\n\n${carveOut}\n`;
  const findings = attachCarveOuts("CONTRIBUTING.md", document, classifyPolicy("CONTRIBUTING.md", document));
  const rules = { checkedAt: "2026-10-20T10:00:00.000Z", findings, filesRead: ["CONTRIBUTING.md"] };
  return {
    bans: findings.filter((finding) => finding.kind === "ban").map((finding) => [finding.contribution, banReach(finding.quote)]),
    case: byHandRulesCase(rules, { learningIssue: false, now: "2026-10-20T09:00:00.000Z" }),
    agent: respectChecks({ body: "Retries a GET twice.", rules }, "en").map((check) => check.id),
  };
}

test("AI itself refused outright in this project or its contributions is a ban of AI help", () => {
  for (const text of [
    "AI is banned from this project.",
    "Generative AI is strictly forbidden in contributions.",
    "LLMs are not allowed in pull requests.",
    "AI use is prohibited in this project.",
    "*AI* is **banned**\nfrom this project.",
  ]) {
    const result = read(text);
    assert.deepEqual(result.bans, [[true, "assistance"]], text);
    assert.ok(result.agent.includes("ai-ban"), text);
    assert.deepEqual(result.case.case === "blocked" && result.case.reason, "reach", text);
  }
  // Without a contribution named, a rule to weigh (and it still stops the quoted confirm, see by-hand-rules).
  assert.deepEqual(read("AI is not welcome here.").bans, [[false, "assistance"]]);
});

test("the software's AI, game AI, AI features or a rule about other things is no ban", () => {
  for (const text of [
    "The enemy AI is not allowed to cheat.",
    "AI is not allowed to merge pull requests by itself.",
    "AI features are not accepted in core; use a plugin.",
    "Our AI is not allowed in ranked games.",
    "AI is not allowed in ranked games.",
    "Unlike other projects, where AI is banned from contributions, we ask only for a note.",
  ]) {
    const result = read(text);
    assert.deepEqual(result.bans, [], text);
    assert.ok(!result.agent.includes("ai-ban"), text);
  }
});
