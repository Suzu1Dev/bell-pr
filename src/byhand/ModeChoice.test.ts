import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { ByHandRulesCase } from "../../shared/by-hand-rules";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { ModeChoice, type ModeChoiceProps } from "./ModeChoice";

const gentoo =
  "It is expressly forbidden to contribute to Gentoo any content that has been created with the assistance of Natural Language Processing artificial intelligence tools.";
const qemu =
  "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.";
const carveOut =
  "This policy does not apply to other uses of AI, such as researching APIs or algorithms, static analysis, or debugging, provided their output is not included in contributions.";

/** A fitted case as W2G's case reader returns it (the W1 stub never does). */
const fitted: ByHandRulesCase = {
  case: "fitted",
  kinds: ["explain", "answer", "test"],
  lock: {
    kinds: ["explain", "answer", "test"],
    rulesCheckedAt: "2026-10-20T00:00:00.000Z",
    rules: [
      {
        kind: "ban",
        path: "docs/devel/code-provenance.rst",
        line: 12,
        quote: qemu,
        allows: [{ line: 20, quote: carveOut, kinds: ["explain", "answer", "test"] }],
      },
    ],
  },
};
const blocked: ByHandRulesCase = {
  case: "blocked",
  finding: { kind: "ban", path: "CONTRIBUTING.md", line: 3, quote: gentoo, contribution: true },
  reach: "assistance",
  reason: "reach",
};

const choice = (props: Partial<ModeChoiceProps> = {}) =>
  createElement(ModeChoice, {
    mode: "agents",
    onModeChange() {},
    fitted: false,
    onFittedChange() {},
    ...props,
  });
/** The radio input of the card titled `label`. */
const radio = (html: string, label: string) =>
  html.match(new RegExp(`(<input type="radio"[^>]*/>)<svg(?:(?!<input)[\\s\\S])*?<strong>${label}`))?.[1] ?? "";

test("the task dialog offers the agent team and Learn by hand, the team first", () => {
  const html = renderEn(choice());
  assertNoHan(html);
  assert.match(html, /<legend class="field-label">Who writes the code\?<\/legend>/);
  assert.match(radio(html, "The agent team writes it"), /checked=""/);
  assert.doesNotMatch(radio(html, "You write it \\(Learn by hand\\)"), /checked|disabled/);
  assert.ok(html.includes("BELL PR&#x27;s agents can&#x27;t edit your files in this run."));
  // Nothing about the project's rules while the team writes.
  assert.doesNotMatch(html, /mode-case|mode-fit/);
  assert.match(renderZh(choice()), /你自己寫（親手學）/);
});

test("the sample shows the agent team only, and says where Learn by hand works", () => {
  const html = renderEn(choice({ sample: true, mode: "hand", rulesCase: blocked }));
  assertNoHan(html);
  assert.match(radio(html, "You write it \\(Learn by hand\\)"), /disabled=""/);
  assert.ok(html.includes("The sample shows the agent team. Learn by hand works on your own projects."));
  assert.doesNotMatch(html, /mode-case/);
});

test("on a project whose rules restrict AI help itself, the card says BELL won't publish it and help stays full", () => {
  const html = renderEn(choice({ mode: "hand", rulesCase: blocked }));
  assertNoHan(html);
  assert.match(
    html,
    /<p class="mode-case" role="status">BELL PR won&#x27;t publish a learn-by-hand run here: the project&#x27;s rules restrict AI help itself, not only AI-written code\. The guide still gives every kind of help\.<\/p>/,
  );
  assert.doesNotMatch(html, /Fit the guide/);
});

test("where the project's text allows the quoted confirm, fitting the guide is preselected and quotes the carve-out", () => {
  const html = renderEn(choice({ mode: "hand", rulesCase: fitted, fitted: true }));
  assertNoHan(html);
  const options = html.slice(html.indexOf('class="mode-fit"'));
  assert.match(options, /<input type="radio"[^>]*checked=""[^>]*\/><span class="mission-plan-copy"><strong>Fit the guide to the project&#x27;s rules<\/strong>/);
  assert.ok(options.includes("only if the guide stays within what the project&#x27;s own text says is fine (explanations, answers, and test help:"));
  assert.ok(options.includes("The maintainers decide whether your change fits."));
  // The carve-out shows once, in the line; a second one of the same rules below it.
  assert.equal(options.split(carveOut).length, 2);
  assert.doesNotMatch(options, /<blockquote>/);
  const second = "Asking an LLM questions about an existing codebase is fine.";
  const two: ByHandRulesCase = structuredClone(fitted);
  if (two.case === "fitted") two.lock.rules[0].allows.push({ line: 22, quote: second, kinds: ["explain"] });
  const both = renderEn(choice({ mode: "hand", rulesCase: two, fitted: true }));
  assert.equal(both.split(carveOut).length, 2);
  assert.ok(both.includes(`<blockquote>${second}</blockquote>`));
  assert.match(options, /<strong>Every kind of help, practise locally<\/strong><small>BELL PR won&#x27;t publish that run here\.<\/small>/);
  // The agent team chosen: no case at all.
  assert.doesNotMatch(renderEn(choice({ mode: "agents", rulesCase: fitted })), /mode-fit/);
  assert.match(renderZh(choice({ mode: "hand", rulesCase: fitted, fitted: true })), /讓嚮導配合專案規範/);
});
