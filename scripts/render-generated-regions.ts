/**
 * Renders the generated regions of Markdown and HTML files, so the product
 * links are never maintained by hand.
 *
 *   npx tsx scripts/render-generated-regions.ts --check [--targets <file>...]
 *   npx tsx scripts/render-generated-regions.ts --write [--targets <file>...]
 *   npx tsx scripts/render-generated-regions.ts --self-test
 *
 * A region is a pair of HTML comments. Everything between them belongs to
 * this script and is replaced on --write:
 *
 *   <!-- generated:product-link key=docsUrl text="Docs" -->…<!-- /generated:product-link -->
 *
 * Kinds and their attributes (values with spaces go in double quotes):
 *
 * - `product-link key=<key> text="…" [path="…"]`: a link to a value of
 *   shared/product.ts, `<a href>` in HTML and `[text](url)` in Markdown, or
 *   **nothing at all** while that value is empty. The key is a
 *   `ProductLinkKey` (homepageUrl, docsUrl, publicRepoUrl, homebrewRepoUrl) or supportEmail /
 *   securityEmail, which become mailto: links. `path` is appended to a URL,
 *   as in `key=publicRepoUrl path=issues`. `text` is plain text; it is
 *   escaped on output.
 * - `product-meta key=<ProductLinkKey> property="…" [path="…"]` (HTML
 *   only): `<meta property="…" content="<url>">`, or nothing while the URL
 *   is empty. It is for Open Graph tags such as og:url and og:image, which
 *   need absolute URLs.
 * - `install-commands method=npx|npm|curl|brew|bun|powershell|mise [lang=en|zh-TW]`:
 *   Fenced Markdown or escaped HTML command text. Installers use homepageUrl
 *   when set, otherwise the public GitHub repository. Homebrew uses its
 *   dedicated homebrewRepoUrl. An empty repository URL hides its block.
 *   HTML callers provide the surrounding <code> element.
 *
 * Layout: when the opening comment stands alone on its line, the content
 * goes on the lines between the comments, at the comment's indentation.
 * Otherwise the content is inline, right after the opening comment.
 *
 * Targets: without --targets, every tracked file listed by
 * `git ls-files '*.md' '*.html'` that contains a region. Markers inside
 * Markdown code spans and fenced code blocks are text, not regions, so
 * documentation can show the syntax. --targets lists the files instead
 * (paths relative to the current directory).
 *
 * Exit status: 0 when every region is current (or was written), 1 when
 * --check finds a stale region or the self-test fails, 2 on a usage error
 * or a malformed region.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  product as productInfo,
  type ProductInfo,
  type ProductLinkKey,
} from "../shared/product.js";

type Format = "html" | "md";

/** Everything a region renders from; the self-test swaps in fixtures. */
export interface RenderContext {
  product: ProductInfo;
}

const defaultContext: RenderContext = { product: productInfo };

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const command = "npx tsx scripts/render-generated-regions.ts";

const urlKeys: readonly ProductLinkKey[] = ["homepageUrl", "docsUrl", "publicRepoUrl", "homebrewRepoUrl"];
const emailKeys = ["supportEmail", "securityEmail"] as const;
type EmailKey = (typeof emailKeys)[number];

/** A malformed region or product value; the message names the file and line. */
export class RegionError extends Error {}

// ---------------------------------------------------------------------------
// Parsing

interface Marker {
  start: number;
  end: number;
  closing: boolean;
  kind: string;
  attrs: Record<string, string>;
  line: number;
}

export interface Region {
  kind: string;
  attrs: Record<string, string>;
  line: number;
  /** Offsets of the text between the two comments. */
  contentStart: number;
  contentEnd: number;
  /** The whitespace before the opening comment when it stands alone on its line. */
  blockIndent?: string;
}

const markerPattern = /<!--\s*(\/?)generated:([^\s>]*)([^]*?)-->/g;
const attrPattern = /\s+([a-z][a-z-]*)=(?:"([^"]*)"|([^\s"]+))/y;

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

