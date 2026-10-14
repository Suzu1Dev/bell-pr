#!/usr/bin/env node
/**
 * Builds the landing site's legal pages from the legal documents, and checks
 * the documents against LEGAL-REVIEW.md. Zero dependencies; development only,
 * it is not part of the site.
 *
 *   node site/build-legal.mjs              write site/legal/*.html
 *   node site/build-legal.mjs --check      verify pages, claims and placeholders
 *   node site/build-legal.mjs --self-test  this script, on fixtures
 *
 * Each page is the document's Markdown rendered into the site's page frame.
 * The DRAFT banner (a blockquote), the owner placeholder list and every
 * `[OWNER: …]` placeholder stay visible; HTML comments, such as the claim
 * markers, do not. Generated regions (`<!-- generated:… -->`, in the head
 * and the footer) belong to scripts/render-generated-regions.ts: a rebuild
 * keeps what that script wrote into them, and --check ignores their content.
 *
 * --check fails when:
 * - a page is not the current rendering of its document;
 * - a claim ID (`<!-- claim:PRIV-07 -->`) in a document has no row in
 *   LEGAL-REVIEW.md, a row has no claim, or an ID is repeated or carries the
 *   wrong document prefix;
 * - a row names neither "owner decision" nor a `path:line` reference, or any
 *   `path:line` in LEGAL-REVIEW.md points to a missing file or past its end;
 * - the lines with an `[OWNER` placeholder in a document (what
 *   `grep -c "\[OWNER"` counts) differ in number from its owner placeholder
 *   list, a line holds two placeholders, or the document says TODO or TBD.
 *
 * Exit status: 0 when fine, 1 when a check failed, 2 on a usage error.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

/** The documents, their pages and claim prefixes. `nav` matches the footer. */
export const documents = [
  {
    source: "LICENSE.md",
    page: "eula.html",
    prefix: "EULA",
    nav: "License agreement",
    lead: "The terms under which you may install and use BELL PR, on the Free plan and with a Pro license.",
  },
  {
    source: "PRIVACY.md",
    page: "privacy.html",
    prefix: "PRIV",
    nav: "Privacy",
    lead: "What BELL PR does with data on your computer, and what the seller does with data when you buy a license or ask for support.",
  },
  {
    source: "TERMS.md",
    page: "terms.html",
    prefix: "TERMS",
    nav: "Terms",
    lead: "The terms of sale for Pro licenses, and the rules for contributing to other people's projects responsibly with BELL PR.",
  },
  {
    source: "REFUND.md",
    page: "refund.html",
    prefix: "REFUND",
    nav: "Refunds",
    lead: "How license keys are delivered, and when and how you can get a refund.",
  },
  {
    source: "SECURITY.md",
    page: "security.html",
    prefix: "SEC",
    nav: "Security",
    lead: "How BELL PR protects your computer and your accounts, and how to report a vulnerability privately.",
  },
];

const reviewFile = "LEGAL-REVIEW.md";
const legalDirectory = "site/legal";

// ---------------------------------------------------------------------------
// Markdown: the subset the legal documents use

const htmlEntities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => htmlEntities[char]);

