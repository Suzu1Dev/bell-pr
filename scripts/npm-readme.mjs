#!/usr/bin/env node
/**
 * The README that the npm package carries, and the checks of the READMEs
 * and docs/.
 *
 *   node scripts/npm-readme.mjs --pre          prepack: ready README.md for npm
 *   node scripts/npm-readme.mjs --post         postpack: restore the READMEs
 *   node scripts/npm-readme.mjs --check-docs   links, anchors and error codes
 *   node scripts/npm-readme.mjs --self-test    this script, on fixtures
 *
 * npmjs.com shows the package's README but cannot resolve a relative path
 * in it: the package leaves docs/ out (the `files` list in package.json),
 * and it names no repository while the source repository is private.
 * Screenshots would show as broken images. And npm packs every README.* at
 * the root, whatever `files` says, then takes the first Markdown README its
 * file search returns as the package's README, which can be
 * README.zh-TW.md.
 *
 * --pre keeps the originals in the folder .README.md.orig (gitignored, and
 * never packed): a byte copy of README.md, and the other root README.*
 * files, moved there so the package holds README.md alone. It then
 * rewrites every relative image and link in README.md:
 *   - while `homepageUrl` in shared/product.ts is set, to the absolute
 *     `<homepageUrl>/<path>`, so the website must serve the repository's
 *     files at the same paths (docs/images/… above all);
 *   - while it is empty, an image becomes the text "Screenshot: <alt>" and
 *     a link keeps its text without the link.
 * Links within the page (#…), absolute URLs and everything in code stay as
 * they are. --pre refuses to run while .README.md.orig exists: it holds the
 * originals from a pack that did not finish, so run --post first.
 *
 * --post moves everything in .README.md.orig back, so the working tree is
 * byte for byte what it was before the pack.
 *
 * npm reads the README for `npm publish` again after postpack, so publish
 * the packed tarball (`npm publish bell-pr-<version>.tgz`, as the release
 * workflow does), never the folder.
 *
 * --check-docs reads README.md, README.zh-TW.md and every Markdown file in
 * docs/, and fails when
 *   - a link or an image does not resolve: a relative path must name a file
 *     or folder of the repository (and an #anchor a heading in it), and an
 *     absolute URL must start with one of `publicUrls` below, the public
 *     pages of the tools BELL PR works with. Product URLs and e-mail
 *     addresses only come from generated product-link regions
 *     (scripts/render-generated-regions.ts), which this check skips;
 *   - an ErrorCode of shared/errors.ts has no heading in
 *     docs/troubleshooting.md;
 *   - README.md, rewritten as --pre would, still has a relative path.
 *
 * Messages go to stderr and findings to stdout, so `npm pack --json` keeps
 * its report readable.
 *
 * Exit status: 0 when everything passes, 1 when a check fails, 2 on a usage
 * or setup error.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const readmeName = "README.md";
const backupName = ".README.md.orig";
const translatedReadme = "README.zh-TW.md";
const troubleshootingName = "docs/troubleshooting.md";
const command = "node scripts/npm-readme.mjs";

/**
 * Absolute URLs the READMEs and docs may link to: the public pages of the
 * tools BELL PR works with. Add a prefix only for pages that exist; never
 * a product URL (those live in shared/product.ts).
 */
export const publicUrls = [
  "https://nodejs.org/",
  "https://git-scm.com/",
  "https://cli.github.com/",
  "https://github.com/openai/codex",
  "https://docs.github.com/",
  "https://code.claude.com/docs/",
  "https://learn.microsoft.com/",
];

/** A problem with the setup rather than with the documents. */
class SetupError extends Error {}

/** README.md cannot be rewritten for npm as it is. */
class ReadmeError extends Error {}

// ---------------------------------------------------------------------------
// Reading Markdown

const blank = (value) => value.replace(/[^\n]/g, " ");

/**
 * The text with everything that is not prose replaced by spaces of the
 * same length (line breaks stay, so offsets and line numbers still match):
 * fenced code blocks, inline code spans, HTML comments and, with
 * `regions`, generated product-link regions with their content.
 */
