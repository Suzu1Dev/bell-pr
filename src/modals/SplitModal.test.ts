import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import type { TeamTask } from "../../shared/team";
import { getDemo } from "../demo";
import modals from "../i18n/en/modals";
import { mount, type FakeElement } from "../mission/test-dom";
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

const element = (run: Run, files: DiffFile[], props: Partial<Parameters<typeof SplitModal>[0]> = {}) =>
  createElement(SplitModal, {
    run,
    files,
    busy: false,
    formError: "",
    async splitRun() {},
    closeModal() {},
    ...props,
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
  // And the file that holds #41 and #42 says so, once; the part with one issue does not.
  const notice = modals.split.mixed({ paths: ["src/runners.ts"], issues: ["#41", "#42"] });
  assert.equal(plain(html).split(notice).length - 1, 1);
  assert.equal(html.split('class="split-warning"').length - 1, 1);
});

// A real run: one task per issue, but both fixes are in src/index.js. The notice names that file, not
// the first task as if it cited both issues.
const sharedFile = (): Run =>
  withPlan([
    task("slugify", "Issue #1: slugify strips trailing dashes", ["src/index.js", "test/slugify.test.js"]),
    task("truncate", "Issue #2: truncate counts the ellipsis", ["src/index.js", "test/truncate.test.js"]),
  ]);
const sharedFileFiles = () => [file("src/index.js"), file("test/slugify.test.js"), file("test/truncate.test.js")];

