#!/usr/bin/env node
// Writes the third-party notices of BELL PR (zero dependencies).
//
//   node scripts/generate-third-party-notices.mjs          write the files
//   node scripts/generate-third-party-notices.mjs --check  verify only
//
// Run it after `vite build`: dist/.vite/bundled-modules.json (written by
// the plugin in vite.config.ts) says which packages are compiled into
// dist/assets. package-lock.json cannot tell, because the web bundle is
// built from devDependencies.
//
// Writes THIRD_PARTY_NOTICES.md (committed) and dist/THIRD_PARTY_NOTICES.txt,
// and copies LICENSE, NOTICE and SECURITY.md to
// dist/legal/{LICENSE,NOTICE,SECURITY}.txt for the app (the About dialog).
// LICENSE and NOTICE are copied as they are; the copy of SECURITY.md leaves
// out HTML comments, which are for maintainers, not for the person who
// reads the text.
//
// --check writes nothing. It fails when THIRD_PARTY_NOTICES.md as staged in
// git (or on disk outside a git checkout) differs from what this script
// generates, or when a package that ships has a license outside the
// allowlist below. Without --check, such a license only warns.
//
// Exit status: 0 when fine, 1 when a check failed, 2 on a setup error.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputName = "THIRD_PARTY_NOTICES.md";
const allowedLicenses = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "OFL-1.1",
]);
const legalCopies = [
  ["LICENSE", "LICENSE.txt"],
  ["NOTICE", "NOTICE.txt"],
  ["SECURITY.md", "SECURITY.txt"],
];
const fonts = [
  { path: "node_modules/@fontsource-variable/dm-sans", family: "DM Sans" },
  { path: "node_modules/@fontsource/ibm-plex-mono", family: "IBM Plex Mono" },
];

class SetupError extends Error {}

const read = (file) => readFileSync(path.join(root, file), "utf8");

function readJson(file) {
  try {
    return JSON.parse(read(file));
  } catch (error) {
    throw new SetupError(`could not read ${file}: ${error.message}`);
  }
}

/**
 * A Markdown document as the app shows it: without HTML comments, the spaces
 * before them, and the blank lines a comment on its own line leaves.
 */
function withoutComments(markdown) {
  return markdown
    .replace(/[ \t]*<!--[^]*?-->/g, "")
    .replace(/(\r?\n){3,}/g, "$1$1");
}

/** Text with LF line ends, no trailing spaces and no outer blank lines. */
function normalize(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/** The license expression of a package.json (old `licenses` arrays too). */
function licenseOf(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses))
    return pkg.licenses.map((entry) => entry.type ?? entry).join(" OR ");
  return "UNKNOWN";
}

/** Whether an SPDX expression is allowed: any OR branch whose AND terms all are. */
function licenseAllowed(expression) {
  return expression
    .replace(/[()]/g, " ")
    .split(/\s+OR\s+/i)
    .some((branch) =>
      branch
        .split(/\s+AND\s+/i)
        .every((term) => allowedLicenses.has(term.trim())),
    );
}

/** LICENSE, LICENCE, COPYING and NOTICE files at the package root. */
function licenseTexts(directory) {
  const names = readdirSync(path.join(root, directory))
    .filter((name) => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name))
    .sort();
  return names.map((name) => normalize(read(path.join(directory, name))));
}

function describePackage(directory) {
  const pkg = readJson(path.join(directory, "package.json"));
  const texts = licenseTexts(directory);
  return {
    name: pkg.name,
    version: pkg.version,
    license: licenseOf(pkg),
    // Without a license file, the package.json declaration is all there is.
    text: texts.length
      ? texts.join("\n\n")
      : `${pkg.name} ships no license file; its package.json declares the license ${licenseOf(pkg)}.`,
  };
}

/**
 * Vite's LICENSE.md covers everything its Node.js build bundles. Only Vite's
 * own client helpers (module preload) reach dist/assets; Rolldown's runtime
 * helpers are credited to the rolldown package.
 */
function viteNotice(text) {
  return normalize(text.split(/^# Licenses of bundled dependencies/m)[0]);
}

function bundledPackages() {
  const file = "dist/.vite/bundled-modules.json";
  if (!existsSync(path.join(root, file)))
    throw new SetupError(`${file} is missing; run \`vite build\` first.`);
  const { packages } = readJson(file);
  if (!Array.isArray(packages) || packages.length === 0)
    throw new SetupError(`${file} lists no packages.`);
  return packages.map((entry) => {
    const described = describePackage(entry.path);
    if (described.name === "vite") described.text = viteNotice(described.text);
    return described;
  });
}

/** The packages npm installs for `dependencies`: the lockfile's non-dev entries. */
function serverPackages() {
  const lock = readJson("package-lock.json");
  return Object.entries(lock.packages ?? {})
    .filter(([key, entry]) => key.startsWith("node_modules/") && !entry.dev && !entry.devOptional)
    .map(([key]) => {
      if (!existsSync(path.join(root, key, "package.json")))
        throw new SetupError(`${key} is not installed; run \`npm ci\` first.`);
      return describePackage(key);
    });
}

/** The product's support address from shared/product.ts, when it is decided. */
function supportEmail() {
  const match = /\bsupportEmail:\s*"([^"]*)"/.exec(read("shared/product.ts"));
  return match?.[1] || undefined;
}

