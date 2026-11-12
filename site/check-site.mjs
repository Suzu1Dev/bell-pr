#!/usr/bin/env node
/**
 * Checks the landing site. Development only; it is not part of the site.
 *
 *   node site/check-site.mjs                      static checks
 *   node site/check-site.mjs --browser [options]  static checks, then each page in Chromium
 *
 * Static checks, on every .html file:
 * - every <a href> resolves to an existing file (and #fragment id) or sits
 *   inside a generated product-link region. A link to another site must be
 *   named in site/README.md;
 * - every resource (stylesheet, script, image and srcset, Open Graph image,
 *   CSS url()) is a relative path to an existing file. Nothing may come
 *   from another origin;
 * - no inline <script>, style="" or on*="" attribute, so a strict Content
 *   Security Policy can apply, and every page declares one;
 * - every image in assets/screenshots/ is a byte-identical copy of the one
 *   in docs/images/en/;
 * - the site's files total at most 5 MB;
 * - on each zh-tw page, visible text and the translatable attributes and
 *   meta text below are checked. Text inside code, pre or kbd is skipped.
 *   After the kept English names in this file are removed, any remaining
 *   Latin letter fails, whether or not the English page has that string.
 *   A language-switch link with lang="en" or hreflang="en" keeps the
 *   English autonym and is not checked.
 *   A CJK character and a Latin letter or digit also need a space between
 *   them (tags in between do not count; full-width punctuation does not
 *   need a space). In site.js the zh side of `isZh ? zh : en` must not be
 *   English.
 *
 * Browser checks (--browser), with the pages served from a static server on
 * 127.0.0.1, at 1440 x 900, 390 x 844 and 320 x 740:
 * - no horizontal scroll (scrollWidth === clientWidth), and no text that is
 *   cut off or runs out of its box, FAQ answers opened (the rules of
 *   e2e/helpers/overflow.ts);
 * - no request outside the local server, no failed request, and no console
 *   error;
 * - the self-hosted DM Sans font is loaded, and every image decodes (lazy
 *   images are loaded first);
 * - installer tabs support clicks and keyboard navigation, copy whole
 *   commands, and select text if copying fails; all commands remain readable
 *   without JavaScript.
 *
 * Options: --port <n> (default: a free port), --screenshots <dir>
 * (full-page PNGs for review).
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE, when set, picks the Chromium build.
 *
 * Exit status: 0 when every check passes, 1 when one fails, 2 on a usage
 * or setup error.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publishedInstallVersion } from "../scripts/published-version.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
/** CHECK_SITE_DIR points the static checks at a copy of site/, for tests. */
const siteDir = process.env.CHECK_SITE_DIR ? path.resolve(process.env.CHECK_SITE_DIR) : scriptDir;
const repoDir = path.dirname(scriptDir);
const readme = fs.readFileSync(path.join(siteDir, "README.md"), "utf8");
/** The site's size budget. */
const maxSiteBytes = 5 * 1024 * 1024;
const widths = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 740 },
];

/** Every .html file of the site, relative to site/. */
function pages(dir = siteDir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return pages(full);
      return entry.name.endsWith(".html") ? [path.relative(siteDir, full)] : [];
    })
    .sort();
}

/** Offset ranges of generated product-link regions; links inside them are generated. */
function generatedRanges(html) {
  const ranges = [];
  const pattern = /<!--\s*generated:product-link\b[^]*?-->([^]*?)<!--\s*\/generated:product-link\s*-->/g;
  for (const match of html.matchAll(pattern)) ranges.push([match.index, match.index + match[0].length]);
  return ranges;
}

const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const listedInReadme = (value) => readme.includes(value);

/**
 * Names that stay English on zh-tw pages. Longest first, so "Claude Code"
 * is removed before "Claude" and "BELL PR" before "BELL". A checked string
 * fails when any Latin letter remains after these are removed.
 * "macOS · Linux" passes. "Deploy now" does not.
 *
 * Brand, product and tool names, plus terms the Traditional Chinese pages
 * keep on purpose: issue, pull request, repository, diff, vibe coding,
 * Draft PR, Agent (capitalized), the role names, CLI, API and AI.
 */
