// A rule that refuses AI help itself stops the quoted confirm wherever it
// stands (plan README §18.10), so the 30 rules a document (classifyPolicy)
// and a project (policyFindings) keep must never drop it in favour of
// rules that block nothing: in a long CONTRIBUTING file it was the last
// rule kept out, and a fitted Learn-by-hand run got the confirm. QEMU's
// ban and carve-out are verbatim (plan research/policies.md §3.3); the
// rest is written for this test.
import test from "node:test";
import assert from "node:assert/strict";
import { byHandRulesCase } from "../shared/by-hand-rules.js";
import { classifyPolicy } from "../shared/project-policy.js";
import { policyFindings } from "./contribution-policy.js";

const qemu = [
  "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.",
  "",
  "This policy does not apply to other uses of AI, such as researching APIs or algorithms, static analysis, or debugging, provided their output is not included in contributions.",
].join("\n");
const issuesFirst = Array.from(
  { length: 31 },
  (_, index) => `- Open an issue first before you start on area ${index + 1}.`,
).join("\n");
const refusal = "AI assistance of any kind is not accepted.";
const caseOf = (findings: ReturnType<typeof policyFindings>) =>
  byHandRulesCase({ checkedAt: "2026-10-20T10:00:00.000Z", findings, filesRead: [] }, {
    learningIssue: false,
    now: "2026-10-20T09:00:00.000Z",
  });

test("a document over 30 rules keeps a rule that refuses AI help itself", () => {
  const text = `${qemu}\n\n${issuesFirst}\n\n${refusal}\n`;
  const findings = classifyPolicy("CONTRIBUTING.md", text);
  assert.equal(findings.length, 30);
  assert.ok(findings.some((finding) => finding.quote === refusal));
});

test("a project over 30 rules keeps it, so the quoted confirm stays blocked by reach", () => {
  const findings = policyFindings([
    { path: "docs/devel/code-provenance.rst", kind: "contributing", content: qemu },
    { path: "CONTRIBUTING.md", kind: "contributing", content: issuesFirst },
    { path: "docs/ai.md", kind: "documentation", content: refusal },
  ]);
  assert.equal(findings.length, 30);
  const result = caseOf(findings);
  assert.deepEqual(result.case === "blocked" && [result.reason, result.finding.quote], ["reach", refusal]);
  // A rule to weigh about something else makes room as before.
  const weighed = policyFindings([
    { path: "docs/devel/code-provenance.rst", kind: "contributing", content: qemu },
    { path: "CONTRIBUTING.md", kind: "contributing", content: issuesFirst },
    { path: "docs/ai.md", kind: "documentation", content: "Do not use AI-generated text in human-to-human communication." },
  ]);
  assert.equal(caseOf(weighed).case, "fitted");
});
