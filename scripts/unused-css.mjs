#!/usr/bin/env node
// Lists the style rules in src/**/*.css that may never match, so they can be
// reviewed and deleted (zero dependencies). Informative: it always exits 0.
//
//   node scripts/unused-css.mjs                rules whose selectors name a class
//                                              that no source file sets
//   node scripts/unused-css.mjs --dom <path>   also the rules whose classes never
//                                              appeared in the rendered pages listed
//                                              in <path> (a file, or a folder of
//                                              them); repeatable
//   node scripts/unused-css.mjs --json         the same report as JSON
//
// The rendered classes come from an e2e run with the capture hook preloaded:
//
//   CSS_USAGE_DIR=<empty folder> NODE_OPTIONS="--import ./scripts/css-usage-hook.mjs" \
//     BELLPR_E2E_PORT=<port> npm run test:e2e
//   node scripts/unused-css.mjs --dom <that folder>
//
// A file of classes is a JSON array of names, or one name per line.
//
// A class is set by the sources when it appears as a word anywhere in
// src/**/*.{ts,tsx} outside the dictionaries, or in index.html (tests
// included: they name the classes the UI renders). A word that ends in "-"
// before an interpolation or a concatenation (`rv-${kind}`, "tone-" + x)
// makes every class with that prefix count. Classes that libraries add at
// runtime (lucide's icon classes, the Markdown renderer's task-list,
// footnote and language-* classes) are listed in `runtimeClasses` and
// `runtimePrefixes`.
//
// A selector misses when one of its classes outside :not(), :is(), :where()
// and :has() is missing; a rule is listed when every selector in its list
// misses. Two lists:
// - "unused": a class that no source file sets. Unless something builds it
//   in a way this script cannot see, the rule is dead.
// - "not rendered" (with --dom): every class is in the sources, but one never
//   appeared in the e2e run. Either the e2e tests do not reach that state
//   (an error, a dialog, a narrow screen...) or the code that sets the class
//   is itself dead.
// Review each rule before deleting it: search for its classes and the code
// that sets them.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// Classes that libraries add: lucide-react on every icon, and the Markdown
// renderer (src/review/markdown/render.ts, after mdast-util-to-hast) on task
// lists, footnotes and fenced code.
const runtimeClasses = new Set([
  "lucide",
  "contains-task-list",
  "task-list-item",
  "footnotes",
  "sr-only",
  "data-footnote-backref",
]);
const runtimePrefixes = ["lucide-", "language-"];

function walk(directory, test, found = []) {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) walk(relative, test, found);
    else if (test(relative)) found.push(relative);
  }
  return found;
}

/**
 * Every word of a source file (code, strings and comments alike, so that
 * no class hides from a parser), and the prefixes it builds classes from:
 * `rv-${kind}` or "tone-" + kind.
 */
export function sourceClasses(text, words = new Set(), prefixes = new Set()) {
  for (const word of text.match(/-?[_a-zA-Z][\w-]*/g) ?? []) words.add(word);
  for (const match of text.matchAll(/([_a-zA-Z][\w-]*-)(?:\$\{|["'`]\s*\+)/g))
    prefixes.add(match[1]);
  return { words, prefixes };
}

/** Removes comments; keeps offsets readable by replacing them with spaces. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));

/** Splits at top-level commas (outside parentheses and brackets). */
function splitList(text) {
  const items = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      items.push(text.slice(start, index));
      start = index + 1;
    }
  }
  items.push(text.slice(start));
  return items.map((item) => item.trim()).filter(Boolean);
}

/** The style rules of a stylesheet, with their line, at any depth of @media, @container, @supports or @layer. */
export function styleRules(css) {
  const text = stripComments(css);
  const rules = [];
  const lineOf = (offset) => text.slice(0, offset).split("\n").length;
  function block(start, end) {
    let index = start;
    while (index < end) {
      const open = text.indexOf("{", index);
      if (open < 0 || open >= end) return;
      const prelude = text.slice(index, open);
      // Statements such as @import end with ";" before the next block.
      const statement = prelude.lastIndexOf(";");
      const head = (statement >= 0 ? prelude.slice(statement + 1) : prelude).trim();
      const headStart = statement >= 0 ? index + statement + 1 : index;
      let depth = 1;
      let close = open + 1;
      for (; close < end && depth; close++) {
        if (text[close] === "{") depth++;
        else if (text[close] === "}") depth--;
      }
      if (/^@(media|container|supports|layer)\b/.test(head)) block(open + 1, close - 1);
      else if (!head.startsWith("@") && !/^(from|to|\d+%)/.test(head))
        rules.push({
          selector: head.replace(/\s+/g, " "),
          line: lineOf(headStart + prelude.slice(statement + 1).search(/\S/)),
        });
      index = close;
    }
  }
  block(0, text.length);
  return rules;
}

/** The classes a selector needs to match: those outside functional pseudo-classes. */
export function requiredClasses(selector) {
  let flat = "";
  let depth = 0;
  for (const char of selector.replace(/\[[^\]]*\]/g, "")) {
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (depth === 0) flat += char;
  }
  return [...flat.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
}

/** The class names in a file of them, or in every file of a folder. */
function readClasses(target) {
  if (statSync(target).isDirectory())
    return readdirSync(target).flatMap((name) => readClasses(path.join(target, name)));
  const text = readFileSync(target, "utf8").trim();
  return text.startsWith("[") ? JSON.parse(text) : text.split(/\s+/);
}

/** The rules whose every selector misses a class that `has` lacks. */
function missing(has) {
  const found = [];
  for (const file of walk("src", (name) => name.endsWith(".css")).sort()) {
    for (const rule of styleRules(readFileSync(path.join(root, file), "utf8"))) {
      const lacking = splitList(rule.selector).map((selector) =>
        requiredClasses(selector).filter((name) => !has(name)),
      );
      if (lacking.every((names) => names.length))
        found.push({ file, line: rule.line, selector: rule.selector, classes: [...new Set(lacking.flat())] });
    }
  }
  return found;
}

export function report({ dom = [] } = {}) {
  const words = new Set(runtimeClasses);
  const prefixes = new Set(runtimePrefixes);
  // The dictionaries hold prose, whose words would hide unused classes.
  const sources = [
    ...walk("src", (file) => /\.(ts|tsx)$/.test(file) && !/(^|\/)i18n\//.test(file)),
    "index.html",
  ];
  for (const file of sources) sourceClasses(readFileSync(path.join(root, file), "utf8"), words, prefixes);
  const set = (name) => words.has(name) || [...prefixes].some((prefix) => name.startsWith(prefix));
  const unused = missing(set);
  if (!dom.length) return { unused };
  const rendered = new Set([...runtimeClasses, ...dom.flatMap(readClasses)]);
  const shown = (name) => rendered.has(name) || runtimePrefixes.some((prefix) => name.startsWith(prefix));
  const listed = new Set(unused.map((rule) => `${rule.file}:${rule.line}`));
  const notRendered = missing(shown).filter((rule) => !listed.has(`${rule.file}:${rule.line}`));
  return { unused, notRendered };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dom = args.flatMap((arg, index) => (arg === "--dom" ? [args[index + 1]] : []));
  const result = report({ dom });
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    const print = (title, rules) => {
      console.log(`${title} (${rules.length}):`);
      for (const rule of rules)
        console.log(`  ${rule.file}:${rule.line}  ${rule.selector}  (${rule.classes.join(", ")})`);
    };
    print("Unused: a class no source file sets", result.unused);
    if (result.notRendered) print("Not rendered: a class the e2e run never showed", result.notRendered);
  }
}