const keptInEnglish = [
  "Apache License",
  "BELL PR Group",
  "Claude Code",
  "Antigravity",
  "PowerShell",
  "Homebrew",
  "Node.js",
  "Google Cloud",
  "vibe coding",
  "git worktree",
  "pull request",
  "Pull request",
  "Draft PR",
  "Test analyst",
  "bubblewrap",
  "repository",
  "Teammates",
  "teammates",
  "teammate",
  "BELL PR",
  "bell-pr",
  "worktree",
  "GitHub",
  "OpenAI",
  "Anthropic",
  "Reviewer",
  "Gemini",
  "Google",
  "Claude",
  "Codex",
  "Docker",
  "Ubuntu",
  "Debian",
  "macOS",
  "Linux",
  "Windows",
  "Group",
  "issue",
  "Shell",
  "WSL2",
  "Draft",
  "WSL",
  "Apache",
  "Agent",
  "diff",
  "PATH",
  "npm",
  "npx",
  "mise",
  "Markdown",
  "socat",
  "sudo",
  "beta",
  "Bun",
  "bun",
  "curl",
  "brew",
  "ps1",
  "Git",
  "BELL",
  "Lead",
  "CLI",
  "API",
  "Inc.",
  "LLC",
  "PBC",
  "PR",
  "AI",
].sort((a, b) => b.length - a.length);

const skipTextTags = new Set(["script", "style", "code", "pre", "kbd", "title"]);
const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Visible text nodes, excluding code, pre and kbd. Whitespace is collapsed.
 * `unclosed` names a skip tag still open at the end; text after it was not checked.
 */
/** A language-switch link written in English (`lang="en"` or `hreflang="en"`). */
function englishSwitch(raw) {
  const lang = raw.match(/\slang="([^"]*)"/i)?.[1] ?? "";
  const hrefLang = raw.match(/\shreflang="([^"]*)"/i)?.[1] ?? "";
  return /^en\b/i.test(lang) || /^en\b/i.test(hrefLang);
}

function visibleTextNodes(html) {
  const nodes = [];
  const stack = [];
  let unclosed;
  let index = 0;
  while (index < html.length) {
    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[index] === "<") {
      const end = html.indexOf(">", index);
      const raw = html.slice(index + 1, end === -1 ? html.length : end);
      index = end === -1 ? html.length : end + 1;
      if (raw.startsWith("/") || raw.startsWith("!") || raw.startsWith("?")) {
        if (raw.startsWith("/")) {
          const name = raw.slice(1).trim().split(/\s/)[0].toLowerCase();
          for (let at = stack.length - 1; at >= 0; at -= 1) {
            if (stack[at].tag === name) {
              // A parent close must not hide a skip tag that was never closed.
              unclosed ??= stack.slice(at + 1).find((frame) => skipTextTags.has(frame.tag))?.tag;
              stack.splice(at);
              break;
            }
          }
        }
        continue;
      }
      const tag = raw.split(/[\s/>]/)[0].toLowerCase();
      if (!raw.endsWith("/") && !voidTags.has(tag)) {
        const inherited = stack.at(-1)?.english ?? false;
        stack.push({ tag, english: inherited || englishSwitch(raw) });
      }
      continue;
    }
    const end = html.indexOf("<", index);
    const raw = html.slice(index, end === -1 ? html.length : end);
    index = end === -1 ? html.length : end;
    if (stack.some((frame) => skipTextTags.has(frame.tag) || frame.english)) continue;
    const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
    if (text) nodes.push(text);
  }
  return { texts: nodes, unclosed: unclosed ?? stack.find((frame) => skipTextTags.has(frame.tag))?.tag };
}

