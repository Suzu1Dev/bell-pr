// A sentence that reports what other projects refuse ("Unlike Zig, …",
// "Some projects say …") states no rule of this project: the classifier's
// own refusal wordings ("No LLMs for patches" and the wordings of plan
// README §18.10) never read it as a ban. The sentences are written for
// these tests.
import assert from "node:assert/strict";
import test from "node:test";
import { classifyPolicy } from "./project-policy.js";

const kinds = (text: string) =>
  classifyPolicy("CONTRIBUTING.md", text).map((finding) => [finding.kind, finding.contribution]);

test("another project's refusal, reported, is no ban of this project", () => {
  for (const text of [
    'Unlike Zig, whose README says "No LLMs for patches", we welcome pull requests from everyone.',
    "Some projects say No LLMs for patches; we only ask you to disclose AI help.",
    "Other projects have a No AI for contributions rule, and we understand why.",
    "Projects such as Zig ask for No LLMs for pull requests.",
  ])
    assert.deepEqual(kinds(text), [], text);
});

test("the project's own refusal stays a ban, whatever else the document reports", () => {
  for (const text of ["No LLMs for patches / pull requests.", "No AI for contributions, please."])
    assert.deepEqual(kinds(text), [["ban", true]], text);
  assert.deepEqual(
    kinds("Some projects allow AI help.\n\nNo LLMs for patches / pull requests."),
    [["ban", true]],
  );
});
