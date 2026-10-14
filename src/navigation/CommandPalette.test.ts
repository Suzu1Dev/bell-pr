import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Repo, RunSummary } from "../types";
import { CommandPalette } from "./CommandPalette";

type Props = Parameters<typeof CommandPalette>[0];

const repo = (id: string, owner: string, name: string): Repo => ({
  id,
  name,
  owner,
  fullName: `${owner}/${name}`,
  path: `/tmp/${name}`,
  defaultBranch: "main",
  url: `https://github.com/${owner}/${name}`,
});
const repos = [repo("repo-1", "octo", "widgets"), repo("repo-2", "octo", "gadgets")];
const run = (
  id: string,
  title: string,
  status: RunSummary["status"],
  repoId = "repo-1",
): RunSummary => ({
  id,
  repoId,
  title,
  prompt: title,
  status,
  branch: `fix/${id}`,
  baseBranch: "main",
  createdAt: "2026-10-13T00:00:00Z",
  agents: [],
  draft: { title, body: "" },
  reviewedFiles: [],
});
const runs = [
  run("run-1", "Retry timeouts", "review"),
  run("run-2", "Document the client", "running"),
];

const element = (props: Partial<Props> = {}) =>
  createElement(CommandPalette, {
    repos,
    runs,
    currentRepoId: "repo-1",
    currentRunId: "run-1",
    onClose() {},
    async onSelectRun() {
      return true;
    },
    onSelectRepo() {},
    ...props,
  });

test("the quick switch reads in English with no Chinese left", () => {
  const html = renderEn(element());
  assert.match(html, /<h2 id="[^"]+">Switch projects and contributions<\/h2>/);
  assert.match(html, /aria-label="Close quick switch"/);
  assert.match(html, /aria-label="octo\/widgets, 2 contributions, current project"/);
  assert.match(html, /aria-label="octo\/gadgets, 0 contributions"/);
  assert.match(html, /placeholder="Search contributions…"/);
  assert.match(html, /<span>2 items<\/span>/);
  // Run statuses come from the shared dictionary, not from a prop.
  assert.match(html, /Ready for your review<small title="fix\/run-1">/);
  assert.match(html, /In progress<small title="fix\/run-2">/);
  assert.match(html, /<span class="command-palette-current">.*Current<\/span>/);
  assert.match(html, /<span>Open project overview<\/span>/);
  assert.match(html, /aria-label="Keyboard shortcuts"/);
  assertNoHan(html);
});

test("an empty project and no projects read in English with no Chinese left", () => {
  const empty = renderEn(element({ currentRepoId: "repo-2", currentRunId: "" }));
  assert.match(empty, /This project has no contributions yet/);
  assert.match(empty, /<span>0 items<\/span>/);
  assertNoHan(empty);
  const one = renderEn(
    element({ runs: [runs[0]], currentRunId: "run-1" }),
  );
  assert.match(one, /aria-label="octo\/widgets, 1 contribution, current project"/);
  assert.match(one, /<span>1 item<\/span>/);
  const none = renderEn(element({ repos: [], runs: [], currentRepoId: undefined }));
  assert.match(none, /No projects imported yet/);
  assertNoHan(none);
});

test("the quick switch keeps its zh-TW labels", () => {
  const html = renderZh(element());
  assert.match(html, />切換專案與貢獻<\/h2>/);
  assert.match(html, /aria-label="octo\/widgets，2 項貢獻，目前專案"/);
  assert.match(html, /<span>2 項<\/span>/);
  assert.match(html, /等待你的審查<small title="fix\/run-1">/);
});