test("tasks for different issues that changed the same file are reported by that file", () => {
  const text = plain(renderEn(element(sharedFile(), sharedFileFiles())));
  assert.ok(text.includes(modals.split.mixed({ paths: ["src/index.js"], issues: ["#1", "#2"] })));
  assert.match(text, /src\/index\.js holds changes for #1 and #2\. BELL PR cannot separate changes inside a file/);
  assert.doesNotMatch(text, /strips trailing dashes" cites/);
});

test("tasks for different issues that only a dependency joins can still be moved apart by file", () => {
  const run = withPlan([
    task("retry", "Retry (#1)", ["src/a.ts"]),
    { ...task("cache", "Cache (#2)", ["src/b.ts"]), dependsOn: ["retry"] },
  ]);
  const html = renderEn(element(run, [file("src/a.ts"), file("src/b.ts")]));
  const text = plain(html);
  assert.ok(text.includes(modals.split.linked({ issues: ["#1", "#2"] })));
  assert.doesNotMatch(text, /cannot separate changes inside a file/);
  // One part is nothing to split, so both files start left out, and the note does not say otherwise.
  assert.deepEqual(["src/a.ts", "src/b.ts"].map((path) => goesTo(html, path)), ["", ""]);
  assert.doesNotMatch(text, /start in (one|a) contribution/);
});

test("a part with a shared file also names an issue that only a dependency joins to it", () => {
  const run = withPlan([
    task("a", "Slugify (#1)", ["src/index.js"]),
    task("b", "Truncate (#2)", ["src/index.js"]),
    { ...task("c", "Config (#3)", ["src/c.js"]), dependsOn: ["a"] },
  ]);
  const html = renderEn(element(run, [file("src/index.js"), file("src/c.js")]));
  const text = plain(html);
  assert.ok(text.includes(modals.split.mixed({ paths: ["src/index.js"], issues: ["#1", "#2"] })));
  // #3's file holds only #3, so it can move: the note that the plan links the tasks names it.
  assert.ok(text.includes(modals.split.linked({ issues: ["#1", "#2", "#3"] })));
  assert.match(text, /links the tasks for #1, #2, and #3/);
  assert.equal(html.split('class="split-warning"').length - 1, 2);
});

test("a plan whose parts each cite one issue, or none, shows no unresolved notice", () => {
  const html = renderEn(element(withPlan([task("retry", "Retry (#1)", ["src/a.ts"]), task("cache", "Cache", ["src/b.ts"])]), [file("src/a.ts"), file("src/b.ts")]));
  assert.doesNotMatch(html, /split-warning/);
});

test("the unresolved notice reads in zh-TW", () => {
  const html = renderZh(element(sharedFile(), sharedFileFiles()));
  assert.match(html, /src\/index\.js 含有 #1、#2 的變更/);
  assert.doesNotMatch(html, /holds changes for/);
});

test("the dialog reads in zh-TW", () => {
  const run = withPlan([task("retry", "Retry on timeout", ["src/a.ts"]), task("cache", "Cache the token", ["src/b.ts"])]);
  const html = renderZh(element(run, [file("src/a.ts"), file("src/b.ts"), file("docs/notes.md")]));
  assert.match(html, /拆分為不同的貢獻/);
  assert.match(html, /不移動/);
  assert.doesNotMatch(html, /Split into separate contributions|Leave out/);
});

/** Calls the click handler React gave `element`: the fake DOM dispatches no events. */
const click = (element: FakeElement) =>
  act(async () => {
    const props = Object.entries(element).find(([name]) => name.startsWith("__reactProps$"))?.[1] as { onClick(): void };
    props.onClick();
  });

test("adding or removing a contribution leaves the keyboard on a contribution's title", async () => {
  const view = await mount(element(withPlan([]), [file("src/a.ts"), file("src/b.ts")]));
  try {
    const find = (match: (element: FakeElement) => boolean) => view.container.querySelectorAll(match)[0]!;
    const add = find((element) => element.getAttribute("class") === "split-add");
    const remove = (number: number) => find((element) => element.getAttribute("aria-label") === `Remove contribution ${number}`);
    const focused = () => document.activeElement?.getAttribute("id");
    // The new contribution's title is what the person fills in next; the eighth also disables Add.
    for (let key = 3; key <= 8; key++) {
      add.focus();
      await click(add);
      assert.equal(focused(), `split-title-${key}`);
    }
    assert.ok(add.disabled || add.hasAttribute("disabled"));
    // A removed card takes its button with it: the next card's title takes the keyboard, or the previous one's for the last card.
    remove(8).focus();
    await click(remove(8));
    assert.equal(focused(), "split-title-7");
    remove(3).focus();
    await click(remove(3));
    assert.equal(focused(), "split-title-4");
  } finally {
    await view.unmount();
  }
});

/** Calls the submit handler React gave `form`, without waiting for the request it starts. */
const submit = (form: FakeElement) =>
  act(async () => {
    const props = Object.entries(form).find(([name]) => name.startsWith("__reactProps$"))?.[1] as {
      onSubmit(event: { preventDefault(): void }): Promise<void>;
    };
    void props.onSubmit({ preventDefault() {} });
  });

test("while the split is sent the dialog cannot be closed, so it can still open the first part or show the error", async () => {
  const run = withPlan([task("retry", "Retry on timeout", ["src/a.ts"]), task("cache", "Cache the token", ["src/b.ts"])]);
  const files = [file("src/a.ts"), file("src/b.ts")];
  let closed = 0;
  let finish = () => {};
  const props = (busy: boolean) => ({
    busy,
    closeModal: () => void closed++,
    splitRun: () => new Promise<void>((resolve) => (finish = resolve)),
  });
  const view = await mount(element(run, files, props(false)));
  try {
    const find = (match: (element: FakeElement) => boolean) => view.container.querySelectorAll(match)[0]!;
    // The close button, Escape and the backdrop all close through the Modal's onClose.
    const close = () => click(find((element) => element.getAttribute("class") === "icon-button modal-close"));
    const cancel = () => find((element) => element.getAttribute("class") === "button secondary" && element.textContent === "Cancel");
    await submit(find((element) => element.nodeName === "FORM"));
    // AppShell is busy while the split runs, as it is for every request.
    await view.rerender(element(run, files, props(true)));
    await close();
    assert.equal(closed, 0);
    assert.ok(cancel().hasAttribute("disabled"));
    // A failed split leaves the dialog open, and then it closes again.
    await act(async () => finish());
    await view.rerender(element(run, files, props(false)));
    assert.ok(!cancel().hasAttribute("disabled"));
    await close();
    assert.equal(closed, 1);
  } finally {
    await view.unmount();
  }
});

test("another request that runs while the dialog is open does not keep it from closing", async () => {
  let closed = 0;
  const view = await mount(element(withPlan([]), [file("src/a.ts"), file("src/b.ts")], { busy: true, closeModal: () => void closed++ }));
  try {
    const find = (match: (element: FakeElement) => boolean) => view.container.querySelectorAll(match)[0]!;
    const cancel = find((element) => element.getAttribute("class") === "button secondary" && element.textContent === "Cancel");
    assert.ok(!cancel.hasAttribute("disabled"));
    await click(find((element) => element.getAttribute("class") === "icon-button modal-close"));
    assert.equal(closed, 1);
  } finally {
    await view.unmount();
  }
});
