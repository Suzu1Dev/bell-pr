import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { getDemo } from "../demo";
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
  const render = (runs: RunSummary[], handlers = true) =>
    renderEn(
      createElement(RunsModal, {
        runs,
        repos: [repo],
        async chooseRun() {
          return true;
        },
        beginContribution() {},
        closeModal() {},
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