/** True when `text` is only kept names, separators and digits. */
function onlyKeptNames(text) {
  let rest = text;
  for (const name of keptInEnglish) rest = rest.split(name).join(" ");
  return !/[A-Za-z]/.test(rest);
}

const metaNames = new Set(["description", "og:title", "og:description", "twitter:title", "twitter:description"]);

/** Visible text, plus alt, title, aria-label, placeholder, label, the document title and description metas. */
function translatableStrings(html) {
  const { texts, unclosed } = visibleTextNodes(html);
  const found = texts.map((text) => ["text", text]);
  const title = /<title>([^<]*)<\/title>/i.exec(html);
  if (title) {
    const text = decodeEntities(title[1]).replace(/\s+/g, " ").trim();
    if (text) found.push(["title", text]);
  }
  const attr = (raw, name) => {
    const match = raw.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
    return match?.slice(1).find((part) => part !== undefined);
  };
  for (const match of html.matchAll(/<(?:meta|[a-z0-9]+)\b([^>]*)>/gi)) {
    const raw = match[1];
    for (const name of ["alt", "title", "aria-label", "placeholder", "label"]) {
      const text = attr(raw, name);
      if (text === undefined) continue;
      const normalized = decodeEntities(text).replace(/\s+/g, " ").trim();
      if (normalized) found.push([name, normalized]);
    }
    const meta = attr(raw, "name") || attr(raw, "property");
    const content = attr(raw, "content");
    if (meta && content && metaNames.has(meta)) {
      const normalized = decodeEntities(content).replace(/\s+/g, " ").trim();
      if (normalized) found.push([meta, normalized]);
    }
  }
  return { found, unclosed };
}