/** A heading's anchor: lower case, letters and digits, words joined by "-". */
export function slug(text) {
  return (
    text
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/&[a-z0-9#]+;/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/**
 * Inline Markdown: code spans, backslash escapes, links, **strong**, *em*,
 * and `[OWNER…]` placeholders, which keep the site's placeholder style. A code
 * span that names another legal document links to its page.
 */
export function inline(text) {
  const held = [];
  const hold = (html) => `\uE000${held.push(html) - 1}\uE000`;
  let out = text
    .replace(/(`+)([^]*?[^`])\1(?!`)/g, (_, _ticks, code) => {
      const value = code.replace(/^ (.*) $/, "$1");
      const linked = documents.find((doc) => doc.source === value);
      const html = `<code>${escapeHtml(value)}</code>`;
      return hold(linked ? `<a href="${linked.page}">${html}</a>` : html);
    })
    .replace(/\\([!-/:-@[-`{-~])/g, (_, char) => hold(escapeHtml(char)));
  out = escapeHtml(out)
    .replace(/\[OWNER(?::[^\]]*)?\]/g, (match) => hold(`<span class="owner">${match}</span>`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?![*\w])/g, "$1<em>$2</em>");
  // A held piece may hold others, such as a code span inside a placeholder.
  while (/\uE000\d+\uE000/.test(out)) out = out.replace(/\uE000(\d+)\uE000/g, (_, index) => held[Number(index)]);
  return out;
}

/** Splits a table row into cells; `\|` stays inside a cell. */
function cells(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  const result = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      current += "\\|";
      index++;
    } else if (char === "|") {
      result.push(current.trim());
      current = "";
    } else current += char;
  }
  result.push(current.trim());
  return result;
}

const isTableSeparator = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
const listItem = /^(\s*)(?:([-*])|(\d+)[.)])\s+(.*)$/;

/**
 * Renders Markdown to HTML. Returns the first `# ` heading as `title`, and
 * the rest as `body`, one block per line group, indented by `indent`.
 * HTML comments are dropped first.
 */