export function proseOnly(text, { regions = false } = {}) {
  const lines = text.split("\n");
  let fence;
  for (let index = 0; index < lines.length; index++) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(lines[index]);
    if (fence) {
      if (
        match &&
        match[1][0] === fence.char &&
        match[1].length >= fence.length &&
        lines[index].slice(match[0].length).trim() === ""
      )
        fence = undefined;
      lines[index] = blank(lines[index]);
    } else if (match) {
      fence = { char: match[1][0], length: match[1].length };
      lines[index] = blank(lines[index]);
    }
  }
  let prose = lines.join("\n");
  // A code span runs to the next backtick run of the same length, within
  // its paragraph.
  prose = prose.replace(/(?<!`)(`+)((?:(?!\n[ \t]*\r?\n)[^`]|`(?!\1))+?)\1(?!`)/g, blank);
  if (regions)
    prose = prose.replace(
      /<!--\s*generated:product-link\b[^]*?<!--\s*\/generated:product-link\s*-->/g,
      blank,
    );
  return prose.replace(/<!--[^]*?-->/g, blank);
}

const inlineLink = new RegExp(
  String.raw`(!?)\[((?:[^\[\]\n]|\n(?![ \t]*\r?\n)|\[[^\[\]\n]*\])*)\]\(` +
    String.raw`[ \t]*\n?[ \t]*(?:<([^<>\n]*)>|((?:[^\s()<>]|\([^\s()]*\))*))` +
    String.raw`(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?[ \t]*\)`,
  "dg",
);
const definition = /^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^<>\n]*)>|(\S+))/dgm;
const htmlTag = /<(img|a)\b[^>]*>/gi;
const attribute = (name) =>
  new RegExp(String.raw`\s${name}\s*=\s*(?:"([^"]*)"|'([^']*)')`, "di");
const autolink = /<([a-z][a-z0-9+.-]{1,31}:[^\s<>]*)>/dgi;
const bareUrl = /(?<![\w/@.:=-])https?:\/\/[^\s<>]+/gi;

/**
 * The links and images of a Markdown text, in order. `masked` is
 * `proseOnly(text)`; offsets index both. Each reference has its kind, the
 * destination, its offsets, its line and, for links and images, the
 * original text between the brackets.
 */
export function references(text, masked = proseOnly(text)) {
  const found = [];
  const add = (reference) =>
    found.push({ ...reference, line: text.slice(0, reference.start).split("\n").length });
  for (const match of masked.matchAll(inlineLink)) {
    const group = match.indices[3] ? 3 : 4;
    const [destStart, destEnd] = match.indices[group] ?? [match.index, match.index];
    const [textStart, textEnd] = match.indices[2];
    add({
      kind: match[1] ? "image" : "link",
      start: match.index,
      end: match.index + match[0].length,
      destStart,
      destEnd,
      dest: text.slice(destStart, destEnd),
      text: text.slice(textStart, textEnd),
    });
  }
  for (const match of masked.matchAll(definition)) {
    const [destStart, destEnd] = match.indices[2] ?? match.indices[3];
    add({
      kind: "definition",
      start: match.index,
      end: match.index + match[0].length,
      destStart,
      destEnd,
      dest: text.slice(destStart, destEnd),
    });
  }
  for (const match of masked.matchAll(htmlTag)) {
    const tag = text.slice(match.index, match.index + match[0].length);
    const name = match[1].toLowerCase();
    const target = attribute(name === "img" ? "src" : "href").exec(tag);
    if (!target) continue;
    const [from, to] = target.indices[1] ?? target.indices[2];
    const alt = attribute("alt").exec(tag);
    add({
      kind: name === "img" ? "html-image" : "html-link",
      start: match.index,
      end: match.index + match[0].length,
      destStart: match.index + from,
      destEnd: match.index + to,
      dest: tag.slice(from, to),
      attributeStart: match.index + target.index,
      attributeEnd: match.index + target.index + target[0].length,
      text: alt ? (alt[1] ?? alt[2]) : "",
    });
  }
  for (const match of masked.matchAll(autolink)) {
    const [destStart, destEnd] = match.indices[1];
    add({
      kind: "autolink",
      start: match.index,
      end: match.index + match[0].length,
      destStart,
      destEnd,
      dest: text.slice(destStart, destEnd),
    });
  }
  // Bare URLs (GitHub links them too), outside what was found above.
  let rest = masked;
  for (const reference of found)
    rest = rest.slice(0, reference.start) + blank(rest.slice(reference.start, reference.end)) + rest.slice(reference.end);
  for (const match of rest.matchAll(bareUrl)) {
    let url = match[0].replace(/[.,:;!?*_~'"]+$/, "");
    while (url.endsWith(")") && url.split("(").length < url.split(")").length) url = url.slice(0, -1);
    add({
      kind: "url",
      start: match.index,
      end: match.index + url.length,
      destStart: match.index,
      destEnd: match.index + url.length,
      dest: url,
    });
  }
  return found.sort((a, b) => a.start - b.start);
}

/** A path inside the repository, as opposed to a URL or an anchor. */
export function isRelative(destination) {
  return (
    destination !== "" &&
    !destination.startsWith("#") &&
    !destination.startsWith("//") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(destination)
  );
}

/**
 * The anchors GitHub gives the headings (and `id`/`name` anchors) of a
 * Markdown text: the heading's text in lower case, without punctuation,
 * spaces as hyphens, and -1, -2… for repeats.
 */
export function anchors(text) {
  const result = new Set();
  const seen = new Map();
  const masked = proseOnly(text);
  const lines = text.split("\n");
  masked.split("\n").forEach((line, index) => {
    if (!/^ {0,3}#{1,6}[ \t]/.test(line)) return;
    const heading = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*\r?$/.exec(lines[index])[1];
    const base = heading
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[`*]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
      .replace(/ /g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count === 0 ? base : `${base}-${count}`);
  });
  for (const match of masked.matchAll(/<a\b[^>]*\s(?:id|name)\s*=\s*"([^"]+)"/gi))
    result.add(match[1]);
  return result;
}

// ---------------------------------------------------------------------------
// The npm README

/**
 * The values of `product` in shared/product.ts, read from its source: this
 * script runs before any build and without TypeScript.
 */
export function productValues(source) {
  const block = /export const product\s*:\s*ProductInfo\s*=\s*\{([^]*?)\n\};/.exec(source);
  if (!block)
    throw new SetupError("shared/product.ts: cannot find `export const product: ProductInfo = {…};`.");
  const values = {};
  for (const match of block[1].matchAll(/^\s*(\w+)\s*:\s*"((?:[^"\\\n]|\\.)*)"\s*,?\s*$/gm))
    values[match[1]] = JSON.parse(`"${match[2]}"`);
  if (typeof values.homepageUrl !== "string")
    throw new SetupError("shared/product.ts: cannot read product.homepageUrl as a string.");
  const homepage = values.homepageUrl.trim();
  if (homepage) {
    let url;
    try {
      url = new URL(homepage);
    } catch {
      url = undefined;
    }
    if (!url || (url.protocol !== "https:" && url.protocol !== "http:"))
      throw new SetupError(`shared/product.ts: homepageUrl is not an http(s) URL: "${homepage}".`);
  }
  return values;
}

const escapeHtml = (value) =>
  value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

/** `text` written out in Markdown, without the characters that would make it a link or code. */
const plainText = (value) => value.replace(/\s+/g, " ").trim();

/**
 * README.md for the npm package: every relative image and link made
 * absolute against `homepageUrl`, or, while it is empty, images as text
 * and links as their text. Returns the text and what changed.
 */
export function npmReadme(text, { homepageUrl = "" } = {}) {
  const base = homepageUrl.trim().replace(/\/+$/, "");
  const changed = { images: 0, links: 0 };
  let output = "";
  let cursor = 0;
  for (const reference of references(text)) {
    if (!isRelative(reference.dest)) continue;
    const where = `README.md:${reference.line}`;
    const target = reference.dest.replace(/^(\.\/)+/, "").replace(/^\/+/, "");
    if (target.split(/[/?#]/).includes(".."))
      throw new ReadmeError(`${where}: "${reference.dest}" leaves the repository root.`);
    const image = reference.kind === "image" || reference.kind === "html-image";
    if (image) changed.images += 1;
    else changed.links += 1;
    let replacement;
    if (base)
      replacement =
        text.slice(reference.start, reference.destStart) +
        `${base}/${target}` +
        text.slice(reference.destEnd, reference.end);
    else if (reference.kind === "image")
      replacement = `*Screenshot: ${plainText(reference.text) || "untitled"}*`;
    else if (reference.kind === "html-image")
      replacement = `<em>Screenshot: ${escapeHtml(plainText(reference.text) || "untitled")}</em>`;
    else if (reference.kind === "link") replacement = reference.text;
    else if (reference.kind === "html-link")
      // An <a> without href is text, so its closing tag can stay.
      replacement =
        text.slice(reference.start, reference.attributeStart) +
        text.slice(reference.attributeEnd, reference.end);
    else
      throw new ReadmeError(
        `${where}: write "${reference.dest}" as an inline link; a reference definition cannot become text.`,
      );
    output += text.slice(cursor, reference.start) + replacement;
    cursor = reference.end;
  }
  return { text: output + text.slice(cursor), changed };
}

function readProduct(root) {
  const file = path.join(root, "shared", "product.ts");
  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new SetupError(`cannot read shared/product.ts: ${error.message}`);
  }
  return productValues(source);
}

/**
 * The root files besides README.md that npm would pack as READMEs, as
 * npm-packlist's `/readme{,.*[^~$]}` rule matches them.
 */
function otherReadmes(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && entry.name !== readmeName && /^readme(?:\..*[^~$])?$/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

function pre(root, log) {
  const readme = path.join(root, readmeName);
  const backup = path.join(root, backupName);
  if (fs.existsSync(backup)) {
    log(
      `npm-readme: ${backupName} holds the READMEs from a pack that did not finish. Run ${command} --post to restore them, then pack again.`,
    );
    return 1;
  }
  const product = readProduct(root);
  const original = fs.readFileSync(readme);
  const { text, changed } = npmReadme(original.toString("utf8"), product);
  const others = otherReadmes(root);
  // mkdir without `recursive` fails if the folder appeared since the check.
  fs.mkdirSync(backup);
  fs.writeFileSync(path.join(backup, readmeName), original, { flag: "wx" });
  for (const name of others) fs.renameSync(path.join(root, name), path.join(backup, name));
  fs.writeFileSync(readme, text);
  log(
    `npm-readme: README.md rewritten for the package (${changed.images} image(s), ${changed.links} link(s), ${
      product.homepageUrl.trim() ? "made absolute" : "as text: homepageUrl is empty"
    })${others.length ? `; ${others.join(", ")} set aside` : ""}. ${backupName} keeps the originals until postpack.`,
  );
  return 0;
}

function post(root, log) {
  const readme = path.join(root, readmeName);
  const backup = path.join(root, backupName);
  if (!fs.existsSync(backup)) {
    log(`npm-readme: no ${backupName}, so no README was changed; nothing to restore.`);
    return 0;
  }
  const saved = fs.readdirSync(backup);
  const taken = saved.filter((name) => name !== readmeName && fs.existsSync(path.join(root, name)));
  if (taken.length) {
    log(
      `npm-readme: ${taken.join(", ")} exist again at the root, so nothing was restored. Compare them with the copies in ${backupName}, keep one of each, then run ${command} --post again.`,
    );
    return 1;
  }
  for (const name of saved)
    if (name !== readmeName) fs.renameSync(path.join(backup, name), path.join(root, name));
  if (saved.includes(readmeName)) {
    // Writing over README.md keeps its file mode; the bytes are the original's.
    fs.writeFileSync(readme, fs.readFileSync(path.join(backup, readmeName)));
    fs.rmSync(path.join(backup, readmeName));
  }
  fs.rmdirSync(backup);
  log("npm-readme: the READMEs are restored.");
  return 0;
}

// ---------------------------------------------------------------------------
// Checking the documents

/** The files of the repository: tracked, or new and not ignored. */
function repositoryFiles(root, env = process.env) {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) throw new SetupError(`could not run git: ${result.error.message}`);
  if (result.status !== 0) throw new SetupError(`git ls-files failed: ${result.stderr.trim()}`);
  const files = new Set(result.stdout.split("\0").filter(Boolean));
  const folders = new Set();
  for (const file of files)
    for (let folder = path.posix.dirname(file); folder !== "."; folder = path.posix.dirname(folder))
      folders.add(folder);
  // A file listed but deleted from the working tree does not count.
  for (const file of files) if (!fs.existsSync(path.join(root, file))) files.delete(file);
  return { files, folders };
}

/** The ErrorCode values in the source of shared/errors.ts. */
export function errorCodesOf(source) {
  const list = /export const errorCodes\s*=\s*\[([^\]]*)\]/.exec(source);
  if (!list) throw new SetupError("shared/errors.ts: cannot find `export const errorCodes = [...]`.");
  const codes = [...list[1].matchAll(/["']([a-z0-9_]+)["']/g)].map((match) => match[1]);
  if (codes.length === 0) throw new SetupError("shared/errors.ts: errorCodes is empty.");
  return codes;
}

/** The Markdown files --check-docs reads, relative to the root. */
function documents(root, files) {
  return [...files]
    .filter(
      (file) =>
        file === readmeName ||
        file === translatedReadme ||
        (file.startsWith("docs/") && file.endsWith(".md") && !file.startsWith("docs/images/")),
    )
    .sort();
}

/** Every problem with the documents under `root`, as "file:line: message". */
export function checkDocs(root, env = process.env) {
  const { files, folders } = repositoryFiles(root, env);
  const problems = [];
  const texts = new Map();
  const read = (file) => {
    if (!texts.has(file)) texts.set(file, fs.readFileSync(path.join(root, file), "utf8"));
    return texts.get(file);
  };
  const anchorCache = new Map();
  const anchorsOf = (file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, anchors(read(file)));
    return anchorCache.get(file);
  };
  for (const name of documents(root, files)) {
    const text = read(name);
    for (const reference of references(text, proseOnly(text, { regions: true }))) {
      const where = `${name}:${reference.line}`;
      const destination = reference.dest.trim();
      if (destination === "") {
        problems.push(`${where}: a link without a destination.`);
      } else if (destination.startsWith("#")) {
        const anchor = decodeURIComponent(destination.slice(1));
        if (!anchorsOf(name).has(anchor))
          problems.push(`${where}: no heading in ${name} has the anchor "${destination}".`);
      } else if (/^mailto:/i.test(destination)) {
        problems.push(
          `${where}: write e-mail addresses only through a generated product-link region (${destination}).`,
        );
      } else if (/^https?:/i.test(destination)) {
        if (!publicUrls.some((prefix) => destination.startsWith(prefix)))
          problems.push(
            `${where}: ${destination} is neither a file of the repository nor on the list of public URLs in scripts/npm-readme.mjs; product URLs belong in generated product-link regions.`,
          );
      } else if (!isRelative(destination)) {
        problems.push(`${where}: unsupported link "${destination}".`);
      } else {
        const [pathPart, anchor] = destination.split("#", 2);
        let decoded;
        try {
          decoded = decodeURIComponent(pathPart.split("?")[0]);
        } catch {
          decoded = pathPart;
        }
        const target = path.posix.normalize(
          decoded.startsWith("/")
            ? decoded.replace(/^\/+/, "")
            : path.posix.join(path.posix.dirname(name), decoded),
        ).replace(/\/+$/, "");
        if (target === ".." || target.startsWith("../")) {
          problems.push(`${where}: "${destination}" leaves the repository.`);
        } else if (target !== "." && !files.has(target) && !folders.has(target)) {
          problems.push(`${where}: "${destination}" names no file or folder of the repository.`);
        } else if (anchor !== undefined && files.has(target)) {
          if (!target.endsWith(".md"))
            problems.push(`${where}: "${destination}" has an anchor, but ${target} is not Markdown.`);
          else if (!anchorsOf(target).has(decodeURIComponent(anchor)))
            problems.push(`${where}: no heading in ${target} has the anchor "#${anchor}".`);
        }
      }
    }
  }
  // Every error code has its own heading in the troubleshooting guide.
  const codes = errorCodesOf(fs.readFileSync(path.join(root, "shared", "errors.ts"), "utf8"));
  if (!files.has(troubleshootingName)) {
    problems.push(`${troubleshootingName}: missing; it documents every ErrorCode.`);
  } else {
    const guide = read(troubleshootingName);
    const masked = proseOnly(guide).split("\n");
    const headings = guide
      .split("\n")
      .filter((_line, index) => /^ {0,3}#{1,6}[ \t]/.test(masked[index]));
    for (const code of codes)
      if (!headings.some((heading) => heading.includes(`\`${code}\``)))
        problems.push(`${troubleshootingName}: no heading names the error code \`${code}\`.`);
  }
  // README.md as the package will carry it: no relative path left.
  if (files.has(readmeName)) {
    try {
      const packed = npmReadme(read(readmeName), readProduct(root)).text;
      for (const reference of references(packed))
        if (isRelative(reference.dest))
          problems.push(`README.md (npm): line ${reference.line} still links to "${reference.dest}".`);
      if (/\]\((?:\.\/)?docs\//.test(packed))
        problems.push("README.md (npm): still contains ](docs/.");
    } catch (error) {
      if (!(error instanceof ReadmeError)) throw error;
      problems.push(`README.md (npm): ${error.message}`);
    }
  }
  return problems;
}

function checkDocsCommand(root, log, out) {
  const problems = checkDocs(root);
  for (const problem of problems) out(problem);
  if (problems.length) {
    log(`npm-readme --check-docs: ${problems.length} problem(s).`);
    return 1;
  }
  log("npm-readme --check-docs: links, anchors and error codes are fine.");
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test

function selfTest() {
  const site = { homepageUrl: "https://bell.example.test/" };
  const readme = [
    "# BELL PR",
    "",
    "[繁體中文](README.zh-TW.md) · [Features](#features)",
    "",
    "![The workbench: a diff with an explanation](docs/images/en/run-changes-1280.png)",
    "",
    '![Titled](./docs/images/en/home-1280.png "Home")',
    "",
    "See [Getting started](docs/getting-started.md#requirements) and [`.env.example`](.env.example).",
    "Read the [privacy",
    "policy](PRIVACY.md) and <https://nodejs.org/en>, or https://cli.github.com/.",
    "",
    'Raw: <img src="docs/images/en/team-390.png" alt="Agent team" width="390"> and <a href="docs/faq.md" title="FAQ">FAQ</a>.',
    "",
    "Code: `[not](docs/a.md)` and `` ![not](docs/b.png) ``.",
    "",
    "```md",
    "![not an image](docs/images/x.png)",
    "```",
    "",
    '<!-- generated:product-link key=docsUrl text="Docs" -->',
    "[Docs](https://docs.example.test/start)",
    "<!-- /generated:product-link -->",
    "<!-- a comment with [a link](docs/c.md) -->",
    "",
  ].join("\n");

  // With a homepage, every relative reference becomes absolute.
  const absolute = npmReadme(readme, site);
  assert.deepEqual(absolute.changed, { images: 3, links: 5 });
  const a = absolute.text;
  assert.ok(a.includes("[繁體中文](https://bell.example.test/README.zh-TW.md) · [Features](#features)"));
  assert.ok(a.includes("![The workbench: a diff with an explanation](https://bell.example.test/docs/images/en/run-changes-1280.png)"));
  assert.ok(a.includes('![Titled](https://bell.example.test/docs/images/en/home-1280.png "Home")'));
  assert.ok(a.includes("[Getting started](https://bell.example.test/docs/getting-started.md#requirements)"));
  assert.ok(a.includes("[`.env.example`](https://bell.example.test/.env.example)"));
  assert.ok(a.includes("[privacy\npolicy](https://bell.example.test/PRIVACY.md)"));
  assert.ok(a.includes('<img src="https://bell.example.test/docs/images/en/team-390.png" alt="Agent team" width="390">'));
  assert.ok(a.includes('<a href="https://bell.example.test/docs/faq.md" title="FAQ">FAQ</a>'));
  assert.ok(a.includes("<https://nodejs.org/en>, or https://cli.github.com/."));

  // Without one, images become text and links their text.
  const text = npmReadme(readme, { homepageUrl: "" });
  assert.deepEqual(text.changed, absolute.changed);
  const t = text.text;
  assert.ok(t.includes("繁體中文 · [Features](#features)"));
  assert.ok(t.includes("\n*Screenshot: The workbench: a diff with an explanation*\n"));
  assert.ok(t.includes("\n*Screenshot: Titled*\n"));
  assert.ok(t.includes("See Getting started and `.env.example`."));
  assert.ok(t.includes("Read the privacy\npolicy and <https://nodejs.org/en>"));
  assert.ok(t.includes('Raw: <em>Screenshot: Agent team</em> and <a title="FAQ">FAQ</a>.'));
  for (const output of [a, t]) {
    // Code, comments and generated regions stay as they are.
    assert.ok(output.includes("Code: `[not](docs/a.md)` and `` ![not](docs/b.png) ``."));
    assert.ok(output.includes("```md\n![not an image](docs/images/x.png)\n```"));
    assert.ok(output.includes("[Docs](https://docs.example.test/start)\n<!-- /generated:product-link -->"));
    assert.ok(output.includes("<!-- a comment with [a link](docs/c.md) -->"));
    assert.deepEqual(references(output).filter((reference) => isRelative(reference.dest)), []);
  }
  // The rewrite keeps line endings, and a text without paths stays as it is.
  const crlf = readme.replace(/\n/g, "\r\n");
  assert.equal(npmReadme(crlf, site).text, a.replace(/\n/g, "\r\n"));
  assert.equal(npmReadme("# Plain\n\nNo links.", site).text, "# Plain\n\nNo links.");
  assert.throws(() => npmReadme("[x](../outside.md)\n", site), /leaves the repository root/);
  assert.throws(() => npmReadme("[x][ref]\n\n[ref]: docs/x.md\n", { homepageUrl: "" }), /inline link/);
  assert.ok(npmReadme("[x][ref]\n\n[ref]: docs/x.md\n", site).text.includes("[ref]: https://bell.example.test/docs/x.md"));

  // Product values come from the source of shared/product.ts.
  const source = (homepage) =>
    `export const product: ProductInfo = {\n  name: "BELL PR",\n  binNames: ["bell-pr", "bellpr"],\n  homepageUrl: "${homepage}",\n  docsUrl: "",\n};\n`;
  assert.deepEqual(productValues(source("")), { name: "BELL PR", homepageUrl: "", docsUrl: "" });
  assert.equal(productValues(source("https://x.example.test")).homepageUrl, "https://x.example.test");
  assert.throws(() => productValues(source("x.example.test")), /not an http\(s\) URL/);
  assert.throws(() => productValues("export const other = {};"), /cannot find/);
  const real = productValues(fs.readFileSync(path.join(repoRoot, "shared", "product.ts"), "utf8"));
  assert.equal(real.name, "BELL PR");
  assert.equal(typeof real.homepageUrl, "string");
  assert.ok(errorCodesOf(fs.readFileSync(path.join(repoRoot, "shared", "errors.ts"), "utf8")).includes("auth_required"));

  // Anchors as GitHub makes them.
  const headings = anchors(
    "# BELL PR\n\n## Free and Pro\n\n## Free and Pro\n\n### `pro_required`: a Pro feature\n\n## 快速開始（60 秒）\n\n```\n# not a heading\n```\n\n## [Linked](x.md) *heading*\n",
  );
  assert.deepEqual(
    [...headings],
    ["bell-pr", "free-and-pro", "free-and-pro-1", "pro_required-a-pro-feature", "快速開始60-秒", "linked-heading"],
  );

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bellpr-npm-readme-"));
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: os.devNull,
  };
  try {
    const write = (file, content) => {
      fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true });
      fs.writeFileSync(path.join(temp, file), content);
    };
    const quiet = () => {};

    // --pre and --post: the originals come back byte for byte.
    const original = Buffer.from("# Fixture\r\n\r\n![Shot](docs/images/a.png)\r\n[Docs](docs/a.md)", "utf8");
    const translated = Buffer.from("# 範例\n\n![圖](docs/images/b.png)\n", "utf8");
    const at = (...parts) => path.join(temp, ...parts);
    write("README.md", original);
    write("README.zh-TW.md", translated);
    write("readme.txt", "plain");
    write("README.md~", "an editor backup npm does not pack");
    write("docs/README.md", "# Docs index stays\n");
    write("shared/product.ts", source(""));
    assert.deepEqual(otherReadmes(temp), ["README.zh-TW.md", "readme.txt"]);
    assert.equal(pre(temp, quiet), 0);
    assert.deepEqual(fs.readFileSync(at(backupName, "README.md")), original);
    assert.deepEqual(fs.readFileSync(at(backupName, "README.zh-TW.md")), translated);
    assert.deepEqual(fs.readdirSync(at(backupName)).sort(), ["README.md", "README.zh-TW.md", "readme.txt"]);
    assert.equal(fs.existsSync(at("README.zh-TW.md")), false, "the package holds README.md alone");
    assert.equal(fs.existsSync(at("readme.txt")), false);
    assert.ok(fs.existsSync(at("README.md~")) && fs.existsSync(at("docs", "README.md")));
    assert.equal(fs.readFileSync(at("README.md"), "utf8"), "# Fixture\r\n\r\n*Screenshot: Shot*\r\nDocs");
    assert.equal(pre(temp, quiet), 1, "a backup from an unfinished pack blocks --pre");
    assert.deepEqual(fs.readFileSync(at(backupName, "README.md")), original, "and stays untouched");
    assert.equal(post(temp, quiet), 0);
    assert.deepEqual(fs.readFileSync(at("README.md")), original);
    assert.deepEqual(fs.readFileSync(at("README.zh-TW.md")), translated);
    assert.equal(fs.readFileSync(at("readme.txt"), "utf8"), "plain");
    assert.equal(fs.existsSync(at(backupName)), false);
    assert.equal(post(temp, quiet), 0, "--post without a backup does nothing");
    assert.deepEqual(fs.readFileSync(at("README.md")), original);
    // A translated README that reappeared meanwhile is never overwritten.
    assert.equal(pre(temp, quiet), 0);
    write("README.zh-TW.md", "new text");
    assert.equal(post(temp, quiet), 1);
    assert.equal(fs.readFileSync(at("README.zh-TW.md"), "utf8"), "new text");
    assert.deepEqual(fs.readFileSync(at(backupName, "README.zh-TW.md")), translated);
    fs.rmSync(at("README.zh-TW.md"));
    assert.equal(post(temp, quiet), 0);
    assert.deepEqual(fs.readFileSync(at("README.zh-TW.md")), translated);
    // A README that cannot become text stops --pre before anything moves.
    write("README.md", "[x][r]\n\n[r]: docs/a.md\n");
    assert.throws(() => pre(temp, quiet), /inline link/);
    assert.equal(fs.existsSync(at(backupName)), false);
    assert.ok(fs.existsSync(at("README.zh-TW.md")));
    write("README.md", original);
    write("shared/product.ts", source("https://bell.example.test"));
    assert.equal(pre(temp, quiet), 0);
    assert.ok(fs.readFileSync(at("README.md"), "utf8").includes("](https://bell.example.test/docs/images/a.png)"));
    assert.equal(post(temp, quiet), 0);
    assert.deepEqual(fs.readFileSync(at("README.md")), original);
    for (const name of ["readme.txt", "README.md~", "docs/README.md"]) fs.rmSync(at(name));

    // --check-docs on a small repository.
    write("shared/product.ts", source(""));
    write("shared/errors.ts", 'export const errorCodes = [\n  "auth_required",\n  "git_missing",\n] as const;\n');
    write(
      "README.md",
      [
        "# Fixture",
        "",
        "[中文](README.zh-TW.md) [Start](docs/start.md#install) [Gone](docs/gone.md)",
        "[Bad anchor](docs/start.md#nowhere) [Here](#fixture) [Nowhere](#missing)",
        "![Shot](docs/images/a.png) [Images](docs/images/) [Mail](mailto:help@example.test)",
        "[Node](https://nodejs.org/en) [Made up](https://bell.example.test/)",
        '<!-- generated:product-link key=homepageUrl text="Website" -->',
        "[Website](https://bell.example.test/)",
        "<!-- /generated:product-link -->",
        "`[code](nowhere.md)`",
        "",
      ].join("\n"),
    );
    write("README.zh-TW.md", "# 範例\n\n[English](README.md) [Ignored](ignored.md)\n");
    write("docs/start.md", "# Start\n\n## Install\n\n[Back](../README.md#fixture) [Up](../../x.md)\n");
    write("docs/images/a.png", "png");
    write("docs/troubleshooting.md", "# Troubleshooting\n\n## `auth_required`\n\nText about `git_missing` outside a heading.\n");
    write(".gitignore", "ignored.md\n");
    write("ignored.md", "# Ignored\n");
    const git = (...args) => {
      const result = spawnSync("git", args, { cwd: temp, encoding: "utf8", env });
      assert.equal(result.status, 0, result.stderr);
    };
    git("init", "-q");
    assert.deepEqual(checkDocs(temp, env), [
      'README.md:3: "docs/gone.md" names no file or folder of the repository.',
      'README.md:4: no heading in docs/start.md has the anchor "#nowhere".',
      'README.md:4: no heading in README.md has the anchor "#missing".',
      "README.md:5: write e-mail addresses only through a generated product-link region (mailto:help@example.test).",
      "README.md:6: https://bell.example.test/ is neither a file of the repository nor on the list of public URLs in scripts/npm-readme.mjs; product URLs belong in generated product-link regions.",
      'README.zh-TW.md:3: "ignored.md" names no file or folder of the repository.',
      'docs/start.md:5: "../../x.md" leaves the repository.',
      "docs/troubleshooting.md: no heading names the error code `git_missing`.",
    ]);
    write("README.md", "# Fixture\n\n[Ref][r]\n\n[r]: docs/start.md\n");
    write("README.zh-TW.md", "# 範例\n\n[English](README.md)\n");
    assert.deepEqual(checkDocs(temp, env), [
      'docs/start.md:5: "../../x.md" leaves the repository.',
      "docs/troubleshooting.md: no heading names the error code `git_missing`.",
      'README.md (npm): README.md:5: write "docs/start.md" as an inline link; a reference definition cannot become text.',
    ]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.error("npm-readme self-test: ok");
  return 0;
}

// ---------------------------------------------------------------------------
// The command line

export function main(args, { root = repoRoot, log = (line) => console.error(line), out = (line) => console.log(line) } = {}) {
  const modes = {
    "--pre": () => pre(root, log),
    "--post": () => post(root, log),
    "--check-docs": () => checkDocsCommand(root, log, out),
    "--self-test": () => selfTest(),
  };
  if (args.length !== 1 || !Object.hasOwn(modes, args[0])) {
    log(`Usage: ${command} --pre | --post | --check-docs | --self-test`);
    return 2;
  }
  try {
    return modes[args[0]]();
  } catch (error) {
    if (error instanceof SetupError) {
      log(`npm-readme: ${error.message}`);
      return 2;
    }
    if (error instanceof ReadmeError) {
      log(`npm-readme: ${error.message}`);
      return 1;
    }
    if (error instanceof assert.AssertionError) {
      log(`npm-readme self-test failed:\n${error.message}`);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error);
    process.exitCode = 2;
  }
}
