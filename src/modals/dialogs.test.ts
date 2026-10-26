import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { getDemo } from "../demo";
import { mount, type FakeElement } from "../mission/test-dom";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Repo, RunSummary } from "../types";
import { HelpModal } from "./HelpModal";
import { RunsModal } from "./RunsModal";

const repo: Repo = {
  id: "repo-1",
  name: "widgets",
  owner: "octo",
  fullName: "octo/widgets",
  path: "/tmp/widgets",
  defaultBranch: "main",
  url: "https://github.com/octo/widgets",
};

test("the guide reads in English with no Chinese left", () => {
  const html = renderEn(createElement(HelpModal, { closeModal() {} }));
  assert.match(html, /<h2 id="modal-title">From an idea to your next PR\.<\/h2>/);
  assert.match(html, /<strong>Understand every change<\/strong>/);
  assert.match(html, />Start exploring<\/button>/);
  assert.match(html, /aria-label="Close dialog"/);
  assertNoHan(html);
  assert.match(
    renderZh(createElement(HelpModal, { closeModal() {} })),
    /<strong>理解每個改動<\/strong>/,
  );
  assert.doesNotMatch(html, /About BELL PR/);
  assert.match(
    renderEn(createElement(HelpModal, { closeModal() {}, openAbout() {} })),
    /<button class="button secondary full-width"><svg[^]*?About BELL PR<\/button>/,
  );
});

test("the runs list reads in English with no Chinese left", () => {
  const run = {
    ...getDemo("en").run,
    id: "run-1",
    repoId: repo.id,
    title: "Retry timeouts",
    status: "running",
    branch: "fix/retry",
  } as RunSummary;
  const element = createElement(RunsModal, {
    runs: [run],
    repos: [repo],
    async chooseRun() {
      return true;
    },
    beginContribution() {},
    closeModal() {},
  });
  const html = renderEn(element);
  assert.match(html, /<h2 id="modal-title">Every idea has its progress\.<\/h2>/);
  assert.match(html, /<small>octo\/widgets · fix\/retry<\/small><\/span><em>In progress<\/em>/);
  assert.match(html, /<small>Interactive demo · /);
  assert.match(html, />New contribution<\/button>/);
  assertNoHan(html);
  assert.match(renderZh(element), /<small>octo\/widgets · fix\/retry<\/small><\/span><em>開發中<\/em>/);
});

