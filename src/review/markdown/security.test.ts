import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn } from "../../test-utils/render";
import { MarkdownContent } from "../MarkdownContent";

const render = (children: string) => {
  const html = renderEn(createElement(MarkdownContent, { children }));
  assertNoHan(html);
  return html;
};

/** Markup that would run code, load something or reach a non-web scheme. */
const unsafe = /<script|<img|<style|<details|onerror|onclick|javascript:|data:|vbscript:|tracker\.example/i;

test("raw HTML inside a table's cells never renders, and the cells keep their text", () => {
  const html = render(
    '| Name | Value |\n| --- | --- |\n| <script>alert(1)</script> | <img src="https://tracker.example/x" onerror="alert(1)"> |\n| <b>bold</b> text | <a href="javascript:alert(1)">x</a> [js](javascript:alert(1)) |',
  );
  assert.doesNotMatch(html, unsafe);
  assert.doesNotMatch(html, /<b>|<a /);
  assert.match(html, /<td>bold text<\/td>/);
  assert.match(html, /<td>x <span>js<\/span><\/td>/);
});

test("raw HTML inside a footnote never renders, and the footnote keeps its text", () => {
  const html = render(
    'A note[^x].\n\n[^x]: Text <script>alert(1)</script> and <img src="https://tracker.example/x" onerror="alert(1)"> and [js](javascript:alert(1)).\n\n    <details>block html</details>\n\n[^y]: <script>alert(1)</script> unused',
  );
  assert.doesNotMatch(html, unsafe);
  assert.match(html, /<li id="user-content-fn-x">\n<p>Text alert\(1\) and {2}and <span>js<\/span>\.<\/p>\n\n<span>↩<\/span>\n<\/li>/);
});

test("raw HTML inside a link's text or title never renders, and the link keeps its text", () => {
  const html = render(
    '[<img src="https://tracker.example/x" onerror="alert(1)">click](https://example.com) [<b>bold</b>](javascript:alert(1)) [title](https://example.com "<script>alert(1)</script>")',
  );
  assert.doesNotMatch(html, unsafe);
  assert.doesNotMatch(html, /<b>|title=/);
  assert.match(
    html,
    /<a href="https:\/\/example.com\/" target="_blank" rel="noopener noreferrer">click<\/a> <span>bold<\/span> <a href="https:\/\/example.com\/" target="_blank" rel="noopener noreferrer">title<\/a>/,
  );
});

test("a javascript: link through a reference definition or an autolink is dropped to its text", () => {
  const html = render(
    "[click][evil] and [Evil] and <javascript:alert(1)> and <JAVASCRIPT:alert(1)>\n\n[evil]: javascript:alert(1) \"t\"",
  );
  assert.doesNotMatch(html, /href|<a /);
  assert.match(
    html,
    /<p><span>click<\/span> and <span>Evil<\/span> and <span>javascript:alert\(1\)<\/span> and <span>JAVASCRIPT:alert\(1\)<\/span><\/p>/,
  );
});

test("an image inside a link shows as the image note inside the link, never as an image", () => {
  const html = render(
    "[![badge](https://tracker.example/badge.svg)](https://example.com/ci) [![](https://tracker.example/x.png)](javascript:alert(1))",
  );
  assert.doesNotMatch(html, unsafe);
  assert.match(
    html,
    /<a href="https:\/\/example.com\/ci" target="_blank" rel="noopener noreferrer"><span class="markdown-image-note">Image omitted: badge<\/span><\/a> <span><span class="markdown-image-note">Image omitted<\/span><\/span>/,
  );
});

test("a long run of spaces or tabs renders in linear time, kept inside a line and trimmed at its ends", () => {
  // The earlier unified pipeline took about 40 ms for 200,000 spaces; a
  // backtracking trim of line ends took seconds, quadratic in the run's
  // length.
  const run = " \t".repeat(100_000);
  const started = performance.now();
  const html = render(`a${run}b\nc${run}\n${run}d`);
  assert.ok(performance.now() - started < 3_000, "rendering took too long");
  assert.equal(html, `<div class="markdown-content"><p>a${run}b\nc\nd</p></div>`);
});