const isCjk = (ch) => /\p{Script=Han}/u.test(ch);
const isLatinOrDigit = (ch) => /[A-Za-z0-9]/u.test(ch);
/** A new block starts a new run of text, so a heading is not glued to the next paragraph. */
const blockTags = new Set([
  "address", "article", "aside", "blockquote", "body", "br", "dd", "details", "div", "dl", "dt",
  "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li",
  "main", "nav", "ol", "p", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

/**
 * Visible characters in order. Inline tags are ignored, so a boundary can sit
 * on either side of them. A block tag inserts a space. script and style are
 * omitted. code, pre and kbd stay, because the space rule is about what a
 * reader sees.
 */
function visibleFlow(html) {
  let flow = "";
  const stack = [];
  const skip = new Set(["script", "style"]);
  let index = 0;
  while (index < html.length) {
    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[index] === "<") {
      const end = html.indexOf(">", index);
      const raw = html.slice(index + 1, end === -1 ? html.length : end);
      index = end === -1 ? html.length : end + 1;
      if (raw.startsWith("/") || raw.startsWith("!") || raw.startsWith("?")) {
        if (raw.startsWith("/")) {
          const name = raw.slice(1).trim().split(/\s/)[0].toLowerCase();
          for (let at = stack.length - 1; at >= 0; at -= 1) {
            if (stack[at] === name) {
              stack.splice(at);
              break;
            }
          }
        }
        continue;
      }
      const tag = raw.split(/[\s/>]/)[0].toLowerCase();
      if (blockTags.has(tag)) flow += " ";
      if (!raw.endsWith("/") && !voidTags.has(tag)) stack.push(tag);
      continue;
    }
    const end = html.indexOf("<", index);
    const raw = html.slice(index, end === -1 ? html.length : end);
    index = end === -1 ? html.length : end;
    if (stack.some((tag) => skip.has(tag))) continue;
    flow += decodeEntities(raw);
  }
  return flow;
}

/** CJK and a Latin letter or digit with nothing between them (inline tags do not count). */
function cjkLatinGaps(flow) {
  const gaps = [];
  const seen = new Set();
  const chars = [...flow];
  for (let i = 0; i < chars.length - 1; i += 1) {
    const left = chars[i];
    const right = chars[i + 1];
    if (!((isCjk(left) && isLatinOrDigit(right)) || (isLatinOrDigit(left) && isCjk(right)))) continue;
    const snippet = chars.slice(Math.max(0, i - 12), i + 14).join("").replace(/\s+/g, " ");
    if (seen.has(snippet)) continue;
    seen.add(snippet);
    gaps.push(snippet);
  }
  return gaps;
}

/** English left on a zh-tw page: Latin letters that are not kept names, and a missing space at a CJK/Latin boundary. */
function checkZhTw(problems) {
  for (const file of pages()) {
    if (!file.startsWith("zh-tw/") || !file.endsWith(".html")) continue;
    const english = file.slice("zh-tw/".length);
    if (!fs.existsSync(path.join(siteDir, english))) problems.push(`${file}: no English page at ${english}`);
    const html = fs.readFileSync(path.join(siteDir, file), "utf8");
    const zh = translatableStrings(html);
    if (zh.unclosed) problems.push(`${file}: <${zh.unclosed}> is never closed, so the text after it was not checked`);
    const seen = new Set();
    for (const [kind, text] of zh.found) {
      if (seen.has(text) || onlyKeptNames(text)) continue;
      seen.add(text);
      problems.push(`${file}: untranslated ${kind} "${text}"`);
    }
    const gaps = new Set(cjkLatinGaps(visibleFlow(html)));
    for (const [kind, text] of zh.found) {
      if (kind === "text") continue;
      for (const gap of cjkLatinGaps(text)) gaps.add(gap);
    }
    for (const gap of gaps) problems.push(`${file}: missing space "${gap}"`);
  }
}

/** User-facing copy in site.js is `isZh ? zh : en`. The two sides must both exist and differ. */
function checkSiteJs(problems) {
  const js = fs.readFileSync(path.join(siteDir, "site.js"), "utf8");
  const pattern = /isZh\s*\?\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g;
  const pairs = [...js.matchAll(pattern)];
  if (pairs.length === 0) problems.push("site.js: no isZh ? zh : en string");
  for (const match of pairs) {
    const zh = match[1] ?? match[2];
    const en = match[3] ?? match[4];
    if (zh === en) problems.push(`site.js: zh and en are the same "${zh}"`);
    else if (!onlyKeptNames(zh)) problems.push(`site.js: zh is still English "${zh}"`);
  }
  if (/textContent\s*=\s*["'][^"']+["']/.test(js)) problems.push("site.js: textContent is set from a string with no zh branch");
}

/** Every file under site/, relative to it. */
function siteFiles(dir = siteDir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return siteFiles(full);
    return [path.relative(siteDir, full)];
  });
}

