#!/usr/bin/env node
// The dry-run path of .github/workflows/release.yml, run locally. Nothing is
// published, pushed or released:
//   1. npm run build
//   2. npm test
//   3. npm pack into the output directory (prepack builds once more, as in
//      the workflow)
//   4. node scripts/check-pack.mjs
//   5. SHA256SUMS for the tarball
//   6. release-notes.md: the CHANGELOG.md section of this version
//   7. npm publish <tarball> --dry-run (--tag next for a prerelease)
//   8. docker build -t bell-pr:dry-run .
//
// Usage:
//   node scripts/release-dry-run.mjs [--out <dir>] [--skip-tests] [--skip-docker]
//   node scripts/release-dry-run.mjs --notes <file> [--require]
//
// --out keeps the tarball, SHA256SUMS and notes in <dir> (default: a new
// temp directory, printed at the end). --notes only writes the release notes
// of the package.json version to <file>; with --require it fails when
// CHANGELOG.md has no section for that version, as a tagged release must.
// Without --require a missing section falls back to [Unreleased].
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";

class StepError extends Error {}

function run(step, command, args, options = {}) {
  console.log(`\n==> ${step}: ${[command, ...args].join(" ")}`);
  const result = spawnSync(windows && command === "npm" ? "npm.cmd" : command, args, {
    cwd: root,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    shell: windows && command === "npm",
    env: { ...process.env, ...options.env },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new StepError(`${step}: ${result.error.message}`);
  if (result.status !== 0) throw new StepError(`${step} failed with exit status ${result.status}.`);
  return result.stdout ?? "";
}

/**
 * The report of `npm pack --json`. The build that prepack runs prints to
 * the same output first, so the report is the last top-level JSON array.
 */
function packReport(stdout) {
  const starts = [...stdout.matchAll(/^\[\s*$/gm)].map((match) => match.index).reverse();
  const end = stdout.search(/^\]\s*$(?![\s\S]*^\]\s*$)/m);
  for (const start of starts) {
    try {
      const report = JSON.parse(stdout.slice(start, end + 1));
      if (report[0]?.filename) return report[0];
    } catch {
      // Not the report; try an earlier candidate.
    }
  }
  throw new StepError("could not read the report of `npm pack --json`.");
}

/** The CHANGELOG.md section of `version`, or of [Unreleased] when allowed. */
export function releaseNotes(changelog, version, { require = false } = {}) {
  const sections = new Map();
  let current;
  for (const line of changelog.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^## \[([^\]]+)\]/.exec(line);
    if (heading) {
      current = heading[1];
      sections.set(current, []);
    } else if (/^## /.test(line)) current = undefined;
    else if (current) sections.get(current).push(line);
  }
  const text = (name) => sections.get(name)?.join("\n").trim() ?? "";
  if (text(version)) return { notes: `${text(version)}\n`, section: version };
  if (require)
    throw new StepError(`CHANGELOG.md has no section "## [${version}]" with release notes.`);
  if (text("Unreleased")) return { notes: `${text("Unreleased")}\n`, section: "Unreleased" };
  throw new StepError(`CHANGELOG.md has neither a "## [${version}]" nor an "## [Unreleased]" section.`);
}

function writeNotes(file, version, require) {
  const { notes, section } = releaseNotes(readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), version, {
    require,
  });
  writeFileSync(file, notes);
  if (section !== version)
    console.warn(`release notes: CHANGELOG.md has no [${version}] section yet; used [${section}].`);
  console.log(`release notes: wrote ${file} from the [${section}] section.`);
}

function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      notes: { type: "string" },
      require: { type: "boolean" },
      "skip-tests": { type: "boolean" },
      "skip-docker": { type: "boolean" },
    },
    strict: true,
  });
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  if (values.notes) {
    writeNotes(path.resolve(values.notes), version, values.require);
    return;
  }

  const out = values.out
    ? path.resolve(values.out)
    : mkdtempSync(path.join(os.tmpdir(), "bell-pr-release-"));
  mkdirSync(out, { recursive: true });
  const prerelease = version.includes("-");
  console.log(`Release dry run of bell-pr ${version}${prerelease ? " (prerelease)" : ""} into ${out}`);

  run("build", "npm", ["run", "build"]);
  if (!values["skip-tests"])
    run("test", "npm", ["test"], { env: { TSX_DISABLE_CACHE: process.env.TSX_DISABLE_CACHE ?? "1" } });
  const packed = packReport(
    run("pack", "npm", ["pack", "--json", "--pack-destination", out], { capture: true }),
  );
  const tarball = path.join(out, packed.filename);
  run("check-pack", process.execPath, ["scripts/check-pack.mjs"]);

  const sum = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  writeFileSync(path.join(out, "SHA256SUMS"), `${sum}  ${path.basename(tarball)}\n`);
  console.log(`\n==> SHA256SUMS: ${sum}  ${path.basename(tarball)}`);
  writeNotes(path.join(out, "release-notes.md"), version, false);

  run("npm publish --dry-run", "npm", [
    "publish",
    tarball,
    "--dry-run",
    ...(prerelease ? ["--tag", "next"] : []),
  ], { env: { npm_config_dry_run: "true" } });
  if (!values["skip-docker"]) run("docker build", "docker", ["build", "-t", "bell-pr:dry-run", "."]);

  console.log(`\nRelease dry run passed. Nothing was published. Artifacts: ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    if (error instanceof StepError || error?.code?.startsWith?.("ERR_PARSE_ARGS")) {
      console.error(`release-dry-run: ${error.message}`);
      process.exitCode = 1;
    } else throw error;
  }
}
