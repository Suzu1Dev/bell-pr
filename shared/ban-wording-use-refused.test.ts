// Close variants of plan README §18.10's "Please do not use AI at all when
// contributing.": "Using AI is not permitted.", "The use of AI is
// forbidden.", "Please refrain from using AI tools when writing
// patches.", "We don't accept code written with the help of AI." Each is a
// ban of AI help; a fitted Learn-by-hand run never gets the quoted confirm
// for it. The sentences are written for these tests.
import assert from "node:assert/strict";
import test from "node:test";
import { byHandRulesCase } from "./by-hand-rules.js";
import { respectChecks } from "./contribution.js";
import { banReach } from "./policy-reach.js";
import { attachCarveOuts, classifyPolicy } from "./project-policy.js";

const qemu =
  "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.\n\nThis policy does not apply to other uses of AI, such as researching APIs or algorithms, static analysis, or debugging, provided their output is not included in contributions.";

function read(text: string) {
  const document = `${qemu}\n\n${text}\n`;
  const findings = attachCarveOuts("CONTRIBUTING.md", document, classifyPolicy("CONTRIBUTING.md", document));
  const rules = { checkedAt: "2026-10-20T10:00:00.000Z", findings, filesRead: ["CONTRIBUTING.md"] };
  return {
    bans: findings.slice(1).filter((finding) => finding.kind === "ban").map((finding) => [finding.contribution, banReach(finding.quote)]),
    case: byHandRulesCase(rules, { learningIssue: false, now: "2026-10-20T09:00:00.000Z" }),
    agent: respectChecks({ body: "Retries a GET twice.", rules }, "en").map((check) => check.id),
  };
}

test("a refusal of using AI, said other ways, is a ban of AI help that keeps QEMU's case blocked", () => {
  for (const [text, contribution] of [
    ["Using AI is not permitted.", false],
    ["The use of AI is forbidden for contributions.", true],
    ["Please refrain from using AI tools when writing patches.", true],
    ["We don't accept code written with the help of AI.", true],
  ] as const) {
    const result = read(text);
    assert.deepEqual(result.bans, [[contribution, "assistance"]], text);
    assert.deepEqual(result.case.case === "blocked" && result.case.reason, "reach", text);
  }
});

test("a refusal of something else next to AI, or welcome help of AI, is no ban", () => {
  for (const text of [
    "Please refrain from pinging maintainers; AI tools can help you find answers.",
    "We welcome code written with the help of AI, as long as you understand it.",
    "If use of AI is suspected, we will ask you about it.",
    "Using AI for ranking results is not supported in this project.",
  ]) {
    const result = read(text);
    assert.deepEqual(result.bans, [], text);
    assert.equal(result.case.case, "fitted", text);
  }
});
