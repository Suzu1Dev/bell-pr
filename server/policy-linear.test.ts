// The policy classifier reads every rules file of a project (up to 60 of
// 128 KB each) at import, Update project and "Check again", and the quote
// readers and PR-text checks run on its output: none may freeze the server
// on crafted text. Each document here is 128 KB of one shape that made a
// pattern rescan its input (whitespace padding, long runs of one character,
// thousands of sentences, list items or questions); each read must finish
// in linear time, with its quotes still verbatim from the file.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { byHandRulesCase, byHandRulesDecision, carveOutKinds } from "../shared/by-hand-rules.js";
import type { ContributionRules } from "../shared/contribution.js";
import { areaReach, banReach } from "../shared/policy-reach.js";
import {
  assistanceDenial,
  attachCarveOuts,
  classifyPolicy,
  hasAiDisclosure,
  refusesAiHelp,
} from "../shared/project-policy.js";
import { refreshRepositoryRules } from "./contribution-facts.js";
import { channelLinks, linkedPaths, policyFindings } from "./contribution-policy.js";
import { git } from "./process.js";
import type { Repository } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

const size = 128_000;
const fill = (unit: string, length = size) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
/** The fastest of `runs` runs, in ms, so a busy machine's pause doesn't count. */
const timed = (fn: () => unknown, runs = 1) => {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
};

/** The shapes the plan names, each must read in under 200 ms. */
const named: [string, string][] = [
  ["(a) one line of spaces", `Do not use AI${" ".repeat(size)}tools in your contributions.`],
  ["(b) tabs", `Code${"\t".repeat(size)}must be written by humans.`],
  ["(c) no-break spaces", `Do not use AI${" ".repeat(size)}to write code.`],
  ["(d) a padded table row", `| Rule |${" ".repeat(size)}|\n| --- | --- |`],
  ["(e) a refusal and padding", `Do not use AI${" ".repeat(size)}`],
  ["(f) letters", fill("a")],
  ["(f) identifiers", fill("retry_after_503_")],
];

/** Other shapes that rescanned their input: many sentences, blocks, items, questions and markup runs. */
const shapes: [string, string][] = [
  ["sentences", fill("a. ")],
  ["refusals", fill("Do not use AI tools. ")],
  ["bans", fill("AI-generated code is not accepted. ")],
  ["permissions", `We do not accept AI-generated code. ${fill("You may use AI for research. ")}`],
  ["questions answered", `We do not accept AI-generated code.\n\n${fill("Can I use AI to understand the code? Yes. ")}`],
  ["one long question", `We do not accept AI-generated code.\n\nCan I use AI for ${fill("research ")}?\n\nYes.`],
  ["blocks", fill("a\n\n")],
  ["lines of one paragraph", fill("Do not use AI\n")],
  ["list items", `We do not accept AI-generated code.\n\n${fill("- a\n")}`],
  ["list items under a lead-in", `We do not accept AI-generated code.\n\nAcceptable uses:\n\n${fill("- research\n")}`],
  ["headings", `We do not accept AI-generated code.\n\n${fill("# H\n")}`],
  ["permission phrases", `We do not accept AI-generated code. It is fine to use AI for research${fill(", which is fine")}.`],
  ["brackets", `We do not accept AI-generated code. ${fill("[")}`],
  ["backticks", `We do not accept AI-generated code. ${fill("`a` ")}`],
  ["a role and padding", `We do not accept AI-generated code. :ref:\`${" ".repeat(size)}`],
  ["emphasis", fill("**")],
  ["comment markers", `<!--${" ".repeat(size)}`],
  ["entities", fill("&nbsp;")],
  ["index brackets", fill("a[")],
  ["agents addressed", fill("you are an AI agent ")],
  ["a note to agents", `Note to${" ".repeat(size)}AI agents: stop.`],
];

const ban = { kind: "ban" as const, path: "CONTRIBUTING.md", line: 1, quote: "We do not accept AI-generated code.", contribution: true };

for (const [name, text] of named)
  test(`the rules of a 128 KB document read in under 200 ms: ${name}`, () => {
    for (const file of ["CONTRIBUTING.md", "CONTRIBUTING.rst"]) {
      const ms = timed(() => classifyPolicy(file, text), 3);
      assert.ok(ms < 200, `${file}: classifyPolicy took ${ms.toFixed(0)} ms`);
    }
    const ms = timed(() => policyFindings([{ path: "CONTRIBUTING.md", content: text, kind: "contributing" }]), 3);
    assert.ok(ms < 200, `policyFindings took ${ms.toFixed(0)} ms`);
  });

// Linear reads take under 250 ms each here; a rescanning one took seconds at 8 KB.
test("every other rescanning shape reads its rules, carve-outs and links in linear time", () => {
  for (const [name, text] of [...named, ...shapes])
    for (const [label, read] of [
      ["classifyPolicy.md", () => classifyPolicy("CONTRIBUTING.md", text)],
      ["classifyPolicy.rst", () => classifyPolicy("CONTRIBUTING.rst", text)],
      ["attachCarveOuts", () => attachCarveOuts("CONTRIBUTING.md", text, [ban])],
      ["attachCarveOuts.rst", () => attachCarveOuts("CONTRIBUTING.rst", text, [ban])],
      ["links and channels", () => [linkedPaths("CONTRIBUTING.md", text, "acme/widgets"), channelLinks([{ path: "C.md", content: text, kind: "contributing" }])]],
    ] as const) {
      const ms = timed(read);
      assert.ok(ms < 1000, `${name}, ${label}: ${ms.toFixed(0)} ms`);
    }
});

