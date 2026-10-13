#!/usr/bin/env node
// Dependency audit gate (zero dependencies).
//
// 1. `npm audit --omit=dev --audit-level=high` must report nothing: the
//    installed server dependencies have no high or critical advisory.
// 2. `npm audit --json` on the full tree must have no high or critical
//    advisory except those listed in audit-allowlist.json. The web bundle in
//    dist/ is compiled from devDependencies (React and friends), so step 1
//    alone does not cover code that ships.
//
// Allowlist entries look like
//   {"advisory": "GHSA-xxxx-xxxx-xxxx" or its URL, "package": "name",
//    "reason": "dev-only tooling, not shipped in dist/ or build/",
//    "review_by": "YYYY-MM-DD"}
// and fail the run once today (UTC) is past review_by.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowlistPath = path.join(root, "audit-allowlist.json");
const blockingSeverities = new Set(["high", "critical"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function ghsaId(value) {
  const match = /GHSA((?:-[0-9a-z]{4}){3})/i.exec(value);
  return match ? `GHSA${match[1].toLowerCase()}` : undefined;
}

/** Throws when the allowlist file is not an array of complete entries. */
export function parseAllowlist(value) {
  if (!Array.isArray(value))
    throw new Error("audit-allowlist.json must hold a JSON array.");
  return value.map((entry, index) => {
    const where = `audit-allowlist.json entry ${index + 1}`;
    if (!entry || typeof entry !== "object")
      throw new Error(`${where} is not an object.`);
    for (const key of ["advisory", "package", "reason", "review_by"])
      if (typeof entry[key] !== "string" || !entry[key].trim())
        throw new Error(`${where} needs a non-empty "${key}".`);
    const reviewBy = entry.review_by;
    const date = new Date(`${reviewBy}T00:00:00Z`);
    if (
      !datePattern.test(reviewBy) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== reviewBy
    )
      throw new Error(`${where} has review_by "${reviewBy}"; use YYYY-MM-DD.`);
    return entry;
  });
}

/** The distinct high and critical advisories in an `npm audit --json` (v2) report. */
export function blockingAdvisories(report) {
  if (report?.error)
    throw new Error(
      `npm audit failed: ${report.error.summary ?? report.error.code ?? "unknown error"}`,
    );
  if (!report || typeof report.vulnerabilities !== "object")
    throw new Error("npm audit --json returned an unexpected report.");
  const advisories = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities))
    for (const via of vulnerability.via ?? []) {
      // String entries name another vulnerable package; its advisory is listed there.
      if (typeof via !== "object" || !blockingSeverities.has(via.severity))
        continue;
      const key = `${via.name}\n${via.url ?? via.source}`;
      advisories.set(key, {
        package: via.name,
        url: via.url ?? "",
        id: ghsaId(via.url ?? "") ?? String(via.source ?? ""),
        title: via.title ?? "",
        severity: via.severity,
      });
    }
  return [...advisories.values()];
}

function matches(entry, advisory) {
  if (entry.package !== advisory.package) return false;
  const id = ghsaId(entry.advisory);
  return id ? id === ghsaId(advisory.url) : entry.advisory === advisory.url;
}

/**
 * Compares a full-tree report with the allowlist. `today` is a UTC
 * YYYY-MM-DD string.
 */
export function evaluate(report, allowlist, today) {
  const expired = allowlist.filter((entry) => entry.review_by < today);
  const advisories = blockingAdvisories(report);
  const unlisted = advisories.filter(
    (advisory) => !allowlist.some((entry) => matches(entry, advisory)),
  );
  const unused = allowlist.filter(
    (entry) => !advisories.some((advisory) => matches(entry, advisory)),
  );
  return { advisories, unlisted, expired, unused };
}

function npm(args) {
  const result = spawnSync("npm", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // npm is npm.cmd on Windows, which Node only spawns through a shell.
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  return result;
}

function main() {
  let failed = false;

  const production = npm(["audit", "--omit=dev", "--audit-level=high"]);
  const productionOutput = `${production.stdout}${production.stderr}`.trim();
  if (production.status === 0) {
    console.log(`Production dependencies: ${productionOutput || "no findings"}`);
  } else {
    console.error(productionOutput);
    console.error(
      "FAIL: npm audit --omit=dev --audit-level=high reported findings (no allowlist applies here).",
    );
    failed = true;
  }

  const allowlist = parseAllowlist(
    JSON.parse(readFileSync(allowlistPath, "utf8")),
  );
  const full = npm(["audit", "--json"]);
  let report;
  try {
    report = JSON.parse(full.stdout);
  } catch {
    throw new Error(
      `npm audit --json did not print JSON (exit ${full.status}): ${full.stderr.trim()}`,
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const { advisories, unlisted, expired, unused } = evaluate(
    report,
    allowlist,
    today,
  );
  for (const entry of expired) {
    console.error(
      `FAIL: allowlist entry ${entry.advisory} (${entry.package}) was due for review on ${entry.review_by}.`,
    );
    failed = true;
  }
  for (const advisory of unlisted) {
    console.error(
      `FAIL: ${advisory.severity} advisory ${advisory.id} in ${advisory.package}: ${advisory.title} ${advisory.url}`.trim(),
    );
    failed = true;
  }
  for (const entry of unused)
    console.log(
      `Note: allowlist entry ${entry.advisory} (${entry.package}) matches no current advisory; remove it.`,
    );
  console.log(
    `Full tree: ${advisories.length} high/critical advisories, ${advisories.length - unlisted.length} allowlisted.`,
  );

  if (failed) process.exitCode = 1;
  else console.log("Audit passed.");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
