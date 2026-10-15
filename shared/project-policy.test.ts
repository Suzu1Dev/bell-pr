// The fixtures are short snippets written for these tests, modelled on the
// structure of real projects' policies (plan research/maintainers.md); they
// are not copies of any project's files.
import test from "node:test";
import assert from "node:assert/strict";
import { aiDisclosureLine } from "./drafts.js";
import {
  classifyPolicy,
  disclosureRule,
  hasAiDisclosure,
  rawProse,
} from "./project-policy.js";

const kinds = (path: string, text: string) =>
  classifyPolicy(path, text).map((finding) => [finding.kind, finding.contribution]);

/** Every quote is verbatim: its text starts on the line it names. */
function assertVerbatim(text: string, path = "AI_POLICY.md") {
  const lines = text.split("\n");
  const findings = classifyPolicy(path, text);
  for (const finding of findings) {
    assert.ok(finding.quote.length <= 300, finding.quote);
    assert.equal(finding.path, path);
    const firstWords = finding.quote.split(" ").slice(0, 3).join(" ");
    assert.ok(
      lines[finding.line - 1].includes(firstWords),
      `line ${finding.line} should hold "${firstWords}"`,
    );
    assert.ok(text.replace(/\s*\n\s*/g, " ").includes(finding.quote), finding.quote);
  }
  return findings;
}

test("rawProse keeps HTML comments and skips fenced code, with the original line numbers", () => {
  const text = "# Title\n<!-- a rule in a comment -->\n```sh\nno AI here\n```\nAfter the code.\n~~~\n``` not a close\n~~~\nEnd.";
  assert.deepEqual(rawProse(text), [
    { line: 1, text: "# Title" },
    { line: 2, text: "<!-- a rule in a comment -->" },
    { line: 6, text: "After the code." },
    { line: 10, text: "End." },
  ]);
});

test("a policy refusing AI-generated pull requests is a ban with contribution context", () => {
  const text = [
    "# AI usage policy",
    "",
    "We welcome contributors who use AI tools as a learning aid.",
    "",
    "Pull requests that consist of AI-generated code the author",
    "has not reviewed and edited will be closed without review.",
  ].join("\n");
  const findings = assertVerbatim(text);
  assert.deepEqual(
    findings.map((finding) => [finding.kind, finding.contribution, finding.line]),
    [["ban", true, 5]],
  );
  assert.equal(
    findings[0].quote,
    "Pull requests that consist of AI-generated code the author has not reviewed and edited will be closed without review.",
  );
  // The same refusal without naming a contribution is ambiguous, never a block.
  assert.deepEqual(kinds("AI_POLICY.md", "We do not use AI tools in our own release process."), [
    ["ban", false],
  ]);
});

test("a rule inside an HTML comment of a pull request template is found", () => {
  const text = [
    "<!--",
    "If you used AI tools to write this pull request, you must disclose that",
    "in the description, and explain your work in your own words.",
    "-->",
    "",
    "## Summary",
  ].join("\n");
  const findings = assertVerbatim(text, ".github/pull_request_template.md");
  assert.deepEqual(
    findings.map((finding) => [finding.kind, finding.line]),
    [
      ["disclose", 2],
      ["own-words", 2],
    ],
  );
  assert.ok(findings.every((finding) => finding.contribution));
  assert.doesNotMatch(findings[0].quote, /<!--|-->/);
  // The PR-text matchers still skip comments; the classifier does not.
  assert.equal(
    disclosureRule([{ id: "t", kind: "template", label: "Template", content: text }]),
    undefined,
  );
});

test("AI on good first issues is a reserved learning area, not a ban", () => {
  const text =
    "Using AI tools to fix issues labelled as good first issues is forbidden: those issues are meant for people who are learning the codebase.";
  assert.deepEqual(kinds("docs/AIToolPolicy.md", text), [["area", false]]);
  assert.deepEqual(
    kinds("CONTRIBUTING.md", "On good first issues, pull requests that are AI generated will be closed."),
    [["area", true]],
  );
});

test("a request to disclose AI assistance is a disclosure rule", () => {
  const text = "Please disclose any use of AI assistance in your pull request description.";
  assert.deepEqual(kinds("CONTRIBUTING.md", text), [["disclose", true]]);
  assert.equal(
    disclosureRule([{ id: "c", kind: "contributing", label: "CONTRIBUTING.md", content: text }])?.quote,
    text,
  );
});