function byNameAndVersion(a, b) {
  return a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en");
}

function unique(packages) {
  const seen = new Map();
  for (const entry of packages) seen.set(`${entry.name}@${entry.version}`, entry);
  return [...seen.values()].sort(byNameAndVersion);
}

function render() {
  const bundled = unique(bundledPackages());
  const server = unique(serverPackages());
  const provenance = readJson("vendor/ponytail/provenance.json");
  const ponytail = {
    name: provenance.name,
    version: provenance.version,
    license: provenance.license,
    text: normalize(read("vendor/ponytail/LICENSE")),
  };
  const fontEntries = fonts.map((font) => ({ ...describePackage(font.path), family: font.family }));
  // Docker-only programs whose packages lack license files (contrib/docker/licenses).
  const dockerText = (file) => normalize(read(path.join("contrib/docker/licenses", file)));
  const docker = {
    gh: { name: "GitHub CLI", version: "(Docker image)", text: dockerText("gh-LICENSE.txt") },
    codex: {
      name: "OpenAI Codex CLI",
      version: "(Docker image)",
      text: `${dockerText("codex-NOTICE.txt")}\n\n${dockerText("codex-LICENSE.txt")}`,
    },
  };

  // Identical license texts are printed once and referenced by number.
  const texts = new Map();
  const reference = (entry) => {
    if (!texts.has(entry.text)) texts.set(entry.text, { number: texts.size + 1, users: [] });
    const record = texts.get(entry.text);
    const label = `${entry.name} ${entry.version}`;
    if (!record.users.includes(label)) record.users.push(label);
    return record.number;
  };
  const table = (entries) => [
    "| Package | Version | License | Text |",
    "| --- | --- | --- | --- |",
    ...entries.map(
      (entry) =>
        `| ${entry.name} | ${entry.version} | ${entry.license} | [${reference(entry)}](#license-text-${reference(entry)}) |`,
    ),
  ];

  const email = supportEmail();
  const lines = [
    "# Third-party notices",
    "",
    "BELL PR is licensed under the Apache License, Version 2.0 (see LICENSE and",
    "NOTICE). It includes, or installs alongside itself, the open-source",
    "software listed below, each under its own license. The full license texts",
    "follow the lists.",
    "",
    "This file is generated by `scripts/generate-third-party-notices.mjs`. Do not",
    "edit it by hand; run `npm run build` and commit the result.",
    "",
    "## A. Compiled into the web interface (dist/assets)",
    "",
    "The browser code in `dist/assets` contains code from these packages.",
    "",
    ...table(bundled),
    "",
    "## B. Server dependencies installed with BELL PR",
    "",
    "npm installs these packages next to BELL PR; the server loads them at run",
    "time.",
    "",
    ...table(server),
    "",
    "## C. Vendored Ponytail rules",
    "",
    `\`vendor/ponytail/rules.md\` is ${ponytail.name} ${ponytail.version} (${ponytail.license}),`,
    `from ${provenance.repository} at commit ${provenance.commit}.`,
    "`vendor/ponytail/provenance.json` records the file hashes.",
    "",
    ...table([ponytail]),
    "",
    "## D. Fonts",
    "",
    "The web interface embeds Latin subsets of these fonts as WOFF2 files, under",
    "the SIL Open Font License 1.1 (full text below).",
    "",
    ...table(fontEntries.map((font) => ({ ...font, name: `${font.family} (${font.name})` }))),
    "",
    "## E. Docker image only",
    "",
    "The BELL PR Docker image adds these programs to the Node.js image it is",
    "built on. They are not part of the npm package. Inside the image, each",
    "Debian package's license is in `/usr/share/doc/<package>/copyright`,",
    "Node.js's in `/usr/local/share/doc/node/LICENSE`, and `dpkg -l` lists the",
    "exact package versions.",
    "",
    "| Component | License | Source |",
    "| --- | --- | --- |",
    "| Node.js and npm (official `node` image) | MIT; npm: Artistic-2.0 | https://github.com/nodejs/node |",
    "| Debian base system | Various free licenses, see each copyright file | https://sources.debian.org |",
    "| git | GPL-2.0-only, parts LGPL-2.1-or-later | Debian package `git` |",
    `| GitHub CLI (gh) | MIT, text [${reference(docker.gh)}](#license-text-${reference(docker.gh)}) | https://github.com/cli/cli |`,
    `| OpenAI Codex CLI (@openai/codex) | Apache-2.0, text and NOTICE [${reference(docker.codex)}](#license-text-${reference(docker.codex)}) | https://github.com/openai/codex |`,
    "| bubblewrap | LGPL-2.0-or-later | Debian package `bubblewrap` |",
    "| socat | GPL-2.0-only with an OpenSSL exception | Debian package `socat` |",
    "| tini | MIT | Debian package `tini` |",
    "| ripgrep | MIT or Unlicense | Debian package `ripgrep` |",
    "| ca-certificates | MPL-2.0 (certificates), GPL-2.0-or-later (scripts) | Debian package `ca-certificates` |",
    "",
    "Claude Code is not part of the image. If you install it yourself, it is",
    "under Anthropic's own terms.",
    "",
    "### Written offer for source code",
    "",
    "git, socat, bubblewrap and other Debian packages in the image, such as bash",
    "and coreutils from the base system, are licensed under the GNU General",
    "Public License or the GNU Lesser General Public License. The image contains",
    "them as unmodified Debian packages. Their complete corresponding source code is",
    "available from the Debian archive (https://sources.debian.org and",
    "https://snapshot.debian.org) under the package names and versions that",
    "`dpkg -l` lists in the image.",
    "",
    "For at least three years after the last distribution of a BELL PR Docker",
    "image by the BELL PR project, its maintainers will give anyone who asks a",
    "copy of that source code on a medium customarily used for software",
    "interchange, for no more than the cost of physically performing the",
    "distribution.",
    email
      ? `Write to ${email}, naming the image version.`
      : "Make the request through the project's issue tracker or the support contact named in the BELL PR documentation, naming the image version.",
    "",
    "## License texts",
    "",
  ];
  for (const [text, record] of texts) {
    lines.push(
      `<a id="license-text-${record.number}"></a>`,
      "",
      `### ${record.number}. Used by ${record.users.join(", ")}`,
      "",
      "```text",
      // A fence inside a license text would end the block early.
      text.replace(/^```/gm, "'''"),
      "```",
      "",
    );
  }
  const markdown = `${lines.join("\n").trimEnd()}\n`;
  const shipped = [...bundled, ...server, ponytail, ...fontEntries];
  const disallowed = shipped.filter((entry) => !licenseAllowed(entry.license));
  return { markdown, disallowed, counts: { bundled: bundled.length, server: server.length } };
}

/** THIRD_PARTY_NOTICES.md as staged in git, or as on disk without git. */
function committedNotices() {
  const git = spawnSync("git", ["show", `:${outputName}`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (git.status === 0) return git.stdout;
  const file = path.join(root, outputName);
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

function reportDisallowed(disallowed) {
  for (const entry of disallowed)
    console.error(`  ${entry.name} ${entry.version}: ${entry.license}`);
}

function main(args) {
  const check = args.includes("--check");
  if (args.some((arg) => arg !== "--check")) {
    console.error("Usage: node scripts/generate-third-party-notices.mjs [--check]");
    return 2;
  }
  const { markdown, disallowed, counts } = render();
  if (check) {
    let failed = false;
    if (committedNotices() !== markdown) {
      console.error(
        `generate-third-party-notices: ${outputName} is out of date. Run \`npm run build\` and commit ${outputName}.`,
      );
      failed = true;
    }
    if (disallowed.length) {
      console.error(
        "generate-third-party-notices: these shipped packages have a license outside the allowlist:",
      );
      reportDisallowed(disallowed);
      failed = true;
    }
    if (!failed)
      console.error(
        `generate-third-party-notices: ${outputName} is current (${counts.bundled} bundled, ${counts.server} server packages) and every license is allowed.`,
      );
    return failed ? 1 : 0;
  }
  writeFileSync(path.join(root, outputName), markdown);
  mkdirSync(path.join(root, "dist", "legal"), { recursive: true });
  writeFileSync(path.join(root, "dist", "THIRD_PARTY_NOTICES.txt"), markdown);
  for (const [source, target] of legalCopies) {
    const text = read(source);
    writeFileSync(path.join(root, "dist", "legal", target), source.endsWith(".md") ? withoutComments(text) : text);
  }
  if (disallowed.length) {
    console.warn(
      "generate-third-party-notices: warning: licenses outside the allowlist (the --check step fails on these):",
    );
    reportDisallowed(disallowed);
  }
  console.log(
    `generate-third-party-notices: wrote ${outputName}, dist/THIRD_PARTY_NOTICES.txt and dist/legal/ (${counts.bundled} bundled, ${counts.server} server packages).`,
  );
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof SetupError) {
    console.error(`generate-third-party-notices: ${error.message}`);
    process.exitCode = 2;
  } else throw error;
}
