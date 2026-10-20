// The renderer's guard (README v1.2 §18.11 item 2): Markdown too long or too
// deeply nested to parse quickly shows as plain text with a note, in both
// languages, without blocking for 200 ms or throwing; each surface has its
// own error boundary; a long list's looseness is read once.
import assert from "node:assert/strict";
import test from "node:test";
import type { List } from "mdast";
import { createElement } from "react";
import { mount } from "../../mission/test-dom";
import { assertNoHan, renderEn, renderZh } from "../../test-utils/render";
import panelEn from "../i18n/en";
import panelZh from "../i18n/zh-TW";
import { MarkdownBoundary, MarkdownContent } from "../MarkdownContent";
import { listLoose } from "./render";

const hostile = [
  "*a ".repeat(21_000) + "a* ".repeat(21_000),
  `- a\n${"b\n".repeat(64_000)}`,
  `${"> ".repeat(64_000)}a`,
  `${"- > ".repeat(32_000)}a`,
  "- a\n".repeat(32_000),
  "a\n=\n".repeat(32_000),
];

test("hostile Markdown of 128 K shows as plain text with a note, quickly, in both languages", () => {
  for (const text of hostile) {
    const started = performance.now();
    const html = renderEn(createElement(MarkdownContent, { children: text }));
    const ms = performance.now() - started;
    assert.ok(ms < 200, `${text.slice(0, 8)}: ${ms.toFixed(0)} ms`);
    assertNoHan(html);
    assert.ok(html.startsWith(`<div class="markdown-content"><p class="markdown-plain-note">${panelEn.plainText}</p><pre class="markdown-plain">`));
  }
  assert.match(renderZh(createElement(MarkdownContent, { children: hostile[2] })), new RegExp(panelZh.plainText));
});

/** An agent's long report or a long PR description: headings, lists, tables, links, code spans and blocks. */
function longReport(size: number) {
  const parts: string[] = [];
  for (let index = 1; parts.join("\n").length < size; index++)
    parts.push(
      `## Step ${index}`,
      "",
      `The \`retry_${index}\` helper now waits **${index * 10} ms** before the next try; see [the docs](https://example.com/docs/${index}) and _the issue_ #${index}.`,
      "",
      `- Checked \`server/file_${index}.ts:${index}\`: it returns early when the cap is hit.`,
      "- Ran `npm test`: 120 passed, 0 failed (~3 s).",
      "  - A nested note about ~~old~~ behaviour and __init__ files.",
      `- [ ] Follow-up: a test for case ${index}`,
      "",
      "| file | lines | status |",
      "| --- | ---: | :---: |",
      `| a_${index}.ts | ${index} | ok |`,
      "",
      "> The maintainers asked for small pull requests.",
      "",
      "```ts",
      `export const value${index} = await retry(() => fetch(url), { cap: 3 });`,
      "```",
      "",
    );
  return parts.join("\n").slice(0, size);
}

test("a long agent report or PR description, up to the size limit, renders formatted", () => {
  // 12,000 characters was the limit at first: a reviewer's report or a detailed PR body lost its formatting.
  const text = longReport(23_000);
  assert.ok(text.length > 20_000);
  const html = renderEn(createElement(MarkdownContent, { children: text }));
  assert.doesNotMatch(html, /markdown-plain/);
  assert.match(html, /<h4>Step 1<\/h4>/);
  assert.match(html, /<table>/);
  assert.match(html, /<code class="language-ts">/);
});

test("inline raw HTML that never closes shows as plain text, quickly", () => {
  for (const opener of ["<? ", "<!-- ", "<!A "]) {
    const text = `a ${opener.repeat(11_990 / opener.length)}`;
    const started = performance.now();
    const html = renderEn(createElement(MarkdownContent, { children: text }));
    const ms = performance.now() - started;
    assert.ok(ms < 200, `${opener}: ${ms.toFixed(0)} ms`);
    assert.ok(html.includes(`<p class="markdown-plain-note">${panelEn.plainText}</p>`), opener);
  }
});

test("2,000 nested block quotes show as plain text instead of overflowing the stack", () => {
  const html = renderEn(createElement(MarkdownContent, { children: `${"> ".repeat(2000)}deep` }));
  assert.match(html, /<pre class="markdown-plain">(?:&gt; ){2000}deep<\/pre>/);
});

test("a surface whose Markdown fails to render shows the text as it is, and the view around it stays", async () => {
  function Broken(): never {
    throw new Error("render failed");
  }
  const logged = console.error;
  console.error = () => {};
  const view = await mount(
    createElement("section", null, createElement(MarkdownBoundary, { text: "**the text**", children: createElement(Broken) }), createElement("p", null, "around")),
  );
  try {
    assert.equal(view.text(), `${panelEn.plainText}**the text**around`);
  } finally {
    await view.unmount();
    console.error = logged;
  }
});

test("a list's looseness is read once, however many items ask", () => {
  let reads = 0;
  const items = Array.from({ length: 1000 }, () => ({
    type: "listItem" as const,
    children: [],
    get spread() {
      reads++;
      return false;
    },
  }));
  const list = { type: "list", children: items } as unknown as List;
  assert.equal(listLoose(list), false);
  const once = reads;
  assert.ok(once >= items.length);
  // Every other item asks again: nothing is read again (it was quadratic: about a second for 15,000 items).
  for (let index = 1; index < items.length; index++) assert.equal(listLoose(list), false);
  assert.equal(reads, once);
});
