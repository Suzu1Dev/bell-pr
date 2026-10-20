/**
 * The Markdown corpus: every Markdown surface's kind of input, and the HTML
 * that MarkdownContent renders for it in each locale (corpus.json; the
 * zh-TW HTML is kept only where it differs from the English). The recorded
 * HTML is data, written only by this file in record mode:
 *
 *   BELLPR_RECORD_MARKDOWN_CORPUS=1 npx tsx --import ./test/css-stub.mjs --test src/review/markdown/corpus.test.ts
 *
 * It was first recorded with react-markdown 10.1.0, the renderer the
 * component had before; a renderer change must leave it byte for byte as
 * it is.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { createElement } from "react";
import type { Locale } from "../../../shared/i18n/locale";
import { getDemo } from "../../demo";
import { briefMarkdown } from "../../mission/ProjectOverview";
import { renderWith } from "../../test-utils/render";
import { MarkdownContent } from "../MarkdownContent";

interface Entry {
  /** A sample's name, "demo" for the sample project's text, or "brief" for request and direction text after briefMarkdown. */
  source: string;
  text: string;
  en: string;
  /** Absent when it is the same as `en`. */
  "zh-TW"?: string;
}

const corpusFile = new URL("./corpus.json", import.meta.url);
const locales: Locale[] = ["en", "zh-TW"];

