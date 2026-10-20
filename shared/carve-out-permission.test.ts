// Permission words that grant nothing, each a false lift of the quoted
// confirm next to an output ban (W2G red team): "out of scope for this
// guide" (not covered here), "If using AI to debug is fine with your
// reviewer, …" (a condition), "…, says the Rust project" (somebody else),
// "…, unless you are a new contributor" (an exception), and "… is fine as
// a learning exercise, but changes made that way are not accepted" (taken
// back). The sentences are written for these tests, except nixpkgs' real
// one (NixOS/nixpkgs CONTRIBUTING.md:945-946, plan research/policies.md §4).
import assert from "node:assert/strict";
import test from "node:test";
import { attachCarveOuts, classifyPolicy } from "./project-policy.js";

const ban = "AI-generated contributions are declined.";
const allowsOf = (rest: string) => {
  const text = `${ban}\n\n${rest}\n`;
  const findings = attachCarveOuts("CONTRIBUTING.md", text, classifyPolicy("CONTRIBUTING.md", text));
  assert.equal(findings[0]?.kind, "ban");
  return (findings[0].allows ?? []).map((allowance) => allowance.kinds.join("+"));
};

test("a permission word that grants nothing here is no carve-out", () => {
  for (const rest of [
    "Debugging help from AI is out of scope for this guide; see the AI policy.",
    "If using AI to debug is fine with your reviewer, say so in the PR.",
    "When it's fine to use AI to understand the code, the maintainers will tell you.",
    "Using AI to debug is fine, says the Rust project.",
    "According to the Rust project, using AI to debug is fine.",
    "As LLVM puts it, using AI to understand code is fine.",
    "It's fine to use AI to understand the code, unless you are a new contributor.",
    "Using AI to understand the code is fine as a learning exercise, but changes made that way are not accepted.",
    "Using AI to debug is not prohibited by law, but we decline such patches.",
  ])
    assert.deepEqual(allowsOf(rest), [], rest);
});

test("the project's own permissions still count", () => {
  for (const [rest, kinds] of [
    [
      "Use of AI tools for research, testing, debugging, or private review is out of scope, if no substantial amount of their output is included in the resulting contribution.",
      ["explain+answer+review+test"],
    ],
    ["Using AI to understand the code is out of scope of this policy.", ["explain+answer"]],
    ["Our policy says it's fine to use AI to understand the code.", ["explain+answer"]],
    ["According to our policy, using AI to understand the code is fine.", ["explain+answer"]],
    ["Using AI to understand the code is fine, but please don't paste its answers into the PR.", ["explain+answer"]],
    ["Using AI to understand the code is fine if you disclose it.", ["explain+answer"]],
  ] as const)
    assert.deepEqual(allowsOf(rest), kinds, rest);
});
