// "We have a strict no-AI policy for contributions.": a project's no-AI
// policy is a ban of AI help (a close variant of plan README §18.10's "AI
// is banned from this project."); a fitted Learn-by-hand run never gets the
// quoted confirm while it stands. The sentences are written for these
// tests.
import assert from "node:assert/strict";
import test from "node:test";
import { byHandRulesCase } from "./by-hand-rules.js";
import { banReach } from "./policy-reach.js";
import { attachCarveOuts, classifyPolicy } from "./project-policy.js";

const qemu =
  "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.\n\nThis policy does not apply to other uses of AI, such as researching APIs or algorithms, static analysis, or debugging, provided their output is not included in contributions.";

function read(text: string) {
  const document = `${qemu}\n\n${text}\n`;
  const findings = attachCarveOuts("CONTRIBUTING.md", document, classifyPolicy("CONTRIBUTING.md", document));
  return {
    bans: findings.slice(1).filter((finding) => finding.kind === "ban").map((finding) => [finding.contribution, banReach(finding.quote)]),
    case: byHandRulesCase(
      { checkedAt: "2026-10-20T10:00:00.000Z", findings, filesRead: ["CONTRIBUTING.md"] },
      { learningIssue: false, now: "2026-10-20T09:00:00.000Z" },
    ).case,
  };
}

test("a project's no-AI policy is a ban of AI help", () => {
  assert.deepEqual(read("We have a strict no-AI policy for contributions."), { bans: [[true, "assistance"]], case: "blocked" });
  assert.deepEqual(read("This project follows a no-LLM policy."), { bans: [[false, "assistance"]], case: "blocked" });
});

test("no AI policy yet, or another project's, is no ban", () => {
  for (const text of ["There is no AI policy yet; we will write one.", "Other projects have a strict no-AI policy; we do not."])
    assert.deepEqual(read(text), { bans: [], case: "fitted" }, text);
});