export function renderMarkdown(markdown, indent = "") {
  const lines = markdown.replace(/\r\n?/g, "\n").replace(/<!--[^]*?-->/g, "").split("\n");
  const blocks = [];
  const ids = new Map();
  let title;
  let index = 0;
  const blank = (line) => line === undefined || line.trim() === "";
  const anchor = (text) => {
    const base = slug(text);
    const count = (ids.get(base) ?? 0) + 1;
    ids.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };

  while (index < lines.length) {
    const line = lines[index];
    if (blank(line)) {
      index++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      index++;
      const level = heading[1].length;
      if (level === 1 && title === undefined) {
        title = heading[2];
        continue;
      }
      const html = inline(heading[2]);
      blocks.push(`<h${level} id="${anchor(html)}">${html}</h${level}>`);
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push("<hr>");
      index++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted = [];
      while (index < lines.length && /^\s*>/.test(lines[index]))
        quoted.push(lines[index++].replace(/^\s*>\s?/, ""));
      const inner = renderMarkdown(quoted.join("\n")).body;
      blocks.push(`<blockquote class="notice">\n${inner.replace(/^/gm, "  ")}\n</blockquote>`);
      continue;
    }
    if (/^\s*\|/.test(line) && isTableSeparator(lines[index + 1] ?? "")) {
      const head = cells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && /^\s*\|/.test(lines[index])) rows.push(cells(lines[index++]));
      const headings = head.map(inline);
      const body = rows.map((row) => {
        const [first, ...rest] = row;
        return `    <tr><th scope="row">${inline(first ?? "")}</th>${rest
          .map((cell, column) => `<td data-label="${escapeHtml(headings[column + 1] ? head[column + 1] : "")}">${inline(cell)}</td>`)
          .join("")}</tr>`;
      });
      blocks.push(
        [
          '<div class="table-frame">',
          '<table class="doc-table">',
          "  <thead>",
          `    <tr>${headings.map((cell) => `<th scope="col">${cell}</th>`).join("")}</tr>`,
          "  </thead>",
          "  <tbody>",
          ...body,
          "  </tbody>",
          "</table>",
          "</div>",
        ].join("\n"),
      );
      continue;
    }
    const item = listItem.exec(line);
    if (item) {
      const ordered = item[3] !== undefined;
      const items = [];
      while (index < lines.length) {
        const match = listItem.exec(lines[index]);
        if (match && (match[3] !== undefined) === ordered && match[1].length < 2) {
          items.push([match[4].trim()]);
          index++;
        } else if (items.length && !blank(lines[index]) && /^\s{2,}\S/.test(lines[index])) {
          items.at(-1).push(lines[index++].trim());
        } else break;
      }
      const tag = ordered ? "ol" : "ul";
      const rendered = items.map((parts) => {
        const text = parts.join(" ").replace(/^\[[ xX]\]\s+/, "");
        return `  <li>${inline(text)}</li>`;
      });
      blocks.push(`<${tag}>\n${rendered.join("\n")}\n</${tag}>`);
      continue;
    }
    const paragraph = [];
    while (
      index < lines.length &&
      !blank(lines[index]) &&
      !/^(#{1,6}\s|\s*>|\s*(?:-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[index]) &&
      !(paragraph.length && listItem.test(lines[index]))
    )
      paragraph.push(lines[index++].trim());
    blocks.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  const body = blocks.join("\n").replace(/^(?=.)/gm, indent);
  return { title, body };
}

// ---------------------------------------------------------------------------
// Pages

/**
 * The whole page for one document, with empty generated regions. The frame
 * (head, header, footer) matches the site's other pages.
 */
export function renderPage(doc, markdown) {
  const { title, body } = renderMarkdown(markdown, "            ");
  if (!title) throw new Error(`${doc.source}: the document has no "# " title.`);
  const name = title.replace(/^BELL PR /, "");
  const pageTitle = `${name}: BELL PR`;
  const lead = escapeHtml(doc.lead);
  const footerLinks = documents
    .map((other) => `              <li><a href="${other.page}"${other === doc ? ' aria-current="page"' : ""}>${escapeHtml(other.nav)}</a></li>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${lead}">
    <meta name="theme-color" content="#1f6d50">
    <link rel="icon" href="../assets/brand/favicon.svg" type="image/svg+xml">
    <link rel="icon" href="../assets/brand/favicon-32.png" sizes="32x32" type="image/png">
    <link rel="apple-touch-icon" href="../assets/brand/apple-touch-icon.png">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="BELL PR">
    <meta property="og:title" content="${escapeHtml(pageTitle)}">
    <meta property="og:description" content="${lead}">
    <!-- generated:product-meta key=homepageUrl property="og:url" path="legal/${doc.page}" -->
    <!-- /generated:product-meta -->
    <!-- generated:product-meta key=homepageUrl property="og:image" path="assets/brand/og-image.png" -->
    <!-- /generated:product-meta -->
    <meta property="og:image" content="../assets/brand/og-image.png">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="stylesheet" href="../site.css">
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="wrap">
        <a class="brand" href="../index.html"><img src="../assets/brand/logo-wordmark.svg" alt="BELL PR" width="104" height="34"></a>
        <nav class="site-nav" aria-label="Main">
          <ul>
            <li><a href="../index.html#how-it-works">How it works</a></li>
            <li><a href="../pricing.html">Pricing</a></li>
            <li><a href="../install.html">Install</a></li>
          </ul>
        </nav>
      </div>
    </header>

    <main id="main">
      <section class="page-head">
        <div class="wrap">
          <p class="eyebrow">Legal</p>
          <h1>${inline(name)}</h1>
          <p class="lead">${lead}</p>
          <p class="doc-source">This page shows <code>${escapeHtml(doc.source)}</code>, which ships with BELL PR.</p>
        </div>
      </section>

      <section class="section section-tinted">
        <div class="wrap">
          <article class="prose legal">
${body}
          </article>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="wrap">
        <div class="footer-grid">
          <div class="footer-brand"><img src="../assets/brand/logo-wordmark.svg" alt="BELL PR" width="92" height="30"></div>
          <nav class="footer-col" aria-labelledby="footer-product">
            <h2 id="footer-product">Product</h2>
            <ul>
              <li><a href="../index.html#how-it-works">How it works</a></li>
              <li><a href="../pricing.html">Pricing</a></li>
              <li><a href="../install.html">Install</a></li>
            </ul>
          </nav>
          <nav class="footer-col" aria-labelledby="footer-legal">
            <h2 id="footer-legal">Legal</h2>
            <ul>
${footerLinks}
            </ul>
          </nav>
          <div class="footer-col">
            <h2>Contact</h2>
            <ul>
              <li><!-- generated:product-link key=supportEmail text="Support" --><!-- /generated:product-link --></li>
              <li><!-- generated:product-link key=securityEmail text="Report a vulnerability" --><!-- /generated:product-link --></li>
              <li><!-- generated:product-link key=publicRepoUrl path=issues text="Report an issue" --><!-- /generated:product-link --></li>
              <li><!-- generated:product-link key=docsUrl text="Documentation" --><!-- /generated:product-link --></li>
            </ul>
          </div>
        </div>
        <p class="disclaimer">BELL PR is an independent product and is not affiliated with, endorsed by, or sponsored by GitHub, Inc., OpenAI, or Anthropic PBC. GitHub, OpenAI, Codex, Anthropic, Claude and Claude Code are trademarks of their respective owners; BELL PR names them only to say which tools it works with.</p>
      </div>
    </footer>
  </body>
</html>
`;
}

const regionPattern = /(<!--\s*generated:([^\s>]*)[^]*?-->)([^]*?)(<!--\s*\/generated:\2\s*-->)/g;

/** The page with the content of every generated region removed. */
export const withoutRegionContent = (html) => html.replace(regionPattern, "$1$4");

/**
 * Puts the content that `previous` holds in its generated regions back into
 * `next`, region by region, when the opening comments match.
 */
export function keepRegionContent(next, previous) {
  if (!previous) return next;
  const contents = new Map();
  for (const match of previous.matchAll(regionPattern)) {
    const key = match[1];
    if (!contents.has(key)) contents.set(key, []);
    contents.get(key).push(match[3]);
  }
  return next.replace(regionPattern, (whole, open, _kind, content, close) => {
    const kept = contents.get(open)?.shift();
    return kept === undefined ? whole : `${open}${kept}${close}`;
  });
}

const read = (root, file) => fs.readFileSync(path.join(root, file), "utf8");
const readIfPresent = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined);

/** Writes every page; returns the pages that changed. */
export function writePages(root = defaultRoot) {
  const changed = [];
  fs.mkdirSync(path.join(root, legalDirectory), { recursive: true });
  for (const doc of documents) {
    const target = path.join(root, legalDirectory, doc.page);
    const previous = readIfPresent(target);
    const next = keepRegionContent(renderPage(doc, read(root, doc.source)), previous);
    if (next !== previous) {
      fs.writeFileSync(target, next);
      changed.push(`${legalDirectory}/${doc.page}`);
    }
  }
  return changed;
}

/** Problems with the pages: missing, stale or unexpected. */
export function checkPages(root = defaultRoot) {
  const problems = [];
  for (const doc of documents) {
    const target = `${legalDirectory}/${doc.page}`;
    const current = readIfPresent(path.join(root, target));
    if (current === undefined) problems.push(`${target}: missing; run node site/build-legal.mjs`);
    else if (withoutRegionContent(current) !== withoutRegionContent(renderPage(doc, read(root, doc.source))))
      problems.push(`${target}: not the current rendering of ${doc.source}; run node site/build-legal.mjs`);
  }
  const directory = path.join(root, legalDirectory);
  const known = new Set(documents.map((doc) => doc.page));
  for (const name of fs.existsSync(directory) ? fs.readdirSync(directory) : [])
    if (!known.has(name)) problems.push(`${legalDirectory}/${name}: no legal document renders to this file`);
  return problems;
}

// ---------------------------------------------------------------------------
// Placeholders and claims

/** Problems with a document's owner placeholders, and leftover TODO or TBD. */
export function checkPlaceholders(name, text) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Owner placeholders\s*$/.test(line));
  let listed = 0;
  if (start >= 0) {
    for (let index = start + 1; index < lines.length && !/^-{3,}\s*$/.test(lines[index]); index++)
      if (/^- \[[ xX]\] /.test(lines[index])) listed++;
  }
  const placeholderLines = lines.filter((line) => line.includes("[OWNER"));
  const occurrences = (text.match(/\[OWNER/g) ?? []).length;
  if (placeholderLines.length !== listed)
    problems.push(
      `${name}: ${placeholderLines.length} line(s) hold an [OWNER placeholder, but the owner placeholder list has ${listed} item(s)`,
    );
  if (occurrences !== placeholderLines.length)
    problems.push(`${name}: a line holds more than one [OWNER placeholder; give each its own line so grep -c counts it`);
  lines.forEach((line, index) => {
    if (/\b(?:TODO|TBD)\b/.test(line)) problems.push(`${name}:${index + 1}: unresolved TODO or TBD`);
  });
  return problems;
}

