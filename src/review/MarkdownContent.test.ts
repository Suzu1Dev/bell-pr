import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { MarkdownContent, safeLink, WebLink } from "./MarkdownContent";

const render = (children: string) =>
  renderZh(createElement(MarkdownContent, { children }));

test("learning content renders paragraphs, GFM lists/tables, and code as readable HTML", () => {
  const html = render(
    "## 設計原因\n\n先保留 **原始錯誤**。\n\n- 使用 `maxDelay`\n- 再測試\n\n```ts\nawait retry();\n```\n\n| 項目 | 狀態 |\n| --- | --- |\n| 測試 | 待驗證 |",
  );
  assert.match(html, /<h4>設計原因<\/h4>/);
  assert.match(html, /<strong>原始錯誤<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<code>maxDelay<\/code>/);
  assert.match(html, /<pre><code class="language-ts">/);
  assert.match(html, /<table>/);
  assert.match(html, /待驗證/);
});

test("untrusted Markdown cannot execute HTML, load images, or link to non-web schemes", () => {
  const html = render(
    '<script>alert(1)</script>\n\n<img src="https://tracker.example/pixel" onerror="alert(1)">\n\n![示意圖](https://tracker.example/pixel)\n\n[unsafe](javascript:alert%281%29) [file](file:///etc/passwd) [relative](/private) [source](https://example.com/source)',
  );
  assert.doesNotMatch(
    html,
    /<script|<img|onerror|tracker\.example|javascript:|file:\/\/|href="\/private/,
  );
  assert.match(html, /圖片已省略：示意圖/);
  assert.match(
    html,
    /href="https:\/\/example.com\/source" target="_blank" rel="noopener noreferrer"/,
  );
});

test("the renderer's own text follows the UI language", () => {
  const html = renderEn(
    createElement(MarkdownContent, {
      children:
        "![diagram](https://tracker.example/pixel) ![](https://tracker.example/x)\n\n| Item | State |\n| --- | --- |\n| Tests | Pending |",
    }),
  );
  assertNoHan(html);
  assert.match(html, /Image omitted: diagram/);
  assert.match(html, /Image omitted<\/span>/);
  assert.match(html, /role="region" aria-label="Explanation table"/);
});

test("a diff block marks its added and removed lines and keeps the text as it was", () => {
  const html = renderEn(
    createElement(MarkdownContent, {
      children: "Explain this.\n\n```diff\n context\n-\told\n+\tnew\n```\n\nAnd `inline` code.",
    }),
  );
  assert.ok(
    html.includes(
      '<pre><code class="language-diff"><span> context\n</span><span class="markdown-diff-removed">-\told\n</span><span class="markdown-diff-added">+\tnew</span></code></pre>',
    ),
    html,
  );
  // Other code is left as it is.
  assert.match(html, /<code>inline<\/code>/);
  assert.match(
    render("```ts\n+1\n```"),
    /<pre><code class="language-ts">\+1\n<\/code><\/pre>/,
  );
  assertNoHan(html);
});

test("safeLink allows only absolute HTTP and HTTPS links", () => {
  for (const value of [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "\u0000javascript:alert(1)",
    "\tjavascript:alert(1)",
    "data:text/html,x",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "/relative",
    "//evil.example",
    "ftp://example.com/x",
  ])
    assert.equal(safeLink(value), "");
  for (const value of ["https://example.com/path", "http://example.com/path"])
    assert.equal(safeLink(value), value);
  assert.equal(safeLink("  https://example.com/a  "), "https://example.com/a");
});

test("rejected external links render their text without an anchor", () => {
  assert.equal(renderEn(createElement(WebLink, { href: safeLink("javascript:alert(1)") || undefined }, "Source")), "<span>Source</span>");
});

test("WebLink never emits a javascript: href even if passed unsanitized", () => {
  const html = renderEn(createElement(WebLink, { href: "javascript:alert(1)" }, "Evil"));
  assert.equal(html, "<span>Evil</span>");
  assert.equal(html.toLowerCase().includes("javascript:"), false);
  assert.equal(html.includes("href="), false);
});

test("WebLink keeps in-page hash hrefs and still blocks javascript:", () => {
  assert.match(renderEn(createElement(WebLink, { href: "#source-1" }, "Ref")), /href="#source-1"/);
  assert.equal(renderEn(createElement(WebLink, { href: "javascript:alert(1)" }, "Evil")), "<span>Evil</span>");
});

test("mailto: and javascript: in Markdown stay blocked (About allowlist does not apply)", () => {
  const html = render(
    "[mail](mailto:security@example.test) [evil](javascript:alert(1)) [ok](https://example.com/x)",
  );
  assert.doesNotMatch(html, /href="mailto:|javascript:/i);
  assert.match(
    html,
    /href="https:\/\/example\.com\/x" target="_blank" rel="noopener noreferrer"/,
  );
  assert.equal(safeLink("mailto:security@example.test"), "");
  assert.equal(safeLink("javascript:alert(1)"), "");
});