test("a run of the person's own can free its disk space or be deleted; the sample cannot", () => {
  const own = (status: RunSummary["status"], extra: Partial<RunSummary> = {}) =>
    ({
      ...getDemo("en").run,
      id: "run-1",
      repoId: repo.id,
      title: "Retry timeouts",
      status,
      branch: "fix/retry",
      ...extra,
    }) as RunSummary;
  const render = (runs: RunSummary[], handlers = true, busy?: boolean) =>
    renderEn(
      createElement(RunsModal, {
        runs,
        repos: [repo],
        async chooseRun() {
          return true;
        },
        beginContribution() {},
        closeModal() {},
        busy,
        ...(handlers ? { async freeRunSpace() {}, async deleteRun() {} } : {}),
      }),
    );
  const html = render([own("review")]);
  assert.match(
    html,
    /<button type="button" class="run-list-action" data-run-action="run-1:free" aria-label="Free disk space: Retry timeouts"><svg[^]*?Free disk space<\/button>/,
  );
  assert.match(
    html,
    /<button type="button" class="run-list-action run-list-action-danger" data-run-action="run-1:delete" aria-label="Delete run: Retry timeouts"><svg[^]*?Delete run<\/button>/,
  );
  // One pair of actions: the sample's row has none.
  assert.equal(html.match(/run-list-actions/g)?.length, 1);
  assertNoHan(html);

  const running = render([own("running")]);
  assert.match(running, /<span class="run-list-hint">Stop this contribution before you free its space or delete it\.<\/span>/);
  assert.match(running, /class="run-list-action" data-run-action="run-1:free" disabled="" aria-label="Free disk space/);
  assert.match(running, /class="run-list-action run-list-action-danger" data-run-action="run-1:delete" disabled=""/);

  // While another request runs, neither starts: its end would clear that request's busy state.
  const busy = render([own("review")], true, true);
  assert.match(busy, /class="run-list-action" data-run-action="run-1:free" disabled=""/);
  assert.match(busy, /class="run-list-action run-list-action-danger" data-run-action="run-1:delete" disabled=""/);
  assert.doesNotMatch(busy, /run-list-hint/);

  const removed = render([own("published", { workspaceRemovedAt: "2026-10-02T08:00:00.000Z" })]);
  assert.match(removed, /<span class="run-files-removed">Files removed<\/span>/);
  assert.doesNotMatch(removed, /Free disk space/);
  assert.match(removed, /Delete run/);

  assert.doesNotMatch(render([own("review")], false), /run-list-actions/);
  assert.match(
    renderZh(
      createElement(RunsModal, {
        runs: [own("review")],
        repos: [repo],
        async chooseRun() {
          return true;
        },
        beginContribution() {},
        closeModal() {},
        async deleteRun() {},
      }),
    ),
    /aria-label="刪除貢獻：Retry timeouts"/,
  );
});

test("in the runs list a learn-by-hand run the person still writes reads as their turn, with the Learn-by-hand chip", () => {
  const run = (phase: string, learnByHand = true) =>
    ({ ...getDemo("en").run, id: "run-1", repoId: repo.id, title: "Cap retries", status: "review", branch: "by-hand/cap", learnByHand, team: { phase } }) as unknown as RunSummary;
  const list = (runs: RunSummary[]) =>
    renderEn(createElement(RunsModal, { runs, repos: [repo], async chooseRun() { return true; }, beginContribution() {}, closeModal() {} }));
  const html = list([run("developing")]);
  assertNoHan(html);
  assert.match(html, /<strong>Cap retries<\/strong>[\s\S]*?<em><span title="Learn by hand"><svg[^>]*lucide-hand[\s\S]*?<\/svg><span class="visually-hidden">Learn by hand<\/span><\/span> Your turn<\/em>/);
  assert.match(list([run("complete")]), /<strong>Cap retries<\/strong>[\s\S]*?<\/span><\/span> Ready for your review<\/em>/);
  assert.doesNotMatch(list([run("developing", false)]), /Your turn|title="Learn by hand"/);
});

/** Calls the click handler React gave `element` (the fake DOM dispatches no events), without waiting for what it starts. */
const click = (element: FakeElement) =>
  act(async () => {
    const props = Object.entries(element).find(([key]) => key.startsWith("__reactProps$"))?.[1] as {
      onClick(event: { preventDefault(): void }): unknown;
    };
    void props.onClick({ preventDefault() {} });
  });

test("while a run is deleted the runs list cannot be closed or left, so a failure still shows in its row", async () => {
  let closed = 0;
  let fail = (_error: Error) => {};
  const run = {
    ...getDemo("en").run,
    id: "run-1",
    repoId: repo.id,
    title: "Retry timeouts",
    status: "review",
    branch: "fix/retry",
  } as RunSummary;
  const view = await mount(
    createElement(RunsModal, {
      runs: [run],
      repos: [repo],
      async chooseRun() {
        return true;
      },
      beginContribution() {},
      closeModal: () => void closed++,
      deleteRun: () => new Promise<void>((_resolve, reject) => (fail = reject)),
    }),
  );
  try {
    const all = (match: (element: FakeElement) => boolean) => view.container.querySelectorAll(match);
    const withClass = (name: string) => all((element) => element.getAttribute("class") === name);
    // The close button, Escape and the backdrop all close through the Modal's onClose.
    const close = () => click(withClass("icon-button modal-close")[0]!);
    await click(all((element) => element.getAttribute("data-run-action") === "run-1:delete")[0]!);
    await click(withClass("button danger")[0]!);
    await close();
    assert.equal(closed, 0);
    // Opening a run or starting a contribution would leave the dialog too.
    const rows = withClass("run-list-row");
    assert.equal(rows.length, 2);
    for (const row of rows) assert.ok(row.hasAttribute("disabled"), row.textContent);
    assert.ok(withClass("button primary full-width")[0]!.hasAttribute("disabled"));
    // The failure shows in the run's row, and then the dialog closes again.
    await act(async () => fail(new Error("Stop this contribution before deleting it.")));
    assert.equal(
      all((element) => element.getAttribute("role") === "alert")[0]?.textContent,
      "Stop this contribution before deleting it.",
    );
    assert.ok(!rows[0]!.hasAttribute("disabled"));
    await close();
    assert.equal(closed, 1);
  } finally {
    await view.unmount();
  }
});
