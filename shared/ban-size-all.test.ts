// A refusal of large AI-generated changes is a size rule the person weighs
// (plan README §18.10 (b), Kubernetes), but one that goes on to every size
// ("…, even small ones", "of any size") leaves nothing to weigh: the ban
// f4853e8 gave stays (a lost block found by the W2G red team). The
// sentences are written for these tests.
import assert from "node:assert/strict";
import test from "node:test";
import { classifyPolicy } from "./project-policy.js";

const kinds = (text: string) =>
  classifyPolicy("CONTRIBUTING.md", text).map((finding) => [finding.kind, finding.contribution]);

test("a size rule that goes on to every size is a ban", () => {
  for (const text of [
    "Large AI-generated changes are not allowed, even small ones.",
    "We do not accept large AI-generated pull requests, or even small ones.",
    "Large or small, AI-generated changes of any size are not accepted.",
    "Do not use AI to generate substantial pieces of code, or even small ones, for this project.",
  ])
    assert.deepEqual(kinds(text), [["ban", true]], text);
});

test("a size rule alone stays a rule to weigh", () => {
  for (const text of [
    "Large AI-generated changes are not allowed.",
    "[Large AI generated](#large-or-automatic-edits) PRs and AI generated commit messages are not allowed.",
    "Do not use AI to generate substantial pieces of code.",
  ])
    assert.deepEqual(kinds(text), [["ban", false]], text);
});