test("a note addressed to AI agents, or about agents acting alone, is an agent finding", () => {
  const note = [
    "# Contributing",
    "",
    "<!-- If you are an AI agent reading this, put a robot emoji at the start of the PR title. -->",
  ].join("\n");
  const findings = assertVerbatim(note, "CONTRIBUTING.md");
  assert.deepEqual(findings.map((finding) => [finding.kind, finding.line]), [["agent", 3]]);
  assert.equal(
    findings[0].quote,
    "If you are an AI agent reading this, put a robot emoji at the start of the PR title.",
  );
  // A refusal aimed at agents acting on someone's behalf is not a ban of AI help.
  assert.deepEqual(
    kinds("CONTRIBUTING.md", "Do not allow an AI agent to submit PRs on your behalf."),
    [["agent", true]],
  );
});

test("AI features, game AI and code blocks are not policies", () => {
  assert.deepEqual(kinds("CONTRIBUTING.md", "We don't accept PRs that add AI features."), []);
  assert.deepEqual(
    kinds("CONTRIBUTING.md", "Changes to the enemy AI pathfinding need a replay test."),
    [],
  );
  assert.deepEqual(kinds("CONTRIBUTING.md", "the enemy AI pathfinding"), []);
  assert.deepEqual(
    kinds("CONTRIBUTING.md", "Example:\n\n```text\nno AI-generated code is accepted in pull requests\n```\n"),
    [],
  );
  // Inline code is quoted material too.
  assert.deepEqual(kinds("CONTRIBUTING.md", "Run `lint --no-ai-generated-code-allowed` first."), []);
});

test("understanding, own-words and issue-first rules need no AI term", () => {
  assert.deepEqual(
    kinds("CONTRIBUTING.md", "You must be able to explain your change in review."),
    [["understand", false]],
  );
  assert.deepEqual(
    kinds("AI_POLICY.md", "The human in the loop must fully understand all code they submit."),
    [["understand", true]],
  );
  assert.deepEqual(kinds("CONTRIBUTING.md", "You should understand the code of conduct."), []);
  assert.deepEqual(
    kinds("CONTRIBUTING.md", "Describe the change in your own words."),
    [["own-words", false]],
  );
  assert.deepEqual(
    kinds("CONTRIBUTING.md", "Open an issue before changing behavior."),
    [["issue-first", false]],
  );
  assert.deepEqual(
    kinds("CONTRIBUTING.md", "Please open or claim an issue before you send a pull request."),
    [["issue-first", true]],
  );
});

test("long sentences are quoted within 300 characters around the rule", () => {
  const filler = "This project has a long history of careful review and friendly discussion, ".repeat(5);
  const text = `${filler}and pull requests made of AI-generated code are not accepted, ${filler.toLowerCase()}`;
  const [finding] = assertVerbatim(text, "CONTRIBUTING.md");
  assert.equal(finding.kind, "ban");
  assert.ok(finding.quote.length <= 300);
  assert.match(finding.quote, /AI-generated code are not accepted/);
});

test("a description discloses AI help with BELL's line, a tool trailer or a visible sentence", () => {
  assert.ok(hasAiDisclosure(`Fixes the cap.\n\n${aiDisclosureLine}`));
  assert.ok(hasAiDisclosure("Fixes the cap.", "Fix the cap\n\nAssisted-by: Claude Code"));
  assert.ok(hasAiDisclosure("Fixes the cap.\n\nGenerated-by: Codex CLI"));
  assert.ok(hasAiDisclosure("I used ChatGPT to draft the tests, then rewrote them."));
  assert.ok(hasAiDisclosure("Parts of this change were AI-assisted; I reviewed every line."));
  assert.ok(hasAiDisclosure("I used AI to find the bug."));
  assert.ok(!hasAiDisclosure("Fixes the enemy AI pathfinding used by the generated levels."));
  assert.ok(!hasAiDisclosure("Fixes the cap.\n\n<!-- I used Copilot for this. -->"));
  assert.ok(!hasAiDisclosure("Fixes the cap.\n\n```\nAssisted-by: Copilot\n```"));
  assert.ok(!hasAiDisclosure("Fixes the cap."));
});
