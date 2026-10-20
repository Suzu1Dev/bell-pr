// A carve-out names a kind of help only when AI does that work (plan
// README §18.10, W2G verifier follow-up 4): "It's fine to use AI to write
// code that you then debug yourself." lets AI write, not debug, so it
// names no test help; "use AI to help you debug" does. Narrowing only:
// the F12 word table never gains a word. The sentences are written for
// these tests except the real carve-outs, quoted verbatim (plan
// research/policies.md §3.3, §3.4, §3.8 and rust-forge llm-usage.md).
import assert from "node:assert/strict";
import test from "node:test";
import { byHandRulesCase, carveOutKinds } from "./by-hand-rules.js";
import { attachCarveOuts, classifyPolicy } from "./project-policy.js";

test("help the person does themselves names no kind; help AI gives does", () => {
  for (const [text, kinds] of [
    ["use AI to write code that you then debug yourself", []],
    ["use AI to write code you can explain", []],
    ["research the APIs yourself", []],
    ["use AI to draft a patch, then review your own changes by hand", []],
    ["use AI to help you debug", ["test"]],
    ["use AI so you can understand the codebase better", ["explain", "answer"]],
    ["use AI to answer questions you have about the codebase", ["explain", "answer"]],
    // The real carve-outs keep every kind they name.
    ["other uses of AI, such as researching APIs or algorithms, static analysis, or debugging", ["explain", "answer", "test"]],
    ["Can I use an AI tool to help me understand Servo's codebase better?", ["explain", "answer"]],
    ["Asking an LLM to privately review your code or prose", ["review"]],
    ["Gaining understanding of the existing code", ["explain", "answer"]],
    ["Using an LLM to generate possible solutions to an issue, learning from them, and then writing something from scratch in your own style", ["plan"]],
  ] as const)
    assert.deepEqual(carveOutKinds(text), kinds, text);
});

test("a carve-out that lets AI write what the person debugs gives no test help to a fitted run", () => {
  const text = [
    "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.",
    "",
    "It's fine to use AI to understand the code.",
    "",
    "It's fine to use AI to write code that you then debug yourself.",
  ].join("\n");
  const findings = attachCarveOuts("CONTRIBUTING.md", text, classifyPolicy("CONTRIBUTING.md", text));
  const result = byHandRulesCase(
    { checkedAt: "2026-10-20T10:00:00.000Z", findings, filesRead: ["CONTRIBUTING.md"] },
    { learningIssue: false, now: "2026-10-20T09:00:00.000Z" },
  );
  assert.deepEqual(result.case === "fitted" && result.kinds, ["explain", "answer"]);
});
