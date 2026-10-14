#!/usr/bin/env node
/**
 * Checks the landing site. Development only; it is not part of the site.
 *
 *   node site/check-site.mjs                      static checks
 *   node site/check-site.mjs --browser [options]  static checks, then each page in Chromium
 *
 * Static checks, on every .html file (media/ excluded):
 * - every <a href> resolves to an existing file (and #fragment id), sits
 *   inside a generated product-link region, or is an open item in
 *   site/README.md: in backticks on a line that says TODO or [OWNER]. A
 *   link to another site must be named in site/README.md;
 * - every resource (stylesheet, script, image, video, poster, track, CSS
 *   url()) is a relative path to an existing file, or a gitignored media/
 *   file that is an open item in site/README.md. Nothing may come from
 *   another origin;
 * - no inline <script>, style="" or on*="" attribute, so a strict Content
 *   Security Policy can apply, and every page declares one.
 *
 * Browser checks (--browser), with the pages served from a static server on
 * 127.0.0.1, at 1440 x 900 and 390 x 844:
 * - no horizontal scroll (scrollWidth === clientWidth);
 * - no request outside the local server, no failed request except missing
 *   media/ files, and no console error;
 * - the self-hosted DM Sans font is loaded;
 * - a <video> is laid out 16:9 (width / height within 1.74-1.80).
 *
 * Options: --port <n> (default: a free port), --without-media (answer 404
 * for media/ even when the files exist, as on a fresh checkout),
 * --screenshots <dir> (full-page PNGs for review).
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
const readme = fs.readFileSync(path.join(siteDir, "README.md"), "utf8");
const widths = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

/** Every .html file of the site, relative to site/, media/ excluded. */
function pages(dir = siteDir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "media" ? [] : pages(full);
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
// Only an open item excuses a missing file: a page the README merely
// mentions, such as `install.html`, must exist.
const openItems = readme.split("\n").filter((line) => /\bTODO\b|\[OWNER/.test(line));
const isOpenItem = (value) => openItems.some((line) => line.includes(`\`${value}\``));

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
        if (!isOpenItem(resolved)) problems.push(`${where(match.index)}: ${value} does not exist and is not an open item in site/README.md`);
        continue;
      }
      if (fragment && resolved.endsWith(".html") && !idsOf(resolved).has(fragment))
        problems.push(`${where(match.index)}: ${value} has no element with id="${fragment}"`);
    }

    // Resources.
    const resources = [
      ...html.matchAll(/<(?:link|script|img|source|track)\b[^>]*\s(?:href|src)="([^"]*)"/g),
      ...html.matchAll(/<video\b[^>]*\sposter="([^"]*)"/g),
    ];
    for (const match of resources) checkResource(file, match[1], where(match.index));
  }

  // Stylesheets may load fonts and images through url().
  for (const css of fs.readdirSync(siteDir).filter((name) => name.endsWith(".css"))) {
    const text = fs.readFileSync(path.join(siteDir, css), "utf8");
    for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g))
      checkResource(css, match[1], `${css}:${text.slice(0, match.index).split("\n").length}`);
  }

  function checkResource(file, value, where) {
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)) {
      problems.push(`${where}: ${value} loads from another origin`);
      return;
    }
    const { resolved, error } = resolve(file, value);
    if (error) problems.push(`${where}: ${value} ${error}`);
    else if (!fs.existsSync(path.join(siteDir, resolved))) {
      // The video files are gitignored; 7C copies them in before deploying.
      if (!(resolved.startsWith("media/") && isOpenItem(resolved)))
        problems.push(`${where}: ${value} does not exist`);
    }
  }

  for (const problem of problems) console.log(problem);
  console.error(
    problems.length === 0
      ? `check-site: ${files.length} pages and ${links} links are fine.`
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
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".vtt": "text/vtt; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** A static file server for site/ on 127.0.0.1. */
function serve(port, withoutMedia) {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let file = path.join(siteDir, path.normalize(pathname));
    if (file.endsWith(path.sep)) file = path.join(file, "index.html");
    const relative = path.relative(siteDir, file);
    const blocked = relative.startsWith("..") || (withoutMedia && relative.split(path.sep)[0] === "media");
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

async function checkBrowser(files, { port, withoutMedia, screenshots }) {
  const { chromium } = await import("@playwright/test");
  const server = await serve(port, withoutMedia);
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
          const video = document.querySelector("video");
          const box = video?.getBoundingClientRect();
          return {
            scrollWidth: root.scrollWidth,
            clientWidth: root.clientWidth,
            fontLoaded: [...document.fonts].some((font) => font.family.replace(/"/g, "") === "DM Sans" && font.status === "loaded"),
            video: box ? { width: box.width, height: box.height } : null,
          };
        });
        if (screenshots) {
          fs.mkdirSync(screenshots, { recursive: true });
          const name = `${file.replace(/[\\/]/g, "_").replace(/\.html$/, "")}-${viewport.width}.png`;
          await page.screenshot({ path: path.join(screenshots, name), fullPage: true });
        }
        await context.close();

        const isMedia = (url) => url.startsWith(`${origin}/media/`);
        if (result.scrollWidth !== result.clientWidth)
          problems.push(`${label}: horizontal scroll (scrollWidth ${result.scrollWidth}, clientWidth ${result.clientWidth})`);
        for (const url of requests.filter((url) => !url.startsWith(`${origin}/`)))
          problems.push(`${label}: request outside the local server: ${url}`);
        for (const failure of failures.filter((line) => !isMedia(line.replace(/^\S+ /, ""))))
          problems.push(`${label}: ${failure}`);
        // Chrome logs every failed load; the missing media files are expected.
        for (const error of errors.filter((text) => !/Failed to load resource: the server responded with a status of 404/.test(text)))
          problems.push(`${label}: console error: ${error}`);
        if (!result.fontLoaded) problems.push(`${label}: the DM Sans font did not load`);
        if (result.video) {
          const ratio = result.video.width / result.video.height;
          if (!(result.video.height > 0 && ratio >= 1.74 && ratio <= 1.8))
            problems.push(`${label}: the video box is ${result.video.width} x ${result.video.height}, not 16:9`);
        }
        console.error(
          `${label}: scrollWidth ${result.scrollWidth}/${result.clientWidth}, ${requests.length} local requests` +
            (result.video ? `, video ${result.video.width.toFixed(0)} x ${result.video.height.toFixed(0)} (${(result.video.width / result.video.height).toFixed(3)})` : ""),
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
  const options = { browser: false, port: 0, withoutMedia: false, screenshots: undefined };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--browser") options.browser = true;
    else if (arg === "--without-media") options.withoutMedia = true;
    else if (arg === "--port" && /^\d+$/.test(args[i + 1] ?? "")) options.port = Number(args[++i]);
    else if (arg === "--screenshots" && args[i + 1]) options.screenshots = path.resolve(args[++i]);
    else return undefined;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (!options) {
  console.error("Usage: node site/check-site.mjs [--browser [--port <n>] [--without-media] [--screenshots <dir>]]");
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
