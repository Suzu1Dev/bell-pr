import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { markdownNestingLimit, markdownTooNested } from "./markdown-nesting.js";

const limit = markdownNestingLimit;
const root = path.join(import.meta.dirname, "..");

/** Each shape the parser reads in time quadratic in its depth, at `depth` levels. */
const shapes: Record<string, (depth: number) => string> = {
  quotes: (depth) => `${">".repeat(depth)} x`,
  "spaced quotes": (depth) => `${"> ".repeat(depth)}x`,
  lists: (depth) => `${"- ".repeat(depth)}x`,
  "ordered lists": (depth) => `${"1. ".repeat(depth)}x`,
  "emphasis runs": (depth) => `${"*".repeat(2 * depth)}a${"*".repeat(2 * depth)}`,
  "strong emphasis with text": (depth) => `${"**a ".repeat(depth)}x${" a**".repeat(depth)}`,
  "emphasis with text": (depth) => `${"*a ".repeat(depth)}x${" a*".repeat(depth)}`,
  "underscores with text": (depth) => `${"_a ".repeat(depth)}x${" a_".repeat(depth)}`,
  strikethrough: (depth) => `${"~a ".repeat(depth)}x${" a~".repeat(depth)}`,
  "double strikethrough": (depth) => `${"~~a ".repeat(depth)}x${" a~~".repeat(depth)}`,
  links: (depth) => `${"[a ".repeat(depth)}x${"](b) ".repeat(depth)}`,
  images: (depth) => `${"![".repeat(depth)}a${"](b)".repeat(depth)}`,
  "footnote definitions": (depth) => `${"[^a]: ".repeat(depth)}x`,
  "emphasis past openers of another kind": (depth) => `${"*a _b ".repeat(depth)}x${" a*".repeat(depth)}`,
};
const deep = shapes["emphasis with text"](4_000);
const deepLists = `${"- ".repeat(8_000)}x`;

test("each nesting the parser reads in quadratic time counts past the limit, not at it", () => {
  for (const [name, make] of Object.entries(shapes)) {
    // A quote marker counts a quarter of a level.
    const most = name.endsWith("quotes") ? 4 * limit : limit;
    assert.equal(markdownTooNested(make(most + 1)), true, `${name} at ${most + 1}`);
    assert.equal(markdownTooNested(make(most)), false, `${name} at ${most}`);
    assert.equal(markdownTooNested(make(5_000)), true, `${name} at 5000`);
  }
  // Kinds that add up on one line, and runs that alternate "*_*_".
  assert.equal(markdownTooNested(`${"> - ".repeat(27)}x`), true);
  assert.equal(markdownTooNested(`${"> ".repeat(64)}${"- ".repeat(16)}x`), false);
  // Four columns after a list marker still nest; five start code.
  assert.equal(markdownTooNested(`${"-    ".repeat(limit + 1)}x`), true);
  assert.equal(markdownTooNested(`${"*_".repeat(17)}a${"_*".repeat(17)}`), true);
  // Closers that look back past many open delimiters of another kind.
  assert.equal(markdownTooNested(`${"_a ".repeat(4_000)}${"a* ".repeat(4_000)}`), true);
  assert.equal(markdownTooNested(`${"*a ".repeat(4_000)}x${" a_".repeat(4_000)}`), true);
  assert.equal(markdownTooNested(`${"_a ".repeat(100)}${"a* ".repeat(100)}`), false);
  // Long chains of delimiters that each both open and close pair as siblings, but in quadratic time.
  assert.equal(markdownTooNested("あ*".repeat(30_000)), true);
  assert.equal(markdownTooNested(".~.".repeat(20_000)), true);
  assert.equal(markdownTooNested("2*3*4*5 ".repeat(5_000)), true);
  assert.equal(markdownTooNested("2*3*4*5 ".repeat(100)), false);
  // Emphasis and strikethrough pair in separate passes, and only runs the parser pairs close.
  assert.equal(markdownTooNested(`*q* ~z ${"*a ".repeat(4_000)}x~${" a*".repeat(4_000)}`), true);
  assert.equal(markdownTooNested(`~q~ *z ${"~a ".repeat(4_000)}x*${" a~".repeat(4_000)}`), true);
  assert.equal(markdownTooNested(`${"~a ".repeat(2_400)}x${" ~~a a~".repeat(2_400)}`), true);
  assert.equal(markdownTooNested(`${"~~a ".repeat(4_000)}x${" ~a ~a a~~".repeat(4_000)}`), true);
  assert.equal(markdownTooNested(`${"*a ".repeat(4_000)}x${" **a a*~~~".repeat(4_000)}`), true);
  // "*" opens before a "~" and closes after one.
  assert.equal(markdownTooNested(`${"*a ".repeat(4_000)}x${"~~~*a".repeat(4_000)}`), true);
  assert.equal(markdownTooNested(`${"*a ".repeat(4_000)}x${" ~*a".repeat(4_000)}`), true);
  assert.equal(markdownTooNested("a*~~~".repeat(12_000)), true);
  // The rule of 3 and separate passes, where pairing them otherwise would hide the depth.
  assert.equal(markdownTooNested(`${"*a ".repeat(40)}x${" **a a*~~~".repeat(40)}`), true);
  assert.equal(markdownTooNested(`*q* ~z ${"*a ".repeat(40)}x~${" a*".repeat(40)}`), true);
});

