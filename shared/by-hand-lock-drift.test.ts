// The lock holds the quotes a run was fitted to, verbatim; the rules read
// again at publish are compared quote for quote (DESIGN v1.2 F12 (e)).
// Pinned here: a re-read that only rewraps lines, changes line endings or
// adds characters a reader doesn't see keeps the confirm (the same text);
// one that changes a character a reader does see, apostrophes and
// spaces included, is "rules-changed" and blocks, and a sentence added
// beside the carve-out that refuses AI help itself blocks by reach. QEMU's
// sentences are verbatim (plan research/policies.md §3.3).
import assert from "node:assert/strict";
import test from "node:test";
import type { HelpLock } from "./by-hand.js";
import { byHandRulesCase, byHandRulesDecision } from "./by-hand-rules.js";
import type { ContributionRules } from "./contribution.js";
import { attachCarveOuts, classifyPolicy } from "./project-policy.js";

const path = "docs/devel/code-provenance.rst";
const document = [
  "Use of AI-generated content",
  "~~~~~~~~~~~~~~~~~~~~~~~~~~~",
  "",
  "  **Current QEMU project policy is to DECLINE any contributions which are",
  "  believed to include or derive from AI generated content. This includes",
  "  ChatGPT, Claude, Copilot, Llama and similar tools.**",
  "",
  "  **This policy does not apply to other uses of AI, such as researching APIs",
  "  or algorithms, static analysis, or debugging, provided their output is not",
  "  included in contributions.**",
].join("\n");
const createdAt = "2026-10-20T09:00:00.000Z";
const rulesOf = (text: string): ContributionRules => ({
  checkedAt: "2026-10-20T10:00:00.000Z",
  findings: attachCarveOuts(path, text, classifyPolicy(path, text)),
  filesRead: [path],
});

function lock(): HelpLock {
  const fitted = byHandRulesCase(rulesOf(document), { learningIssue: false, now: createdAt });
  assert.equal(fitted.case, "fitted");
  return { ...(fitted as Extract<typeof fitted, { case: "fitted" }>).lock, at: createdAt };
}
function decide(text: string) {
  const rules = rulesOf(text);
  const decision = byHandRulesDecision(
    { bans: rules.findings.filter((finding) => finding.kind === "ban" && finding.contribution), areas: [], rules },
    { helps: ["explain", "answer"], helpLock: lock(), createdAt, now: "2026-10-20T12:00:00.000Z" },
  );
  return decision.blocked[0]?.reason ?? (decision.confirmable.length ? "confirm" : "none");
}

test("the same text, rewrapped, with other line endings or invisible characters, keeps the confirm", () => {
  assert.equal(decide(document), "confirm");
  assert.equal(decide(document.replace(/\n/g, "\r\n")), "confirm");
  assert.equal(decide(document.replace("researching APIs\n  or algorithms", "researching\n  APIs or algorithms")), "confirm");
  assert.equal(decide(document.replace("researching", "re­search​ing")), "confirm");
});

test("a character a reader sees changed, or a refusal added, blocks", () => {
  assert.equal(decide(document.replace("does not apply", "doesn’t apply")), "rules-changed");
  assert.equal(decide(document.replace("other uses of AI", "other uses of AI")), "rules-changed");
  assert.equal(decide(document.replace("researching APIs", "researching  APIs")), "rules-changed");
  assert.equal(decide(document.replace("DECLINE", "decline")), "rules-changed");
  assert.equal(decide(`${document}\n\n  AI assistance of any kind is not accepted.\n`), "reach");
});
