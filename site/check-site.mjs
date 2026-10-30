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
 * - the site's files total at most 5 MB.
 *
 * Browser checks (--browser), with the pages served from a static server on
 * 127.0.0.1, at 1440 x 900 and 390 x 844:
 * - no horizontal scroll (scrollWidth === clientWidth), and no text that is
 *   cut off or runs out of its box, FAQ answers opened (the rules of
 *   e2e/helpers/overflow.ts);
 * - no request outside the local server, no failed request, and no console
 *   error;
 * - the self-hosted DM Sans font is loaded, and every image decodes (lazy
 *   images are loaded first).
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

const siteDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.dirname(siteDir);
const readme = fs.readFileSync(path.join(siteDir, "README.md"), "utf8");
/** The site's size budget. */
const maxSiteBytes = 5 * 1024 * 1024;
const widths = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
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
  const { chromium } = await import("@playwright/test");
  const server = await serve(port);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  const problems = [];
  try {
    for (const file of files) {
      for (const viewport of widths) {
        const label = `${file} @ ${viewport.width}px`;
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const requests = [];
        const failures = [];
        const errors = [];
        page.on("request", (request) => requests.push(request.url()));
        page.on("response", (response) => {
          if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
        });
        page.on("requestfailed", (request) => failures.push(`failed ${request.url()}`));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${origin}/${file}`, { waitUntil: "load" });
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
      ? `check-site: ${files.length} pages pass the browser checks at ${widths.map((v) => v.width).join(" and ")} px.`
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
