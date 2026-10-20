// The guard before every GFM parse (README v1.2 §18.11 item 2): hostile
// Markdown never blocks the event loop for 200 ms or overflows the stack in
// the draft checks, which run on the server at approve and publish and in
// the browser on every keystroke; ordinary text is read by the parser as
// before.
import assert from "node:assert/strict";
import test from "node:test";
import { findDraftPlaceholders, markdownProse } from "./draft-checks.js";
import { assistanceDenial, hasAiDisclosure } from "./project-policy.js";
import { markdownLimits, markdownTooHeavy, roughProse } from "./markdown-guard.js";

/** The shapes that took seconds or threw in the parser (N1B and REVIEW-A security reviews), at a size. */
const hostile: Record<string, (size: number) => string> = {
  "nested emphasis": (size) => "*a ".repeat(size / 6) + "a* ".repeat(size / 6),
  "emphasis openers": (size) => "*a".repeat(size / 2),
  "lazy list continuation": (size) => `- a\n${"b\n".repeat(size / 2)}`,
  "lazy quote continuation": (size) => `> a\n${"b\n".repeat(size / 2)}`,
  "nested quotes": (size) => `${"> ".repeat(size / 2)}a`,
  "nested lists and quotes": (size) => `${"- > ".repeat(size / 4)}a`,
  "nested lists by indent": (size) => Array.from({ length: Math.sqrt(size) }, (_, index) => `${" ".repeat(index * 2)}- a`).join("\n"),
  "dotted words": (size) => "a.".repeat(size / 2),
  "research and dashes": (size) => `research${"-".repeat(size)}`,
  "tight list": (size) => "- a\n".repeat(size / 4),
  "link openers": (size) => "[a](b ".repeat(size / 6),
  "table rows": (size) => `|a|b|\n|-|-|\n${"|a|b|\n".repeat(size / 6)}`,
};

/** Runs `check` and returns how long it blocked, in ms. */
function blocked(check: () => unknown) {
  const started = performance.now();
  check();
  return performance.now() - started;
}

test("no hostile Markdown of 128 K blocks the draft checks for 200 ms, and none throws", () => {
  for (const [name, make] of Object.entries(hostile)) {
    const body = make(128 * 1024);
    markdownProse("warm up");
    // Each check on its own, as the server and the Draft tab call them.
    for (const [check, run] of [
      ["prose", () => markdownProse(body)],
      ["placeholders", () => findDraftPlaceholders(`${body}\nTODO`)],
      ["disclosure", () => hasAiDisclosure(body)],
      ["denial", () => assistanceDenial(body)],
    ] as const) {
      const ms = blocked(run);
      assert.ok(ms < 200, `${name}, ${check}: ${ms.toFixed(0)} ms`);
    }
  }
});

test("every hostile shape at the size limit is guarded or checked under 200 ms", () => {
  /** Lines indented `step` more each, up to `most`, each holding `text`. */
  const staircase = (step: string, most: number, text: string) => (size: number) => {
    const lines: string[] = [];
    for (let index = 0; lines.join("\n").length < size && lines.length < 990; index++) lines.push(`${step.repeat(Math.min(index, most))}- ${text}`);
    return lines.join("\n");
  };
  const shapes: Record<string, (size: number) => string> = {
    ...hostile,
    "intra-word underscores": (size) => "_a".repeat(size / 2),
    "dotted words in runs": (size) => `${"a.".repeat(1000)} `.repeat(size / 2001),
    "dashes in runs": (size) => `research${"-".repeat(1990)} `.repeat(size / 1999),
    "inline raw HTML": (size) => `a ${"<? ".repeat(size / 3)}`,
    "inline raw HTML in prose": (size) => `a ${"<? ".repeat(100)}${"word ".repeat((size - 302) / 5)}`,
    "e-mail addresses": (size) => "a@b.c ".repeat(size / 6),
    "lists nested by tabs": staircase("\t", 64, "a"),
    "lists nested by 16 columns of e-mail addresses": staircase("  ", 8, "a@b.c a@b.c"),
    "a table of e-mail addresses": (size) => `| h | h | h | h |\n|---|---|---|---|\n${"| a@b.c | a@b.c | a@b.c | a@b.c |\n".repeat(Math.min(990, size / 36))}`,
  };
  for (const [name, make] of Object.entries(shapes)) {
    const body = make(markdownLimits.chars).slice(0, markdownLimits.chars);
    for (const [check, run] of [
      ["prose", () => markdownProse(body)],
      ["disclosure", () => hasAiDisclosure(body)],
      ["denial", () => assistanceDenial(body)],
    ] as const) {
      // The best of three, so another process on a busy machine does not count.
      const ms = Math.min(
        ...[0, 1, 2].map(() => {
          markdownProse("warm up");
          return blocked(run);
        }),
      );
      assert.ok(ms < 200, `${name}, ${check}: ${ms.toFixed(0)} ms`);
    }
  }
});

