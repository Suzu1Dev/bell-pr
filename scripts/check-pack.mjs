#!/usr/bin/env node
// Size and content budgets for the npm package (zero dependencies).
//
//   node scripts/check-pack.mjs
//
// Lists the package with `npm pack --dry-run --json --ignore-scripts`, so
// it checks the build already in the working tree (run `npm run build`
// first; `npm pack` itself rebuilds through prepack). It prints the actual
// numbers and fails when the package:
//   - is larger than 3 MB packed or 10 MB unpacked, or has over 150 files;
//   - contains any .woff file, or more than 12 .woff2 files;
//   - lacks a required file, or contains a dev-only one (tests, fixtures,
//     tooling, keys, the Vite build manifest);
//   - ships a legal text for the app (dist/legal/) that still has an HTML
//     comment, such as a claim marker;
//   - ships web bundles over the gzip budgets below.
//
// Raising a budget needs a reason in the commit message body.
//
// Gzip budgets for dist/assets (level 9). Measured for 1.0.0-beta.0: largest
// JS chunk 80 kB (the app), all JS 270 kB, all CSS 31 kB. Measured for
// 1.0.0-rc.1: largest JS chunk 97.8 kB (the startup chunk), all JS 350.0 kB
// in 25 files, all CSS 38.6 kB. Measured for v1.1 after wave L2: largest
// JS chunk 110.6 kB (the startup chunk), all JS 437.0 kB in 42 files, all
// CSS 43.9 kB; the one budget raise v1.1 was allowed (owner answer Q10)
// covers it. All JS counts every lazy chunk, so moving code out of the
// startup chunk adds a little to it.
//
// Exit status: 0 within budget, 1 over budget, 2 on a setup error.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MB = 1000 * 1000;
const kB = 1000;
const budgets = {
  packedBytes: 3 * MB,
  unpackedBytes: 10 * MB,
  entries: 150,
  woff2: 12,
  largestJsGzip: 116 * kB,
  totalJsGzip: 460 * kB,
  totalCssGzip: 45 * kB,
};
const required = [
  "package.json",
  "bin/bellpr.mjs",
  "build/cli.mjs",
  "dist/index.html",
  "dist/THIRD_PARTY_NOTICES.txt",
  "dist/legal/EULA.txt",
  "dist/legal/PRIVACY.txt",
  "dist/legal/TERMS.txt",
  "dist/legal/REFUND.txt",
  "dist/legal/SECURITY.txt",
  "vendor/ponytail/rules.md",
  "vendor/ponytail/LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "LICENSE.md",
];
const forbidden = [
  { pattern: /\.test\.tsx?$/, reason: "test file" },
  { pattern: /^deploy\//, reason: "deployment files" },
  { pattern: /^\.agents\//, reason: "agent instructions" },
  { pattern: /^AGENTS\.md$/, reason: "agent instructions" },
  { pattern: /^tools\//, reason: "dev tooling" },
  { pattern: /^e2e\//, reason: "end-to-end tests" },
  { pattern: /^marketing\//, reason: "marketing sources" },
  { pattern: /^site\//, reason: "landing site" },
  { pattern: /^dist\/\.vite\//, reason: "Vite build manifest" },
  { pattern: /(^|\/)fixtures\//, reason: "test fixtures" },
  { pattern: /^node_modules\//, reason: "dependencies" },
  { pattern: /\.(pem|key)$/, reason: "key or certificate" },
  { pattern: /(^|\/)\.env(\.|$)/, reason: "environment file" },
];

class SetupError extends Error {}

/** The JSON report in npm's output, which lifecycle scripts may surround. */
function parsePackReport(stdout) {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  try {
    const report = JSON.parse(stdout.slice(start, end + 1));
    if (Array.isArray(report) && report[0]?.files) return report[0];
  } catch {
    // Reported below.
  }
  throw new SetupError("could not read the JSON report of `npm pack --dry-run --json`.");
}

function pack() {
  const windows = process.platform === "win32";
  const result = spawnSync(
    windows ? "npm.cmd" : "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
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
    throw new SetupError(`npm pack --dry-run exited with status ${result.status}.`);
  return parsePackReport(result.stdout);
}

const formatBytes = (bytes) =>
  bytes >= MB ? `${(bytes / MB).toFixed(2)} MB` : `${(bytes / kB).toFixed(1)} kB`;

function main() {
  const report = pack();
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
  over("entries", report.entryCount ?? files.length, budgets.entries, count);
  const woff = files.filter((file) => file.endsWith(".woff"));
  const woff2 = files.filter((file) => file.endsWith(".woff2"));
  console.log(`.woff files: ${woff.length} (budget 0)`);
  if (woff.length) problems.push(`.woff files are not allowed (use .woff2): ${woff.join(", ")}.`);
  over(".woff2 files", woff2.length, budgets.woff2, count);

  const gzip = (file) => gzipSync(readFileSync(path.join(root, file)), { level: 9 }).length;
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
    if (readFileSync(path.join(root, file), "utf8").includes("<!--"))
      problems.push(`${file} contains an HTML comment; the app shows it as plain text (scripts/generate-third-party-notices.mjs removes them).`);

  if (problems.length) {
    for (const problem of problems) console.error(`check-pack: ${problem}`);
    return 1;
  }
  console.error("check-pack: the package is within every budget.");
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof SetupError) {
    console.error(`check-pack: ${error.message}`);
    process.exitCode = 2;
  } else throw error;
}