const claimPattern = /<!--\s*claim:([A-Z]+-\d+)\s*-->/g;
const pathLinePattern =
  /(?<![\w./-])((?:(?:server|src|shared|scripts|tools|bin|e2e|test|site|docs|public|marketing)\/[\w./-]+)|[A-Za-z_][\w-]*(?:\.[\w-]+)*\.(?:md|json|ts|tsx|mjs|js|yml|yaml)|Dockerfile):(\d+)(?:-(\d+))?/g;

/** The claim IDs a document marks, in order. */
export const claimIds = (text) => [...text.matchAll(claimPattern)].map((match) => match[1]);

/** Rows of the review tables: `| ID | claim | evidence |`. */
export function reviewRows(text) {
  const rows = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const match = /^\|\s*([A-Z]+-\d+)\s*\|(.*)\|\s*$/.exec(line);
    if (!match) return;
    const parts = cells(line);
    rows.push({ id: match[1], evidence: parts.at(-1) ?? "", line: index + 1 });
  });
  return rows;
}

/**
 * Problems between the documents' claims and the review table. `texts` maps
 * each document's file name to its text; `exists(file)` and `lineCount(file)`
 * answer for the repository.
 */
export function checkClaims(texts, review, { exists, lineCount }) {
  const problems = [];
  const seen = new Map();
  for (const doc of documents) {
    const text = texts[doc.source];
    if (text === undefined) continue;
    for (const match of text.matchAll(/<!--\s*claim\b[^]*?-->/g))
      if (!new RegExp(claimPattern.source).test(match[0]))
        problems.push(`${doc.source}: malformed claim marker ${match[0]}`);
    for (const id of claimIds(text)) {
      if (!id.startsWith(`${doc.prefix}-`)) problems.push(`${doc.source}: claim ${id} should start with ${doc.prefix}-`);
      if (seen.has(id)) problems.push(`${doc.source}: claim ${id} is repeated (also in ${seen.get(id)})`);
      else seen.set(id, doc.source);
    }
  }
  const rows = reviewRows(review);
  const rowIds = new Map();
  for (const row of rows) {
    if (rowIds.has(row.id)) problems.push(`${reviewFile}:${row.line}: row ${row.id} is repeated (line ${rowIds.get(row.id)})`);
    else rowIds.set(row.id, row.line);
    if (!seen.has(row.id)) problems.push(`${reviewFile}:${row.line}: row ${row.id} matches no claim in the legal documents`);
    const references = [...row.evidence.matchAll(pathLinePattern)];
    if (!/owner decision/i.test(row.evidence) && references.length === 0)
      problems.push(`${reviewFile}:${row.line}: row ${row.id} names neither code (path:line) nor an owner decision`);
  }
  for (const [id, source] of seen)
    if (!rowIds.has(id)) problems.push(`${source}: claim ${id} has no row in ${reviewFile}`);
  review.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(pathLinePattern)) {
      const [reference, file, from, to] = match;
      const where = `${reviewFile}:${index + 1}`;
      if (!exists(file)) {
        problems.push(`${where}: ${reference} names a file that does not exist`);
        continue;
      }
      const last = Number(to ?? from);
      if (Number(from) < 1 || last > lineCount(file))
        problems.push(`${where}: ${reference} is past the end of ${file} (${lineCount(file)} lines)`);
    }
  });
  return problems;
}

