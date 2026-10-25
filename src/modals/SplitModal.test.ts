import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { TeamTask } from "../../shared/team";
import { getDemo } from "../demo";
import modals from "../i18n/en/modals";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { DiffFile, Run } from "../types";
import { SplitModal } from "./SplitModal";

const demo = getDemo("en");

const file = (path: string, blocked = ""): DiffFile => ({
  path,
  language: "TypeScript",
  additions: 1,
  deletions: 0,
  status: "modified",
  patch: "@@ -1 +1 @@\n+a",
  ...(blocked ? { blocked } : {}),
});

const task = (id: string, title: string, files: string[]): TeamTask => ({
  id,
  title,
  description: "",
  owner: "lead",
  files,
  dependsOn: [],
  status: "complete",
});

const withPlan = (tasks: TeamTask[]): Run => ({
  ...demo.run,
  team: {
    config: {
      maxTeammates: 2,
      requirePlanApproval: false,
      provider: "claude",
      protocol: "bell-shared-tasks",
      messageDelivery: "between-turns",
    },
    phase: "complete",
    planSummary: "",
    tasks,
    messages: [],
  },
});

const element = (run: Run, files: DiffFile[]) =>
  createElement(SplitModal, {
    run,
    files,
    busy: false,
    formError: "",
    async splitRun() {},
    closeModal() {},
  });

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Rendered text with the entities React uses for quotes turned back, to compare with the dictionary. */
const plain = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"');
/** The contribution a file's menu has selected: its key, or "" when the file is left out. */
const goesTo = (html: string, path: string) => {
  const menu = new RegExp(`<select[^>]*aria-label="Contribution for ${escapeRegExp(path)}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  return menu ? /<option value="([^"]*)" selected=""/.exec(menu[1])?.[1] : undefined;
};
/** The title typed into contribution `key`. */
const titleOf = (html: string, key: number) =>
  new RegExp(`<input id="split-title-${key}"[^>]*value="([^"]*)"`).exec(html)?.[1];

test("a plan with independent parts starts one contribution per part, and a file no part claims is left out", () => {
  const run = withPlan([task("retry", "Retry on timeout", ["src/a.ts"]), task("cache", "Cache the token", ["src/b.ts"])]);
  const html = renderEn(element(run, [file("src/a.ts"), file("src/b.ts"), file("docs/notes.md")]));
  assertNoHan(html);
  const text = plain(html);
  assert.match(html, /Split into separate contributions/);
  // What a split does and what it cannot do is always in front of the person.
  for (const sentence of [modals.split.creates, modals.split.original, modals.split.filesOnly, modals.split.testEach])
    assert.ok(text.includes(sentence), sentence);
  assert.equal(titleOf(html, 1), "Retry on timeout");
  assert.equal(titleOf(html, 2), "Cache the token");
  assert.deepEqual(
    ["src/a.ts", "src/b.ts", "docs/notes.md"].map((path) => goesTo(html, path)),
    ["1", "2", ""],
  );
  assert.match(html, /2 contributions; 1 file left out\./);
  assert.match(html, /<button type="submit" class="button primary"><svg[\s\S]*?Split<\/button>/);
});

test("without a plan the dialog opens two empty contributions, and Split waits until each has a title and a file", () => {
  const html = renderEn(element(withPlan([]), [file("src/a.ts"), file("src/b.ts")]));
  assertNoHan(html);
  assert.match(html, /<input id="split-title-1"[^>]*value=""/);
  assert.match(html, /<input id="split-title-2"[^>]*value=""/);
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Remove contribution 1"/);
  assert.match(html, /2 contributions; 2 files left out\./);
  assert.match(html, /<button type="submit" class="button primary" disabled="">/);
});