/** Padded and repeated PR text, at most 60,000 characters as a draft's body. */
const bodies = [
  `AI${" ".repeat(60_000)}such as Copilot helped.`,
  `Codex${"\t".repeat(60_000)}wrote it.`,
  fill("explained ", 60_000),
  fill("Not explained by AI; ", 60_000),
  fill("Assisted-by:\n", 60_000),
  fill("a. ", 60_000),
  fill("Can I use AI to understand the code? ", 60_000),
];

test("the quote readers stay linear on padded and repeated text", () => {
  for (const text of [...named.map(([, text]) => text), ...bodies, `research${fill("-")}`, fill("research ")])
    for (const [label, read] of [
      ["refusesAiHelp", () => refusesAiHelp(text)],
      ["banReach", () => banReach(text)],
      ["areaReach", () => areaReach(text)],
      ["carveOutKinds", () => carveOutKinds(text)],
    ] as const) {
      const ms = timed(read);
      assert.ok(ms < 500, `${label} on ${JSON.stringify(text.slice(0, 30))}…: ${ms.toFixed(0)} ms`);
    }
});

test("the PR-text checks stay linear on a padded or repeated body", () => {
  for (const text of bodies)
    for (const [label, read] of [
      ["hasAiDisclosure", () => hasAiDisclosure(text, text, { helpVerbs: true })],
      ["assistanceDenial", () => assistanceDenial(text, text)],
    ] as const) {
      const ms = timed(read);
      assert.ok(ms < 500, `${label} on ${JSON.stringify(text.slice(0, 30))}…: ${ms.toFixed(0)} ms`);
    }
});

test("a rules read over a padded CONTRIBUTING takes under a second, every quote verbatim and stable for the lock", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-policy-linear-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // A real output ban with its carve-out, written with runs of spaces and tabs inside the sentences, then padding.
  const rules = "We do not accept\tAI-generated   code in pull requests.\nIt is fine to use AI for research   and debugging.\n";
  // Under the 128 KB a rules file may have (`policyLimits.fileBytes`).
  const padded = `${rules}\n${`| Rule |${" ".repeat(60_000)}|`}\n\nThank you${"\t".repeat(60_000)}for contributing.\n`;
  await writeFile(path.join(directory, "CONTRIBUTING.md"), padded);
  await git(directory, ["init", "-q", "-b", "main"]);
  await git(directory, ["config", "user.name", "BELL Test"]);
  await git(directory, ["config", "user.email", "test@example.invalid"]);
  await git(directory, ["add", "-A"]);
  await git(directory, ["commit", "-qm", "fixture"]);
  const repo: Repository = { id: "repo", name: "widgets", owner: "acme", fullName: "acme/widgets", path: directory, defaultBranch: "main", url: "https://github.com/acme/widgets" };
  const read = () => refreshRepositoryRules({} as WorkbenchContext, repo, { network: false, registry: [] });
  let start = performance.now();
  const first = (await read())!;
  let ms = performance.now() - start;
  start = performance.now();
  const second = (await read())!;
  ms = Math.min(ms, performance.now() - start);
  assert.ok(ms < 1000, `the rules read took ${ms.toFixed(0)} ms`);
  // Quotes are the file's own text, runs of spaces and tabs kept, on the line they name (lines joined as a block joins them).
  const flat = padded.split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
  const lines = padded.split("\n");
  for (const finding of first.findings) {
    assert.ok(flat.includes(finding.quote), finding.quote);
    assert.ok(lines[finding.line - 1].includes(finding.quote.split(" ")[0]), `${finding.line}: ${finding.quote}`);
    for (const allowance of finding.allows ?? []) assert.ok(flat.includes(allowance.quote), allowance.quote);
  }
  const outputBan = first.findings.find((finding) => finding.kind === "ban" && finding.contribution);
  assert.equal(outputBan?.quote, "We do not accept\tAI-generated   code in pull requests.");
  assert.deepEqual(outputBan?.allows?.map((allowance) => allowance.quote), ["It is fine to use AI for research   and debugging."]);
  // Read again, the rules a run was fitted to are the same text: the lock sees no drift.
  assert.deepEqual(second.findings, first.findings);
  const fitted = byHandRulesCase(first, { learningIssue: false, now: first.checkedAt });
  assert.equal(fitted.case, "fitted");
  if (fitted.case !== "fitted") return;
  const later: ContributionRules = { ...second, checkedAt: new Date(Date.parse(first.checkedAt) + 1000).toISOString() };
  const decision = byHandRulesDecision(
    { bans: later.findings.filter((finding) => finding.kind === "ban" && finding.contribution), areas: [], rules: later },
    { helps: ["explain"], helpLock: { ...fitted.lock, at: first.checkedAt }, createdAt: first.checkedAt, now: later.checkedAt },
  );
  assert.deepEqual(decision.blocked, []);
  assert.equal(decision.confirmable.length, 1);
});
