// The project's own rules for the "Before you contribute" card: the policy
// files read locally at the clone's commit, one hop of links from
// CONTRIBUTING, the generated-file patterns, and the classifier on short
// fixtures written for the test (server/fixtures/policy/<case>) and on
// verbatim excerpts of real projects' policies
// (server/fixtures/policy/real, sources in its SOURCES.md). No network.
import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { respectChecks, type PolicyFinding } from "../shared/contribution.js";
import { attachCarveOuts, classifyPolicy, hasAiDisclosure } from "../shared/project-policy.js";
import { draftPreflight } from "../shared/draft-checks.js";
import {
  channelLinks,
  generatedPatterns,
  linkedPaths,
  policyFile,
  policyFindings,
  readLocalPolicy,
} from "./contribution-policy.js";
import { git } from "./process.js";

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

/**
 * The real policies that block an agent-written change, one per line so
 * each classifier fix can add or drop its own (DESIGN v1.2 F14).
 */
const blocksAgentRuns = [
  "gentoo-ai-policy.txt",
  "netbsd-commit-guidelines.txt",
  "qemu-code-provenance.rst",
];

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
  assert.deepEqual(blocked.sort(), [...blocksAgentRuns].sort());
});

test("carve-outs of the real policies: QEMU's research and debugging, matplotlib's acceptable uses", async () => {
  const allowsOf = async (file: string) => {
    const text = await readFile(path.join(fixtures, "real", file), "utf8");
    return attachCarveOuts(file, text, classifyPolicy(file, text)).flatMap((finding) =>
      finding.allows ? [[finding.kind, finding.line, finding.allows.map((allowance) => [allowance.line, allowance.kinds.join(" ")])]] : [],
    );
  };
  assert.deepEqual(await allowsOf("qemu-code-provenance.rst"), [["ban", 6, [[10, "explain answer test"]]]]);
  // Its only ban is conditional, so the carve-outs are shown and never act.
  assert.deepEqual(await allowsOf("matplotlib-contribute-generative-ai.rst"), [
    ["ban", 38, [[20, "explain answer"], [21, "plan"]]],
  ]);
  for (const file of Object.keys(realExpectations).filter((name) => !/^(?:qemu|matplotlib-contribute-generative)/.test(name)))
    assert.deepEqual(await allowsOf(file), [], file);
});

test("an agent run's checks never read carve-outs: every real policy gives the same checks with and without them", async () => {
  for (const file of Object.keys(realExpectations)) {
    const text = await readFile(path.join(fixtures, "real", file), "utf8");
    const findings = attachCarveOuts(file, text, classifyPolicy(file, text));
    const bare = findings.map(({ allows: _allows, ...finding }) => finding);
    for (const facts of [undefined, { checkedAt: "2026-10-20T00:00:00.000Z", issue: { url: "https://github.com/acme/widgets/issues/1", state: "OPEN", labels: ["good first issue"] } }]) {
      const checks = (rules: PolicyFinding[]) =>
        respectChecks({ body: "Fixes the cap.", rules: { checkedAt: "2026-10-20T00:00:00.000Z", findings: rules, filesRead: [file] }, ...(facts ? { facts } : {}) }, "en");
      assert.deepEqual(checks(findings), checks(bare), file);
    }
  }
});

test("a carve-out counts only in its own document, and its quote is checked for credentials", () => {
  const findings = policyFindings([
    { path: "CONTRIBUTING.md", kind: "contributing", content: "We do not accept AI-generated pull requests." },
    { path: "docs/ai.md", kind: "documentation", content: "We do not accept AI-generated patches.\n\nDebugging with AI is fine, with the token ghp_abcdefghijklmnopqrstuvwxyz0123456789 removed." },
  ]);
  assert.deepEqual(findings.map((finding) => [finding.path, finding.allows?.map((allowance) => allowance.kinds)]), [
    ["CONTRIBUTING.md", undefined],
    ["docs/ai.md", [["test"]]],
  ]);
  assert.doesNotMatch(findings[1].allows![0].quote, /ghp_abcdefghijklmnopqrstuvwxyz0123456789/);
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
    "Disclosure: no AI was used.",
  ])
    assert.ok(!hasAiDisclosure(`Fixes the cap.\n\n${body}`), body);
  // A denial in one clause leaves a disclosure in the next one standing.
  for (const body of [
    "Codex wrote the parser; the tests were not AI-generated.",
    "I used Claude Code to draft it; I did not change the tests.",
    "This PR was not reviewed by AI but was written with Copilot.",
    "None of the logic is mine: Claude Code wrote it.",
  ])
    assert.ok(hasAiDisclosure(`Fixes the cap.\n\n${body}`), body);
});