/** Constructs and edge cases of GitHub Flavored Markdown, and untrusted input. */
const samples: Record<string, string> = {
  empty: "",
  blank: "  \n\t\n",
  "plain text": "Just one sentence.",
  "table alignment":
    "| Left | Center | Right | None |\n| :--- | :---: | ---: | --- |\n| a | b | c | d |\n| longer cell | `code` | 1,000 | |",
  "table code and pipes":
    "| Command | Meaning |\n| --- | --- |\n| `a \\| b` | pipe `\\|` inside code |\n| a \\| b | escaped pipe in text |\n| **bold** *em* ~~gone~~ | [link](https://example.com) |",
  "table wide":
    "| Column one | Column two | Column three | Column four | Column five | Column six | Column seven | Column eight | Column nine | Column ten |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |\n| a very long cell that keeps going and going so the table must scroll sideways on a narrow screen | b | c | d | e | f | g | h | i | j |",
  "table ragged rows":
    "| A | B | C |\n| --- | :-: | --: |\n| only one |\n| one | two | three | four |",
  "table head only": "| Only | Head |\n| --- | --- |",
  "table after paragraph": "Results:\n| Item | State |\n| --- | --- |\n| Tests | Pending |\nAfter the table.",
  "table in list": "- Item\n\n  | A | B |\n  | - | - |\n  | 1 | 2 |",
  "task list":
    "- [x] Done item\n- [ ] Open item\n- [X] Capital X\n- Plain item\n- [ ]\n- [ ] \n-   [x]   spaced",
  "task list nested and loose":
    "1. [ ] First\n   - [x] Nested done\n   - [ ] Nested open\n\n2. [x] Second\n\n   With a paragraph.",
  "task list in quote": "> - [ ] quoted task\n> - [x] quoted done",
  strikethrough: "~~two tildes~~ and ~one tilde~ and ~~~three~~~ and ~~not closed",
  autolinks:
    "Visit www.example.com, https://example.com/path?q=1&r=2. Or http://example.com/a_(b)_c).\nMail contact@example.com or mailto:someone@example.com.\nAngle <https://example.com/angle> <mailto:a@b.co> <a@b.co> <ftp://example.com/f>.\nNot links: www. example, http://, user@ example.com, www.example.com/path..",
  footnotes:
    "A claim[^1] and another[^note] and the first again[^1].\n\n[^1]: The first footnote.\n[^note]: A footnote with `code` and a [link](https://example.com).\n\n    Its second paragraph.\n\n[^unused]: Never referenced.",
  "footnote labels": "Odd label[^Ünï cödé] and[^a b] and[^x-y_z].\n\n[^Ünï cödé]: Unicode.\n[^a b]: Space.\n[^x-y_z]: Punctuation.",
  "footnote with list": "See[^list].\n\n[^list]:\n    - one\n    - two",
  "nested lists":
    "- one\n  - one.a\n    - one.a.i\n- two\n  1. two.1\n  2. two.2\n- three",
  "loose list": "- first\n\n- second\n\n  second paragraph\n- third",
  "ordered start": "3. three\n4. four\n\n0) zero\n1) one\n\n1. one\n1. one again",
  "list mixed content":
    "- item with code:\n\n  ```js\n  run();\n  ```\n- > a quote in an item\n-\n  empty first line\n- # heading in item",
  "list item paragraphs": "1. Step one.\n   Continued line.\n\n   Second paragraph.\n2. Step two.",
  blockquotes:
    "> One level\n> continued\nlazy continuation\n\n> > Two levels\n>\n> - list in quote\n> 1. ordered\n\n> ```\n> code in quote\n> ```",
  headings:
    "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n####### seven is text\n\nSetext one\n===\n\nSetext two\n---\n\n# Heading with `code` and [link](https://example.com) #",
  "hard breaks":
    "Two spaces  \nthen a line.\nBackslash\\\nthen a line.\n*em with break  \n  indented after*\nTrailing spaces at end  ",
  "hard break before inline": "Line  \n   **bold after break**\nLine\\\n   `code after break`",
  "soft breaks and trailing spaces": "First line   \n   second line  with  inner  spaces\n\tthird line\t",
  "code spans":
    "Use `npm test`, ``a ` tick``, `` `edge` ``, `  two spaces  `, ` `, and a `multi\nline\nspan`. Unclosed `tick.",
  "fenced code":
    "```ts\nconst a: Promise<number> = get();\n```\n\n```\nno language\n```\n\n~~~python extra meta words\nprint(\"hi\")\n~~~\n\n```js title=\"x.js\" {1,3}\nlet x = 1;\n```\n\n```\n```\n\n````md\n```nested```\n````",
  "indented code": "Paragraph.\n\n    indented code\n      more indent\n\n\tтаб",
  "unclosed fence": "Before.\n\n```sh\nnpm run build\nno closing fence",
  "diff blocks":
    "```diff\n context line\n-removed line\n+added line\n--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n```\n\n```diff extra\n+meta after language\n```\n\n```diff\n```\n\n```Diff\n+capital language\n```\n\n```diff-foo\n+not a diff\n```\n\n```ts\n+plus in ts\n-minus in ts\n```",
  "diff block blank lines": "```diff\n+a\n\n-b\n\n```",
  "links by scheme":
    "[http](http://example.com) [https](https://example.com/a?b=c#d) [mailto](mailto:someone@example.com) [javascript](javascript:alert(1)) [JS upper](JaVaScRiPt:alert(1)) [data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==) [vbscript](vbscript:msgbox) [file](file:///etc/passwd) [ftp](ftp://example.com/x) [relative](docs/readme.md) [root](/private) [dot](./a) [anchor](#section) [protocol-relative](//example.com/x) [empty]() [query](?q=1) [tel](tel:+123)",
  "link details":
    "[titled](https://example.com \"A title\") [spaces](<https://example.com/a b>) [unicode](https://example.com/ü/中) [encoded](https://example.com/%E4%B8%AD%zz) [backslash](https://example.com/a\\b) [pipes](https://example.com/a|b^c[d]{e}) [upper](HTTPS://EXAMPLE.COM/Path) [port](http://localhost:4310/x) [user](https://user:pass@example.com/) [**bold** link](https://example.com) [`code` link](https://example.com)",
  "reference links":
    "[full][ref] [collapsed][] [shortcut] [undefined][nope] [Case][REF]\n\n[ref]: https://example.com/ref \"Ref title\"\n[collapsed]: <https://example.com/collapsed>\n[shortcut]: /relative/shortcut\n[evil]: javascript:alert(1)\n\nUse [evil] too.",
  images:
    "![alt text](https://tracker.example/a.png) ![](https://tracker.example/b.png) ![titled](https://tracker.example/c.png \"Title\") ![**bold** alt with `code`](x.png) ![ref image][img] ![collapsed img][] ![missing][none]\n\n[img]: https://tracker.example/ref.png\n[collapsed img]: https://tracker.example/col.png",
  "image in link":
    "[![badge](https://tracker.example/badge.svg)](https://example.com/ci) [![](https://tracker.example/x.png)](javascript:alert(1)) [text ![inner](i.png) more](https://example.com)",
  "raw html inline":
    "Text with <b>bold</b>, <span onclick=\"alert(1)\">span</span>, <img src=x onerror=alert(1)> and <a href=\"javascript:alert(1)\">raw link</a>. A <br> break and an <!-- inline comment --> end.",
  "raw html blocks":
    "<script>alert(1)</script>\n\n<img src=\"https://tracker.example/pixel\" onerror=\"alert(1)\">\n\n<details>\n<summary>More</summary>\n\nInside **details**.\n\n</details>\n\n<!-- a comment -->\n\n<div align=\"center\">\n  <p>centered</p>\n</div>\n\n<style>body{display:none}</style>\nAfter.",
  "raw html between paragraphs": "First.\n\n<hr>\n\nSecond.\n<p>attached html</p>\nThird.",
  "only html": "<p>only html</p>",
  entities:
    "&amp; &lt;tag&gt; &copy; &nbsp;x &#123; &#x1F600; &#0; &foo; &AMP &amp &quot;q&quot; &#X41; &ouml;\n\n`&amp; in code` and [&lt;link&gt;](https://example.com/?a=1&amp;b=2)",
  "escapes": "\\*not em\\* \\_not em\\_ \\# not heading \\[not link\\](x) \\<not html> \\\\ backslash \\` tick \\| pipe \\~ tilde",
  "emphasis": "*em* _em_ **strong** __strong__ ***both*** *nested **strong** em* snake_case_name __init__.py _a_b_ **bold**text 2*3*4",
  "thematic breaks": "Above\n\n---\n\n***\n\n___\n\nBelow\n- - -",
  "cjk text":
    "這是一段**中文**說明，包含`程式碼`與[連結](https://example.com)。\n\n- 第一項：使用 `maxDelay`\n- 第二項：**粗體**後面接中文\n\n| 項目 | 狀態 |\n| --- | --- |\n| 測試 | 待驗證 |\n\n![示意圖](https://tracker.example/pixel) ~~刪除~~ 全形符號：「引號」（括號）！",
  "cjk emphasis edges": "**「強調」**後面 *中文*斜體 中文**粗體**中文 __底線__粗體 ~~刪除~~文字",
  "crlf line endings": "Line one\r\nLine two  \r\nLine three\r\n\r\n- a\r\n- b\r\n\r\n```diff\r\n+added\r\n-removed\r\n```\r\n",
  "tabs": "\tTab-indented code\n\n-\ttab list\n\n> \ttab quote",
  "definitions only": "[a]: https://example.com\n[b]: https://example.com/b",
  "pr body template":
    "<!-- Thanks for contributing! Please fill in this template. -->\n## Summary\n\nAdds retries with full jitter to GET requests.\n\n<!-- Describe what changed and why. -->\n\n## Checklist\n\n- [x] I read the [contributing guide](https://github.com/example/project/blob/main/CONTRIBUTING.md)\n- [ ] Tests pass locally (`npm test`)\n- [ ] Docs updated <!-- if needed -->\n- [ ] <!-- leave unchecked -->\n\n## Test plan\n\n```sh\nnpm test -- retry\n```\n\nFixes #42\n\n<details><summary>Screenshots</summary>\n\n![screenshot](https://user-images.example/1.png)\n\n</details>",
  "html in table":
    "| Name | Value |\n| --- | --- |\n| <script>alert(1)</script> | <img src=x onerror=alert(1)> |\n| <b>bold</b> text | <a href=\"javascript:alert(1)\">x</a> [js](javascript:alert(1)) |",
  "html in footnote":
    "A note[^x].\n\n[^x]: Text <script>alert(1)</script> and <img src=\"https://tracker.example/x\" onerror=\"alert(1)\"> and [js](javascript:alert(1)).\n\n    <details>block html</details>\n\n[^y]: <script>alert(1)</script> unused",
  "html block footnote":
    "A note[^x].\n\n[^x]: <script>alert(1)</script> text <img src=x onerror=alert(1)> and [js](javascript:alert(1)).\n\n    <details>block html</details>",
  "html in link":
    "[<img src=x onerror=alert(1)>click](https://example.com) [<b>bold</b>](javascript:alert(1)) [title](https://example.com \"<script>alert(1)</script>\")",
  "javascript in reference definition":
    "[click][evil] and [Evil] and ![img][evil]\n\n[evil]: javascript:alert(1) \"t\"\n[angle]: <javascript:alert(1)>\n\n[angle][]",
  "javascript in autolink":
    "<javascript:alert(1)> <JAVASCRIPT:alert(1)> <data:text/html,<script>> <vbscript:x> <https://example.com/safe> javascript:alert(1) www.example.com/javascript:x",
  "spaces after a hard break":
    "Space reference  \n&#32;after a break\\\n&#9;tab reference\\\n**&#32;bold head**  \n`&#32;code`\\\n[&#32;link](https://example.com)",
  "spaces around line endings":
    "Space reference &#32;\nnext line\n&#32;leading reference\nTab&#9;\n&#9;tab line\n\n- item &#32;\n  &#32;continued\n\n| A |\n| --- |\n| cell &#32; |",
  "footnote references in many places":
    "# Heading[^h]\n\n| Cell[^c] | B |\n| --- | --- |\n| [link text[^l]](https://example.com) | ~~gone[^c]~~ |\n\nThird use[^c] and case[^H].\n\n[^h]: Heading note, with a nested reference[^n].\n[^c]: Cell note.\n[^l]: Link note.\n[^n]: Only referenced from a footnote.\n[^h]: A second definition that never shows.",
  "footnote definition shapes":
    "Empty[^e], code[^k], quote[^q] and html[^t].\n\n[^e]:\n[^k]:\n\n        code at the end\n\n> [^q]: Defined inside a quote.\n\n[^t]: <b>tail is html</b>",
  "duplicate definitions": "[a] and [b]\n\n[a]: https://example.com/first\n[A]: https://example.com/second\n[b]: <> \"empty url\"",
  "html block kinds":
    "<pre>\n*kept raw*\n</pre>\n\n<textarea>x</textarea>\n\n<?php echo 1; ?>\n\n<!DOCTYPE html>\n\n<![CDATA[ data ]]>\n\n</div>\nclosing tag block\n\n<custom-element attr=\"1\">\ntext\n\nAfter all.",
  "html inside table cells": "| A | B |\n| --- | --- |\n| line<br>break | <sub>sub</sub> and <kbd>Ctrl</kbd> |\n| <!-- c --> | `<br>` |",
  "carriage returns": "One\rTwo  \rThree\r\r- a\r- b\r\rInline `a\r\nb` code",
  "code info strings": "```c&#43;&#43; meta\nint x;\n```\n\n```\\\nescaped\n```\n\n``` diff\n+leading space info\n```\n\n```diff\n+\n-\n \nno marker\n```",
  "url normalization": "[emoji](https://example.com/😀) [lone](https://example.com/\uD800x) [percent](https://example.com/100%) [ok](https://example.com/%41) [space](<https://example.com/a b?c d#e f>) [quote](https://example.com/\"q\") [ref][u]\n\n[u]: https://example.com/ü?q=ü \"Ü\"",
  "reference url normalization":
    "[full][v], [collapsed][], [v] and ![image][v]\n\n[v]: https://example.com/a\\b|c^%zz{d}`e` \"t\"\n[collapsed]: <https://example.com/x y>",
  "deep nesting":
    "> - a\n>   > 1. b\n>   >    - [ ] c\n>   >      > ```diff\n>   >      > +d\n>   >      > ```\n\n- [x] item\n\n  > quote in a loose task item\n- [ ] second",
  "ordered list numbers": "123456789. big\n\n1. one\n\n   two paragraphs\n10. ten",
  "trailing and leading spaces": "  leading spaces\ttab   \n   continued   \n\n- item   \n  next   ",
  "long line": `${"word ".repeat(400)}end`,
  "mixed document":
    "# Retry\n\nThe client now **retries** `GET` requests:\n\n1. Wait `min(30, 2^attempt)` seconds.\n2. Add jitter.\n\n> Note: writes are not retried.\n\n```diff\n-await fetch(url);\n+await retry(() => fetch(url));\n```\n\n| Status | Retry? |\n| --- | :---: |\n| 503 | yes |\n| 404 | no |\n\nSee [MDN](https://developer.mozilla.org/) and the footnote[^1].\n\n[^1]: RFC 9110.",
};