test("nesting cannot hide behind code this reading may take for code, nor behind a list item that continues a paragraph", () => {
  for (const text of [
    // Fences in a quote or a list item, closed early by a code line, or opened in an HTML block.
    `> \`\`\`\n\n${deep}`,
    `- \`\`\`\n\n${deep}`,
    `- a\n\n  \`\`\`\n\n${deep}`,
    `> \`\`\`\n\n${"- ".repeat(5_000)}x`,
    `\`\`\`\n- \`\`\`\n\`\`\`\n\n${deep}`,
    `\`\`\`\n> \`\`\`\n\`\`\`\n\n${deep}`,
    `<!--\n\`\`\`\n-->\n${deepLists}`,
    `<div>\n\`\`\`\n\n${deepLists}`,
    // Indented text that is a list item's paragraph, and markers at any indentation.
    `- a\n\n    ${deep}`,
    `- x\n    ${deepLists}`,
    `10. x\n     ${deepLists}`,
    // Text that only looks like an HTML tag, and code spans the line reading pairs wrongly.
    `<x ${"*a ".repeat(4_000)}>x${" a*".repeat(4_000)}`,
    `<x ${"[".repeat(4_000)}>x${"](b)".repeat(4_000)}`,
    `foo \`\n\` ${deep} \``,
    `[a](b\`c) ${deep} \``,
    // List items and empty items that do not start a new paragraph, and a lone carriage return.
    `x\n${Array(4_000).fill("2. *a").join("\n")}\nx\n${Array(4_000).fill("2. a*").join("\n")}`,
    `${Array(400).fill("*a ".repeat(10)).join("\n*\n")}\nx\n${Array(400).fill(" a*".repeat(10)).join("\n*\n")}`,
    `x\r${deepLists}`,
    // A setext underline that is a lazy continuation does not end the paragraph.
    `> ${"*a ".repeat(4_000)}\n=\n> ${" a*".repeat(4_000)}`,
    `- ${"*a ".repeat(4_000)}\n=\n  ${" a*".repeat(4_000)}`,
    // List items continued by indentation (spaces or tabs) nest as deep as markers, and so do footnote definitions.
    Array.from({ length: limit + 1 }, (_, index) => `${"  ".repeat(index)}- x`).join("\n"),
    Array.from({ length: limit + 1 }, (_, index) => `${"\t".repeat(Math.floor(index / 2))}${"  ".repeat(index % 2)}- x`).join("\n"),
    `${"- ".repeat(limit)}x\n${"  ".repeat(limit)}- x`,
    `[^a]: ${"- ".repeat(limit)}x`,
    // Lines the parser reads as more of the paragraph: indented four columns, after "2.", or of Unicode spaces.
    ...["    ~~~", "    ```x", "    >", "\t>", "    > # x", "    - # x", "2. # x", "2. ~~~", "10) ```", "　", "\u00a0", "\f"].map(
      (middle) => `${"*a ".repeat(4_000)}x\n${middle}\n${" a*".repeat(4_000)}`,
    ),
    // Text this reading takes for code and the parser for prose, or the other way round.
    `- x\n\n    ${"*a ".repeat(4_000)}x\n${" a*".repeat(4_000)}`,
    `[^a]: x\n\n    ${"*a ".repeat(4_000)}x\n${" a*".repeat(4_000)}`,
    `x \`\n\` ${"*a ".repeat(4_000)}x \` ${" a*".repeat(4_000)}`,
    `| h |\n| - |\n| a \` | b ${"*a ".repeat(4_000)}x \` ${" a*".repeat(4_000)} |`,
    // Four columns continue every open footnote definition at once.
    `${"[^a]: ".repeat(limit - 2)}x\n    ${"[^a]: ".repeat(limit - 2)}x`,
    `${"[^a]: ".repeat(limit - 2)}x\n\t${"- ".repeat(limit - 2)}x`,
    // A fence line the parser reads as text (after text, indented four columns or after "2."): its info string counts.
    `x\n    ~~~ ${deep}`,
    `x\n2. ~~~ ${deep}`,
    // Code spans and tags in text read as code, which the parser pairs otherwise (across lines), hide nothing.
    `x \`\n    ~~~\n\` ${"*a ".repeat(4_000)}x \` ${" a*".repeat(4_000)}`,
    `x \`\n    ~~~\n<a title='\` ${"*a ".repeat(4_000)}x'> ${" a*".repeat(4_000)}`,
    `- x\n\n    a \`\n    \` ${"*a ".repeat(4_000)}x \` ${" a*".repeat(4_000)}`,
    // Code itself still counts, against four times the limit.
    `\`\`\`\n${shapes["emphasis runs"](4 * limit + 1)}\n\`\`\``,
    `\`\`\`\n${"- ".repeat(4 * limit + 1)}x\n\`\`\``,
  ])
    assert.equal(markdownTooNested(text), true, JSON.stringify(text.slice(0, 40)));
});

