#!/usr/bin/env node
/**
 * Keeps the owner's personal infrastructure out of the repository and out of
 * the npm package.
 *
 *   node scripts/check-personal-info.mjs              tracked files (git grep)
 *   node scripts/check-personal-info.mjs --pack       files `npm pack` would publish
 *   node scripts/check-personal-info.mjs --self-test  this script, on fixtures
 *
 * The patterns are owner identifiers only. Generic paths such as
 * /home/<user>/ and product URLs are not checked. Each pattern is built from
 * fragments, so this file never matches itself.
 *
 * Justified exceptions go in scripts/personal-info-allowlist.txt, one per
 * line, as `<path>:<pattern id>  # <reason>`. Use the pattern ids below and
 * never write the identifier itself.
 *
 * Exit status: 0 when clean, 1 when something matched, 2 on a usage or setup
 * error.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fragments = (...parts) => parts.join("");

/** `search` is plain text matched case-insensitively; `word` requires word boundaries. */
const patterns = [
  { id: "user", search: fragments("ubuntu", "2604") },
  { id: "tailnet", search: fragments("tail", "1efcdf") },
  { id: "handle", search: fragments("suzu", "1dev") },
  { id: "port", search: fragments("2000", "2"), word: true },
].map((pattern) => ({
  ...pattern,
  regex: new RegExp(
    pattern.word ? `\\b${pattern.search}\\b` : pattern.search,
    "i",
  ),
}));
const patternIds = patterns.map((pattern) => pattern.id);

/** Paths that must never be published, whatever they contain. */
const forbiddenInPackage =
  /^(tools|deploy|\.agents|e2e|marketing|site|scripts|test)\/|^AGENTS\.md$|\.test\.tsx?$|\.pem$|\.key$/;

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const allowlistName = "scripts/personal-info-allowlist.txt";
const maxBuffer = 512 * 1024 * 1024;

/** A problem with the setup or the allowlist rather than a finding. */
class SetupError extends Error {}

function matchingIds(text) {
  return patterns
    .filter((pattern) => pattern.regex.test(text))
    .map((pattern) => pattern.id);
}

function readAllowlist() {
  let text;
  try {
    text = fs.readFileSync(path.join(root, allowlistName), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const entries = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const where = `${allowlistName}:${index + 1}`;
    const match = /^(\S.*?):([a-z]+)\s+#\s*(\S.*)$/.exec(line);
    if (!match)
      throw new SetupError(
        `${where}: expected "<path>:<pattern id>  # <reason>".`,
      );
    if (!patternIds.includes(match[2]))
      throw new SetupError(
        `${where}: unknown pattern id "${match[2]}"; use one of ${patternIds.join(", ")}.`,
      );
    entries.push({ file: match[1], id: match[2], where, used: false });
  });
  return entries;
}

/** Drops allowlisted findings and marks the entries that were used. */
function applyAllowlist(findings, allowlist) {
  return findings.filter((finding) => {
    const entry = allowlist.find(
      (item) => item.file === finding.file && item.id === finding.id,
    );
    if (entry) entry.used = true;
    return !entry;
  });
}

/** Parses `git grep -z -n` output: `<path>\0<line>\0<text>\n` per match. */
function parseGitGrep(output) {
  const matches = [];
  let index = 0;
  while (index < output.length) {
    const afterPath = output.indexOf("\0", index);
    const afterLine = output.indexOf("\0", afterPath + 1);
    if (afterPath < 0 || afterLine < 0) break;
    let end = output.indexOf("\n", afterLine + 1);
    if (end < 0) end = output.length;
    matches.push({
      file: output.slice(index, afterPath),
      line: Number(output.slice(afterPath + 1, afterLine)),
      text: output.slice(afterLine + 1, end),
    });
    index = end + 1;
  }
  return matches;
}

function findingsIn(file, line, text) {
  return matchingIds(text).map((id) => ({ file, line, id }));
}

/** Prints one `path:line  (ids)` row per line, in the order found. */
function printFindings(findings) {
  const rows = new Map();
  for (const { file, line, id } of findings) {
    const key = `${file}:${line}`;
    rows.set(key, [...(rows.get(key) ?? []), id]);
  }
  for (const [location, ids] of rows) console.log(`${location}  (${ids.join(", ")})`);
  return rows.size;
}

function printHint() {
  console.error(
    `Remove the owner's identifiers. A justified exception goes in ${allowlistName} as "<path>:<pattern id>  # <reason>" (pattern ids: ${patternIds.join(", ")}).`,
  );
}

function printPackHint(forbidden, identifiers) {
  if (forbidden)
    console.error(
      'Keep dev-only files out of the package with the "files" list in package.json.',
    );
  if (identifiers) printHint();
}