function checkStatic() {
  const problems = [];
  const files = pages();
  const idCache = new Map();
  const idsOf = (file) => {
    if (!idCache.has(file)) idCache.set(file, ids(fs.readFileSync(path.join(siteDir, file), "utf8")));
    return idCache.get(file);
  };
  /** Resolves a relative reference from `file`; returns the site-relative path or an error. */
  const resolve = (file, value) => {
    const [target, fragment] = value.split("#");
    const resolved = target === "" ? file : path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
    if (resolved.startsWith("..")) return { error: "points outside site/" };
    return { resolved, fragment };
  };
  let links = 0;
  for (const file of files) {
    const html = fs.readFileSync(path.join(siteDir, file), "utf8");
    const where = (index) => `${file}:${html.slice(0, index).split("\n").length}`;
    const generated = generatedRanges(html);

    if (!/<meta http-equiv="Content-Security-Policy" content="default-src 'none';/.test(html))
      problems.push(`${file}: no Content-Security-Policy meta tag with default-src 'none'`);
    for (const match of html.matchAll(/<script\b(?![^>]*\ssrc=)[^>]*>/g))
      problems.push(`${where(match.index)}: inline <script>`);
    for (const match of html.matchAll(/<[^!>][^>]*\s(style|on[a-z]+)=/g))
      problems.push(`${where(match.index)}: inline ${match[1]} attribute`);

    // Links.
    for (const match of html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)) {
      links += 1;
      const value = match[1];
      if (generated.some(([from, to]) => match.index >= from && match.index < to)) continue;
      if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)) {
        if (!listedInReadme(value)) problems.push(`${where(match.index)}: external link ${value} is not listed in site/README.md`);
        continue;
      }
      const { resolved, fragment, error } = resolve(file, value);
      if (error) {
        problems.push(`${where(match.index)}: ${value} ${error}`);
        continue;
      }
      if (!fs.existsSync(path.join(siteDir, resolved))) {
        problems.push(`${where(match.index)}: ${value} does not exist`);
        continue;
      }
      if (fragment && resolved.endsWith(".html") && !idsOf(resolved).has(fragment))
        problems.push(`${where(match.index)}: ${value} has no element with id="${fragment}"`);
    }

    // Resources.
    const resources = [
      ...html.matchAll(/<(?:link|script|img|source|track)\b[^>]*\s(?:href|src)="([^"]*)"/g),
      ...html.matchAll(/<meta\s+property="og:image"\s+content="(?![a-z][a-z0-9+.-]*:|\/\/)([^"]*)"/gi),
      ...html.matchAll(/\sposter="([^"]*)"/g),
    ];
    for (const match of resources) checkResource(file, match[1], where(match.index));
    for (const match of html.matchAll(/\ssrcset="([^"]*)"/g))
      for (const candidate of match[1].split(","))
        checkResource(file, candidate.trim().split(/\s+/)[0], where(match.index));
  }

  // Screenshots are copies of the app's documentation images.
  const shots = path.join(siteDir, "assets", "screenshots");
  for (const name of fs.existsSync(shots) ? fs.readdirSync(shots) : []) {
    const original = path.join(repoDir, "docs", "images", "en", name);
    if (!fs.existsSync(original))
      problems.push(`assets/screenshots/${name}: docs/images/en/${name} does not exist`);
    else if (!fs.readFileSync(original).equals(fs.readFileSync(path.join(shots, name))))
      problems.push(
        `assets/screenshots/${name}: differs from docs/images/en/${name}; copy it again: cp docs/images/en/${name} site/assets/screenshots/`,
      );
  }

  // The size budget.
  const bytes = siteFiles()
    .filter((name) => !/\.(mp4|webm)$/i.test(name))
    .reduce((total, name) => total + fs.statSync(path.join(siteDir, name)).size, 0);
  if (bytes > maxSiteBytes) problems.push(`site/: ${bytes} bytes, over the ${maxSiteBytes}-byte budget`);

  checkZhTw(problems);
  checkSiteJs(problems);

  // Stylesheets may load fonts and images through url().
  for (const css of fs.readdirSync(siteDir).filter((name) => name.endsWith(".css"))) {
    const text = fs.readFileSync(path.join(siteDir, css), "utf8");
    for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g))
      checkResource(css, match[1], `${css}:${text.slice(0, match.index).split("\n").length}`);
  }

  function checkResource(file, value, where) {
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)) {
      // Absolute hreflang / social URLs may be listed in site/README.md.
      if (!listedInReadme(value)) problems.push(`${where}: ${value} loads from another origin`);
      return;
    }
    const { resolved, error } = resolve(file, value);
    if (error) problems.push(`${where}: ${value} ${error}`);
    else if (!fs.existsSync(path.join(siteDir, resolved))) {
      // Large promo binaries are deploy-only; see assets/video/README.md.
      if (/^assets\/video\/.*\.(mp4|webm)$/.test(resolved.replace(/\\/g, "/"))) return;
      problems.push(`${where}: ${value} does not exist`);
    }
  }

  for (const problem of problems) console.log(problem);
  console.error(
    problems.length === 0
      ? `check-site: ${files.length} pages and ${links} links are fine; ${(bytes / 1024 / 1024).toFixed(2)} MB.`
      : `check-site: ${problems.length} problem(s) in the static checks.`,
  );
  return { ok: problems.length === 0, files };
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".md": "text/markdown; charset=utf-8",
};

