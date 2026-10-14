import test from "node:test";
import assert from "node:assert/strict";
import {
  assertGitHubRepository,
  assertRefName,
  ciConfigPath,
  normalizeRepositorySource,
  parseGitHubSource,
  safeRefName,
  safeRelativePath,
  sensitivePath,
} from "./git.js";
import { AppError } from "./types.js";

test("diff paths that would reach an object prototype are rejected", () => {
  for (const filePath of [
    "__proto__",
    "src/__proto__",
    "__proto__/x.ts",
    "constructor",
    "lib/constructor/index.ts",
    "prototype",
    "a/prototype/b",
  ])
    assert.equal(safeRelativePath(filePath), false, filePath);
  // The words inside a longer name are fine.
  for (const filePath of [
    "src/constructor.ts",
    "docs/prototype-notes.md",
    "proto/__proto__x",
    "hello.ts",
    "[id].ts",
  ])
    assert.equal(safeRelativePath(filePath), true, filePath);
  // The existing rules still hold.
  for (const filePath of ["", "/etc/passwd", "../x", "a/../b", ".git/config", "a\\b", "a\nb"])
    assert.equal(safeRelativePath(filePath), false, JSON.stringify(filePath));
});

test("CI configuration is confirmed at publishing, not held back as sensitive", () => {
  for (const filePath of [
    ".github/workflows/ci.yml",
    ".github/workflows/release.yaml",
    ".github/actions/setup/action.yml",
    ".gitlab-ci.yml",
    ".circleci/config.yml",
    ".travis.yml",
    "azure-pipelines.yml",
    "Jenkinsfile",
    ".buildkite/pipeline.yml",
  ]) {
    assert.equal(sensitivePath(filePath), false, filePath);
    assert.equal(ciConfigPath(filePath), true, filePath);
  }
  for (const filePath of [
    "docs/.github/workflows/example.yml",
    "src/workflows/ci.ts",
    ".github/CODEOWNERS",
    "README.md",
  ])
    assert.equal(ciConfigPath(filePath), false, filePath);
  // Credentials stay held back.
  assert.equal(sensitivePath(".env"), true);
  assert.equal(sensitivePath("deploy/id_ed25519"), true);
});

test("branch and repository names are checked before they reach a URL or refspec", () => {
  for (const name of ["main", "fix/abc12345", "feat/a.b_c-d", "release/1.2.3", "a@b"])
    assert.equal(safeRefName(name), true, name);
  for (const name of [
    "",
    "-delete",
    "+main",
    "main:other",
    "a..b",
    "a b",
    "a\tb",
    "a~1",
    "a^",
    "a?",
    "a*",
    "a[b",
    "a\\b",
    "a@{1}",
    "@",
    "a/.hidden",
    ".hidden",
    "a.lock",
    "a.lock/b",
    "a/",
    "a.",
    "a//b",
    "/a",
    "x".repeat(256),
  ]) {
    assert.equal(safeRefName(name), false, JSON.stringify(name));
    assert.throws(
      () => assertRefName(name),
      (error: unknown) => error instanceof AppError && error.statusCode === 409,
    );
  }
  assertGitHubRepository("octo-org/hello.world");
  for (const fullName of [
    "",
    "owner",
    "owner/name/extra",
    "../name",
    "owner/..",
    "owner/name.git?x",
    "-owner/name",
    "owner/na me",
    "evil.example/x@y",
  ])
    assert.throws(() => assertGitHubRepository(fullName), AppError, fullName);
});

test("what a person types to import a project is normalized before the import reads it", () => {
  const home = "/home/someone";
  const github = "https://github.com/octo-org/hello.world";
  const table: [string, string][] = [
    // owner/repo and github.com without a scheme.
    ["octo-org/hello.world", github],
    ["  octo-org/hello.world.git  ", github],
    ["github.com/octo-org/hello.world", github],
    ["www.github.com/octo-org/hello.world/", github],
    ["GitHub.com/octo-org/hello.world", github],
    ["http://github.com/octo-org/hello.world", github],
    ["https://github.com/octo-org/hello.world.git", github],
    // Pages inside the repository name the repository.
    ["https://github.com/octo-org/hello.world/tree/main/src", github],
    ["github.com/octo-org/hello.world/blob/main/README.md#L10", github],
    ["https://github.com/octo-org/hello.world/issues/42", github],
    ["https://github.com/octo-org/hello.world/issues", github],
    ["https://github.com/octo-org/hello.world/pull/7/files", github],
    ["https://github.com/octo-org/hello.world/pulls?q=is%3Aopen", github],
    ["https://github.com/octo-org/hello.world?tab=readme-ov-file", github],
    // The home directory.
    ["~/code/project", "/home/someone/code/project"],
    ["~", "/home/someone"],
    // Everything else stays as typed, for the import to accept or refuse.
    ["/srv/repos/project", "/srv/repos/project"],
    ["git@github.com:octo-org/hello.world.git", "git@github.com:octo-org/hello.world.git"],
    ["./relative/path", "./relative/path"],
    ["relative/path/deeper", "relative/path/deeper"],
    ["https://github.com/octo-org/hello.world/settings", "https://github.com/octo-org/hello.world/settings"],
    ["https://github.com/octo-org", "https://github.com/octo-org"],
    ["https://gitlab.com/octo-org/hello.world", "https://gitlab.com/octo-org/hello.world"],
    ["https://user:secret@github.com/octo-org/hello.world", "https://user:secret@github.com/octo-org/hello.world"],
    ["-owner/repo", "-owner/repo"],
    ["owner/..", "owner/.."],
    ["--upload-pack=x/y", "--upload-pack=x/y"],
    ["~someone/repo", "~someone/repo"],
  ];
  for (const [input, expected] of table)
    assert.equal(normalizeRepositorySource(input, home), expected, input);
  // Every GitHub result is one the import accepts.
  for (const [input, expected] of table)
    if (expected.startsWith("https://github.com/") && expected === github)
      assert.equal(parseGitHubSource(normalizeRepositorySource(input, home))?.url, github, input);
});