function checkTracked() {
  const allowlist = readAllowlist();
  const grep = spawnSync(
    "git",
    [
      "grep",
      "-z",
      "-n",
      "-I",
      "-i",
      "-E",
      patterns.map((pattern) => pattern.search).join("|"),
      "--",
      ":!package-lock.json",
    ],
    { cwd: root, encoding: "utf8", maxBuffer },
  );
  if (grep.error) throw new SetupError(`could not run git: ${grep.error.message}`);
  // git grep exits with 1 when nothing matches.
  if (grep.status !== 0 && !(grep.status === 1 && grep.stdout === ""))
    throw new SetupError(`git grep failed: ${grep.stderr.trim()}`);
  // git grep matched the plain text; the regexes add the word boundaries.
  const findings = applyAllowlist(
    parseGitGrep(grep.stdout).flatMap(({ file, line, text }) =>
      findingsIn(file, line, text),
    ),
    allowlist,
  );
  for (const entry of allowlist.filter((item) => !item.used))
    console.error(`${entry.where}: warning: this entry matches nothing; remove it.`);
  const lines = printFindings(findings);
  if (lines === 0) {
    console.error("check-personal-info: no owner identifiers in tracked files.");
    return 0;
  }
  console.error(
    `check-personal-info: ${lines} line(s) in tracked files contain owner identifiers.`,
  );
  printHint();
  return 1;
}

/** Finds the JSON report in npm's output, which lifecycle scripts may surround. */
function parsePackReport(stdout) {
  const offsets = (regex) => [...stdout.matchAll(regex)].map((match) => match.index);
  const starts = offsets(/^\[/gm);
  const ends = [stdout.length, ...offsets(/^\]/gm).map((index) => index + 1).reverse()];
  for (const start of starts)
    for (const end of ends) {
      if (end <= start) continue;
      try {
        const report = JSON.parse(stdout.slice(start, end));
        if (Array.isArray(report)) return report;
      } catch {
        // Not the report; try the next candidate.
      }
    }
  throw new SetupError("could not find the JSON report in the npm pack output.");
}