function parseAttrs(source: string, where: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let position = 0;
  let match: RegExpExecArray | null;
  attrPattern.lastIndex = 0;
  while ((match = attrPattern.exec(source))) {
    if (match[1] in attrs) throw new RegionError(`${where}: attribute "${match[1]}" is repeated.`);
    attrs[match[1]] = match[2] ?? match[3];
    position = attrPattern.lastIndex;
  }
  // A failed sticky match resets lastIndex, so `position` marks the end.
  if (source.slice(position).trim() !== "")
    throw new RegionError(
      `${where}: cannot read the attributes "${source.trim()}"; write name=value or name="value with spaces".`,
    );
  return attrs;
}

/**
 * Offset ranges of Markdown code: fenced blocks and inline code spans.
 * Markers inside them are examples, not regions.
 */
function markdownCode(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const lines = text.split("\n");
  let offset = 0;
  let fence: { char: string; length: number; start: number } | undefined;
  let prose = "";
  let proseStart = 0;
  const flushProse = () => {
    // A backtick run opens a code span that the next run of the same length closes.
    const runs = [...prose.matchAll(/`+/g)];
    for (let i = 0; i < runs.length; i++) {
      const close = runs.findIndex((run, j) => j > i && run[0].length === runs[i][0].length);
      if (close < 0) continue;
      ranges.push([proseStart + runs[i].index, proseStart + runs[close].index + runs[close][0].length]);
      i = close;
    }
    prose = "";
  };
  for (const line of lines) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length) {
        ranges.push([fence.start, offset + line.length]);
        fence = undefined;
      }
    } else if (fenceMatch) {
      flushProse();
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length, start: offset };
    } else if (line.trim() === "") {
      // Code spans end with their paragraph.
      flushProse();
    } else {
      if (prose === "") proseStart = offset;
      prose += `${line}\n`;
    }
    offset += line.length + 1;
  }
  if (fence) ranges.push([fence.start, text.length]);
  flushProse();
  return ranges;
}

/** Finds the regions of a file; `name` only labels error messages. */
export function parseRegions(text: string, format: Format, name: string): Region[] {
  const code = format === "md" ? markdownCode(text) : [];
  const markers: Marker[] = [];
  for (const match of text.matchAll(markerPattern)) {
    const start = match.index;
    if (code.some(([from, to]) => start >= from && start < to)) continue;
    const line = lineAt(text, start);
    const where = `${name}:${line}`;
    const closing = match[1] === "/";
    if (closing && match[3].trim() !== "")
      throw new RegionError(`${where}: a closing comment takes no attributes.`);
    markers.push({
      start,
      end: start + match[0].length,
      closing,
      kind: match[2],
      attrs: closing ? {} : parseAttrs(match[3], where),
      line,
    });
  }
  const regions: Region[] = [];
  let open: Marker | undefined;
  for (const marker of markers) {
    if (!marker.closing) {
      if (open)
        throw new RegionError(
          `${name}:${marker.line}: generated:${marker.kind} starts inside generated:${open.kind} (line ${open.line}); regions cannot nest.`,
        );
      open = marker;
      continue;
    }
    if (!open)
      throw new RegionError(`${name}:${marker.line}: /generated:${marker.kind} closes no region.`);
    if (marker.kind !== open.kind)
      throw new RegionError(
        `${name}:${marker.line}: /generated:${marker.kind} closes generated:${open.kind} (line ${open.line}).`,
      );
    const lineStart = text.lastIndexOf("\n", open.start - 1) + 1;
    const before = text.slice(lineStart, open.start);
    regions.push({
      kind: open.kind,
      attrs: open.attrs,
      line: open.line,
      contentStart: open.end,
      contentEnd: marker.start,
      blockIndent: /^[ \t]*$/.test(before) ? before : undefined,
    });
    open = undefined;
  }
  if (open) throw new RegionError(`${name}:${open.line}: generated:${open.kind} is never closed.`);
  return regions;
}

// ---------------------------------------------------------------------------
// Rendering

const htmlEntities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => htmlEntities[char]);

/** Backslash-escapes the ASCII punctuation that Markdown would interpret. */
const escapeMarkdown = (value: string) => value.replace(/[\\`*_[\]<>|]/g, "\\$&");

function requireAttrs(region: Region, where: string, required: string[], optional: string[] = []) {
  for (const name of required)
    if (!region.attrs[name])
      throw new RegionError(`${where}: generated:${region.kind} needs ${name}="…".`);
  for (const name of Object.keys(region.attrs))
    if (!required.includes(name) && !optional.includes(name))
      throw new RegionError(`${where}: generated:${region.kind} has no attribute "${name}".`);
}

/** The product value as a link target, or undefined while it is empty. */
function productTarget(region: Region, where: string, context: RenderContext, emails: boolean) {
  const key = region.attrs.key;
  const isUrl = (urlKeys as readonly string[]).includes(key);
  const isEmail = emails && (emailKeys as readonly string[]).includes(key);
  if (!isUrl && !isEmail)
    throw new RegionError(
      `${where}: key must be one of ${[...urlKeys, ...(emails ? emailKeys : [])].join(", ")}, not "${key}".`,
    );
  const value = context.product[key as ProductLinkKey | EmailKey].trim();
  if (value === "") return undefined;
  const subPath = region.attrs.path;
  if (isEmail) {
    if (subPath) throw new RegionError(`${where}: path only applies to URLs, not to ${key}.`);
    if (!/^[^\s@<>"]+@[^\s@<>"]+$/.test(value))
      throw new RegionError(`${where}: shared/product.ts ${key} is not an e-mail address: "${value}".`);
    return `mailto:${value}`;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    url = new URL("invalid:");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new RegionError(`${where}: shared/product.ts ${key} is not an http(s) URL: "${value}".`);
  return subPath ? `${value.replace(/\/+$/, "")}/${subPath.replace(/^\/+/, "")}` : value;
}

function productLink(region: Region, format: Format, where: string, context: RenderContext): string[] {
  requireAttrs(region, where, ["key", "text"], ["path"]);
  const target = productTarget(region, where, context, true);
  if (!target) return [];
  const text = region.attrs.text;
  if (format === "md") {
    const destination = /[\s()<>]/.test(target) ? `<${target}>` : target;
    return [`[${escapeMarkdown(text)}](${destination})`];
  }
  return [`<a href="${escapeHtml(target)}">${escapeHtml(text)}</a>`];
}

function productMeta(region: Region, format: Format, where: string, context: RenderContext): string[] {
  if (format !== "html") throw new RegionError(`${where}: generated:product-meta only works in HTML files.`);
  requireAttrs(region, where, ["key", "property"], ["path"]);
  const target = productTarget(region, where, context, false);
  if (!target) return [];
  return [`<meta property="${escapeHtml(region.attrs.property)}" content="${escapeHtml(target)}">`];
}

function installCommands(region: Region, format: Format, where: string, context: RenderContext): string[] {
  requireAttrs(region, where, ["method"], ["lang"]);
  if (format === "md" && region.blockIndent === undefined)
    throw new RegionError(`${where}: install-commands requires a Markdown block region.`);
  const { method, lang = "en" } = region.attrs;
  if (!["npx", "npm", "curl", "brew", "bun", "powershell", "mise"].includes(method) || !["en", "zh-TW"].includes(lang))
    throw new RegionError(`${where}: invalid installation method or language.`);
  const repoUrl = method === "brew" ? context.product.homebrewRepoUrl : context.product.publicRepoUrl;
  if (!repoUrl) return [];
  const repo = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/?$/.exec(repoUrl);
  const bin = context.product.binNames[0];
  const pkg = context.product.npmPackage;
  if (!repo || !/^[a-z0-9][a-z0-9-]*$/.test(bin) || !/^[a-z0-9][a-z0-9-]*$/.test(pkg))
    throw new RegionError(`${where}: installation commands need a GitHub repository and a safe command name.`);
  const raw = `https://raw.githubusercontent.com/${repo[1]}/${repo[2]}/main`;
  const homepage = context.product.homepageUrl.replace(/\/+$/, "");
  if (method !== "brew" && homepage && !/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?(?:\/[A-Za-z0-9._~-]+)*$/.test(homepage))
    throw new RegionError(`${where}: installation commands need a safe HTTPS homepage URL.`);
  let lines: string[];
  if (method === "npx") {
    lines = [`npx ${pkg}`];
  } else if (method === "npm") {
    lines = [`npm install -g ${pkg}`];
  } else if (method === "curl") {
    lines = [`curl -fsSL ${homepage ? `${homepage}/install` : `${raw}/install.sh`} | sh${lang === "zh-TW" ? " -s -- --lang zh-TW" : ""}`];
  } else if (method === "brew") {
    const tapName = /^homebrew-([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(repo[2])?.[1];
    if (!tapName) throw new RegionError(`${where}: Homebrew needs a GitHub repository named homebrew-<tap>.`);
    const tap = `${repo[1]}/${tapName}`.toLowerCase();
    lines = [`brew install ${tap}/${bin}`];
  } else if (method === "bun") {
    lines = [`bun add --global ${pkg}`];
  } else if (method === "mise") {
    // Use the formula's published release, not a package version still being prepared.
    const formula = fs.readFileSync(path.join(repoRoot, "Formula", `${productInfo.npmPackage}.rb`), "utf8");
    const version = /^ {2}version "([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)"$/m.exec(formula)?.[1];
    if (!version) throw new RegionError(`${where}: Homebrew formula has no published version.`);
    lines = [`MISE_NPM_PACKAGE_MANAGER=npm mise use -g node@24 npm:${pkg}@${version}`];
  } else {
    lines = [
      "& {",
      `  Invoke-RestMethod '${homepage || raw}/install.ps1' -OutFile install.ps1 -ErrorAction Stop`,
      `  powershell -NoProfile -ExecutionPolicy Bypass -File .\\install.ps1${lang === "zh-TW" ? " -Lang zh-TW" : ""}`,
      "}",
    ];
  }
  return format === "html"
    ? [escapeHtml(lines.join("\n"))]
    : [`\`\`\`${method === "powershell" ? "powershell" : "sh"}`, ...lines, "```"];
}

const renderers = {
  "product-link": productLink,
  "product-meta": productMeta,
  "install-commands": installCommands,
} satisfies Record<string, (region: Region, format: Format, where: string, context: RenderContext) => string[]>;

/** The text that belongs between the region's comments. */
export function regionContent(
  region: Region,
  format: Format,
  name: string,
  context: RenderContext,
  eol = "\n",
): string {
  const where = `${name}:${region.line}`;
  if (!Object.hasOwn(renderers, region.kind))
    throw new RegionError(
      `${where}: unknown region generated:${region.kind}; use ${Object.keys(renderers).join(", ")}.`,
    );
  const lines = renderers[region.kind as keyof typeof renderers](region, format, where, context);
  if (region.blockIndent === undefined) return lines.join("");
  // Each line at the comment's indentation, then the closing comment's own.
  const indent = region.blockIndent;
  return eol + [...lines.map((line) => (line ? indent + line : line)), indent].join(eol);
}

export const formatOf = (file: string): Format => (/\.md$/i.test(file) ? "md" : "html");
const targetPattern = /\.(md|html?)$/i;

export interface RenderResult {
  text: string;
  regions: number;
  /** Lines of the regions whose content changed. */
  stale: { line: number; kind: string }[];
}

/** Renders every region of a file's text. */
export function renderText(text: string, name: string, context: RenderContext = defaultContext): RenderResult {
  const format = formatOf(name);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const regions = parseRegions(text, format, name);
  const stale: RenderResult["stale"] = [];
  let output = "";
  let cursor = 0;
  for (const region of regions) {
    const content = regionContent(region, format, name, context, eol);
    if (text.slice(region.contentStart, region.contentEnd) !== content)
      stale.push({ line: region.line, kind: region.kind });
    output += text.slice(cursor, region.contentStart) + content;
    cursor = region.contentEnd;
  }
  return { text: output + text.slice(cursor), regions: regions.length, stale };
}

// ---------------------------------------------------------------------------
// Targets and the command line

/** Tracked .md and .html files under `root` that contain a region. */
export function discoverTargets(root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const result = spawnSync("git", ["ls-files", "-z", "--", "*.md", "*.html"], {
    cwd: root,
    encoding: "utf8",
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new RegionError(`could not run git: ${result.error.message}`);
  if (result.status !== 0) throw new RegionError(`git ls-files failed: ${result.stderr.trim()}`);
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .filter((file) => {
      const full = path.join(root, file);
      if (!fs.existsSync(full)) return false;
      const text = fs.readFileSync(full, "utf8");
      return text.includes("generated:") && parseRegions(text, formatOf(file), file).length > 0;
    })
    .sort();
}

export interface MainOptions {
  root?: string;
  cwd?: string;
  context?: RenderContext;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

const usage = `Usage: ${command} --check|--write [--targets <file>...]
       ${command} --self-test`;

export function main(args: string[], options: MainOptions = {}): number {
  const root = options.root ?? repoRoot;
  const cwd = options.cwd ?? process.cwd();
  const log = options.log ?? ((line) => console.log(line));
  const error = options.error ?? ((line) => console.error(line));
  const mode = args[0];
  const rest = args.slice(1);
  if (mode === "--self-test" && rest.length === 0) return selfTest();
  const targetsGiven = rest[0] === "--targets";
  if ((mode !== "--check" && mode !== "--write") || (rest.length > 0 && (!targetsGiven || rest.length < 2))) {
    error(usage);
    return 2;
  }
  try {
    const files = targetsGiven
      ? rest.slice(1).map((file) => {
          const full = path.resolve(cwd, file);
          if (!fs.existsSync(full)) throw new RegionError(`${file}: no such file.`);
          if (!targetPattern.test(file)) throw new RegionError(`${file}: only .md and .html files have regions.`);
          return { full, name: path.relative(root, full) || file };
        })
      : discoverTargets(root, options.env).map((name) => ({ full: path.join(root, name), name }));
    let regions = 0;
    let stale = 0;
    let updated = 0;
    for (const { full, name } of files) {
      const text = fs.readFileSync(full, "utf8");
      const result = renderText(text, name, options.context);
      regions += result.regions;
      if (result.stale.length === 0) continue;
      if (mode === "--write") {
        fs.writeFileSync(full, result.text);
        updated += 1;
        log(`updated ${name} (${result.stale.length} region(s))`);
      } else {
        for (const item of result.stale) log(`${name}:${item.line}: generated:${item.kind} is stale`);
        stale += result.stale.length;
      }
    }
    if (stale > 0) {
      error(`render-generated-regions: ${stale} stale region(s). Run ${command} --write`);
      return 1;
    }
    error(
      mode === "--write"
        ? `render-generated-regions: ${regions} region(s) in ${files.length} file(s); ${updated} file(s) updated.`
        : `render-generated-regions: ${regions} region(s) in ${files.length} file(s) are current.`,
    );
    return 0;
  } catch (caught) {
    if (!(caught instanceof RegionError)) throw caught;
    error(`render-generated-regions: ${caught.message}`);
    return 2;
  }
}

// ---------------------------------------------------------------------------
// Self-test

function selfTest(): number {
  const product: ProductInfo = {
    ...productInfo,
    homepageUrl: "https://bell.example.test/",
    docsUrl: "",
    publicRepoUrl: "https://code.example.test/bell-pr/",
    homebrewRepoUrl: "https://github.com/packager/homebrew-tools",
    supportEmail: "help@example.test",
    securityEmail: "",
  };
  const context: RenderContext = { ...defaultContext, product };
  const quiet = { log() {}, error() {} };
  const errorOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (caught) {
      if (caught instanceof RegionError) return caught.message;
      throw caught;
    }
    assert.fail("expected a RegionError");
  };

  // HTML: block and inline layouts, empty and set values.
  const html = [
    "<section>",
    '  <p>Source: <!-- generated:product-link key=publicRepoUrl text="Source & more" -->stale<!-- /generated:product-link --></p>',
    '  <p>Docs: <!-- generated:product-link key=docsUrl text=Docs --><a href="old">Docs</a><!-- /generated:product-link --></p>',
    '  <!-- generated:product-link key=supportEmail text="Write to us" -->',
    "  <!-- /generated:product-link -->",
    "  <p>Security: <!-- generated:product-link key=securityEmail text=Report --><!-- /generated:product-link --></p>",
    '  <!-- generated:product-link key=docsUrl text="Docs" -->',
    "  <!-- /generated:product-link -->",
    '  <!-- generated:product-link key=publicRepoUrl path=issues text="Report an issue" --><!-- /generated:product-link -->',
    '  <!-- generated:product-meta key=homepageUrl property="og:image" path="/assets/og.png" --><!-- /generated:product-meta -->',
    "</section>",
    "",
  ].join("\n");
  const first = renderText(html, "page.html", context);
  assert.equal(first.regions, 7);
  const out = first.text;
  assert.ok(
    out.includes(
      'Source: <!-- generated:product-link key=publicRepoUrl text="Source & more" --><a href="https://code.example.test/bell-pr/">Source &amp; more</a><!-- /generated:product-link -->',
    ),
    "text is HTML-escaped",
  );
  // An empty value renders nothing at all, inline or as a block.
  assert.ok(out.includes("Docs: <!-- generated:product-link key=docsUrl text=Docs --><!-- /generated:product-link -->"));
  assert.ok(out.includes("Security: <!-- generated:product-link key=securityEmail text=Report --><!-- /generated:product-link -->"));
  assert.ok(out.includes('<!-- generated:product-link key=docsUrl text="Docs" -->\n  <!-- /generated:product-link -->'));
  assert.ok(
    out.includes('-->\n  <a href="mailto:help@example.test">Write to us</a>\n  <!-- /generated:product-link -->'),
    "the closing comment keeps its indentation",
  );
  assert.ok(out.includes('<a href="https://code.example.test/bell-pr/issues">Report an issue</a>'));
  assert.ok(out.includes('<meta property="og:image" content="https://bell.example.test/assets/og.png">'));
  assert.deepEqual(
    first.stale.map((item) => item.line),
    [2, 3, 4, 9, 10],
    "every region that changed is reported, the current empty ones are not",
  );

  // Rendering is idempotent, and a current file has no stale region.
  const again = renderText(out, "page.html", context);
  assert.equal(again.text, out);
  assert.deepEqual(again.stale, []);

  // A stale region is detected: edited content, or a changed source value.
  const edited = out.replace("Write to us</a>", "Write to me</a>");
  assert.deepEqual(renderText(edited, "page.html", context).stale, [{ line: 4, kind: "product-link" }]);
  const unset = renderText(out, "page.html", { ...context, product: { ...product, publicRepoUrl: "" } });
  assert.ok(unset.stale.some((item) => item.kind === "product-link"));
  assert.ok(unset.text.includes('text="Source & more" --><!-- /generated:product-link -->'));
  const moved = { ...context, product: { ...product, supportEmail: "other@example.test" } };
  assert.deepEqual(renderText(out, "page.html", moved).stale, [{ line: 4, kind: "product-link" }]);

  // Markdown: links, escaping, CRLF, and markers in code that stay untouched.
  const md = [
    "# Links",
    "",
    'Source [here]: <!-- generated:product-link key=publicRepoUrl text="Repo [code]" --><!-- /generated:product-link -->.',
    'Docs: <!-- generated:product-link key=docsUrl text="Docs" -->old<!-- /generated:product-link -->',
    "Write `<!-- generated:product-link key=docsUrl text=Docs -->…<!-- /generated:product-link -->` to add a link.",
    "",
    '<!-- generated:product-link key=supportEmail text="Write to us" -->',
    "<!-- /generated:product-link -->",
    "",
    "```html",
    "<!-- generated:product-link key=docsUrl text=Docs -->",
    "```",
    "",
  ].join("\n");
  const markdown = renderText(md, "README.md", context).text;
  assert.ok(markdown.includes("-->[Repo \\[code\\]](https://code.example.test/bell-pr/)<!--"));
  assert.ok(markdown.includes('text="Docs" --><!-- /generated:product-link -->'));
  assert.ok(markdown.includes("-->\n[Write to us](mailto:help@example.test)\n<!-- /generated:product-link -->"));
  assert.ok(markdown.includes("Write `<!-- generated:product-link key=docsUrl text=Docs -->…<!-- /generated:product-link -->` to add"));
  assert.ok(markdown.includes("```html\n<!-- generated:product-link key=docsUrl text=Docs -->\n```"));
  const pipes = "<!-- generated:product-link key=publicRepoUrl text=\"A | B <c> *x*\" --><!-- /generated:product-link -->";
  assert.ok(renderText(pipes, "README.md", context).text.includes("[A \\| B \\<c\\> \\*x\\*](https://code.example.test/bell-pr/)"));
  // A backtick without a partner in its paragraph hides nothing.
  const loose = "Use ` carefully.\n\n<!-- generated:product-link key=docsUrl text=Docs -->x<!-- /generated:product-link -->\n\nAnd ` here.\n";
  assert.equal(renderText(loose, "x.md", context).regions, 1);
  const crlf = renderText(md.replace(/\n/g, "\r\n"), "README.md", context).text;
  assert.equal(crlf, markdown.replace(/\n/g, "\r\n"));

  const install = (method: string) => `<!-- generated:install-commands method=${method} lang=zh-TW -->\n<!-- /generated:install-commands -->\n`;
  const installerContext = { product: { ...product, homepageUrl: "", publicRepoUrl: "https://github.com/example/workbench" } };
  for (const method of ["npx", "npm", "curl", "brew", "bun", "powershell", "mise"]) {
    const rendered = renderText(install(method), "install.md", installerContext);
    if (["curl", "powershell"].includes(method))
      assert.match(rendered.text, /github(?:usercontent)?\.com\/example\/workbench/);
    assert.deepEqual(renderText(rendered.text, "install.md", installerContext).stale, []);
    const hidden = renderText(install(method), "install.md", { product: { ...product, publicRepoUrl: "", homebrewRepoUrl: "" } }).text;
    assert.ok(!hidden.includes("```"));
    const html = renderText(`<code>${install(method).trim()}</code>`, "install.html", installerContext);
    assert.ok(!html.text.includes("```"));
    assert.deepEqual(renderText(html.text, "install.html", installerContext).stale, []);
    if (method === "brew") {
      const brew = `brew install packager/tools/${product.binNames[0]}`;
      assert.ok(rendered.text.includes(`\n${brew}\n`));
      assert.ok(html.text.includes(`-->${brew}<!--`));
      assert.doesNotMatch(html.text, /brew tap|&&|&amp;/);
    }
    if (method === "powershell") assert.match(html.text, /&amp; \{/);
    if (method === "npx") assert.ok(html.text.includes(`npx ${product.npmPackage}`));
    if (method === "npm") assert.ok(html.text.includes(`npm install -g ${product.npmPackage}`));
  }
  const noTap = { product: { ...installerContext.product, homebrewRepoUrl: "" } };
  assert.ok(!renderText(install("brew"), "install.md", noTap).text.includes("```"));
  assert.match(renderText(install("npm"), "install.md", noTap).text, /npm install -g/);
  assert.match(renderText(install("brew"), "install.md", {
    product: { ...installerContext.product, publicRepoUrl: "" },
  }).text, /brew install packager\/tools\//);
  for (const homebrewRepoUrl of [
    "https://github.com/example/workbench",
    "https://github.com/example/homebrew-",
    "https://github.com/example/homebrew-tools;touch",
    "https://example.test/example/homebrew-tools",
  ]) assert.match(errorOf(() => renderText(install("brew"), "install.md", {
    product: { ...installerContext.product, homebrewRepoUrl },
  })), /Homebrew needs|GitHub repository/);
  const tapLink = '<!-- generated:product-link key=homebrewRepoUrl text="Homebrew tap" --><!-- /generated:product-link -->';
  assert.match(renderText(tapLink, "install.md", installerContext).text, /\[Homebrew tap\]\(https:\/\/github\.com\/packager\/homebrew-tools\)/);
  assert.ok(!renderText(tapLink, "install.md", noTap).text.includes("[Homebrew tap]"));
  const hostedInstaller = { product: { ...installerContext.product, homepageUrl: "https://install.example.test" } };
  assert.match(renderText(install("curl"), "install.md", hostedInstaller).text, /https:\/\/install\.example\.test\/install \| sh/);
  assert.match(renderText(install("powershell"), "install.md", hostedInstaller).text, /https:\/\/install\.example\.test\/install\.ps1/);
  assert.match(errorOf(() => renderText(install("curl"), "install.md", {
    product: { ...installerContext.product, homepageUrl: "https://example.test/$(command)" },
  })), /safe HTTPS homepage/);
  assert.match(renderText(install("curl"), "install.md", installerContext).text, /sh -s -- --lang zh-TW/);
  assert.match(renderText(install("powershell"), "install.md", installerContext).text, /-Lang zh-TW/);
  assert.match(errorOf(() => renderText(install("invalid"), "install.md", installerContext)), /invalid installation/);

  // Malformed regions are errors with a line number.
  const bad = (text: string, file = "bad.html") => errorOf(() => renderText(text, file, context));
  assert.match(bad("x\n<!-- generated:product-link key=docsUrl text=a -->\n"), /bad\.html:2: generated:product-link is never closed/);
  assert.match(bad("<!-- /generated:product-link -->"), /closes no region/);
  assert.match(bad("<!-- generated:product-link key=docsUrl text=a --><!-- /generated:product-meta -->"), /closes generated:product-link/);
  assert.match(
    bad("<!-- generated:product-link key=docsUrl text=a -->\n<!-- generated:product-link key=docsUrl text=a -->"),
    /cannot nest/,
  );
  assert.match(bad("<!-- generated:price-table --><!-- /generated:price-table -->"), /unknown region generated:price-table/);
  assert.match(bad("<!-- generated:product-link key=docsUrl --><!-- /generated:product-link -->"), /needs text=/);
  assert.match(bad("<!-- generated:product-link key=name text=a --><!-- /generated:product-link -->"), /key must be one of/);
  assert.match(bad("<!-- generated:product-link key=docsUrl text=a size=2 --><!-- /generated:product-link -->"), /no attribute "size"/);
  assert.match(bad('<!-- generated:product-link key=docsUrl text="a --><!-- /generated:product-link -->'), /cannot read the attributes/);
  assert.match(bad("<!-- generated:product-meta key=homepageUrl property=og:url --><!-- /generated:product-meta -->", "x.md"), /only works in HTML/);
  assert.match(bad("<!-- generated:product-meta key=supportEmail property=og:url --><!-- /generated:product-meta -->"), /key must be one of/);
  const notUrl = { ...context, product: { ...product, docsUrl: "docs.example.test" } };
  assert.match(
    errorOf(() => renderText("<!-- generated:product-link key=docsUrl text=a --><!-- /generated:product-link -->", "x.html", notUrl)),
    /is not an http\(s\) URL/,
  );

  // Target discovery and the command line, in a temporary git repository.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bellpr-regions-"));
  // Drop GIT_DIR and the like, which a hook may set; they would point git
  // at another repository.
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: os.devNull,
  };
  try {
    const write = (file: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true });
      fs.writeFileSync(path.join(temp, file), text);
    };
    const region = '<!-- generated:product-link key=publicRepoUrl text="Source" -->\n<!-- /generated:product-link -->\n';
    write("README.md", `# Fixture\n\n${region}`);
    write("site/index.html", `<main>\n${region}</main>\n`);
    write("docs/plain.md", "# No regions here\n");
    write("docs/syntax.md", "Use `<!-- generated:product-link key=docsUrl text=Docs -->` markers.\n");
    write("notes.txt", region);
    write("untracked.md", region);
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: temp, encoding: "utf8", env });
      assert.equal(result.status, 0, result.stderr);
    };
    git("init", "-q");
    git("add", "README.md", "site/index.html", "docs/plain.md", "docs/syntax.md", "notes.txt");
    assert.deepEqual(discoverTargets(temp, env), ["README.md", "site/index.html"]);

    const run = (...args: string[]) => main(args, { root: temp, cwd: temp, context, env, ...quiet });
    assert.equal(run("--check"), 1, "the fixtures start stale");
    assert.equal(run("--write"), 0);
    assert.equal(run("--check"), 0);
    assert.ok(fs.readFileSync(path.join(temp, "site/index.html"), "utf8").includes('<a href="https://code.example.test/bell-pr/">Source</a>'));
    assert.equal(fs.readFileSync(path.join(temp, "untracked.md"), "utf8"), region, "untracked files are not targets");
    // --targets replaces discovery.
    assert.equal(run("--check", "--targets", "untracked.md"), 1);
    assert.equal(run("--write", "--targets", "untracked.md"), 0);
    assert.equal(run("--check", "--targets", "untracked.md", "README.md"), 0);
    assert.equal(run("--check", "--targets", "missing.md"), 2);
    assert.equal(run("--check", "--targets"), 2);
    assert.equal(run("--fix"), 2);
    assert.equal(run("--check", "--targets", "notes.txt"), 2);
    write("site/index.html", "<!-- generated:product-link key=docsUrl text=Docs -->\n");
    git("add", "site/index.html");
    assert.equal(run("--check"), 2, "a malformed region is a usage error");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log("render-generated-regions self-test: ok");
  return 0;
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (isEntry) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (caught) {
    if (caught instanceof assert.AssertionError) {
      console.error(`render-generated-regions self-test failed:\n${caught.message}`);
      process.exitCode = 1;
    } else {
      console.error(caught);
      process.exitCode = 2;
    }
  }
}
