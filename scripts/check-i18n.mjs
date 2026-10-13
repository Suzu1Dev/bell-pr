#!/usr/bin/env node
// Reports text that still needs translating: lines in src/, server/ and
// shared/ (*.ts, *.tsx) and index.html that contain Han characters or CJK
// punctuation, outside the zh-TW dictionaries and tests. index.html must also
// declare <html lang="en">.
//
// A line is allowed when it, or the line above, carries the comment
// "i18n-allow: <reason>". The only reasons are "autonym" (a language's own
// name) and "parser" (a pattern that must match CJK input); any other reason
// is reported as an error.
//
// Usage: node scripts/check-i18n.mjs [--report] [--paths <file or dir>...]
//   default   print file:line: snippet for every finding; exit 1 if any
//   --report  print the count per file and per area instead; always exit 0
//   --paths   check only these files or directories (relative to the
//             current directory)
// Zero dependencies: plain Node.js.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultTargets = ["src", "server", "shared", "index.html"];

// Han by script extension, so marks that Han text uses (such as U+3001) count
// too, plus the CJK symbols and punctuation block and the half-width and
// full-width forms block, whose punctuation (such as U+FF1B) is Script=Common.
// The Latin middle dot U+00B7 also lists Han among its script extensions, but
// English text uses it as a separator ("Free \u00B7 Pro"), so it never counts.
const cjk = /(?!\u00B7)[\p{Script_Extensions=Han}\u3000-\u303F\uFF00-\uFFEF]/u;
const allowReasons = new Set(["autonym", "parser"]);
const pragma = /\bi18n-allow\b(:?)[ \t]*([\w-]*)/g;
const htmlLangEn = /<html\b[^>]*\slang\s*=\s*(["']?)en\1(?=[\s>/])/i;

const skippedDirectories = new Set(["node_modules", "vendor", "dist", "build"]);
const excluded = [
  /\.test\.tsx?$/,
  /(^|\/)i18n\/zh-TW\//,
  /(^|\/)src\/demo\/zh-TW\.ts$/,
  /(^|\/)shared\/i18n\/[^/]*zh-TW[^/]*$/,
  /(^|\/)(node_modules|vendor|dist|build)\//,
];

function usage(message) {
  if (message) console.error(`check-i18n: ${message}`);
  console.error(
    "Usage: node scripts/check-i18n.mjs [--report] [--paths <file or dir>...]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const options = { report: false, paths: undefined };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--report") options.report = true;
    else if (arg === "--paths") {
      options.paths = [];
      while (index + 1 < argv.length && !argv[index + 1].startsWith("--"))
        options.paths.push(argv[++index]);
      if (!options.paths.length) usage("--paths needs at least one path");
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/check-i18n.mjs [--report] [--paths <file or dir>...]",
      );
      process.exit(0);
    } else usage(`unknown argument ${arg}`);
  }
  return options;
}

function inside(directory, file) {
  const relative = path.relative(directory, file);
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

// Repository files are named from the repository root; other files from the
// current directory, or absolutely when they are outside it as well.
function displayName(file) {
  const base = inside(root, file)
    ? root
    : inside(process.cwd(), file)
      ? process.cwd()
      : undefined;
  const name = base ? path.relative(base, file) : file;
  return name.split(path.sep).join("/");
}

// Code point order, so the output does not depend on the machine's locale.
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isExcluded = (name) => excluded.some((pattern) => pattern.test(name));
const isIndexHtml = (name) => path.posix.basename(name) === "index.html";
const isSource = (name) => /\.tsx?$/.test(name);

function collect(target, files) {
  const stat = statSync(target);
  if (stat.isFile()) {
    files.add(target);
    return;
  }
  if (!stat.isDirectory()) return;
  const entries = readdirSync(target, { withFileTypes: true }).sort((a, b) =>
    byName(a.name, b.name),
  );
  for (const entry of entries) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name) && !entry.name.startsWith("."))
        collect(full, files);
    } else if (entry.isFile() && (isSource(entry.name) || isIndexHtml(entry.name)))
      files.add(full);
  }
}