test("a file held back from review names why it cannot move", () => {
  const run = withPlan([task("retry", "Retry on timeout", ["src/a.ts"]), task("cache", "Cache the token", ["src/b.ts"])]);
  const html = renderEn(element(run, [file("src/a.ts"), file("src/b.ts"), file("src/secret.ts", "contains a secret")]));
  assertNoHan(html);
  assert.match(html, /<select[^>]*aria-label="Contribution for src\/secret\.ts"[^>]*disabled=""/);
  assert.ok(plain(html).includes(modals.split.blocked({ reason: "contains a secret" })));
  assert.match(html, /2 contributions; 1 file left out\./);
});

test("a plan with more parts than a split takes assigns the first eight and leaves out the rest", () => {
  const tasks = Array.from({ length: 9 }, (_, index) => task(`t${index + 1}`, `Part ${index + 1}`, [`src/f${index + 1}.ts`]));
  const files = Array.from({ length: 9 }, (_, index) => file(`src/f${index + 1}.ts`));
  const html = renderEn(element(withPlan(tasks), files));
  assertNoHan(html);
  assert.ok(plain(html).includes(modals.split.suggestionLimit({ count: 8 })));
  assert.match(html, /8 contributions; 1 file left out\./);
  assert.equal(goesTo(html, "src/f9.ts"), "");
});

// The plan splits work by file, for speed: one task covers #41 and half of #42, another the other half
// of #42, the third is #43. The dialog must not offer #42 as two contributions, and must say that the
// first part still holds two issues in files it cannot cut apart.
const byFile = (): Run =>
  withPlan([
    { ...task("runners", "Runners: keep non-finite results (#41, #42 for JS and Python)", ["src/runners.ts"]) },
    { ...task("compiled", "Compiled harness: report cycles (#42, compiled languages)", ["src/compiled.ts"]) },
    { ...task("board", "Example board: reset the pen (#43)", ["src/board.ts"]) },
  ]);
const byFileFiles = () => [file("src/runners.ts"), file("src/compiled.ts"), file("src/board.ts")];

test("tasks that cite the same issue start as one contribution, and a part that cites several issues is reported as unresolved", () => {
  const html = renderEn(element(byFile(), byFileFiles()));
  assertNoHan(html);
  // Two contributions, not three: #42 is not divided between two of them.
  assert.match(html, /2 contributions; 0 files left out\./);
  assert.equal(titleOf(html, 1), "Runners: keep non-finite results (#41, #42 for JS and Python)");
  assert.deepEqual(
    ["src/runners.ts", "src/compiled.ts", "src/board.ts"].map((path) => goesTo(html, path)),
    ["1", "1", "2"],
  );
  // And the part that holds #41 and #42 says so, once; the part with one issue does not.
  const notice = modals.split.mixed({
    title: "Runners: keep non-finite results (#41, #42 for JS and Python)",
    issues: ["#41", "#42"],
  });
  assert.equal(plain(html).split(notice).length - 1, 1);
  assert.doesNotMatch(html, /cites #43/);
});

test("a plan whose parts each cite one issue, or none, shows no unresolved notice", () => {
  const html = renderEn(element(withPlan([task("retry", "Retry (#1)", ["src/a.ts"]), task("cache", "Cache", ["src/b.ts"])]), [file("src/a.ts"), file("src/b.ts")]));
  assert.doesNotMatch(html, /its files carry more than one issue/);
});

test("the unresolved notice reads in zh-TW", () => {
  const html = renderZh(element(byFile(), byFileFiles()));
  assert.match(html, /提到 #41、#42：它的檔案涉及不只一個議題/);
  assert.doesNotMatch(html, /cites #41/);
});

test("the dialog reads in zh-TW", () => {
  const run = withPlan([task("retry", "Retry on timeout", ["src/a.ts"]), task("cache", "Cache the token", ["src/b.ts"])]);
  const html = renderZh(element(run, [file("src/a.ts"), file("src/b.ts"), file("docs/notes.md")]));
  assert.match(html, /拆分為不同的貢獻/);
  assert.match(html, /不移動/);
  assert.doesNotMatch(html, /Split into separate contributions|Leave out/);
});