test("code under four times the limit, thematic breaks, redactions, fill-in lines and siblings do not count", () => {
  const code = 4 * limit;
  for (const text of [
    `Intro\n\n\`\`\`\n${"- ".repeat(code)}x\n${shapes["emphasis runs"](code)}\n\`\`\`\n\nAfter`,
    `~~~ts\n${shapes.links(code)}\n~~~`,
    `> \`\`\`\n>\n> ${shapes["emphasis runs"](code)}\n> \`\`\``,
    `Intro\n\n    ${shapes["emphasis with text"](code)}\n\nAfter`,
    `Run \`${shapes["emphasis runs"](code)}\` and \`\`${shapes.links(code)}\`\` there.`,
    `1. Add the header:\n    \`\`\`c\n    /${"*".repeat(60)}/\n    \`\`\``,
    `1. Step\n   - sub\n     \`\`\`c\n     /${"*".repeat(60)}/\n     \`\`\``,
    `\`/${"*".repeat(80)}/\``,
    `/${"*".repeat(60)}\n * Copyright\n ${"*".repeat(60)}/`,
    `${"- ".repeat(200)}`,
    `${"*".repeat(200)}`,
    `${"_".repeat(200)}`,
    `API_TOKEN=${"*".repeat(40)}`,
    `GITHUB_TOKEN=ghp_${"*".repeat(36)}`,
    `Name:${"_".repeat(40)}`,
    `姓名：${"_".repeat(40)}`,
    `${"\\*".repeat(500)}a${"\\*".repeat(500)}`,
    `<https://example.com/${"[".repeat(100)}>`,
    `Press <kbd>Ctrl</kbd> or <a href="https://x.y/${"[".repeat(100)}" title="${"*a ".repeat(100)}">here</a>.`,
    // Escaped backticks before a longer run.
    "\\``a",
    "Use \\``x`` here",
    "\\```*a*``",
    // Openers that never close: Chinese bold labels ending in a fullwidth colon, pointers, half-open ranges.
    `${["問題根源", "影響範圍", "修正方式", "測試方式", "風險評估", "效能影響", "相容性", "後續工作", "回滾方式"].map((label) => `**${label}：**說明`).join("\n")}\n**部署：** 需要重新部署`,
    `${Array.from({ length: 20 }, (_, index) => `int f${index}(char *buf, size_t *len);`).join("\n")}\n/* end */`,
    `${Array.from({ length: 40 }, (_, index) => `| [${index}, ${index + 10}) | ok |`).join("\n")}\n| [0, 0] | ok |`,
    // Siblings, however many, and arithmetic.
    "**a** ".repeat(5_000),
    "[a](b) ".repeat(5_000),
    "*a* _b_ ~c~ ".repeat(5_000),
    `${"- item\n".repeat(5_000)}`,
    `${"> quoted\n".repeat(5_000)}`,
    // Lists nested by indentation up to the limit, footnotes, and setext headings.
    Array.from({ length: limit }, (_, index) => `${"  ".repeat(index)}- x${index}`).join("\n"),
    Array.from({ length: limit / 2 }, (_, index) => `${"    ".repeat(index)}- x${index}`).join("\n"),
    "Text[^1] and more.\n\n[^1]: A note with [a link](https://example.com) and `code`.\n    Its second paragraph.",
    "Title\n=====\n\nText with *emphasis* and **strong**.\n\nSection\n-------\n\nMore text.",
    // Comment boxes from license headers, pasted as they are, indented or quoted.
    ` *${" ".repeat(75)}*`,
    `*${" ".repeat(70)}*\n*  6. Disclaimer of Warranty${" ".repeat(43)}*\n*${" ".repeat(70)}*`,
    `    /${"*".repeat(77)}\n     *${" ".repeat(75)}*\n     *   Copyright (c) Example${" ".repeat(53)}*\n     ${"*".repeat(77)}/`,
    `> *${" ".repeat(75)}*`,
    // A C++ crash report pasted without a fence: each "T*" closer looks back past the open "__1" and "_0" runs.
    `==1==ERROR: AddressSanitizer: stack-overflow\n${Array.from({ length: 250 }, (_, i) => `    #${i} 0x${i.toString(16)} in ${i % 3 === 2 ? "std::__1::__function::__func<P::parse(L*, V*)::$_0, std::__1::allocator<P::parse(L*, V*)::$_0>, void (V*)>::operator()(V*&&)" : "P::parse(L*, V*)"} p.cpp:${i}`).join("\n")}`,
    // Indented code: C banners, footnotes, a JSON fixture under a list item; a fence's info string.
    `    /${"*".repeat(78)}\\\n    * Includes.\n    \\${"*".repeat(78)}/`,
    Array.from({ length: 40 }, (_, i) => `    [^${i + 1}]: Note ${i + 1}.`).join("\n"),
    `1. Add the fixture:\n    \`\`\`json\n    ${"[".repeat(40)}1${"]".repeat(40)}\n    \`\`\``,
    "~~~md {1,3-5}\nUse `*a*`, `[b](c)` and <kbd>Ctrl</kbd>.\n~~~",
    `${Array.from({ length: 40 }, (_, index) => `[^${index}]: Note ${index}.`).join("\n")}\n    - a list in the last note`,
    // Escaped delimiters, identifiers, and zh-TW sections whose headings have no blank lines around them.
    `${"\\*a ".repeat(40)}x${" a\\*".repeat(40)}`,
    "my_var_name ".repeat(3_000),
    ["## 摘要", ...Array.from({ length: 20 }, (_, i) => `- **標籤${i}：**說明`), "## 變更", ...Array.from({ length: 10 }, (_, i) => `- 在**A${i}**中調整**B${i}**的行為`)].join("\n"),
    // pytest's --pdb separators pasted without a fence.
    `${">".repeat(34)} traceback ${">".repeat(34)}\n\n${">".repeat(33)} entering PDB ${">".repeat(33)}`,
  ])
    assert.equal(markdownTooNested(text), false, JSON.stringify(text.slice(0, 40)));
});