test("deep nesting and dense emphasis under the size limit are guarded too", () => {
  for (const [name, text] of [
    ["2,000 nested quotes", `${"> ".repeat(2000)}a`],
    ["1,000 nested list items in quotes", `${"- > ".repeat(1000)}a`],
    ["nested emphasis", "*a ".repeat(1000) + "a* ".repeat(1000)],
    ["lazy continuation", `- a\n${"b\n".repeat(2000)}`],
  ] as const) {
    assert.ok(text.length <= markdownLimits.chars, name);
    assert.equal(markdownTooHeavy(text), true, name);
    const ms = blocked(() => markdownProse(`${text}\n`));
    assert.ok(ms < 200, `${name}: ${ms.toFixed(0)} ms`);
  }
});

test("inline raw HTML that never closes is guarded under the size limit: each opener reads to the paragraph's end", () => {
  // Processing instructions, comments and declarations: about 275 ms, 155 ms and 185 ms at 12,000 characters unguarded.
  for (const [name, opener] of [
    ["processing instructions", "<? "],
    ["comments", "<!-- "],
    ["declarations", "<!A "],
  ] as const) {
    const text = `a ${opener.repeat((markdownLimits.chars - 2) / opener.length)}`.slice(0, markdownLimits.chars);
    assert.equal(markdownTooHeavy(text), true, name);
    for (const [check, run] of [
      ["prose", () => markdownProse(text)],
      ["disclosure", () => hasAiDisclosure(text)],
      ["denial", () => assistanceDenial(text)],
    ] as const) {
      markdownProse("warm up");
      const ms = blocked(run);
      assert.ok(ms < 200, `${name}, ${check}: ${ms.toFixed(0)} ms`);
    }
  }
  // A template's comments, a page's doctype or a PHP tag in ordinary text are read by the parser.
  assert.equal(markdownTooHeavy("<!-- Describe your change. -->\nFixes the cap. <!-- why --> See <?php echo 1; ?>.\n<!DOCTYPE html>"), false);
});

test("ordinary Markdown is read by the parser as before: code, nesting, emphasis and long logs in fences", () => {
  const body = [
    "## Summary",
    "",
    "Retries a GET after a 503, with a **cap** of _three_ and `maxDelay` in `retry.ts`.",
    "",
    "- One",
    "  - Two",
    "    > A quote in a list",
    "",
    "```text",
    ...Array.from({ length: 200 }, (_, index) => `log_line_${index} **bold** __init__ [x] ~~y~~`),
    "```",
    "",
    "| a | b |",
    "| --- | --- |",
    "| 1 | 2 |",
  ].join("\n");
  assert.equal(markdownTooHeavy(body), false);
  assert.equal(markdownTooHeavy("snake_case_names_everywhere ".repeat(400)), false);
  const prose = markdownProse(body);
  assert.equal(prose.length, body.split("\n").length);
  assert.match(prose[2], /Retries a GET/);
  assert.doesNotMatch(prose[2], /maxDelay/);
  assert.ok(prose.slice(8, 210).every((line) => line === ""));
});

test("the rough reading of a guarded text blanks fences, code spans and closed comments, line for line", () => {
  const text = [
    "Fixes the cap. `TODO` in code is not a placeholder.",
    "<!-- a template comment",
    "spanning lines -->Visible after the comment.",
    "~~~",
    "TODO in a fence",
    "~~~",
    "TODO: still to write",
    "```",
    "an unclosed fence hides the rest, as GitHub shows it",
  ].join("\n");
  const rough = roughProse(text);
  assert.equal(rough.length, 9);
  assert.match(rough[0], /^Fixes the cap\. {8}in code is not a placeholder\.$/);
  assert.equal(rough[1], "");
  assert.match(rough[2], /^ {18}Visible after the comment\.$/);
  assert.deepEqual(rough.slice(3, 6), ["", "", ""]);
  assert.equal(rough[6], "TODO: still to write");
  assert.deepEqual(rough.slice(7), ["", ""]);
  // A guarded body is checked through it: a placeholder outside code is still found.
  const heavy = `${"- > ".repeat(100)}a\n\nTODO: add the output\n\n\`\`\`\nTODO in code\n\`\`\``;
  assert.equal(markdownTooHeavy(heavy), true);
  assert.deepEqual(findDraftPlaceholders(heavy).map((entry) => entry.line), [3]);
  // An unclosed comment hides nothing.
  assert.equal(roughProse("<!-- never closed\nTODO")[1], "TODO");
});

test("the guard and the rough reading take linear time on crafted text", () => {
  for (const text of [
    "`".repeat(64 * 1024),
    "` `` ``` ````".repeat(5000),
    "<!--".repeat(16 * 1024),
    `${">".repeat(64 * 1024)}`,
    `${" ".repeat(64 * 1024)}- a`,
    "_a_".repeat(20 * 1024),
  ]) {
    const ms = blocked(() => {
      markdownTooHeavy(text);
      roughProse(text);
    });
    assert.ok(ms < 200, `${text.slice(0, 12)}: ${ms.toFixed(0)} ms`);
  }
});
