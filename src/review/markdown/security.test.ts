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

test("nesting past the limit renders as written, at once, instead of keeping the parser busy for seconds", () => {
  // The parser's time grows with the square of this nesting: 4,000 list
  // markers on a line, or 4,000 nested emphasis or links, took seconds, and
  // deeper ones threw a RangeError. Such text never reaches the parser now.
  const started = performance.now();
  for (const source of [
    `${">".repeat(20_000)} x`,
    `${"- ".repeat(8_000)}x`,
    `${"> - ".repeat(4_000)}x`,
    `${"*a ".repeat(4_000)}x${" a*".repeat(4_000)}`,
    `${"*".repeat(20_000)}x${"*".repeat(20_000)}`,
    `${"[a ".repeat(4_000)}x${"](b) ".repeat(4_000)}`,
    `${"![".repeat(4_000)}x${"](b)".repeat(4_000)}`,
  ]) {
    const html = render(source);
    assert.match(html, /white-space:pre-wrap/, source.slice(0, 20));
    assert.ok(html.replace(/<[^>]*>/g, "").includes("x"), source.slice(0, 20));
  }
  assert.ok(performance.now() - started < 3_000, "rendering took too long");
});

test("text the parser would take seconds on without nesting renders as written, at once", () => {
  // Closers that find no opener, unclosed HTML, runs the autolink finders
  // read from every start, and lists closing in lists: each took the parser
  // one to ten seconds at 60,000 characters.
  const started = performance.now();
  for (const source of [
    `${"a* ".repeat(20_000)}x`,
    `${"](b) ".repeat(12_000)}x`,
    `x ${"<?".repeat(29_000)}`,
    `x ${"<!--".repeat(14_000)}`,
    `${"a.".repeat(29_000)}x`,
    `www.a.b/${"!".repeat(59_000)}x`,
    `${"- - x\n\n".repeat(8_000)}`,
  ]) {
    const html = render(source);
    assert.match(html, /white-space:pre-wrap/, source.slice(0, 20));
    assert.ok(html.replace(/<[^>]*>/g, "").includes("x"), source.slice(0, 20));
  }
  assert.ok(performance.now() - started < 3_000, "rendering took too long");
});

test("lists nested by indentation or under footnote definitions past the limit render as written, at once", () => {
  // Each line opens or continues every level, so the parser's time grew with
  // the cube of the depth: 60 KB of tab-indented items took it seconds.
  const started = performance.now();
  for (const source of [
    Array.from({ length: 60 }, (_, index) => `${"  ".repeat(index)}- x${index}`).join("\n"),
    `${`[^a]: ${"- ".repeat(31)}`.repeat(300)}x`,
  ]) {
    const html = render(source);
    assert.match(html, /white-space:pre-wrap/, source.slice(0, 20));
  }
  assert.ok(performance.now() - started < 3_000, "rendering took too long");
});

test("an escaped backtick before a longer run renders", () => {
  assert.equal(render("Escape it as \\`` here."), '<div class="markdown-content"><p>Escape it as `` here.</p></div>');
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
