// Claims stay inside what the code makes true (DESIGN v1.2 §15): the copy,
// the dictionaries, the docs, the READMEs, the privacy policy, the site and
// the titles of tests never claim what Learn by hand cannot prove, such as
// "AI-free", "authorship verified" or "allowed by the project". Test
// bodies, fixtures and THIRD_PARTY_NOTICES.md are not scanned: a denial
// fixture such as "This change was written without AI assistance." is
// data, not a claim.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.join(import.meta.dirname, "..");

/** What copy may never say, case-insensitive. */
const forbidden = [
  "AI-free",
  "100% human",
  "authorship verified",
  "verified author",
  "compliant with",
  "complies with",
  "policy-compliant",
  "produced no code",
  "written without AI",
  "works with projects that ban AI",
  "undetectable",
  "allowed by the project",
  "permitted by the project",
  "safe to submit",
  "無 AI",
  "100% 人",
  "已驗證作者",
];
const pattern = new RegExp(forbidden.map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\%]/g, "\\$&")).join("|"), "i");

/** Exact lines that may match, each with its reason. */
const allowlist: { file: string; line: string; reason: string }[] = [
  {
    file: "server/i18n/en/run.ts",
    line: '      "The agent team produced no code changes. Check the task reports or adjust the direction.",',
    reason: "An agent run's error: the agents made no changes at all; it claims nothing about a person's code.",
  },
];

const skippedDirectories = new Set(["node_modules", "dist", "build", ".git", ".vite-cache", "output", "fixtures"]);

/** Every file under `directory` (relative to the repository) that `keep` accepts. */
function files(directory: string, keep: (file: string) => boolean): string[] {
  const absolute = path.join(root, directory);
  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    if (skippedDirectories.has(name)) return [];
    const relative = path.posix.join(directory, name);
    if (statSync(path.join(root, relative)).isDirectory()) return files(relative, keep);
    return keep(relative) ? [relative] : [];
  });
}

const sourceFile = (file: string) => /\.(?:ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file);

/** The copy, docs and pages that speak to people. */
function copyFiles() {
  return [
    ...files("src/i18n", sourceFile),
    ...files("src/byhand", (file) => sourceFile(file) && file.includes("/i18n/")),
    ...files("shared/i18n", sourceFile),
    ...files("server/i18n", sourceFile),
    ...files("docs", (file) => file.endsWith(".md")),
    ...readdirSync(root).filter((name) => /^README.*\.md$|^PRIVACY\.md$/.test(name)),
    ...files("site", (file) => file.endsWith(".html")),
  ];
}

/** The first argument of each test(, it( and describe( call: what a test claims to show. */
function testTitles(source: string) {
  return [...source.matchAll(/\b(?:test|it|describe)(?:\.\w+)?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(
    (match) => match[2],
  );
}

test("no copy, doc, page or test title claims what Learn by hand cannot prove", () => {
  const scanned = copyFiles();
  // The places the claim test is about are really read.
  for (const expected of ["shared/i18n/draft-checks.en.ts", "server/i18n/en/by-hand.ts", "src/i18n/en/mission.ts", "README.md", "PRIVACY.md", "site/index.html", "docs/troubleshooting.md"])
    assert.ok(scanned.includes(expected), expected);
  const hits: string[] = [];
  for (const file of scanned) {
    const lines = readFileSync(path.join(root, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!pattern.test(line)) return;
      if (allowlist.some((entry) => entry.file === file && entry.line === line)) return;
      hits.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  const tests = [
    ...files("server", (file) => /\.test\.tsx?$/.test(file)),
    ...files("shared", (file) => /\.test\.tsx?$/.test(file)),
    ...files("src", (file) => /\.test\.tsx?$/.test(file)),
    ...files("scripts", (file) => /\.test\.tsx?$/.test(file)),
    ...files("e2e", (file) => file.endsWith(".spec.ts")),
  ];
  assert.ok(tests.length > 100, `${tests.length} test files`);
  for (const file of tests)
    for (const title of testTitles(readFileSync(path.join(root, file), "utf8")))
      if (pattern.test(title)) hits.push(`${file}: test title "${title}"`);
  assert.deepEqual(hits, [], "Claims outside what the code makes true (DESIGN v1.2 §15)");
  // Every allowlisted line still exists, so the list never hides a stale entry.
  for (const entry of allowlist)
    assert.ok(readFileSync(path.join(root, entry.file), "utf8").split("\n").includes(entry.line), entry.file);
});

test("the claim test finds the phrases it looks for, in copy and in test titles", () => {
  for (const phrase of forbidden) assert.ok(pattern.test(`Copy that says ${phrase.toUpperCase()} somewhere.`), phrase);
  assert.ok(!pattern.test("BELL PR's agents had no write access and gave you no code for this change."));
  assert.deepEqual(testTitles('test("a", () => {});\nit(`b ${x}`, fn);\ndescribe.skip(\'c\', fn);\ntest(name, fn);'), ["a", "b ${x}", "c"]);
});