/**
 * Runs in the page: the text that is cut off or runs out of its box, by the
 * rules of findOverflow() in e2e/helpers/overflow.ts. Every <details> is
 * opened first, so the FAQ answers count. Text in a box that scrolls
 * sideways (code) and visually hidden text do not count.
 */
function findTextOverflow() {
  for (const details of document.querySelectorAll("details")) details.open = true;
  const scrollsSideways = (style) => style.overflowX === "auto" || style.overflowX === "scroll";
  const boxOf = (element) => {
    for (let box = element; box; box = box.parentElement) {
      const display = getComputedStyle(box).display;
      if (display !== "inline" && display !== "contents") return box;
    }
    return null;
  };
  const inSidewaysScroller = (element) => {
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement)
      if (scrollsSideways(getComputedStyle(parent)) && parent.scrollWidth > parent.clientWidth + 1) return true;
    return false;
  };
  const textOutside = (box, texts) => {
    const left = box.getBoundingClientRect().left + box.clientLeft;
    const right = left + box.clientWidth;
    const range = document.createRange();
    for (const text of texts) {
      range.selectNodeContents(text);
      for (const rect of range.getClientRects())
        if (rect.width > 0 && (rect.right > right + 1 || rect.left < left - 1)) return true;
    }
    return false;
  };
  const boxes = new Map();
  for (const element of document.body.querySelectorAll("*")) {
    const texts = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const box = texts.length ? boxOf(element) : null;
    if (!box) continue;
    if (!boxes.has(box)) boxes.set(box, []);
    boxes.get(box).push(...texts);
  }
  const problems = [];
  for (const [box, texts] of boxes) {
    const style = getComputedStyle(box);
    const rect = box.getBoundingClientRect();
    if (!box.checkVisibility({ visibilityProperty: true }) || rect.width <= 1 || rect.height <= 1) continue;
    if (scrollsSideways(style)) continue;
    const ellipsis = style.textOverflow === "ellipsis" && style.overflowX !== "visible";
    if (box.scrollWidth > box.clientWidth + 1 && !inSidewaysScroller(box) && (ellipsis || textOutside(box, texts))) {
      const name = [box.tagName.toLowerCase(), box.id ? `#${box.id}` : "", ...[...box.classList].map((c) => `.${c}`)].join("");
      problems.push(`${ellipsis ? "ellipsis" : "overflow"}: ${name} "${box.textContent.trim().replace(/\s+/g, " ").slice(0, 60)}"`);
    }
  }
  return problems;
}

