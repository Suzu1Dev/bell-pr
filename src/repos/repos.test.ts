import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Repo } from "../types";
import { ImportRepoModal, isWindowsPlatform, localPathExample, namesSample } from "./ImportRepoModal";
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
  assert.match(html, /<h1 tabindex="-1">Projects<\/h1>/);
  assert.match(html, /<span class="demo-pill">Sample project<\/span>/);
  assert.match(html, /Open the sample workbench/);
  assert.match(html, /Open project/);
  assert.match(html, /<strong>Import a project<\/strong>/);
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
    maskPath: (path: string) => `…/${path.split("/").pop()}`,
    async deleteRepository() {},
  });
  const html = renderEn(element);
  assert.match(
    html,
    /<button type="button" class="run-list-action run-list-action-danger" data-repo-delete="repo-1" aria-label="Delete project: octo\/widgets"><svg[^]*?Delete project<\/button>/,
  );
  assert.equal(html.match(/repository-delete/g)?.length, 1);
  // One line that keeps the end of the path; the full (masked) path is its title.
  assert.match(
    html,
    /<p class="repository-path" title="…\/widgets"><span>…\/widgets<\/span><\/p>/,
  );
  assert.doesNotMatch(html, /\/tmp\/widgets/);
  // The discovery entry carries no plan badge.
  assert.match(
    html,
    /<strong>Not sure which project to contribute to yet\?<\/strong>/,
  );
  assert.doesNotMatch(html, /pro-badge/);
  assertNoHan(html);
  assert.match(renderZh(element), /aria-label="刪除專案：octo\/widgets"/);
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
  assert.match(html, /<h2 id="modal-title">Import a project<\/h2>/);
  assert.match(html, /<label class="field-label" for="repo-source">Project source<\/label>/);
  assert.match(html, /placeholder="owner\/repository or https:\/\/github\.com\/owner\/repository"/);
  assert.match(html, /Paste a GitHub link, owner\/repository, or the full path of a local Git project, such as ~\/projects\/repository<\/p>/);
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

test("one path example for every computer, and the WSL2 hint for Windows browsers", () => {
  assert.equal(localPathExample, "~/projects/repository");
  assert.equal(isWindowsPlatform("Win32"), true);
  for (const platform of ["MacIntel", "Linux x86_64", "iPhone", ""])
    assert.equal(isWindowsPlatform(platform), false, platform);
  const props = {
    source: "",
    setSource() {},
    busy: false,
    formError: "",
    importRepo() {},
    closeModal() {},
  };
  for (const platform of ["MacIntel", "Linux x86_64"]) {
    const html = renderEn(createElement(ImportRepoModal, { ...props, platform }));
    assert.match(html, /such as ~\/projects\/repository</, platform);
    assert.match(html, /aria-describedby="repo-source-hint"/, platform);
    assert.doesNotMatch(html, /WSL2|C:\\|\/home\/|\/Users\//, platform);
  }
  const windows = renderEn(createElement(ImportRepoModal, { ...props, platform: "Win32" }));
  assert.match(windows, /such as ~\/projects\/repository</);
  assert.match(windows, /aria-describedby="repo-source-hint repo-source-wsl"/);
  assert.match(
    windows,
    /<p class="field-help" id="repo-source-wsl">If BELL PR runs in WSL2 on this computer, use the Linux path, such as \/mnt\/c\/projects\/repository for a Windows folder\.<\/p>/,
  );
  assertNoHan(windows);
  const zh = renderZh(createElement(ImportRepoModal, { ...props, platform: "Win32" }));
  assert.match(zh, /貼上 GitHub 連結、owner\/repository，或本機 Git 專案的完整路徑，例如 ~\/projects\/repository/);
  assert.match(zh, /若 BELL PR 在這台電腦的 WSL2 中執行，請使用 Linux 路徑/);
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