test("no Markdown the app renders or checks counts: the renderer's corpus, the docs and the policy fixtures", () => {
  const corpus = JSON.parse(readFileSync(path.join(root, "src/review/markdown/corpus.json"), "utf8")) as { source: string }[];
  for (const { source } of corpus) assert.equal(markdownTooNested(source), false, source.slice(0, 60));
  const files = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const full = path.join(directory, name);
      return statSync(full).isDirectory() ? files(full) : [full];
    });
  const documents = [
    ...readdirSync(root).filter((name) => name.endsWith(".md")).map((name) => path.join(root, name)),
    ...files(path.join(root, "docs")).filter((name) => name.endsWith(".md")),
    ...files(path.join(root, "server/fixtures/policy")),
  ];
  assert.ok(documents.length > 20);
  for (const file of documents) assert.equal(markdownTooNested(readFileSync(file, "utf8")), false, file);
});

test("reading takes linear time, however the text nests", () => {
  const started = performance.now();
  for (const make of Object.values(shapes)) markdownTooNested(make(200_000));
  // Text read to its end: siblings, backtick runs of many lengths, unclosed tags and quoted values, open brackets.
  for (const text of [
    "*a* [b](c) ".repeat(100_000),
    Array.from({ length: 100_000 }, (_, index) => `${"`".repeat(1 + (index % 50))}a`).join(" "),
    "<a b='".repeat(100_000),
    '<a b="x" c='.repeat(100_000),
    "[a ".repeat(300_000),
    "*a ".repeat(300_000),
    `${"\\`".repeat(100_000)}${"``".repeat(100_000)}`,
  ])
    markdownTooNested(text);
  assert.ok(performance.now() - started < 3_000, "reading took too long");
});
