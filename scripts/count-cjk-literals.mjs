#!/usr/bin/env node
// Counts the string literals that hold Han characters in .ts/.tsx files.
//
// A literal is a string literal, a template literal without substitutions,
// one text part of a template literal (head, middle or tail) or a JSX text
// node. Comments and regular expressions are not literals. Test files
// (*.test.ts, *.test.tsx) are skipped unless --include-tests is given.
//
// Use it to check that a refactor moved copy without losing or duplicating
// any: run it before and after and compare the totals.
//
//   node scripts/count-cjk-literals.mjs [--json] [--include-tests]
//     [--paths <file-or-folder>...]
//
// --paths takes one or more files or folders (relative to the current
// directory, or comma-separated) and defaults to src, server and shared.
// --json prints {"files": {"<path>": <count>}, "total": <count>}; files
// without such literals are left out.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const han = /\p{Script=Han}/u;
const skippedFolders = new Set(["node_modules", "dist", "build", ".git"]);
const literalKinds = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
]);

const isTest = (file) => /\.test\.tsx?$/.test(file);
const isSource = (file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts");

/** Number of literals in one file's source text that contain a Han character. */
export function countCjkLiterals(fileName, text) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let count = 0;
  const visit = (node) => {
    if (literalKinds.has(node.kind) && han.test(node.text)) count++;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

function listFiles(entry, includeTests, found) {
  const stats = statSync(entry);
  if (stats.isDirectory()) {
    for (const name of readdirSync(entry).sort()) {
      if (skippedFolders.has(name)) continue;
      listFiles(path.join(entry, name), includeTests, found);
    }
  } else if (isSource(entry) && (includeTests || !isTest(entry))) {
    found.push(entry);
  }
  return found;
}

export function parseArguments(argv) {
  const options = { json: false, includeTests: false, paths: [] };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--json") options.json = true;
    else if (value === "--include-tests") options.includeTests = true;
    else if (value.startsWith("--paths=")) {
      options.paths.push(...value.slice("--paths=".length).split(","));
    } else if (value === "--paths") {
      while (argv[index + 1] !== undefined && !argv[index + 1].startsWith("--"))
        options.paths.push(...argv[++index].split(","));
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  options.paths = options.paths.filter(Boolean);
  if (!options.paths.length) options.paths = ["src", "server", "shared"];
  return options;
}

/** {files: {path: count}, total} for the files under the given paths. */
export function countPaths(paths, { includeTests = false } = {}) {
  const files = {};
  let total = 0;
  const seen = new Set();
  for (const entry of paths) {
    for (const file of listFiles(entry, includeTests, [])) {
      const key = path.relative(process.cwd(), file).split(path.sep).join("/");
      if (seen.has(key)) continue;
      seen.add(key);
      const count = countCjkLiterals(file, readFileSync(file, "utf8"));
      if (!count) continue;
      files[key] = count;
      total += count;
    }
  }
  return { files, total };
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const result = countPaths(options.paths, options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const width = String(result.total).length;
  for (const [file, count] of Object.entries(result.files))
    console.log(`${String(count).padStart(width)}  ${file}`);
  console.log(`${String(result.total).padStart(width)}  total`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
