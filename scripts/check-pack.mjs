#!/usr/bin/env node
// Size and content budgets for the npm package (zero dependencies).
//
//   node scripts/check-pack.mjs                    pack the working tree, then check
//   node scripts/check-pack.mjs --tarball <file>   check a tarball as it is
//
// Without --tarball it packs with `npm pack --json --ignore-scripts` into a
// new temporary folder and removes that folder afterwards, so it checks the
// build already in the working tree (run `npm run build` first) and never
// writes a tarball into the repository. --tarball checks the given file
// without packing again and leaves it in place: CI and the release workflow
// pass the tarball their plain `npm pack` (with prepack) wrote, the one they
// install, checksum, upload and publish. It reads every file from the
// tarball itself, prints the actual numbers and fails when the package:
//   - is larger than 3 MB packed or 10 MB unpacked, or has over 150 files;
//   - contains any .woff file, or more than 12 .woff2 files;
//   - lacks a required file, or contains a dev-only one (tests, fixtures,
//     tooling, keys, the Vite build manifest);
//   - ships a document for the app (dist/legal/) that still has an HTML
//     comment;
//   - ships web bundles over the gzip budgets below;
//   - lacks a dist/ tree, or its bin is missing, not executable, or fails
//     `bell-pr --help` after a temp-prefix install of the tarball;
//   - with --tarball only: ships a README.md that still has a relative link
//     or image, which npmjs.com cannot show, because prepack's
//     `node scripts/npm-readme.mjs --pre` did not rewrite it.
//
// Make room before you raise a budget; a raise needs a reason in the commit
// message body.
//
// Gzip budgets for dist/assets (level 9). Measured for 1.0.0-beta.0: largest
// JS chunk 80 kB (the app), all JS 270 kB, all CSS 31 kB. Measured for
// 1.0.0-rc.1: largest JS chunk 97.8 kB (the startup chunk), all JS 350.0 kB
// in 25 files, all CSS 38.6 kB. Measured for v1.1 after wave L2: largest
// JS chunk 110.6 kB (the startup chunk), all JS 437.0 kB in 42 files, all
// CSS 43.9 kB; the budget raise that v1.1 needed covers it. Measured for
// 1.0.0 with Node.js 22.22.1: largest JS chunk 65.4 kB (zh-TW, which loads
// only when zh-TW shows; the startup chunk is 65.1 kB), all JS 472.2 kB in
// 52 files, all CSS 42.9 kB, 90 entries. CI's Node.js 24 gzips the same
// files about 2 kB larger (all JS 474.2 kB). All JS counts every lazy
// chunk, so moving code out of the startup chunk adds a little to it.
//
// Exit status: 0 when every check passes, 1 when one fails, 2 on a usage or
// setup error.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { parsePackReport, tarballReport } from "./npm-pack-report.mjs";
import { relativeReferencesLeft } from "./npm-readme.mjs";
import { diffExpected, readExpected } from "./pack-expected.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MB = 1000 * 1000;
const kB = 1000;
const budgets = {
  packedBytes: 3 * MB,
  unpackedBytes: 10 * MB,
  entries: 150,
  woff2: 12,
  largestJsGzip: 116 * kB,
  totalJsGzip: 480 * kB,
  totalCssGzip: 45 * kB,
};
const required = [
  "package.json",
  "bin/bellpr.mjs",
  "build/cli.mjs",
  "dist/index.html",
  "dist/THIRD_PARTY_NOTICES.txt",
  "dist/legal/LICENSE.txt",
  "dist/legal/NOTICE.txt",
  "dist/legal/SECURITY.txt",
  "vendor/ponytail/rules.md",
  "vendor/ponytail/LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  "README.zh-TW.md",
];
const forbidden = [
  { pattern: /(^|\/)\.codex-prompts(\/|$)/, reason: "private prompts" },
  { pattern: /\.map$/, reason: "source map" },
  { pattern: /(^|\/)\.git(\/|$)/, reason: "Git metadata" },
  { pattern: /(^|\/)(tests?|e2e)(\/|$)/, reason: "tests" },
  { pattern: /\.test\.tsx?$/, reason: "test file" },
  { pattern: /^deploy\//, reason: "deployment files" },
  { pattern: /^\.agents\//, reason: "agent instructions" },
  { pattern: /^AGENTS\.md$/, reason: "agent instructions" },
  { pattern: /^e2e\//, reason: "end-to-end tests" },
  { pattern: /^site\//, reason: "landing site" },
  { pattern: /^dist\/\.vite\//, reason: "Vite build manifest" },
  { pattern: /(^|\/)fixtures\//, reason: "test fixtures" },
  { pattern: /^node_modules\//, reason: "dependencies" },
  { pattern: /\.(pem|key)$/, reason: "key or certificate" },
  { pattern: /(^|\/)\.env[^/]*(\/|$)/, reason: "environment file" },
];

class SetupError extends Error {}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function pack(destination) {
  const windows = process.platform === "win32";
  // Real pack (not dry-run) so the install smoke can use the same tarball.
  // --ignore-scripts skips prepack; callers must already have run `npm run build`.
  const result = spawnSync(
    npmCommand(),
    ["pack", "--json", "--ignore-scripts", "--pack-destination", destination],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      shell: windows,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  if (result.error) throw new SetupError(`could not run npm: ${result.error.message}`);
  if (result.status !== 0)
    throw new SetupError(`npm pack exited with status ${result.status}.`);
  try {
    return parsePackReport(result.stdout);
  } catch {
    throw new SetupError("could not read the JSON report of `npm pack --json`.");
  }
}

/** Install the tarball into a temp prefix and run `bell-pr --help`. */
function installAndRunHelp(tarball) {
  const problems = [];
  const prefix = mkdtempSync(path.join(os.tmpdir(), "bell-pr-pack-smoke-"));
  const windows = process.platform === "win32";
  try {
    // -g --prefix puts bins under <prefix>/bin (local --prefix only links
    // node_modules/.bin). Same layout as a user global install into a prefix.
    const install = spawnSync(
      npmCommand(),
      ["install", "-g", "--prefix", prefix, "--no-fund", "--no-audit", tarball],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        shell: windows,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (install.error) {
      problems.push(`could not install the packed tarball: ${install.error.message}`);
      return problems;
    }
    if (install.status !== 0) {
      const detail = (install.stderr || install.stdout || "").trim().split(/\n/).slice(-8).join(" ");
      problems.push(
        `npm install of the packed tarball exited with status ${install.status}${detail ? `: ${detail}` : "."}`,
      );
      return problems;
    }
    const binName = windows ? "bell-pr.cmd" : "bell-pr";
    const binPath = path.join(prefix, "bin", binName);
    let mode;
    try {
      mode = statSync(binPath).mode;
    } catch (error) {
      problems.push(`packed bin missing after install (${binPath}): ${error.message}`);
      return problems;
    }
    if (!windows && (mode & 0o111) === 0) {
      problems.push(`packed bin is not executable after install: ${binPath}`);
    }
    const targetBin = path.join(prefix, "lib", "node_modules", "bell-pr", "bin", "bellpr.mjs");
    try {
      const targetMode = statSync(targetBin).mode;
      if ((targetMode & 0o111) === 0) {
        problems.push(`packaged bin/bellpr.mjs is not executable after install: ${targetBin}`);
      }
    } catch (error) {
      problems.push(`packaged bin/bellpr.mjs missing after install (${targetBin}): ${error.message}`);
    }
    const help = spawnSync(binPath, ["--help"], {
      cwd: prefix,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      shell: windows,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, npm_config_prefix: prefix },
    });
    if (help.error) {
      problems.push(`could not run packed bell-pr --help: ${help.error.message}`);
      return problems;
    }
    if (help.status !== 0) {
      const detail = (help.stderr || help.stdout || "").trim().split(/\n/).slice(-5).join(" ");
      problems.push(
        `packed bell-pr --help exited with status ${help.status}${detail ? `: ${detail}` : "."}`,
      );
      return problems;
    }
    const out = `${help.stdout || ""}${help.stderr || ""}`;
    if (!/Usage:\s*bell-pr/i.test(out)) {
      problems.push("packed bell-pr --help did not print the expected usage line.");
    }
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
  return problems;
}

const formatBytes = (bytes) =>
  bytes >= MB ? `${(bytes / MB).toFixed(2)} MB` : `${(bytes / kB).toFixed(1)} kB`;

/** Every check of the tarball; `readme` adds the README.md check. */
function check(tarball, { readme }) {
  let report;
  try {
    report = tarballReport(tarball);
  } catch (error) {
    throw new SetupError(`could not read ${tarball}: ${error.message}`);
  }
  const files = report.files.map((file) => file.path);
  const problems = [];
  const over = (label, actual, budget, format = formatBytes) => {
    const line = `${label}: ${format(actual)} (budget ${format(budget)})`;
    console.log(line);
    if (actual > budget) problems.push(`${label} is over budget: ${format(actual)} > ${format(budget)}.`);
  };
  const count = (value) => String(value);

  console.log(`${report.name}@${report.version}: ${report.filename}`);
  over("packed size", report.size, budgets.packedBytes);
  over("unpacked size", report.unpackedSize, budgets.unpackedBytes);
  over("entries", report.entryCount, budgets.entries, count);
  const woff = files.filter((file) => file.endsWith(".woff"));
  const woff2 = files.filter((file) => file.endsWith(".woff2"));
  console.log(`.woff files: ${woff.length} (budget 0)`);
  if (woff.length) problems.push(`.woff files are not allowed (use .woff2): ${woff.join(", ")}.`);
  over(".woff2 files", woff2.length, budgets.woff2, count);

  const gzip = (file) => gzipSync(report.contents.get(file), { level: 9 }).length;
  const assets = files.filter((file) => file.startsWith("dist/assets/"));
  const js = assets.filter((file) => file.endsWith(".js")).map((file) => ({ file, size: gzip(file) }));
  const css = assets.filter((file) => file.endsWith(".css")).map((file) => ({ file, size: gzip(file) }));
  const largest = js.reduce((max, item) => (item.size > max.size ? item : max), { file: "-", size: 0 });
  const sum = (items) => items.reduce((total, item) => total + item.size, 0);
  over(`largest JS chunk, gzip (${path.basename(largest.file)})`, largest.size, budgets.largestJsGzip);
  over(`all JS (${js.length} files), gzip`, sum(js), budgets.totalJsGzip);
  over(`all CSS (${css.length} files), gzip`, sum(css), budgets.totalCssGzip);

  for (const file of required)
    if (!files.includes(file))
      problems.push(`${file} is missing from the package${file.startsWith("dist/") || file.startsWith("build/") ? " (run `npm run build` first)" : ""}.`);
  for (const file of files)
    for (const { pattern, reason } of forbidden)
      if (pattern.test(file)) problems.push(`${file} must not be in the package (${reason}).`);
  for (const file of files.filter((name) => name.startsWith("dist/legal/")))
    if (report.contents.get(file).toString("utf8").includes("<!--"))
      problems.push(`${file} contains an HTML comment; the app shows it as plain text (scripts/generate-third-party-notices.mjs removes them).`);

  if (!files.some((file) => file === "dist" || file.startsWith("dist/")))
    problems.push("dist/ is missing from the package (run `npm run build` first).");

  try {
    const expected = readExpected();
    for (const problem of diffExpected([...files].sort(), expected)) problems.push(problem);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  const packedReadme = report.contents.get("README.md");
  if (readme && packedReadme) {
    const left = relativeReferencesLeft(packedReadme.toString("utf8"));
    if (left.length)
      problems.push(
        "README.md is not the one prepack (`node scripts/npm-readme.mjs --pre`) writes for npmjs.com; pack with a plain `npm pack`.",
        ...left.slice(0, 5).map((problem) => `README.md: ${problem}`),
      );
    if (left.length > 5) problems.push(`README.md: ${left.length - 5} more like these.`);
  }

  // Budget/forbidden findings still fail the check; still run the install smoke
  // so a single report lists every problem.
  problems.push(...installAndRunHelp(tarball));

  if (problems.length) {
    for (const problem of problems) console.error(`check-pack: ${problem}`);
    return 1;
  }
  console.error(
    `check-pack: the package is within every budget; dist/ present; packed bin runs --help${readme ? "; README.md is ready for npmjs.com" : ""}.`,
  );
  return 0;
}

function main(args) {
  const { values } = parseArgs({ args, options: { tarball: { type: "string" } }, strict: true });
  // The tarball is the caller's: check it as it is and never remove it.
  if (values.tarball !== undefined) return check(path.resolve(values.tarball), { readme: true });
  const destination = mkdtempSync(path.join(os.tmpdir(), "bell-pr-check-pack-"));
  try {
    const report = pack(destination);
    // --ignore-scripts skipped prepack, so this README.md is the repository's
    // own, relative links and all: only --tarball checks the README.
    return check(path.join(destination, report.filename), { readme: false });
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof SetupError) {
    console.error(`check-pack: ${error.message}`);
    process.exitCode = 2;
  } else if (error?.code?.startsWith?.("ERR_PARSE_ARGS")) {
    console.error(`check-pack: ${error.message}`);
    console.error("Usage: node scripts/check-pack.mjs [--tarball <file>]");
    process.exitCode = 2;
  } else throw error;
}
