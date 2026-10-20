// Wordings the reach read too loosely, each a false lift of the quoted
// confirm when the same document has a carve-out: "generative AI" read
// as output ("generat…"), as did AI that "created" or "wrote" the
// contribution "with" a tool (unclear, as "made with" already is), "AI
// help" and "the aid of AI" (help itself), and reserved issues to be
// solved "without AI", with "No AI help" or "by hand" (a use of AI at
// all). The sentences are written for these tests.
import assert from "node:assert/strict";
import test from "node:test";
import { byHandRulesCase } from "./by-hand-rules.js";
import { areaReach, banReach } from "./policy-reach.js";
import { attachCarveOuts, classifyPolicy } from "./project-policy.js";

test("generative AI, and contributions created or written with AI, are no output-only ban", () => {
  for (const quote of [
    "We do not accept generative AI contributions.",
    "Contributions created with AI tools are declined.",
    "Code written with ChatGPT or Copilot is not accepted.",
    "Patches produced with an LLM are declined.",
  ])
    assert.equal(banReach(quote), "unknown", quote);
  for (const quote of [
    "No AI help or AI-generated code is accepted in pull requests.",
    "Contributions produced by or with the aid of AI tools are declined.",
    "AI-aided patches are declined.",
  ])
    assert.equal(banReach(quote), "assistance", quote);
  // What AI generated, wrote or created stays output.
  for (const quote of [
    "AI-generated code is not accepted.",
    "Code written by ChatGPT is not accepted.",
    "Patches generated with an LLM are declined.",
    "Contributions must not include content created by generative AI tools.",
  ])
    assert.equal(banReach(quote), "output", quote);
});

test("a reserved issue to be solved without AI, with no AI help or by hand is a use of AI at all", () => {
  for (const quote of [
    "Good first issues must be solved without AI; AI-generated pull requests for them will be closed.",
    "No AI help on good first issues: pull requests for them that are AI generated will be closed.",
    "Good first issues are for people learning to code by hand, so pull requests for them that are AI generated will be closed.",
    "No AI on good first issues; AI-generated pull requests will be closed.",
  ])
    assert.equal(areaReach(quote), "use", quote);
  assert.equal(areaReach("No AI-generated pull requests for good first issues, please."), "output");
  assert.equal(areaReach("pull requests that are AI generated will be closed."), "output");
});

test("such a ban or reserved issue next to a carve-out is never fitted", () => {
  const carveOut = "\n\n**Acceptable uses**\n\n- Gaining understanding of the existing code\n";
  for (const [text, learningIssue] of [
    ["We do not accept generative AI contributions.", false],
    ["Contributions created with AI tools are declined.", false],
    ["No AI help or AI-generated code is accepted in pull requests.", false],
    ["Good first issues must be solved without AI; AI-generated pull requests for them will be closed.", true],
  ] as const) {
    const document = text + carveOut;
    const findings = attachCarveOuts("CONTRIBUTING.md", document, classifyPolicy("CONTRIBUTING.md", document));
    assert.ok(findings[0].allows?.length, text);
    const result = byHandRulesCase(
      { checkedAt: "2026-10-20T10:00:00.000Z", findings, filesRead: ["CONTRIBUTING.md"] },
      { learningIssue, now: "2026-10-20T09:00:00.000Z" },
    );
    assert.deepEqual(result.case === "blocked" && result.reason, "reach", text);
  }
});