function packedFiles() {
  const windows = process.platform === "win32";
  const pack = spawnSync(
    windows ? "npm.cmd" : "npm",
    ["pack", "--dry-run", "--json"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer,
      shell: windows,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  if (pack.error) throw new SetupError(`could not run npm: ${pack.error.message}`);
  if (pack.status !== 0)
    throw new SetupError(`npm pack --dry-run --json exited with status ${pack.status}.`);
  const files = parsePackReport(pack.stdout).flatMap((entry) =>
    (entry.files ?? []).map((file) => file.path),
  );
  if (files.length === 0) throw new SetupError("npm pack listed no files.");
  return files;
}

function checkPack() {
  const allowlist = readAllowlist();
  const files = packedFiles();
  let forbidden = 0;
  let identifiers = 0;
  for (const file of files) {
    if (forbiddenInPackage.test(file)) {
      console.log(`${file}  (not allowed in the package)`);
      forbidden += 1;
    }
    const content = fs.readFileSync(path.join(root, file));
    // Skip binary files, as git grep -I does.
    if (content.subarray(0, 8000).includes(0)) continue;
    const findings = content
      .toString("utf8")
      .split(/\r?\n/)
      .flatMap((text, index) => findingsIn(file, index + 1, text));
    identifiers += printFindings(applyAllowlist(findings, allowlist));
  }
  const problems = forbidden + identifiers;
  if (problems === 0) {
    console.error(
      `check-personal-info --pack: no owner identifiers or dev-only files in the ${files.length} packed files.`,
    );
    return 0;
  }
  console.error(
    `check-personal-info --pack: ${problems} problem(s) in the ${files.length} packed files.`,
  );
  printPackHint(forbidden > 0, identifiers > 0);
  return 1;
}

/** Runs a copy of this script against fixture repositories in a temp dir. */
function selfTest() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bellpr-personal-info-"));
  const repo = path.join(temp, "repo");
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: os.devNull,
  };
  const id = Object.fromEntries(patterns.map((p) => [p.id, p.search]));
  const write = (file, content) => {
    const target = path.join(repo, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
  };
  const check = (args = [], extraEnv = {}) => {
    const result = spawnSync(
      process.execPath,
      [path.join(repo, "scripts", "check-personal-info.mjs"), ...args],
      { cwd: repo, encoding: "utf8", env: { ...env, ...extraEnv } },
    );
    const lines = result.stdout.split("\n").filter(Boolean);
    return { status: result.status, lines, stderr: result.stderr };
  };
  try {
    write("scripts/check-personal-info.mjs", fs.readFileSync(scriptPath));
    write(
      "README.md",
      "Paths like /home/alice/ and https://bell.example.internal are fine.\nSo are the numbers 120002 and 200021.\n",
    );
    write(
      "server/config.ts",
      `export const port = 4311;\nexport const origin = "https://${id.user}.${id.tailnet}.ts.net:${id.port}";\n`,
    );
    write("docs/contact.md", `# Contact\n\nWrite to ${id.handle.toUpperCase()}@example.test.\n`);
    write("package-lock.json", `{ "note": "${id.user}" }\n`);
    write("logo.bin", Buffer.concat([Buffer.from([0]), Buffer.from(id.user)]));
    for (const file of ["package.json", "AGENTS.md", "src/app.test.tsx", "certs/dev.pem"])
      write(file, "clean\n");
    git("init", "-q");
    git("add", "-A");
    write("untracked.txt", `${id.user}\n`);

    // Tracked text files only; the root lockfile and binaries are skipped.
    let result = check();
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(result.lines, [
      "docs/contact.md:3  (handle)",
      "server/config.ts:2  (user, tailnet, port)",
    ]);

    // Allowlisted findings pass; an entry that matches nothing warns.
    write(
      "scripts/personal-info-allowlist.txt",
      [
        "# Allowlist fixture",
        "",
        "docs/contact.md:handle  # sample address",
        "server/config.ts:user  # fixture",
        "server/config.ts:tailnet  # fixture",
        "server/config.ts:port  # fixture",
        "README.md:port  # nothing matches this",
        "",
      ].join("\n"),
    );
    git("add", "scripts/personal-info-allowlist.txt");
    result = check();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.lines, []);
    assert.deepEqual(result.stderr.match(/allowlist\.txt:\d+: warning/g), [
      "allowlist.txt:7: warning",
    ]);

    // Entries without a reason or with an unknown pattern id are errors.
    for (const entry of ["docs/contact.md:handle", "docs/contact.md:mail  # typo"]) {
      write("scripts/personal-info-allowlist.txt", `${entry}\n`);
      result = check();
      assert.equal(result.status, 2, entry);
      assert.match(result.stderr, /personal-info-allowlist\.txt:1: /);
    }
    write("scripts/personal-info-allowlist.txt", "");

    if (process.platform !== "win32") {
      // --pack reads the file list from `npm pack --dry-run --json`.
      const bin = path.join(temp, "bin");
      const report = path.join(temp, "pack.json");
      fs.mkdirSync(bin);
      fs.writeFileSync(
        path.join(bin, "npm"),
        [
          "#!/bin/sh",
          '[ "$*" = "pack --dry-run --json" ] || { echo "unexpected: npm $*" >&2; exit 3; }',
          'echo "> bell-pr prepack"',
          'cat "$FAKE_PACK_REPORT"',
          'echo "> bell-pr postpack"',
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const pack = (files) => {
        const listing = [{ files: files.map((file) => ({ path: file })) }];
        fs.writeFileSync(report, `${JSON.stringify(listing, null, 2)}\n`);
        return check(["--pack"], {
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          FAKE_PACK_REPORT: report,
        });
      };
      result = pack([
        "package.json",
        "README.md",
        "server/config.ts",
        "logo.bin",
        "scripts/check-personal-info.mjs",
        "AGENTS.md",
        "src/app.test.tsx",
        "certs/dev.pem",
      ]);
      assert.equal(result.status, 1, result.stderr);
      assert.deepEqual(result.lines, [
        "server/config.ts:2  (user, tailnet, port)",
        "scripts/check-personal-info.mjs  (not allowed in the package)",
        "AGENTS.md  (not allowed in the package)",
        "src/app.test.tsx  (not allowed in the package)",
        "certs/dev.pem  (not allowed in the package)",
      ]);
      result = pack(["package.json", "README.md", "logo.bin"]);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.lines, []);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log("check-personal-info self-test: ok");
  return 0;
}

const args = process.argv.slice(2);
const modes = { "--pack": checkPack, "--self-test": selfTest };
try {
  if (args.length === 0) process.exitCode = checkTracked();
  else if (args.length === 1 && modes[args[0]]) process.exitCode = modes[args[0]]();
  else {
    console.error("Usage: node scripts/check-personal-info.mjs [--pack | --self-test]");
    process.exitCode = 2;
  }
} catch (error) {
  if (error instanceof SetupError) {
    console.error(`check-personal-info: ${error.message}`);
    process.exitCode = 2;
  } else if (error instanceof assert.AssertionError) {
    console.error(`check-personal-info self-test failed:\n${error.message}`);
    process.exitCode = 1;
  } else {
    console.error(error);
    process.exitCode = 2;
  }
}
