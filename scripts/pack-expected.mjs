#!/usr/bin/env node
/**
 * Exact file list for the npm package (sorted), checked in CI and locally.
 *
 *   node scripts/pack-expected.mjs --write   regenerate scripts/pack-expected.txt
 *   node scripts/pack-expected.mjs --check   compare pack to the committed list
 *
 * Uses `npm pack --dry-run --json` (lifecycle scripts run: prepack builds and
 * rewrites README.md; postpack restores). Callers should start from a clean
 * git tree so the list matches what CI packs.
 *
 * Exit status: 0 ok, 1 mismatch / missing expected, 2 usage or setup error.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePackReport } from "./npm-pack-report.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedPath = path.join(root, "scripts", "pack-expected.txt");

class SetupError extends Error {}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/** Sorted package paths from `npm pack --dry-run --json`. */
export function packFileList(cwd = root) {
  const windows = process.platform === "win32";
  // Run lifecycle scripts without mixing their (possibly colored) output into JSON.
  const result = spawnSync(npmCommand(), ["pack", "--dry-run", "--json", "--foreground-scripts=false"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: windows,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new SetupError(`could not run npm: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim().split(/\n/).slice(-12).join("\n");
    throw new SetupError(`npm pack --dry-run failed (status ${result.status})${detail ? `:\n${detail}` : "."}`);
  }
  let entry;
  try {
    entry = parsePackReport(result.stdout);
  } catch {
    throw new SetupError("could not read the JSON report of `npm pack --dry-run --json`.");
  }
  return {
    files: entry.files.map((file) => file.path).sort(),
    size: entry.size,
    unpackedSize: entry.unpackedSize,
    filename: entry.filename,
    name: entry.name,
    version: entry.version,
  };
}

export function readExpected(file = expectedPath) {
  if (!existsSync(file)) throw new SetupError(`${path.relative(root, file)} is missing; run node scripts/pack-expected.mjs --write.`);
  return readFileSync(file, "utf8")
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export function formatExpected(files) {
  return `# Exact paths from \`npm pack --dry-run --json\`, one per line, sorted.\n# Regenerate: node scripts/pack-expected.mjs --write\n${files.join("\n")}\n`;
}

/** Compare actual sorted paths to expected; returns problem strings. */
export function diffExpected(actual, expected) {
  const problems = [];
  const a = new Set(actual);
  const e = new Set(expected);
  for (const file of expected) if (!a.has(file)) problems.push(`missing from pack: ${file}`);
  for (const file of actual) if (!e.has(file)) problems.push(`unexpected in pack: ${file}`);
  if (actual.length !== expected.length && problems.length === 0) {
    problems.push(`file count differs: pack has ${actual.length}, expected ${expected.length}`);
  }
  return problems;
}

function main(argv) {
  const mode = argv[0];
  if (mode !== "--write" && mode !== "--check") {
    console.error("Usage: node scripts/pack-expected.mjs --write | --check");
    return 2;
  }
  const { files, size, unpackedSize } = packFileList();
  if (mode === "--write") {
    writeFileSync(expectedPath, formatExpected(files));
    console.log(
      `wrote ${path.relative(root, expectedPath)} (${files.length} files; packed ${size} B, unpacked ${unpackedSize} B)`,
    );
    return 0;
  }
  let expected;
  try {
    expected = readExpected();
  } catch (error) {
    if (error instanceof SetupError) {
      console.error(`pack-expected: ${error.message}`);
      return 2;
    }
    throw error;
  }
  const problems = diffExpected(files, expected);
  if (problems.length) {
    for (const problem of problems) console.error(`pack-expected: ${problem}`);
    console.error(
      `pack-expected: pack has ${files.length} files (packed ${size} B, unpacked ${unpackedSize} B); expected ${expected.length}. Regenerated list: node scripts/pack-expected.mjs --write`,
    );
    return 1;
  }
  console.log(
    `pack-expected: ${files.length} files match scripts/pack-expected.txt (packed ${size} B, unpacked ${unpackedSize} B).`,
  );
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof SetupError) {
      console.error(`pack-expected: ${error.message}`);
      process.exitCode = 2;
    } else throw error;
  }
}