/** Every legal check: pages, placeholders and claims. */
export function checkLegal(root = defaultRoot) {
  const texts = Object.fromEntries(documents.map((doc) => [doc.source, read(root, doc.source)]));
  const lineCounts = new Map();
  const problems = [
    ...checkPages(root),
    ...documents.flatMap((doc) => checkPlaceholders(doc.source, texts[doc.source])),
    ...checkClaims(texts, read(root, reviewFile), {
      exists: (file) => fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile(),
      lineCount: (file) => {
        if (!lineCounts.has(file)) lineCounts.set(file, read(root, file).replace(/\n$/, "").split("\n").length);
        return lineCounts.get(file);
      },
    }),
  ];
  const claims = documents.reduce((total, doc) => total + claimIds(texts[doc.source]).length, 0);
  return { problems, claims };
}

// ---------------------------------------------------------------------------
// Self-test

function selfTest() {
  // Inline Markdown.
  assert.equal(inline("**Grant.** A `LICENSE.md` key"), '<strong>Grant.</strong> A <a href="eula.html"><code>LICENSE.md</code></a> key');
  assert.equal(inline("Use `<b>` & *this*"), "Use <code>&lt;b&gt;</code> &amp; <em>this</em>");
  assert.equal(inline("to [OWNER: provider], which"), 'to <span class="owner">[OWNER: provider]</span>, which');
  assert.equal(inline("A \\| B \\<c\\> \\*x\\*"), "A | B &lt;c&gt; *x*");
  assert.equal(inline("see [the docs](https://example.test/a?b=1&c=2)"), 'see <a href="https://example.test/a?b=1&amp;c=2">the docs</a>');
  assert.equal(inline("`state.json.bak.1` to `.bak.3`"), "<code>state.json.bak.1</code> to <code>.bak.3</code>");
  assert.equal(slug("4. Pro License"), "4-pro-license");

  // Blocks.
  const markdown = [
    "# BELL PR Fixture Policy",
    "",
    "> **DRAFT, pending counsel review.** Not in",
    "> force.",
    "",
    "EULA version: 1.0",
    "",
    "## Owner placeholders",
    "",
    "- [ ] **Seller** (Who we are): the seller's name.",
    "- [ ] **Contact**: an address,",
    "  continued.",
    "",
    "---",
    "",
    "## Who we are",
    "",
    "[OWNER: seller] makes it. <!-- claim:PRIV-01 -->",
    "Second line of the paragraph.",
    "",
    "| Item | What it holds |",
    "| --- | --- |",
    "| `a.json` | One \\| two |",
    "",
    "<!-- claim:PRIV-02 -->",
    "",
    "1. First",
    "2. Second",
    "",
    "## Who we are",
    "",
  ].join("\n");
  const { title, body } = renderMarkdown(markdown);
  assert.equal(title, "BELL PR Fixture Policy");
  assert.ok(body.includes('<blockquote class="notice">\n  <p><strong>DRAFT, pending counsel review.</strong> Not in force.</p>\n</blockquote>'));
  assert.ok(body.includes("<p>EULA version: 1.0</p>"));
  assert.ok(body.includes('<h2 id="owner-placeholders">Owner placeholders</h2>'));
  assert.ok(body.includes("<li><strong>Contact</strong>: an address, continued.</li>"), "a task list item keeps its continuation");
  assert.ok(body.includes("<hr>"));
  assert.ok(body.includes('<p><span class="owner">[OWNER: seller]</span> makes it. Second line of the paragraph.</p>'));
  assert.ok(!body.includes("claim:"), "comments are dropped");
  assert.ok(body.includes('<tr><th scope="row"><code>a.json</code></th><td data-label="What it holds">One | two</td></tr>'));
  assert.ok(body.includes("<ol>\n  <li>First</li>\n  <li>Second</li>\n</ol>"));
  assert.ok(body.includes('<h2 id="who-we-are-2">'), "repeated headings get distinct anchors");

  // Pages and generated regions.
  const doc = documents[1];
  const page = renderPage(doc, markdown);
  assert.ok(page.includes("<title>Fixture Policy: BELL PR</title>"));
  assert.ok(page.includes('<li><a href="privacy.html" aria-current="page">Privacy</a></li>'));
  assert.ok(page.includes('path="legal/privacy.html" -->\n    <!-- /generated:product-meta -->'));
  const filled = page.replace(
    '<!-- generated:product-link key=supportEmail text="Support" --><!-- /generated:product-link -->',
    '<!-- generated:product-link key=supportEmail text="Support" --><a href="mailto:help@example.test">Support</a><!-- /generated:product-link -->',
  );
  assert.notEqual(filled, page);
  assert.equal(keepRegionContent(page, filled), filled, "a rebuild keeps what the region script wrote");
  assert.equal(withoutRegionContent(filled), withoutRegionContent(page), "the check ignores region content");
  assert.equal(keepRegionContent(page, undefined), page);

  // Placeholders.
  const list = (items, text) => ["## Owner placeholders", "", ...items, "", "---", "", text].join("\n");
  assert.deepEqual(checkPlaceholders("x.md", list(["- [ ] **A**: a.", "- [ ] **B**: b."], "[OWNER: a] and\n[OWNER: b].")), []);
  assert.match(checkPlaceholders("x.md", list(["- [ ] **A**: a."], "[OWNER: a] and\n[OWNER: b]."))[0], /2 line\(s\).*1 item/);
  assert.match(checkPlaceholders("x.md", list(["- [ ] **A**: a.", "- [ ] **B**: b."], "[OWNER: a] and [OWNER: b]."))[0], /1 line\(s\).*2 item/);
  assert.match(checkPlaceholders("x.md", list([], "Fix this TODO later.")).join("\n"), /x\.md:6: unresolved TODO/);
  assert.match(checkPlaceholders("x.md", list([], "Price TBD.")).join("\n"), /unresolved TODO or TBD/);

  // Claims against the review table.
  const files = new Map([["server/a.ts", 10], ["Dockerfile", 3]]);
  const repo = { exists: (file) => files.has(file), lineCount: (file) => files.get(file) };
  const texts = {
    "LICENSE.md": "One. <!-- claim:EULA-01 --> Two. <!-- claim:EULA-02 -->",
    "PRIVACY.md": "Three. <!-- claim:PRIV-01 -->",
  };
  const table = (...rows) => ["| ID | Claim | Evidence |", "| --- | --- | --- |", ...rows].join("\n");
  const good = table(
    "| EULA-01 | One | `server/a.ts:4` |",
    "| EULA-02 | Two | Owner decision: counsel |",
    "| PRIV-01 | Three | `Dockerfile:3`, `server/a.ts:2-10` |",
  );
  assert.deepEqual(checkClaims(texts, good, repo), []);
  const problems = (review, docTexts = texts) => checkClaims(docTexts, review, repo).join("\n");
  assert.match(problems(table("| EULA-01 | One | `server/a.ts:4` |", "| PRIV-01 | Three | owner decision |")), /LICENSE\.md: claim EULA-02 has no row/);
  assert.match(problems(`${good}\n| EULA-09 | Nine | owner decision |`), /row EULA-09 matches no claim/);
  assert.match(problems(`${good}\n| EULA-01 | Again | owner decision |`), /row EULA-01 is repeated/);
  assert.match(problems(good.replace("Owner decision: counsel", "Counsel will look")), /row EULA-02 names neither code/);
  assert.match(problems(good.replace("server/a.ts:4", "server/b.ts:4")), /server\/b\.ts:4 names a file that does not exist/);
  assert.match(problems(good.replace("server/a.ts:2-10", "server/a.ts:2-11")), /server\/a\.ts:2-11 is past the end of server\/a\.ts \(10 lines\)/);
  assert.match(problems(good, { ...texts, "PRIVACY.md": "Three. <!-- claim:EULA-01 -->" }), /claim EULA-01 should start with PRIV-.*\n.*EULA-01 is repeated/);
  assert.match(problems(good, { ...texts, "PRIVACY.md": `${texts["PRIVACY.md"]} <!-- claim: priv 2 -->` }), /malformed claim marker/);

  // The command line, on a fixture tree in a temporary directory.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bellpr-legal-"));
  try {
    const write = (file, text) => {
      fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true });
      fs.writeFileSync(path.join(temp, file), text);
    };
    const owner = (text) => list(["- [ ] **A**: a."], `${text}\n[OWNER: a]`);
    documents.forEach((item, index) =>
      write(item.source, `# BELL PR Doc ${index}\n\n${owner(`Claim. <!-- claim:${item.prefix}-01 -->`)}\n`),
    );
    write("server/a.ts", "one\ntwo\n");
    write(reviewFile, table(...documents.map((item) => `| ${item.prefix}-01 | Claim | \`server/a.ts:2\` |`)));
    const quiet = { log() {}, error() {} };
    assert.equal(main(["--check"], { root: temp, ...quiet }), 1, "pages are missing at first");
    assert.equal(main([], { root: temp, ...quiet }), 0);
    assert.equal(main(["--check"], { root: temp, ...quiet }), 0);
    assert.ok(fs.readFileSync(path.join(temp, "site/legal/eula.html"), "utf8").includes("<h1>Doc 0</h1>"));
    write("TERMS.md", fs.readFileSync(path.join(temp, "TERMS.md"), "utf8").replace("Claim.", "Changed claim."));
    assert.equal(main(["--check"], { root: temp, ...quiet }), 1, "an edited document makes its page stale");
    assert.equal(main(["--write"], { root: temp, ...quiet }), 0);
    assert.equal(main(["--check"], { root: temp, ...quiet }), 0);
    write("site/legal/old.html", "<p>old</p>");
    assert.equal(main(["--check"], { root: temp, ...quiet }), 1, "a page without a document is reported");
    assert.equal(main(["--fix"], { root: temp, ...quiet }), 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log("build-legal self-test: ok");
  return 0;
}