/** A static file server for site/ on 127.0.0.1. */
function serve(port) {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let file = path.join(siteDir, path.normalize(pathname));
    if (file.endsWith(path.sep)) file = path.join(file, "index.html");
    const relative = path.relative(siteDir, file);
    const blocked = relative.startsWith("..");
    if (blocked || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function checkBrowser(files, { port, screenshots }) {
  const { chromium, expect } = await import("@playwright/test");
  const server = await serve(port);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  const problems = [];
  const methods = ["npx", "npm", "curl", "brew", "bun", "powershell", "mise"];
  const packageName = JSON.parse(fs.readFileSync(path.join(repoDir, "package.json"), "utf8")).name;
  async function checkInstaller(page, noScript = false) {
    const widget = page.locator("[data-install]");
    await expect(widget).toHaveCount(1);
    const toolbar = widget.locator("[data-install-tabs]");
    if (noScript) await expect(toolbar).toBeHidden();
    else {
      await expect(toolbar).toBeVisible();
      await expect(widget.getByRole("tab")).toHaveCount(methods.length);
      expect(await widget.getByRole("tab").evaluateAll((tabs) => tabs.map((tab) => tab.id))).toEqual(methods.map((method) => `install-tab-${method}`));
      await selected("npx");
    }
    const isZh = (await page.locator("html").getAttribute("lang")).startsWith("zh");
    async function selected(method) {
      await expect(widget.locator('[role="tabpanel"]:visible')).toHaveCount(1);
      await expect(widget.locator(`#install-panel-${method}`)).toBeVisible();
      await expect(widget.locator(`#install-tab-${method}`)).toHaveAttribute("aria-selected", "true");
      await expect(widget.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
      await expect(widget.locator(`#install-tab-${method}`)).toHaveAttribute("tabindex", "0");
      await expect(widget.locator("[data-install-platform]")).toHaveText(await widget.locator(`#install-panel-${method}`).getAttribute("data-platform"));
    }
    for (const method of methods) {
      const panel = widget.locator(`#install-panel-${method}`);
      const code = widget.locator(`#install-command-${method}`);
      if (!noScript) {
        await widget.locator(`#install-tab-${method}`).click();
        await selected(method);
      }
      await expect(panel).toBeVisible();
      await expect(code).toBeVisible();
      const command = (await code.textContent()).trim();
      expect(command, `${method} has a readable install command`).not.toBe("");
      if (method === "npx") expect(command).toBe(`npx ${packageName}`);
      if (method === "npm") expect(command).toBe(`npm install -g ${packageName}`);
      if (method === "bun") expect(command).toBe(`bun add --global ${packageName}`);
      if (method === "mise") expect(command).toBe(`MISE_NPM_PACKAGE_MANAGER=npm mise use -g node@24 npm:${packageName}@${publishedInstallVersion}`);
      if (method === "brew" || method === "powershell") expect(command).toContain("\n");
      if (!noScript) {
        const button = widget.locator(`button[data-copy="install-command-${method}"]`);
        await button.click();
        await expect(button).toHaveText(isZh ? "已複製" : "Copied");
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
        await expect(page.locator("#copy-status")).toHaveText(isZh ? "已複製到剪貼簿。" : "Copied to the clipboard.");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${method}: page does not scroll sideways`).toBe(0);
      expect(await page.evaluate(findTextOverflow), `${method}: text fits`).toEqual([]);
    }
    if (noScript) {
      await expect(widget.locator("button[data-copy]:visible")).toHaveCount(0);
      return;
    }
    await widget.locator("#install-tab-npx").focus();
    for (const [key, method] of [["ArrowLeft", "mise"], ["ArrowRight", "npx"], ["ArrowRight", "npm"], ["End", "mise"], ["Home", "npx"]]) {
      await page.keyboard.press(key);
      await selected(method);
      await expect(widget.locator(`#install-tab-${method}`)).toBeFocused();
    }
    await widget.locator("#install-tab-powershell").click();
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async () => { throw new DOMException("Fixture permission denied", "NotAllowedError"); },
      });
    });
    const fallback = widget.locator('button[data-copy="install-command-powershell"]');
    await fallback.click();
    await expect(fallback).toHaveText(isZh ? "已選取" : "Selected");
    expect(await page.evaluate(() => window.getSelection().toString())).toBe((await widget.locator("#install-command-powershell").textContent()).trim());
    await expect(page.locator("#copy-status")).toHaveText(isZh
      ? "複製失敗。指令已選取；請用鍵盤複製。"
      : "Copying failed. The command is selected; copy it with your keyboard.");
    await widget.locator("#install-tab-npx").click();
    await selected("npx");
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await expect(widget.locator('button[data-copy="install-command-npx"]')).toHaveText(isZh ? "複製" : "Copy");
  }
  try {
    for (const file of files) {
      for (const viewport of widths) {
        const label = `${file} @ ${viewport.width}px`;
        const context = await browser.newContext({ viewport, permissions: ["clipboard-read", "clipboard-write"] });
        const page = await context.newPage();
        const requests = [];
        const failures = [];
        const errors = [];
        const observe = (target) => {
          target.on("request", (request) => requests.push(request.url()));
          target.on("response", (response) => {
            if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
          });
          target.on("requestfailed", (request) => failures.push(`failed ${request.url()}`));
          target.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
          });
          target.on("pageerror", (error) => errors.push(error.message));
        };
        observe(page);
        await page.goto(`${origin}/${file}`, { waitUntil: "load" });
        try { await checkInstaller(page); }
        catch (error) { problems.push(`${label}: installer controls: ${error.message}`); }
        const result = await page.evaluate(async () => {
          await document.fonts.ready;
          const root = document.documentElement;
          return {
            scrollWidth: root.scrollWidth,
            clientWidth: root.clientWidth,
            fontLoaded: [...document.fonts].some((font) => font.family.replace(/"/g, "") === "DM Sans" && font.status === "loaded"),
          };
        });
        const brokenImages = await page.evaluate(async () => {
          const broken = [];
          for (const image of document.images) {
            image.loading = "eager";
            try {
              await image.decode();
            } catch {
              broken.push(image.getAttribute("src"));
            }
          }
          return broken;
        });
        const textProblems = await page.evaluate(findTextOverflow);
        if (screenshots) {
          fs.mkdirSync(screenshots, { recursive: true });
          const name = `${file.replace(/[\\/]/g, "_").replace(/\.html$/, "")}-${viewport.width}.png`;
          await page.screenshot({ path: path.join(screenshots, name), fullPage: true });
        }
        await context.close();
        if (viewport.width === 390) {
          const noScript = await browser.newContext({ viewport, javaScriptEnabled: false });
          try {
            const plainPage = await noScript.newPage();
            observe(plainPage);
            await plainPage.goto(`${origin}/${file}`, { waitUntil: "load" });
            await checkInstaller(plainPage, true);
          } catch (error) { problems.push(`${label}: without JavaScript: ${error.message}`); }
          finally { await noScript.close(); }
        }

        if (result.scrollWidth !== result.clientWidth)
          problems.push(`${label}: horizontal scroll (scrollWidth ${result.scrollWidth}, clientWidth ${result.clientWidth})`);
        for (const problem of textProblems) problems.push(`${label}: text does not fit, ${problem}`);
        for (const image of brokenImages) problems.push(`${label}: the image ${image} does not load`);
        for (const url of requests.filter((url) => !url.startsWith(`${origin}/`)))
          problems.push(`${label}: request outside the local server: ${url}`);
        for (const failure of failures) problems.push(`${label}: ${failure}`);
        // Chrome logs every failed load as a console error; the failures above name the file.
        for (const error of errors.filter((text) => !/Failed to load resource: the server responded with a status of 404/.test(text)))
          problems.push(`${label}: console error: ${error}`);
        if (!result.fontLoaded) problems.push(`${label}: the DM Sans font did not load`);
        console.error(
          `${label}: scrollWidth ${result.scrollWidth}/${result.clientWidth}, ${requests.length} local requests`,
        );
      }
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  for (const problem of problems) console.log(problem);
  console.error(
    problems.length === 0
      ? `check-site: ${files.length} pages pass the browser checks at ${widths.map((v) => v.width).join(", ")} px.`
      : `check-site: ${problems.length} problem(s) in the browser checks.`,
  );
  return problems.length === 0;
}

function parseArgs(args) {
  const options = { browser: false, port: 0, screenshots: undefined };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--browser") options.browser = true;
    else if (arg === "--port" && /^\d+$/.test(args[i + 1] ?? "")) options.port = Number(args[++i]);
    else if (arg === "--screenshots" && args[i + 1]) options.screenshots = path.resolve(args[++i]);
    else return undefined;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (!options) {
  console.error("Usage: node site/check-site.mjs [--browser [--port <n>] [--screenshots <dir>]]");
  process.exitCode = 2;
} else {
  try {
    const { ok, files } = checkStatic();
    const browserOk = options.browser ? await checkBrowser(files, options) : true;
    process.exitCode = ok && browserOk ? 0 : 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 2;
  }
}
