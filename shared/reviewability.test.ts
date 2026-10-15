import test from "node:test";
import assert from "node:assert/strict";
import {
  isGeneratedPath,
  isLockfile,
  isManifest,
  isTestPath,
  newDependencies,
  patchLines,
  reviewabilitySnapshot,
  weakenedTests,
  whitespaceOnlyHunks,
} from "./reviewability.js";

const patch = (lines: string[], start = 1) =>
  `diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -${start},${lines.length} +${start},${lines.length} @@\n${lines.join("\n")}\n`;

const changed = (path: string, lines: string[], extra: Record<string, unknown> = {}) => ({
  path,
  additions: lines.filter((line) => line.startsWith("+")).length,
  deletions: lines.filter((line) => line.startsWith("-")).length,
  patch: patch(lines),
  ...extra,
});

test("paths are told apart: lockfiles, tests, manifests and generated output", () => {
  assert.ok(isLockfile("web/package-lock.json"));
  assert.ok(isLockfile("go.sum"));
  assert.ok(!isLockfile("src/lock.ts"));
  for (const path of ["tests/a.ts", "src/__tests__/a.ts", "a.test.ts", "b.spec.js", "pkg/x_test.go", "test_api.py", "FooTest.java"])
    assert.ok(isTestPath(path), path);
  for (const path of ["src/contest.ts", "src/testing-utils.ts", "latest.md"])
    assert.ok(!isTestPath(path), path);
  for (const path of ["package.json", "sub/Cargo.toml", "requirements-dev.txt", "app.gemspec", "App.csproj", "go.mod"])
    assert.ok(isManifest(path), path);
  assert.ok(!isManifest("src/package.ts"));
  assert.ok(isGeneratedPath("dist/app.min.js"));
  assert.ok(isGeneratedPath("api/v1/service.pb.go"));
  assert.ok(isGeneratedPath("src/gen/types.ts", ["src/gen/**"]));
  assert.ok(isGeneratedPath("deep/a/schema.ts", ["schema.ts"]));
  assert.ok(isGeneratedPath("vendor/x/y.js", ["vendor/"]));
  assert.ok(!isGeneratedPath("src/vendor.js", ["/vendor/"]));
  assert.ok(isGeneratedPath("snap/a.snap", ["*.snap"]));
  assert.ok(!isGeneratedPath("src/a.ts", ["*.snap", "", "["]));
});

test("patch lines carry old and new line numbers across hunks", () => {
  const text = "--- a/f\n+++ b/f\n@@ -10,2 +10,3 @@\n keep\n-old\n+new\n+more\n@@ -40 +41 @@\n-x\n+y\n";
  assert.deepEqual(
    patchLines(text).map((line) => [line.kind, line.text, line.oldLine, line.newLine, line.hunk]),
    [
      [" ", "keep", 10, 10, 0],
      ["-", "old", 11, undefined, 0],
      ["+", "new", undefined, 11, 0],
      ["+", "more", undefined, 12, 0],
      ["-", "x", 40, undefined, 1],
      ["+", "y", undefined, 41, 1],
    ],
  );
  assert.deepEqual(patchLines("This file is held back."), []);
  assert.equal(whitespaceOnlyHunks("@@ -1 +1 @@\n-a(b)\n+a( b )\n@@ -9 +9 @@\n-c\n+d\n"), 1);
});

test("weakened tests: a deleted test file, added skips and removed assertions", () => {
  const found = weakenedTests([
    { path: "tests/old.test.ts", status: "deleted", patch: "" },
    changed("tests/a.test.ts", [
      " describe('a', () => {",
      "-  expect(value).toBe(1);",
      "+  it.skip('flaky', () => {});",
      "+  it('works', () => {});",
      " });",
    ]),
    changed("test_api.py", ["+@pytest.mark.skip(reason='slow')", "-    assert result == 2"]),
    changed("pkg/x_test.go", ["+\tt.Skip(\"later\")"]),
    // Outside test files nothing is flagged.
    changed("src/a.ts", ["-  assert(x);", "+  it.only('x')"]),
  ]);
  assert.deepEqual(
    found.map((item) => [item.id, item.line, item.text]),
    [
      ["tests/old.test.ts#0", 0, ""],
      ["tests/a.test.ts#-2", 2, "expect(value).toBe(1);"],
      ["tests/a.test.ts#2", 2, "it.skip('flaky', () => {});"],
      ["test_api.py#1", 1, "@pytest.mark.skip(reason='slow')"],
      ["test_api.py#-1", 1, "assert result == 2"],
      ["pkg/x_test.go#1", 1, 't.Skip("later")'],
    ],
  );
});

test("new dependencies are added manifest entries, not version bumps", () => {
  const deps = newDependencies([
    changed("package.json", [
      '   "dependencies": {',
      '-    "react": "^18.0.0",',
      '+    "react": "^19.0.0",',
      '+    "left-pad": "^1.3.0",',
      '+    "build": "tsc",',
      "   }",
    ]),
    changed("requirements.txt", ["+requests>=2.31", "+# a comment"]),
    changed("go.mod", ["+\tgithub.com/pkg/errors v0.9.1"]),
    changed("src/package.json.ts", ['+  "x": "^1.0.0"']),
  ]);
  assert.deepEqual(deps, [
    { path: "package.json", name: "left-pad" },
    { path: "requirements.txt", name: "requests" },
    { path: "go.mod", name: "github.com/pkg/errors" },
  ]);
});

test("the snapshot measures size without lockfiles and generated files and bands it", () => {
  const lines = (count: number) => Array.from({ length: count }, (_, index) => `+line ${index}`);
  const files = [
    changed("src/a.ts", lines(60)),
    changed("README.md", lines(10)),
    changed("package-lock.json", lines(900)),
    changed("src/gen/x.ts", lines(500)),
    changed("src/b.ts", ["-if (a){", "+if (a) {"]),
  ];
  const snapshot = reviewabilitySnapshot({
    files,
    planScopes: [["src/a.ts", "README.md"], []],
    generated: ["src/gen/**"],
    mergedSizes: [{ number: 7, additions: 40, deletions: 2, changedFiles: 3 }],
  });
  assert.deepEqual(snapshot, {
    changedLines: 72,
    files: 3,
    testFilesChanged: 0,
    sourceChanged: true,
    docsOnly: false,
    newDependencies: [],
    outsidePlan: ["src/b.ts"],
    whitespaceOnly: ["src/b.ts"],
    weakened: [],
    band: "small",
    mergedSizes: [{ number: 7, additions: 40, deletions: 2, changedFiles: 3 }],
  });
  const band = (count: number, fileCount = 1) =>
    reviewabilitySnapshot({
      files: Array.from({ length: fileCount }, (_, index) => ({
        path: `src/f${index}.ts`,
        additions: count / fileCount,
        deletions: 0,
      })),
    }).band;
  assert.deepEqual([band(100), band(101), band(400), band(401), band(1000), band(1001)], [
    "small",
    "medium",
    "medium",
    "large",
    "large",
    "very-large",
  ]);
  assert.equal(band(21, 21), "very-large");
  // Without a plan, nothing is outside it; docs alone are docs-only.
  const docs = reviewabilitySnapshot({ files: [changed("docs/a.md", lines(5))] });
  assert.deepEqual([docs.outsidePlan, docs.docsOnly, docs.sourceChanged], [[], true, false]);
});
