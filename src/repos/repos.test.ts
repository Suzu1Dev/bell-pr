import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Repo } from "../types";
import { ImportRepoModal, isWindowsPlatform, localPathExample, namesSample } from "./ImportRepoModal";
import { ExploreHeading } from "./ExplorePage";
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

const localRepo: Repo = {
  id: "local-1",
  name: "notes",
  owner: "local",
  fullName: "local/notes",
  path: "/tmp/notes",
  defaultBranch: "main",
  url: "",
};

/** An origin that must never appear in the notice or in stored data. */
const secretOrigin = "https://user:token@github.com/o/r.git";

const ignoredRepo: Repo = {
  ...localRepo,
  id: "ignored-1",
  name: "widgets",
  fullName: "local/widgets",
  originUserinfoIgnored: true,
};

const list = (repos: Repo[]) =>
  createElement(ReposPage, {
    repos,
    openModal() {},
    navigate() {},
    async chooseRun() {
      return true;
    },
    setExploreRepoId() {},
  });

test("the origin notice shows only when that origin was imported as local", () => {
  const command = "git remote set-url origin https://github.com/OWNER/REPO";
  const html = renderEn(list([repo, localRepo, ignoredRepo]));
  assert.equal(html.match(/role="alert"/g)?.length, 1);
  assert.match(html, /imported as a local project/);
  assert.match(html, /use a credential helper/);
  assert.ok(html.includes(`<code>${command}</code>`));
  assert.equal(html.includes(secretOrigin), false);
  assert.equal(html.includes("user:token"), false);
  assertNoHan(html);
  const zh = renderZh(list([ignoredRepo]));
  assert.match(zh, /使用者名稱或權杖/);
  assert.match(zh, /請執行這個指令並使用 credential helper/);
  assert.ok(zh.includes(`<code>${command}</code>`));
  assert.equal(zh.includes(secretOrigin), false);
  assert.equal(zh.includes("user:token"), false);
  for (const repos of [[repo], [localRepo]]) {
    const plain = renderEn(list(repos));
    assert.equal(plain.includes('role="alert"'), false);
    assert.equal(plain.includes(command), false);
  }
  const project = renderEn(
    createElement(ExploreHeading, { repo: ignoredRepo, onChooseDirection() {} }),
  );
  assert.match(project, /<h1 tabindex="-1">local\/widgets<\/h1>/);
  assert.equal(project.match(/role="alert"/g)?.length, 1);
  assert.ok(project.includes(`<code>${command}</code>`));
  assert.equal(project.includes(secretOrigin), false);
  assert.equal(project.includes("user:token"), false);
  assertNoHan(project);
  const projectZh = renderZh(
    createElement(ExploreHeading, { repo: ignoredRepo, onChooseDirection() {} }),
  );
  assert.match(projectZh, /使用者名稱或權杖/);
  assert.equal(projectZh.includes("user:token"), false);
  for (const plainRepo of [repo, localRepo]) {
    const plain = renderEn(
      createElement(ExploreHeading, { repo: plainRepo, onChooseDirection() {} }),
    );
    assert.equal(plain.includes('role="alert"'), false);
    assert.equal(plain.includes(command), false);
  }
});

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
    maskPath: (path: string) => `…/${path.split("/").pop()}`,
    async deleteRepository() {},
  });
  const html = renderEn(element);
  assert.match(
    html,
    /<button type="button" class="run-list-action run-list-action-danger" data-repo-delete="repo-1" aria-label="Delete repository: octo\/widgets"><svg[^]*?Delete repository<\/button>/,
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
  assert.match(html, /Local Git projects work too: paste the path, such as ~\/projects\/repository<\/p>/);
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
    /<p class="field-help" id="repo-source-wsl">If BELL PR runs inside WSL2 on this computer, use the path in your Linux distribution: a Windows folder is under \/mnt\/c\/, for example \/mnt\/c\/projects\/repository\.<\/p>/,
  );
  assertNoHan(windows);
  const zh = renderZh(createElement(ImportRepoModal, { ...props, platform: "Win32" }));
  assert.match(zh, /也支援本機 Git 專案：貼上路徑，例如 ~\/projects\/repository/);
  assert.match(zh, /若 BELL PR 在這台電腦的 WSL2 中執行，請使用 Linux 發行版中的路徑/);
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