/** Requests written as labelled sections, as the brief shows them (src/mission/ProjectOverview.test.ts). */
const briefRequests = [
  [
    "問題：觀察：create_interview 會回傳既有列的 id。",
    "使用者影響：若此假設成立，候選人重新整理後就無法開始面試。",
    "建議做法：1) 用 `grep -rn 'create_interview(' src/` 找出呼叫端。",
    "驗收：",
    "- `./scripts/test.sh` 通過",
    "原始碼依據（引文已核對；推論仍待確認）：",
    "- src/accounts/interviews.rs：「The caller supplies the id」",
  ].join("\n"),
  [
    "Problem: GET requests fail on the first brief outage.",
    "User impact: Retries would spare people a reload.",
    "Acceptance:",
    "- `npm test` passes",
    "Source evidence (each quote was checked; inferences are unconfirmed):",
    "- src/client.ts: “fetch(url)” — one attempt",
  ].join("\n"),
  [
    "Problem: Make get() return Promise<Response> instead of Promise<any>, and fix the import in src/__init__.py.",
    "The <Dialog> component closes on Escape; make <Select> do the same for Result<Vec<u8>, Error> & Array<string>.",
    "Keep snake_case_names and C:\\Users\\me\\new_dir; see https://example.com/a_b/c_d.",
    "Run `make <target> __all__` first.",
    "```",
    "Problem: <b>kept</b> __as__ written",
    "```",
  ].join("\n"),
  "若此假設成立，候選人：無法開始",
  "1) 步驟：先讀",
  "If this holds, the caller: fails\nnote: lowercase\nhttps://example.com/a: b\n1) Step: read",
  "Problem: x\n".repeat(30),
  "`npm test` passes",
  "Problem: &amp; entity, a \\ backslash, __dunder__, _lead and trail_, <T>, `a <b> c` and ``x `y` z``.\nDirection: keep `<Dialog>`\n~~~\nfenced: <b>raw</b> __as__ written\n~~~\nAfter: done",
];

