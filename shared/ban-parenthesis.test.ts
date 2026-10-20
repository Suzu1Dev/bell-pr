// A rule to weigh named in parentheses beside a refused AI-made change
// ("AI-generated code (including large AI-generated PRs) is not
// accepted.") swallowed the ban: a parenthesis didn't end the refused
// part, so the whole sentence read as a size or credit rule, losing the
// agent-run block f4853e8 gave (found by the W2G red team). The sentences
// are written for these tests.
import assert from "node:assert/strict";
import test from "node:test";
import { classifyPolicy } from "./project-policy.js";

const kinds = (text: string) =>
  classifyPolicy("CONTRIBUTING.md", text).map((finding) => [finding.kind, finding.contribution]);

test("a refused change beside a rule to weigh in parentheses is still a ban", () => {
  for (const text of [
    "AI-generated code (including large AI-generated PRs) is not accepted.",
    "AI-assisted changes (including AI co-authors) is not accepted.",
    "AI-assisted changes (including Assisted-by trailers) are not accepted.",
  ])
    assert.deepEqual(kinds(text), [["ban", true]], text);
});

test("a rule to weigh alone, in or around parentheses, stays one", () => {
  for (const text of [
    "[Large AI generated](#large-or-automatic-edits) PRs and AI generated commit messages are not allowed.",
    "Large AI-generated PRs (and AI-generated commit messages) are not allowed.",
    "Listing AI tooling as a co-author (or co-signing commits using an AI tool) is not allowed.",
  ])
    assert.deepEqual(kinds(text), [["ban", false]], text);
});