// ---------------------------------------------------------------------------
// Command line

export function main(args, options = {}) {
  const root = options.root ?? defaultRoot;
  const log = options.log ?? ((line) => console.log(line));
  const error = options.error ?? ((line) => console.error(line));
  const [mode = "--write", ...rest] = args;
  if (rest.length || !["--write", "--check", "--self-test"].includes(mode)) {
    error("Usage: node site/build-legal.mjs [--write | --check | --self-test]");
    return 2;
  }
  if (mode === "--self-test") return selfTest();
  if (mode === "--write") {
    const changed = writePages(root);
    for (const file of changed) log(`updated ${file}`);
    error(`build-legal: ${documents.length} page(s), ${changed.length} updated.`);
    return 0;
  }
  const { problems, claims } = checkLegal(root);
  for (const problem of problems) log(problem);
  error(
    problems.length
      ? `build-legal: ${problems.length} problem(s).`
      : `build-legal: ${documents.length} pages are current, and ${claims} claims match ${reviewFile}.`,
  );
  return problems.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (caught) {
    if (caught instanceof assert.AssertionError) {
      console.error(`build-legal self-test failed:\n${caught.message}`);
      process.exitCode = 1;
    } else {
      console.error(caught);
      process.exitCode = 2;
    }
  }
}