/** Every long string of the sample project in both languages, and its prewritten answers for every file. */
function demoTexts() {
  const texts = new Set<string>();
  const briefs = new Set<string>();
  for (const locale of locales) {
    const demo = getDemo(locale);
    const seen = new Set<unknown>();
    const walk = (value: unknown) => {
      if (typeof value === "string") {
        if (value.length >= 40) texts.add(value);
      } else if (value && typeof value === "object" && !seen.has(value)) {
        seen.add(value);
        for (const child of Object.values(value)) walk(child);
      }
    };
    walk(demo);
    for (const answer of demo.answers)
      for (const file of demo.files) texts.add(answer.text({ file }));
    const brief = demo.contributionBrief;
    for (const text of [
      demo.run.prompt,
      brief.problem,
      brief.motivation,
      brief.before,
      brief.after,
      ...brief.validation,
      ...brief.risks,
    ])
      briefs.add(briefMarkdown(text));
  }
  return { texts: [...texts], briefs: [...briefs] };
}

const render = (locale: Locale, text: string) =>
  renderWith(locale, createElement(MarkdownContent, { children: text }));

const parse = (text: string) =>
  fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });

function record() {
  const { texts, briefs } = demoTexts();
  const inputs = [
    ...Object.entries(samples).map(([name, text]) => ({ source: name, text })),
    ...briefRequests.map((text) => ({ source: "brief", text: briefMarkdown(text) })),
    ...briefs.map((text) => ({ source: "brief", text })),
    ...texts.map((text) => ({ source: "demo", text })),
  ];
  const entries: Entry[] = inputs.map(({ source, text }) => {
    const en = render("en", text);
    const zh = render("zh-TW", text);
    return { source, text, en, ...(zh === en ? {} : { "zh-TW": zh }) };
  });
  writeFileSync(corpusFile, `${JSON.stringify(entries, null, 1)}\n`);
}

