// The policy classifier on verbatim excerpts of real projects' policies
// (server/fixtures/policy/real, sources in its SOURCES.md): what each one
// yields, quoted verbatim, and which of them block an agent-written change.
// No network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { PolicyFinding } from "../shared/contribution.js";
import { classifyPolicy, hasAiDisclosure } from "../shared/project-policy.js";
import { draftPreflight } from "../shared/draft-checks.js";

const fixtures = path.join(import.meta.dirname, "fixtures", "policy");

const brief = (finding: PolicyFinding) =>
  [finding.kind, finding.path, finding.line, finding.contribution] as const;

/** Every quote is verbatim: its words are on the line it names, and in the file. */
function assertVerbatim(text: string, findings: readonly PolicyFinding[]) {
  const lines = text.split("\n");
  const flat = text.replace(/\s*\n\s*/g, " ");
  for (const finding of findings) {
    assert.ok(finding.quote.length <= 300, finding.quote);
    const first = finding.quote.split(" ")[0];
    assert.ok(lines[finding.line - 1].includes(first), `${finding.path}:${finding.line} should hold "${first}"`);
    assert.ok(flat.includes(finding.quote), finding.quote);
  }
}

/** What each real excerpt should yield: its kinds, and for bans whether they block. */
const realExpectations: Record<string, readonly (readonly [string, boolean?])[]> = {
  // AI help is accepted; the reporting rules are about security reports.
  "curl-CONTRIBUTE.md": [],
  // The whole template is one HTML comment.
  "curl-pull_request_template.md": [["understand"], ["own-words"]],
  // Acceptable and unacceptable uses; "flag and reject low-value
  // contributions … AI generated" is conditional on the value.
  "matplotlib-contribute-generative-ai.rst": [["agent"], ["ban", false]],
  // Good first issues are reserved; the reST role still reads as text.
  "matplotlib-contribute-good-first-issues.rst": [["area"]],
  "matplotlib-PULL_REQUEST_TEMPLATE.md": [["own-words"], ["disclose"]],
  // LLVM lets contributors use AI with a human in the loop.
  "llvm-AIToolPolicy.md": [["understand"], ["disclose"], ["agent"], ["area"], ["area"]],
  // Ghostty: disclosure and understanding required; the "do not contribute"
  // rule depends on what the contributor can explain.
  "ghostty-AI_POLICY.md": [
    ["disclose"],
    ["ban", false],
    ["understand"],
    ["understand"],
    ["ban", false],
  ],
  // A real ban, under a reStructuredText "~~~" heading.
  "qemu-code-provenance.rst": [["ban", true]],
  "godot-CONTRIBUTING.md": [["agent"]],
  "godot-PULL_REQUEST_TEMPLATE.md": [["disclose"]],
  // "substantial pieces of code" and "if you do not have the knowledge" are
  // the person's call; the communication rule is not about the change.
  "godot-contribution-rules.md": [
    ["ban", false],
    ["agent"],
    ["ban", false],
    ["ban", false],
    ["ban", false],
  ],
  // Maintainer approval keeps a refusal a ban.
  "netbsd-commit-guidelines.txt": [["ban", true]],
  "gentoo-ai-policy.txt": [["ban", true]],
};

test("real projects' policies yield the expected kinds, quoted verbatim, and conditional rules never block", async () => {
  const files = (await readdir(path.join(fixtures, "real"))).filter((file) => file !== "SOURCES.md");
  assert.deepEqual(files.sort(), Object.keys(realExpectations).sort());
  for (const [file, expected] of Object.entries(realExpectations)) {
    const text = await readFile(path.join(fixtures, "real", file), "utf8");
    const findings = classifyPolicy(file, text);
    assert.deepEqual(
      findings.map((finding) =>
        finding.kind === "ban" ? [finding.kind, finding.contribution] : [finding.kind],
      ),
      expected,
      `${file}: ${JSON.stringify(findings.map((finding) => [finding.kind, finding.line, finding.quote.slice(0, 60)]))}`,
    );
    assertVerbatim(text, findings);
  }
});

test("only the projects that ban AI-generated contributions outright block an agent-written change", async () => {
  const blocked: string[] = [];
  for (const file of Object.keys(realExpectations)) {
    const text = await readFile(path.join(fixtures, "real", file), "utf8");
    const checks = draftPreflight({
      body: "Fixes the cap.\n\nAssisted-by: Codex CLI",
      rules: { checkedAt: "2026-10-15T00:00:00.000Z", findings: classifyPolicy(file, text), filesRead: [file] },
    });
    if (checks.some((check) => check.id === "ai-ban")) blocked.push(file);
  }
  assert.deepEqual(blocked.sort(), [
    "gentoo-ai-policy.txt",
    "netbsd-commit-guidelines.txt",
    "qemu-code-provenance.rst",
  ]);
});

test("a Godot-style refusal of AI for substantial code is quoted as a rule the person weighs", () => {
  const [finding] = classifyPolicy("CONTRIBUTING.md", "Do not use AI to generate substantial pieces of code.");
  assert.deepEqual([finding.kind, finding.contribution, finding.quote], [
    "ban",
    false,
    "Do not use AI to generate substantial pieces of code.",
  ]);
  // Without the size, the same refusal is a ban that blocks.
  assert.deepEqual(
    classifyPolicy("CONTRIBUTING.md", "Do not use AI to generate code for this project.").map(brief),
    [["ban", "CONTRIBUTING.md", 1, true]],
  );
  // Projects that build AI features mention models and chatbots without a ban.
  for (const text of [
    "We do not accept PRs that add LLM providers without tests.",
    "Pull requests changing the chatbot must not break the transcript format.",
    "Do not commit API keys for the LLM backends.",
  ])
    assert.deepEqual(classifyPolicy("CONTRIBUTING.md", text), [], text);
});

test("a description that says no AI was used is not an AI disclosure", () => {
  for (const body of [
    "No AI tools were used.",
    "I did not use AI for this change.",
    "This change was written without AI assistance.",
    "AI was not used.",
    "None of this was AI-generated.",
  ])
    assert.ok(!hasAiDisclosure(`Fixes the cap.\n\n${body}`), body);
  for (const body of [
    "Codex wrote the parser; the tests were not AI-generated.",
    "I used Claude Code to draft it; I did not change the tests.",
  ])
    assert.ok(hasAiDisclosure(`Fixes the cap.\n\n${body}`), body);
});
