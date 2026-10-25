import test from "node:test";
import assert from "node:assert/strict";
import { planTaskPaths, reviewabilitySnapshot, suggestSplit, taskIssues } from "./reviewability.js";
import { dropSplitLinks, type SplitTask } from "./split.js";

const task = (
  id: string,
  title: string,
  files: readonly string[],
  extra: Partial<SplitTask> = {},
): SplitTask => ({ id, title, files, ...extra });

const change = (path: string) => ({ path, additions: 10, deletions: 2 });

// Three tasks that share no file, dependency or issue: each owns a source file and its test.
const bundle = [
  change("web/runners.js"),
  change("tests/browser/runners.test.js"),
  change("web/compiler-explorer.js"),
  change("tests/browser/compiler-explorer.test.js"),
  change("web/example-board.js"),
  change("tests/browser/example-board-ui.test.js"),
];
const bundleTasks = [
  task("runners", "Runners", ["web/runners.js", "tests/browser/runners.test.js"]),
  task("compiled", "Compiled harness", ["web/compiler-explorer.js", "tests/browser/compiler-explorer.test.js"]),
  task("board", "Example board", ["web/example-board.js", "tests/browser/example-board-ui.test.js"]),
];

test("tasks on separate files with no dependency are separate parts, each with its test", () => {
  const { parts, unassigned } = suggestSplit(bundle, bundleTasks);
  assert.deepEqual(
    parts.map((part) => [part.title, part.paths, part.taskIds]),
    [
      ["Runners", ["web/runners.js", "tests/browser/runners.test.js"], ["runners"]],
      ["Compiled harness", ["web/compiler-explorer.js", "tests/browser/compiler-explorer.test.js"], ["compiled"]],
      ["Example board", ["web/example-board.js", "tests/browser/example-board-ui.test.js"], ["board"]],
    ],
  );
  assert.deepEqual(unassigned, []);
});

test("a dependency or a shared file joins tasks into one part", () => {
  const dependent = [
    bundleTasks[0],
    task("compiled", "Compiled harness", bundleTasks[1].files, { dependsOn: ["runners"] }),
    bundleTasks[2],
  ];
  assert.deepEqual(
    suggestSplit(bundle, dependent).parts.map((part) => part.taskIds),
    [["runners", "compiled"], ["board"]],
  );
  // Two tasks that changed the same file cannot be told apart by file.
  const shared = [
    task("a", "A", ["web/runners.js"], { integratedFiles: ["web/runners.js", "web/example-board.js"] }),
    task("b", "B", ["web/example-board.js"], { integratedFiles: ["web/example-board.js"] }),
  ];
  const parts = suggestSplit(bundle, shared).parts;
  assert.equal(parts.length, 1);
  assert.deepEqual(parts[0].taskIds, ["a", "b"]);
});

test("a task that only changes tests or documents makes no part, and its files wait to be placed", () => {
  const files = [change("src/app.ts"), change("src/app.test.ts"), change("docs/guide.md"), change("package-lock.json")];
  const { parts, unassigned } = suggestSplit(files, [
    task("code", "Code", ["src/app.ts"]),
    task("tests", "Tests", ["src/app.test.ts"]),
    task("docs", "Docs", ["docs/"]),
  ]);
  assert.deepEqual(parts.map((part) => part.paths), [["src/app.ts"]]);
  assert.deepEqual(unassigned, ["src/app.test.ts", "docs/guide.md", "package-lock.json"]);
});

test("a run saved before tasks recorded their files falls back to their scopes, and a directory scope covers its files", () => {
  const files = [change("server/a.ts"), change("server/b.ts"), change("web/ui.ts")];
  const tasks = [task("api", "API", ["server/"]), task("ui", "UI", ["web/ui.ts"])];
  assert.deepEqual(planTaskPaths(files.map((file) => file.path), tasks[0]), ["server/a.ts", "server/b.ts"]);
  assert.deepEqual(
    suggestSplit(files, tasks).parts.map((part) => part.paths),
    [["server/a.ts", "server/b.ts"], ["web/ui.ts"]],
  );
  // What a task integrated wins over what its scope could cover, and a path that is no longer changed is ignored.
  const integrated = task("api", "API", ["server/"], { integratedFiles: ["server/a.ts", "gone.ts"] });
  assert.deepEqual(planTaskPaths(files.map((file) => file.path), integrated), ["server/a.ts"]);
});