function checkFile(file) {
  const name = displayName(file);
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const result = { name, hits: [], errors: [] };
  let allowedThrough = -1;
  lines.forEach((line, index) => {
    for (const match of line.matchAll(pragma)) {
      const [, colon, reason] = match;
      if (!colon)
        result.errors.push({
          line: index + 1,
          text: 'malformed pragma; write "i18n-allow: <reason>"',
        });
      else if (!allowReasons.has(reason))
        result.errors.push({
          line: index + 1,
          text: reason
            ? `unknown i18n-allow reason "${reason}"; allowed: autonym, parser`
            : "i18n-allow needs a reason: autonym or parser",
        });
      else allowedThrough = index + 1;
    }
    if (index <= allowedThrough || !cjk.test(line)) return;
    result.hits.push({ line: index + 1, text: snippet(line) });
  });
  if (isIndexHtml(name)) {
    const source = lines.join("\n");
    if (!htmlLangEn.test(source)) {
      const at = lines.findIndex((line) => /<html\b/i.test(line));
      result.errors.push({
        line: at === -1 ? 1 : at + 1,
        text: 'index.html must declare <html lang="en">',
      });
      result.missingLang = true;
    }
  }
  return result;
}

function snippet(line) {
  const text = line.trim();
  if (text.length <= 160) return text;
  const at = Math.max(0, text.search(cjk) - 40);
  return `${at ? "…" : ""}${text.slice(at, at + 160)}…`;
}

// The top-level folder (or file) a finding counts toward in the totals.
function area(name) {
  return path.isAbsolute(name) ? path.dirname(name) : name.split("/")[0];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const targets = options.paths
    ? options.paths.map((target) => path.resolve(target))
    : defaultTargets.map((target) => path.join(root, target));
  const files = new Set();
  for (const target of targets) {
    if (!existsSync(target)) {
      if (options.paths) usage(`no such file or directory: ${target}`);
      continue;
    }
    collect(target, files);
  }
  const results = [...files]
    .map((file) => ({ file, name: displayName(file) }))
    .filter(({ name }) => !isExcluded(name))
    .sort((a, b) => byName(a.name, b.name))
    .map(({ file }) => checkFile(file));
  const hits = results.reduce((sum, result) => sum + result.hits.length, 0);
  const errors = results.reduce((sum, result) => sum + result.errors.length, 0);

  if (options.report) {
    printReport(results, hits, errors);
    return 0;
  }
  for (const result of results) {
    const findings = [...result.hits, ...result.errors].sort(
      (a, b) => a.line - b.line,
    );
    for (const finding of findings)
      console.log(`${result.name}:${finding.line}: ${finding.text}`);
  }
  if (hits || errors) {
    console.error(
      `check-i18n: ${hits} line(s) with Han characters or CJK punctuation, ${errors} other error(s).`,
    );
    console.error(
      'Move UI text into the dictionaries. Only a language name ("i18n-allow: autonym") or a pattern that must match CJK input ("i18n-allow: parser") may stay.',
    );
    return 1;
  }
  console.log(`check-i18n: ${results.length} file(s) checked, nothing to translate.`);
  return 0;
}

function printReport(results, hits, errors) {
  const flagged = results.filter(
    (result) => result.hits.length || result.errors.length,
  );
  console.log(
    "check-i18n report: lines with Han characters or CJK punctuation per file",
  );
  const width = String(Math.max(0, ...flagged.map((r) => r.hits.length))).length;
  for (const result of flagged.sort(
    (a, b) => b.hits.length - a.hits.length || byName(a.name, b.name),
  ))
    console.log(
      `  ${String(result.hits.length).padStart(width)}  ${result.name}${result.missingLang ? ' (missing <html lang="en">)' : ""}`,
    );
  const areas = new Map();
  for (const result of flagged.filter((r) => r.hits.length)) {
    const key = area(result.name);
    const entry = areas.get(key) ?? { hits: 0, files: 0 };
    entry.hits += result.hits.length;
    entry.files += 1;
    areas.set(key, entry);
  }
  console.log("");
  console.log("Totals:");
  for (const [key, entry] of [...areas].sort((a, b) => byName(a[0], b[0])))
    console.log(`  ${key}: ${entry.hits} line(s) in ${entry.files} file(s)`);
  console.log(
    `  total: ${hits} line(s) in ${flagged.filter((r) => r.hits.length).length} file(s); ${results.length} file(s) checked`,
  );
  const errorList = results.flatMap((result) =>
    result.errors.map((error) => `${result.name}:${error.line}: ${error.text}`),
  );
  console.log(`Other errors: ${errors}`);
  for (const line of errorList) console.log(`  ${line}`);
}

process.exitCode = main();