/** A Git repository holding the files of one fixture case, `dot-<name>` as `.<name>`. */
async function caseRepository(name: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-policy-"));
  await cp(path.join(fixtures, name), directory, { recursive: true });
  for (const entry of await readdir(directory, { recursive: true }))
    if (path.basename(entry).startsWith("dot-"))
      await rename(
        path.join(directory, entry),
        path.join(directory, path.dirname(entry), `.${path.basename(entry).slice(4)}`),
      );
  await git(directory, ["init", "-q", "-b", "main"]);
  await git(directory, ["config", "user.name", "BELL Test"]);
  await git(directory, ["config", "user.email", "test@example.invalid"]);
  await git(directory, ["add", "-A"]);
  await git(directory, ["commit", "-qm", "fixture"]);
  return {
    directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("each policy fixture yields exactly its findings, read locally at the commit", async () => {
  const expected: Record<string, (readonly [string, string, number, boolean])[]> = {
    // A root AI_POLICY.md that refuses AI-generated code; the README is not a rules file.
    "ai-policy-ban": [["ban", "AI_POLICY.md", 5, true]],
    // CONTRIBUTE.md, reached by name and by the link from CONTRIBUTING, and
    // a linked page that no name rule would find.
    "contribute-link": [
      ["disclose", "docs/CONTRIBUTE.md", 3, true],
      ["understand", "docs/handbook/reviews.md", 3, false],
    ],
    // Rules inside a pull request template's HTML comment.
    "template-comment": [
      ["own-words", ".github/pull_request_template.md", 4, false],
      ["disclose", ".github/pull_request_template.md", 5, false],
      ["disclose", ".github/pull_request_template.md", 8, false],
    ],
    // Game AI and AI features are not about AI help: no ban.
    "game-ai": [],
    "ai-features": [],
    // A note to agents in a comment.
    "agent-note": [["agent", "CONTRIBUTING.md", 4, true]],
  };
  for (const [name, findings] of Object.entries(expected)) {
    const repo = await caseRepository(name);
    try {
      const local = await readLocalPolicy(repo.directory);
      assert.equal(local.baseSha, (await git(repo.directory, ["rev-parse", "HEAD"])).stdout.trim());
      const found = policyFindings(local.documents);
      assert.deepEqual(found.map(brief), findings, name);
      for (const document of local.documents)
        assertVerbatim(
          document.content,
          found.filter((finding) => finding.path === document.path),
        );
    } finally {
      await repo.cleanup();
    }
  }
});

test("the rules card reads the files it can name, one hop of links, and the generated patterns", async () => {
  const linked = await caseRepository("contribute-link");
  try {
    const local = await readLocalPolicy(linked.directory, { repository: "acme/widgets" });
    assert.deepEqual(
      local.documents.map((document) => [document.path, document.kind]),
      [
        [".github/CONTRIBUTING.md", "contributing"],
        ["docs/CONTRIBUTE.md", "contributing"],
        ["docs/handbook/reviews.md", "documentation"],
      ],
    );
    // GitHub's own fallback stands in only for a missing CONTRIBUTING or template.
    assert.deepEqual([...local.kinds], ["contributing"]);
    assert.deepEqual(local.generated, []);
  } finally {
    await linked.cleanup();
  }
  const banned = await caseRepository("ai-policy-ban");
  try {
    const local = await readLocalPolicy(banned.directory);
    assert.deepEqual(local.documents.map((document) => document.path), ["AI_POLICY.md"]);
    // An AI policy is guidance, but GitHub does not fall back for it.
    assert.deepEqual([...local.kinds], []);
    assert.deepEqual(local.generated, ["dist/**", "*.pb.go"]);
  } finally {
    await banned.cleanup();
  }
});

test("links from CONTRIBUTING stay inside the repository and lead to text documents", () => {
  const content = [
    "See [CONTRIBUTE](/docs/CONTRIBUTE.md#ai) and [style](./style.md \"Style\").",
    "Also [review](../docs/review.rst), [up](../../escape.md), [site](https://example.org/x.md),",
    "[mail](mailto:team@example.invalid), [secrets](../.env.md), [image](../logo.png),",
    "[ours](https://github.com/acme/widgets/blob/main/docs/ai-policy.md) and [theirs](https://github.com/other/repo/blob/main/x.md).",
    "",
    "[ref]: docs/reference.md",
    "Read `the guide <docs/guide.rst>`_ too.",
  ].join("\n");
  assert.deepEqual(linkedPaths(".github/CONTRIBUTING.md", content, "acme/widgets"), [
    "docs/CONTRIBUTE.md",
    ".github/style.md",
    "docs/review.rst",
    "docs/ai-policy.md",
    ".github/docs/reference.md",
    ".github/docs/guide.rst",
  ]);
});

test("generated patterns come from linguist-generated attributes only", () => {
  assert.deepEqual(
    generatedPatterns(
      "# comment\n*.min.js linguist-generated\nproto/** linguist-generated=true\nsrc/** -linguist-generated\nlib/** linguist-generated=false\nvendor/** linguist-vendored\n\n",
    ),
    ["*.min.js", "proto/**"],
  );
  const many = Array.from({ length: 40 }, (_, index) => `gen${index}/** linguist-generated`).join("\n");
  assert.equal(generatedPatterns(many).length, 30);
});

test("the rules card reads policy files by name and depth, never the README", () => {
  for (const [file, kind] of [
    ["AI_POLICY.md", "contributing"],
    ["AI-POLICY.md", "contributing"],
    [".github/AI_USAGE.md", "contributing"],
    ["llvm/docs/AIToolPolicy.md", "contributing"],
    ["docs/LLM_POLICY.md", "contributing"],
    ["docs/CONTRIBUTE.md", "contributing"],
    ["doc/devel/contribute.rst", "contributing"],
    ["CONTRIBUTING.md", "contributing"],
    ["CODE_OF_CONDUCT.md", "documentation"],
    [".github/copilot-instructions.md", "documentation"],
    ["AGENTS.md", "documentation"],
    [".github/CLAUDE.md", "documentation"],
    ["Documentation/process/generated-content.rst", "documentation"],
    ["Documentation/process/coding-assistants.rst", "documentation"],
    ["docs/devel/code-provenance.rst", "documentation"],
    ["docs/ai-usage-guide.md", "contributing"],
    ["doc/policies/ai.md", "documentation"],
    [".github/PULL_REQUEST_TEMPLATE/feature.md", "template"],
  ] as const)
    assert.equal(policyFile(file), kind, file);
  for (const file of [
    "README.md",
    "docs/README.md",
    "src/AI_POLICY.md",
    "third_party/lib/docs/AI_POLICY.md",
    "docs/openai-integration.md",
    "docs/a/b/c/ai-notes.md",
    "docs/agents.md",
    "docs/ai-logo.png",
    "packages/app/CONTRIBUTING.md",
  ])
    assert.equal(policyFile(file), undefined, file);
});

test("more than 30 rules keep the ones that block publishing", () => {
  const filler = Array.from(
    { length: 40 },
    (_, index) => `${index + 1}. You must be able to explain your change number ${index}.`,
  ).join("\n");
  const findings = policyFindings([
    { path: "CONTRIBUTING.md", kind: "contributing", content: filler },
    { path: "AI_POLICY.md", kind: "contributing", content: "We do not accept AI-generated pull requests." },
  ]);
  assert.equal(findings.length, 30);
  assert.ok(findings.some((finding) => finding.kind === "ban" && finding.contribution));
  // Still in reading order.
  assert.equal(findings.at(-1)?.path, "AI_POLICY.md");
});

test("the project's help channels: each kind of address, with its file, line and words", () => {
  const content = [
    "# Contributing",
    "",
    "Ask questions on [our Zulip](https://servo.zulipchat.com/#narrow/stream/263398-general).",
    "Chat with us on Discord: https://discord.gg/abc123.",
    "Or the old invite <https://discord.com/invite/xyz789>, the forum https://discourse.llvm.org/ and",
    "`the core-dev category <https://discuss.python.org/c/core-dev/23>`_.",
    "",
    "```sh",
    "curl https://lists.example.org/should-not-count",
    "```",
    "",
    "Matrix: https://matrix.to/#/#project:matrix.org",
  ].join("\n");
  assert.deepEqual(channelLinks([{ path: "CONTRIBUTING.md", kind: "contributing", content }]), [
    { label: "our Zulip", url: "https://servo.zulipchat.com/#narrow/stream/263398-general", path: "CONTRIBUTING.md", line: 3 },
    { label: "discord.gg/abc123", url: "https://discord.gg/abc123", path: "CONTRIBUTING.md", line: 4 },
    { label: "discord.com/invite/xyz789", url: "https://discord.com/invite/xyz789", path: "CONTRIBUTING.md", line: 5 },
    { label: "discourse.llvm.org", url: "https://discourse.llvm.org/", path: "CONTRIBUTING.md", line: 5 },
    { label: "the core-dev category", url: "https://discuss.python.org/c/core-dev/23", path: "CONTRIBUTING.md", line: 6 },
  ]);
  const lists = [
    "Mailing lists: https://lists.example.org/listinfo/dev, https://mail.python.org/mailman3/lists/python-dev.python.org/,",
    "https://groups.google.com/g/project-dev and [Gitter](https://gitter.im/project/community).",
    "Also https://app.gitter.im/#/room/#project:gitter.im.",
  ].join("\n");
  assert.deepEqual(
    channelLinks([{ path: "docs/CONTRIBUTE.md", kind: "contributing", content: lists }]).map((channel) => [channel.url, channel.line]),
    [
      ["https://lists.example.org/listinfo/dev", 1],
      ["https://mail.python.org/mailman3/lists/python-dev.python.org/", 1],
      ["https://groups.google.com/g/project-dev", 2],
      ["https://gitter.im/project/community", 2],
      ["https://app.gitter.im/#/room/#project:gitter.im", 3],
    ],
  );
  assert.deepEqual(
    channelLinks([{ path: "CONTRIBUTING.md", kind: "contributing", content: "Matrix: https://matrix.to/#/#project:matrix.org" }]).map((channel) => channel.label),
    ["matrix.to"],
  );
});

test("help channels: only the repository's own Discussions, no other address, no repeats, at most 5", () => {
  const content = [
    "See https://github.com/acme/widgets/discussions and https://github.com/Acme/Widgets/discussions/categories/q-a.",
    "Not https://github.com/other/repo/discussions, https://github.com/acme/widgets/issues,",
    "https://example.org/docs, https://discord.com/channels/1/2 or https://discord.gg/.",
    "Repeats: https://discord.gg/abc123 and https://discord.gg/abc123/ again.",
  ].join("\n");
  const documents = [{ path: "CONTRIBUTING.md", kind: "contributing" as const, content }];
  assert.deepEqual(channelLinks(documents, "acme/widgets").map((channel) => channel.url), [
    "https://github.com/acme/widgets/discussions",
    "https://github.com/Acme/Widgets/discussions/categories/q-a",
    "https://discord.gg/abc123",
  ]);
  // Without the repository's name, Discussions can't be told apart.
  assert.deepEqual(channelLinks(documents).map((channel) => channel.url), ["https://discord.gg/abc123"]);
  const many = Array.from({ length: 8 }, (_, index) => `Room ${index}: https://matrix.to/#/#room${index}:example.org`).join("\n");
  const capped = channelLinks([
    { path: "CONTRIBUTING.md", kind: "contributing", content: many },
    { path: "docs/more.md", kind: "documentation", content: "https://discord.gg/later" },
  ]);
  assert.equal(capped.length, 5);
  assert.deepEqual(capped.map((channel) => channel.line), [1, 2, 3, 4, 5]);
  assert.deepEqual(channelLinks([]), []);
});