test("a finished task that changed nothing owns no file, even with a broad scope", () => {
  const files = [change("src/a.js"), change("src/b.js")];
  const tasks = [
    task("a", "A (#1)", ["src/a.js"], { integratedFiles: ["src/a.js"] }),
    task("b", "B (#2)", ["src/b.js"], { integratedFiles: ["src/b.js"] }),
    task("verify", "Verify the build", ["src/"], { integratedFiles: [] }),
  ];
  assert.deepEqual(planTaskPaths(files.map((file) => file.path), tasks[2]), []);
  assert.deepEqual(
    suggestSplit(files, tasks).parts.map((part) => [part.paths, part.taskIds, part.issues]),
    [
      [["src/a.js"], ["a"], ["#1"]],
      [["src/b.js"], ["b"], ["#2"]],
    ],
  );
});

test("the reviewability snapshot counts the parts only when there are two or more", () => {
  assert.equal(reviewabilitySnapshot({ files: bundle, planTasks: bundleTasks }).parts, 3);
  assert.equal(reviewabilitySnapshot({ files: bundle, planTasks: bundleTasks.slice(0, 1) }).parts, undefined);
  assert.equal(reviewabilitySnapshot({ files: bundle }).parts, undefined);
});

// What a real run looked like: the plan splits the work by file, for speed, not by fix. One task
// covers #41 and the JS and Python half of #42, another the compiled half of #42, the third is #43.
const byFile = [
  task("runners", "Runners: keep non-finite results, report self-linked trees (#41, #42 for JS and Python)", bundleTasks[0].files, {
    description: "Fixes #41 and the first half of #42 in one file.",
  }),
  task("compiled", "Compiled harness: report cycles (#42, compiled languages)", bundleTasks[1].files),
  task("board", "Example board: reset the pen when a colour is picked (#43)", bundleTasks[2].files),
];

test("tasks that cite the same issue are one part, and a part that cites several issues says so", () => {
  const { parts, unassigned } = suggestSplit(bundle, byFile);
  // Three file groups, but only two fixes' worth of separation: #42 is not divided between two contributions...
  assert.deepEqual(
    parts.map((part) => [part.taskIds, part.issues]),
    [
      [["runners", "compiled"], ["#41", "#42"]],
      [["board"], ["#43"]],
    ],
  );
  assert.deepEqual(unassigned, []);
  // ...and the first part still cites two issues in files that cannot be separated: it is reported, not solved.
  assert.deepEqual(parts.filter((part) => part.issues.length > 1).map((part) => part.taskIds), [["runners", "compiled"]]);
  assert.equal(reviewabilitySnapshot({ files: bundle, planTasks: byFile }).parts, 2);
});

test("issue numbers come from a task's title and description, and only real references count", () => {
  assert.deepEqual(taskIssues({ title: "Fix #12 and #7 (#12 again)", description: "Also closes #345." }), ["#12", "#7", "#345"]);
  // An HTML entity, a word before the hash, a colour and a URL fragment are not issues.
  assert.deepEqual(taskIssues({ title: "Use &#39; in C#7 code, colour #ff0000, see page#12", description: "" }), []);
  assert.deepEqual(taskIssues({ title: "No reference here" }), []);
});

test("a part's issues are those of its tasks, and tasks without any reference stay as they were", () => {
  const mixed = [
    task("a", "Fix A (#5)", ["web/runners.js"]),
    task("b", "Fix B", ["web/compiler-explorer.js"]),
    task("c", "Fix C (#5)", ["web/example-board.js"]),
  ];
  const { parts } = suggestSplit(bundle, mixed);
  // a and c cite #5, so they are one part; b cites nothing and stays alone.
  assert.deepEqual(parts.map((part) => [part.taskIds, part.issues]), [
    [["a", "c"], ["#5"]],
    [["b"], []],
  ]);
});

test("a deleted contribution leaves the links of the runs split from or into it, and the rest stay", () => {
  const original = { splitInto: [{ runId: "a", title: "A" }, { runId: "b", title: "B" }] };
  const part = { splitFrom: { runId: "source", title: "Source" } };
  assert.equal(dropSplitLinks(original, "other"), false);
  assert.equal(dropSplitLinks(part, "other"), false);
  assert.deepEqual([original.splitInto.length, part.splitFrom.runId], [2, "source"]);
  // On a copy, as the browser updates its open run, the run it was copied from keeps its list.
  const copy = { ...original };
  assert.equal(dropSplitLinks(copy, "a"), true);
  assert.deepEqual(copy.splitInto, [{ runId: "b", title: "B" }]);
  assert.equal(original.splitInto.length, 2);
  // The last part takes the list with it, and the original its part's link back.
  assert.equal(dropSplitLinks(copy, "b"), true);
  assert.equal("splitInto" in copy, false);
  assert.equal(dropSplitLinks(part, "source"), true);
  assert.equal("splitFrom" in part, false);
});
