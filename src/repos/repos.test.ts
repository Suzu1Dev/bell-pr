import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Repo } from "../types";
import { examplePath, ImportRepoModal, namesSample } from "./ImportRepoModal";
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

test("an imported repository can be deleted, the sample cannot, and paths mask while presenting", () => {
  const element = createElement(ReposPage, {
    repos: [repo],
    openModal() {},
    navigate() {},
    async chooseRun() {
      return true;
    },
    setExploreRepoId() {},
    discoveryLocked: true,
    maskPath: (path: string) => `…/${path.split("/").pop()}`,
    async deleteRepository() {},
  });
  const html = renderEn(element);
  assert.match(
    html,
    /<button type="button" class="run-list-action run-list-action-danger" aria-label="Delete repository: octo\/widgets"><svg[^]*?Delete repository<\/button>/,
  );
  assert.equal(html.match(/repository-delete/g)?.length, 1);
  assert.match(html, /<p>…\/widgets<\/p>/);
  assert.doesNotMatch(html, /\/tmp\/widgets/);
  // On Free the discovery entry says PRO.
  assert.match(
    html,
    /<strong class="discovery-entry-title">Not sure which project to contribute to yet\?<span class="pro-badge" role="img" aria-label="Pro feature"/,
  );
  assertNoHan(html);
  assert.match(renderZh(element), /aria-label="刪除 Repository：octo\/widgets"/);
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
  assert.match(html, /placeholder="owner\/repository or https:\/\/github\.com\/owner\/repository"/);
  assert.match(html, /Local Git projects work too: paste the full path, such as /);
  assert.match(html, />Not now<\/button>/);
  assert.doesNotMatch(html, /lucide-github|Cloning/);
  assertNoHan(html);
  const busy = renderEn(createElement(ImportRepoModal, { ...props, source: "x", busy: true }));
  assert.match(busy, /Importing…/);
  assert.match(
    busy,
    /<p class="field-help import-cloning" role="status">Cloning… large repositories can take a few minutes\.<\/p>/,
  );
  assert.match(renderZh(createElement(ImportRepoModal, props)), />稍後再說<\/button>/);
});

test("the path example follows the computer's platform", () => {
  assert.equal(examplePath("MacIntel"), "/Users/you/projects/repository");
  assert.equal(examplePath("Win32"), "C:\\Users\\you\\projects\\repository");
  assert.equal(examplePath("Linux x86_64"), "/home/you/projects/repository");
});

test("the sample is recognized by its name or its GitHub address", () => {
  const sample = "openfetch-sample/open-fetch";
  for (const input of [
    sample,
    "  OpenFetch-Sample/Open-Fetch ",
    "https://github.com/openfetch-sample/open-fetch",
    "https://github.com/openfetch-sample/open-fetch.git",
    "github.com/openfetch-sample/open-fetch/",
  ])
    assert.equal(namesSample(input, sample), true, input);
  for (const input of ["openfetch-sample/open-fetch-2", "octo/open-fetch", "/home/you/open-fetch", ""])
    assert.equal(namesSample(input, sample), false, input);
});