if (process.env.BELLPR_RECORD_MARKDOWN_CORPUS === "1") record();

const corpus = JSON.parse(readFileSync(corpusFile, "utf8")) as Entry[];

test("every corpus text renders byte for byte as recorded, in English and zh-TW", () => {
  const mismatches: string[] = [];
  for (const entry of corpus)
    for (const locale of locales) {
      const recorded = entry[locale] ?? entry.en;
      const html = render(locale, entry.text);
      if (html !== recorded)
        mismatches.push(
          `${entry.source} (${locale}): ${JSON.stringify(entry.text.slice(0, 80))}\n  recorded: ${recorded}\n  rendered: ${html}`,
        );
    }
  assert.equal(
    mismatches.length,
    0,
    `${mismatches.length} of ${corpus.length * locales.length} renders differ:\n${mismatches.slice(0, 5).join("\n")}`,
  );
});

test("the corpus covers every Markdown node the parser makes and both locales' own text", () => {
  const types = new Set<string>();
  const visit = (node: Nodes) => {
    types.add(node.type);
    if ("children" in node) for (const child of node.children) visit(child);
  };
  for (const entry of corpus) visit(parse(entry.text));
  assert.deepEqual(
    [...types].sort(),
    [
      "blockquote",
      "break",
      "code",
      "definition",
      "delete",
      "emphasis",
      "footnoteDefinition",
      "footnoteReference",
      "heading",
      "html",
      "image",
      "imageReference",
      "inlineCode",
      "link",
      "linkReference",
      "list",
      "listItem",
      "paragraph",
      "root",
      "strong",
      "table",
      "tableCell",
      "tableRow",
      "text",
      "thematicBreak",
    ],
  );
  const sources = new Set(corpus.map((entry) => entry.source));
  for (const name of [...Object.keys(samples), "brief", "demo"]) assert.ok(sources.has(name), name);
  // The image note and the table label are the renderer's own, localized text.
  const localized = corpus.filter((entry) => entry["zh-TW"] !== undefined);
  assert.ok(localized.some((entry) => entry.en.includes("Image omitted") && entry["zh-TW"]?.includes("圖片已省略")));
  assert.ok(localized.some((entry) => entry.en.includes('aria-label="Explanation table"')));
});
