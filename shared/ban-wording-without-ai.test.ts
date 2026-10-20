// "Contributions must be written without any help from AI tools.": a
// contribution that must be made without AI is a ban of AI help (plan
// README §18.10, W2G verifier follow-up 1). It blocks agent runs, and a
// fitted Learn-by-hand run never gets the quoted confirm for it, even with
// a carve-out beside it. The sentences are written for these tests.
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

test("a contribution that must be made without AI is a ban of AI help", () => {
  for (const text of [
    "Contributions must be written without any help from AI tools.",
    "Patches must be made without AI.",
    "Code has to be written without using an LLM.",
    "All pull requests must be created entirely without AI assistance.",
    "Contributions **must** be written without\nthe help of AI.",
  ]) {
    const result = read(text);
    assert.deepEqual(result.bans, [[true, "assistance"]], text);
    assert.ok(result.agent.includes("ai-ban"), text);
    assert.deepEqual(result.case.case === "blocked" && result.case.reason, "reach", text);
  }
});

test("work explained, reviewed or tested without something, or other projects' rules, is no ban", () => {
  for (const text of [
    "Changes must be explained without AI jargon.",
    "Code must be reviewed without relying on AI tools.",
    "Tests must be written without network access.",
    "Docs can be written without AI help, or with it.",
    "Some projects require patches to be made without AI; we don't.",
  ]) {
    const result = read(text);
    assert.deepEqual(result.bans, [], text);
    assert.ok(!result.agent.includes("ai-ban"), text);
  }
});
