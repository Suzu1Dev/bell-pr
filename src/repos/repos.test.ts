import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { mount, type FakeElement } from "../mission/test-dom";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Repo } from "../types";
import { ImportRepoModal, isWindowsPlatform, localPathExample, namesSample } from "./ImportRepoModal";
import { ExploreHeading } from "./ExplorePage";
import { OriginIgnoredNotice } from "./OriginIgnoredNotice";
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
  const copyLabel = `Copy the command. Replace OWNER and REPO: ${command}`;
  const html = renderEn(list([repo, localRepo, ignoredRepo]));
  assert.equal(html.match(/role="note"/g)?.length, 1);
  assert.equal(html.includes('role="alert"'), false);
  assert.match(html, /The origin URL includes credentials, so this was imported as a local project\./);
  assert.match(html, /Replace OWNER and REPO, update the remote in your checkout, and use a credential helper\./);
  assert.match(html, /Remove this local project and import the folder again\./);
  assert.ok(html.includes(`<code>${command}</code>`));
  assert.equal(html.match(/copy-command-button/g)?.length, 1);
  assert.match(html, /<span class="copy-command-label">Replace OWNER and REPO\.<\/span>/);
  assert.ok(html.includes(`aria-label="${copyLabel}"`));
  assertNoHan(html);
  const zh = renderZh(list([ignoredRepo]));
  assert.match(zh, /請把 OWNER 與 REPO 換成你的專案，在工作目錄更新 remote，並改用 credential helper。/);
  assert.match(zh, /移除此本機專案後，再匯入該資料夾。/);
  assert.ok(zh.includes(`<code>${command}</code>`));
  assert.match(zh, /<span class="copy-command-label">請替換 OWNER 與 REPO。<\/span>/);
  for (const repos of [[repo], [localRepo]]) {
    const plain = renderEn(list(repos));
    assert.equal(plain.includes('role="note"'), false);
    assert.equal(plain.includes(command), false);
    assert.equal(plain.includes("copy-command-button"), false);
  }
  const project = renderEn(
    createElement(ExploreHeading, { repo: ignoredRepo, onChooseDirection() {} }),
  );
  assert.match(project, /<h1 tabindex="-1">local\/widgets<\/h1>/);
  const title = project.slice(project.indexOf('class="page-title"'), project.indexOf('class="origin-notice-slot"'));
  assert.equal(title.includes("origin-ignored"), false);
  assert.match(project, /<div class="origin-notice-slot"><div class="callout origin-ignored" role="note">/);
  assert.ok(project.includes(`aria-label="${copyLabel}"`));
  assertNoHan(project);
  const projectZh = renderZh(
    createElement(ExploreHeading, { repo: ignoredRepo, onChooseDirection() {} }),
  );
  assert.match(projectZh, /移除此本機專案後，再匯入該資料夾。/);
  for (const plainRepo of [repo, localRepo]) {
    const plain = renderEn(
      createElement(ExploreHeading, { repo: plainRepo, onChooseDirection() {} }),
    );
    assert.equal(plain.includes('role="note"'), false);
    assert.equal(plain.includes(command), false);
  }
});

test("the origin notice's copy button copies the command and says so", async () => {
  const command = "git remote set-url origin https://github.com/OWNER/REPO";
  const written: string[] = [];
  const navigator = globalThis.navigator;
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        written.push(text);
      },
    },
  });
  const click = async (element: FakeElement) => {
    const props = Object.entries(element).find(([name]) => name.startsWith("__reactProps$"))?.[1] as {
      onClick(): void;
    };
    await act(async () => {
      props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  try {
    for (const [locale, feedback, label] of [
      ["en", "Copied", `Copy the command. Replace OWNER and REPO: ${command}`],
      ["zh-TW", "已複製", `複製指令。請替換 OWNER 與 REPO：${command}`],
    ] as const) {
      written.length = 0;
      const view = await mount(createElement(OriginIgnoredNotice, { ignored: true }), locale);
      try {
        const button = view.container.querySelectorAll(
          (element) => element.getAttribute("aria-label") === label,
        )[0];
        assert.ok(button, locale);
        await click(button);
        assert.deepEqual(written, [command]);
        assert.ok(view.text().includes(feedback), locale);
      } finally {
        await view.unmount();
      }
    }
    const hidden = await mount(createElement(OriginIgnoredNotice, {}));
    try {
      assert.equal(
        hidden.container.querySelectorAll((element) => element.nodeName === "BUTTON").length,
        0,
      );
    } finally {
      await hidden.unmount();
    }
  } finally {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else Reflect.deleteProperty(navigator, "clipboard");
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