test("a block with more children than a function call takes still renders", () => {
  // 150,000 children (a hard break and a line break after each line): the
  // earlier unified pipeline rendered them in a paragraph (though not in a
  // tight list item), and spreading them into one call throws a
  // RangeError, which would take down the view.
  const lines = 50_000;
  for (const [html, open, close] of [
    [render(`${"a\\\n".repeat(lines)}end`), "<p>", "</p>"],
    [render(`- ${"a\\\n  ".repeat(lines)}end`), "<ul>\n<li>", "</li>\n</ul>"],
  ]) {
    assert.equal(html.match(/<br\/>/g)?.length, lines);
    assert.ok(html.startsWith(`<div class="markdown-content">${open}a<br/>\na<br/>`));
    assert.ok(html.endsWith(`a<br/>\nend${close}</div>`));
  }
});

test("nesting too deep for the call stack renders, with its innermost text", () => {
  // Each level of nesting took several stack frames, so about 1,300 quote
  // markers (or 800 list markers) threw a RangeError, which would take down
  // the view. Past a hundred levels the nesting now shows as its text; past
  // what the parser itself can take, the whole text shows as written.
  for (const source of [
    `${">".repeat(5_000)} x`,
    `${"- ".repeat(800)}x`,
    `${"> - ".repeat(600)}x`,
    `${"*a ".repeat(1_500)}x${" a*".repeat(1_500)}`,
  ]) {
    const html = render(source);
    const tags = html.match(/<blockquote>|<ul>|<em>/g)?.length ?? 0;
    assert.ok(html.replace(/<[^>]*>/g, "").includes("x"), source.slice(0, 20));
    // The depth limit, not the plain-text fallback, keeps these shallow:
    // React renders the elements later, outside Markdown's try/catch.
    assert.doesNotMatch(html, /white-space/, source.slice(0, 20));
    assert.ok(tags > 0 && tags <= 100, source.slice(0, 20));
  }
  const tooDeep = render(`${">".repeat(20_000)} x`);
  assert.ok(tooDeep.replace(/<[^>]*>/g, "").includes("x"));
  assert.doesNotMatch(tooDeep, /<blockquote>/);

  const quotes = render(`${"> ".repeat(500)}x`);
  assert.ok(quotes.startsWith('<div class="markdown-content"><blockquote>\n<blockquote>'));
  assert.equal(quotes.match(/<blockquote>/g)?.length, 100);
  assert.match(quotes.replace(/<[^>]*>/g, ""), /x\s*$/);
});

test("short table rows are filled only within a budget, so a few kilobytes cannot make millions of cells", () => {
  // Every row got a cell per column of the head: a head of 1,000 columns
  // over 2,000 one-cell rows (8 KB) made 2,000,000 cells, seconds and
  // gigabytes, and twelve tables of 316 by 316 almost 1,200,000. Past
  // 100,000 empty cells in a document, a short row shows only its own cells.
  const table = (columns: number, rows: number) =>
    `${"|a".repeat(columns)}\n${"|-".repeat(columns)}\n${"x\n".repeat(rows)}`;
  const started = performance.now();
  for (const [source, cells] of [
    [table(1_000, 2_000), 2_000],
    [Array.from({ length: 12 }, () => table(316, 316)).join("\n"), 316 * 316 + 11 * 316],
  ] as const)
    assert.equal(render(source).match(/<td>/g)?.length, cells);
  assert.ok(performance.now() - started < 3_000, "rendering took too long");
  assert.match(render(table(3, 1)), /<tbody><tr><td>x<\/td><td><\/td><td><\/td><\/tr><\/tbody>/);
});

test("children that are not a string render an empty container instead of throwing", () => {
  // As the earlier pipeline did in a production build: a null or other
  // value read from a stored run must not take down the view.
  for (const children of [null, undefined, 0, 42, ["a", "b"], { a: 1 }])
    assert.equal(
      renderEn(createElement(MarkdownContent, { children: children as unknown as string })),
      '<div class="markdown-content"></div>',
    );
});
