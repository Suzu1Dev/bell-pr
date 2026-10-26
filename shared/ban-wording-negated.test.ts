// "AI-assisted contributions are not forbidden, but they must be
// disclosed.": a refusal word that is negated refuses nothing, so the
// sentence is no ban and an agent run gets no ai-ban block for it. The
// same words without the negation stay bans. The sentences are written for
// these tests.
import assert from "node:assert/strict";
import test from "node:test";
import { respectChecks } from "./contribution.js";
import { attachCarveOuts, classifyPolicy } from "./project-policy.js";

function read(text: string) {
  const document = `# Contributing\n\n${text}\n`;
  const findings = attachCarveOuts("CONTRIBUTING.md", document, classifyPolicy("CONTRIBUTING.md", document));
  const rules = { checkedAt: "2026-10-20T10:00:00.000Z", findings, filesRead: ["CONTRIBUTING.md"] };
  return {
    bans: findings.filter((finding) => finding.kind === "ban").map((finding) => finding.contribution),
    allows: findings.filter((finding) => finding.kind === "ban").map((finding) => finding.allows?.length ?? 0),
    agent: respectChecks({ body: "Prepared with Codex, which wrote the patch.", rules }, "en").map((check) => check.id),
  };
}

test("a negated refusal word is no ban", () => {
  for (const text of [
    "AI-assisted contributions are not forbidden, but they must be disclosed.",
    "AI-generated code is not prohibited, but you must understand it.",
    "We don't forbid AI-assisted pull requests.",
    "We will not reject a pull request only because it was AI-assisted.",
    "We never reject AI-assisted pull requests for that reason alone.",
    "PRs that use AI tools will not be declined.",
    "Using AI tools is not prohibited.",
    "AI-assisted pull requests are not strictly forbidden.",
    "AI-assisted patches won't be explicitly declined.",
    "AI-assisted contributions are neither encouraged nor forbidden.",
    "We neither encourage nor forbid the use of AI tools in contributions.",
    "AI-assisted contributions are neither forbidden nor required.",
    "We will neither reject nor favor AI-assisted pull requests.",
  ]) {
    const result = read(text);
    assert.deepEqual(result.bans, [], text);
    assert.ok(!result.agent.includes("ai-ban"), text);
  }
});

test("a refusal word without a negation stays a ban", () => {
  for (const text of [
    "AI-generated code is prohibited.",
    "AI-generated pull requests will be rejected.",
    "We reject all AI-generated contributions.",
    "We do not accept AI-generated pull requests.",
    "AI-generated code is not merely discouraged but forbidden.",
    "Use of AI tools in contributions is not only forbidden but grounds for a ban.",
    "AI-generated code is not only prohibited, it is reported.",
    "AI-generated code is not merely prohibited; it will be reported.",
    "AI-generated code is not only prohibited but also grounds for a permanent ban from the project.",
    "We will not only reject AI-generated pull requests but also block the contributor.",
  ]) {
    const result = read(text);
    assert.deepEqual(result.bans, [true], text);
    assert.ok(result.agent.includes("ai-ban"), text);
  }
});

test("a negated refusal beside a ban is its carve-out, not a second ban", () => {
  const result = read("AI-generated code is not accepted.\n\nUsing AI tools to understand the code is not prohibited.");
  assert.deepEqual(result.bans, [true]);
  assert.deepEqual(result.allows, [1]);
});
