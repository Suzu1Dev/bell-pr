// A carve-out the project hasn't adopted yet ("## Acceptable uses
// (proposal, not yet adopted)", "Proposed: …", "We are considering a rule
// that …") is no permission: next to an output ban it gave a fitted
// Learn-by-hand run the quoted confirm (a false lift found by the W2G red
// team). The sentences are written for these tests.
import assert from "node:assert/strict";
import test from "node:test";
import { attachCarveOuts, classifyPolicy } from "./project-policy.js";

const allowsOf = (rest: string) => {
  const text = `AI-generated contributions are declined.\n\n${rest}\n`;
  const findings = attachCarveOuts("CONTRIBUTING.md", text, classifyPolicy("CONTRIBUTING.md", text));
  return (findings[0].allows ?? []).map((allowance) => allowance.kinds.join("+"));
};

test("a carve-out not adopted yet is none", () => {
  for (const rest of [
    "## Acceptable uses (proposal, not yet adopted)\n\n- Asking questions about the codebase",
    "Proposed: it is fine to use AI to understand the code.",
    "We are considering a rule that using AI to debug is fine.",
    "## Acceptable uses (draft)\n\n- Asking questions about the codebase",
    "Pending a vote, using AI to understand the code is fine.",
  ])
    assert.deepEqual(allowsOf(rest), [], rest);
});

test("an adopted carve-out still counts", () => {
  assert.deepEqual(allowsOf("## Acceptable uses\n\n- Asking questions about the codebase"), ["explain+answer"]);
  assert.deepEqual(allowsOf("It is fine to use AI to understand the code."), ["explain+answer"]);
});
