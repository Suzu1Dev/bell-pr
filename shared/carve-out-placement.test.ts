// Carve-outs a reader doesn't see as the project's own permission, each a
// false lift of the quoted confirm next to an output ban (W2G red team):
// one in an HTML or reStructuredText comment (a draft nobody reads), in an
// indented code block (an example), in a quote of another project's
// policy, taken back by the next sentence after "Actually,", or an item
// marked ❌ or listed under a "Not acceptable:" lead-in inside a list of
// acceptable uses. The sentences are written for these tests.
import assert from "node:assert/strict";
import test from "node:test";
import { attachCarveOuts, classifyPolicy } from "./project-policy.js";

const ban = "AI-generated contributions are declined.";
const allowsOf = (path: string, rest: string) => {
  const text = `${ban}\n\n${rest}\n`;
  const findings = attachCarveOuts(path, text, classifyPolicy(path, text));
  assert.equal(findings[0]?.kind, "ban");
  return (findings[0].allows ?? []).map((allowance) => [allowance.kinds.join("+"), allowance.quote]);
};

test("a carve-out inside a comment, an example or another project's quote is not the project's", () => {
  for (const [path, rest] of [
    ["CONTRIBUTING.md", "<!-- Draft, not agreed yet: It's fine to use AI to understand the code. -->"],
    ["CONTRIBUTING.md", "<!--\nIt's fine to use AI to understand the code.\n-->"],
    ["docs/policy.rst", ".. It's fine to use AI to understand the code.\n   (not agreed yet)"],
    ["CONTRIBUTING.md", "An example policy you could copy for your own project:\n\n    It is fine to use AI tools to understand the codebase."],
    ["CONTRIBUTING.md", "Here is what LLVM's policy says, for comparison:\n\n> It is fine to use AI tools to understand the codebase."],
    ["CONTRIBUTING.md", "> It is fine to use AI tools to understand the codebase.\n> — from another project's guide"],
    ["CONTRIBUTING.md", "It is fine to use AI to understand the code. Actually, no: that is not fine anymore."],
  ])
    assert.deepEqual(allowsOf(path, rest), [], rest);
});

test("an item marked as not acceptable never counts, even in a list of acceptable uses", () => {
  assert.deepEqual(
    allowsOf(
      "CONTRIBUTING.md",
      "### Acceptable uses\n\n- ✅ Asking an LLM questions about an existing codebase\n- ❌ Asking an LLM to debug your patch",
    ),
    [["explain+answer", "✅ Asking an LLM questions about an existing codebase"]],
  );
  assert.deepEqual(
    allowsOf(
      "CONTRIBUTING.md",
      "### Acceptable uses\n\n- Asking an LLM questions about an existing codebase\n- Not acceptable uses:\n  - Asking an LLM to debug your patch",
    ),
    [["explain+answer", "Asking an LLM questions about an existing codebase"]],
  );
});

test("the project's own carve-outs still count: in a note, a list, or followed by more rules", () => {
  assert.deepEqual(allowsOf("CONTRIBUTING.md", "> **Note**: It is fine to use AI tools to understand the codebase."), [
    ["explain+answer", "Note**: It is fine to use AI tools to understand the codebase."],
  ]);
  assert.deepEqual(
    allowsOf("CONTRIBUTING.md", "Using AI to understand the code is fine. No AI-generated code, though."),
    [["explain+answer", "Using AI to understand the code is fine."]],
  );
  assert.deepEqual(
    allowsOf("CONTRIBUTING.md", "Examples of acceptable AI use:\n\n- Asking questions about the codebase"),
    [["explain+answer", "Asking questions about the codebase"]],
  );
  // A list item's continuation, indented under it, is prose.
  assert.deepEqual(
    allowsOf("CONTRIBUTING.md", "- Some notes on AI.\n\n    It is fine to use AI tools to understand the codebase."),
    [["explain+answer", "It is fine to use AI tools to understand the codebase."]],
  );
});
