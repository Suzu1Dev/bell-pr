import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Repo } from "../types";
import { ImportRepoModal } from "./ImportRepoModal";
import { ReposPage } from "./ReposPage";

const repo: Repo = {
  id: "repo-1",
  name: "widgets",
  owner: "octo",
  fullName: "octo/widgets",
  path: "/tmp/widgets",
  defaultBranch: "main",
  url: "https://github.com/octo/widgets",
};

test("the repository list reads in English with no Chinese left", () => {
  const element = createElement(ReposPage, {
    repos: [repo],
    openModal() {},
    navigate() {},
    async chooseRun() {
      return true;
    },
    setExploreRepoId() {},
  });
  const html = renderEn(element);
  assert.match(html, /<h1 tabindex="-1">Your next contribution starts here\.<\/h1>/);
  assert.match(html, /<span class="demo-pill">Sample project<\/span>/);
  assert.match(html, /Explore the demo workbench/);
  assert.match(html, /Explore the project and directions/);
  assert.match(html, /<strong>Add your repository<\/strong>/);
  assertNoHan(html);
  assert.match(renderZh(element), /<span class="demo-pill">示範專案<\/span>/);
});

test("the import dialog reads in English with no Chinese left", () => {
  const props = {
    source: "",
    setSource() {},
    busy: false,
    formError: "",
    importRepo() {},
    closeModal() {},
  };
  const html = renderEn(createElement(ImportRepoModal, props));
  assert.match(html, /<h2 id="modal-title">Bring in your next contribution\.<\/h2>/);
  assert.match(html, /<label class="field-label" for="repo-source">Repository source<\/label>/);
  assert.match(html, />Not now<\/button>/);
  assertNoHan(html);
  assert.match(
    renderEn(createElement(ImportRepoModal, { ...props, source: "x", busy: true })),
    /Importing…/,
  );
  assert.match(renderZh(createElement(ImportRepoModal, props)), />稍後再說<\/button>/);
});
