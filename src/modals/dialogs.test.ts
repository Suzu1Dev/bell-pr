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
