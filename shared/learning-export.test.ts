// Imports from shared/ (and the client demo) only: the demo builds its
// learning record in the browser with the same builder the server uses.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDemo } from "../src/demo/index.js";
import { assertNoHan } from "../src/test-utils/render.js";
import { locales } from "./i18n/locale.js";
import { buildLearningExport } from "./learning-export.js";
import type { Repository, RunCore } from "./types.js";

const sharedDirectory = path.dirname(fileURLToPath(import.meta.url));

/**
 * Every module shared/learning-export.ts loads, followed through relative
 * imports. Type-only imports load nothing at run time, so they are not
 * followed.
 */
function importGraph(entry: string) {
  const seen = new Map<string, string[]>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    const source = readFileSync(file, "utf8");
    const specifiers = [
      ...source.matchAll(/^\s*(?:import|export)\b(?!\s+type\b)[^;]*?\bfrom\s+"([^"]+)"/gms),
      ...source.matchAll(/^\s*import\s+"([^"]+)"/gm),
    ].map((match) => match[1]);
    seen.set(file, specifiers);
    for (const specifier of specifiers)
      if (specifier.startsWith("."))
        visit(
          path.resolve(path.dirname(file), specifier).replace(/\.js$/, ".ts"),
        );
  };
  visit(entry);
  return seen;
}

test("the learning export builder loads nothing outside shared/ and no Node built-in", () => {
  const graph = importGraph(path.join(sharedDirectory, "learning-export.ts"));
  assert.ok(graph.size >= 4, [...graph.keys()].join("\n"));
  for (const [file, specifiers] of graph) {
    assert.ok(
      !path.relative(sharedDirectory, file).startsWith(".."),
      `${file} is outside shared/`,
    );
    for (const specifier of specifiers)
      assert.ok(
        specifier.startsWith("."),
        `${path.relative(sharedDirectory, file)} imports ${specifier}`,
      );
  }
});

// The client demo run: no baseSha, worktree or reviewed fingerprints.
const demoLikeRun: RunCore = {
  id: "demo-run",
  repoId: "demo-repo",
  title: "Make retries back off",
  prompt: "Retry failed requests with exponential backoff.",
  status: "review",
  branch: "bell/backoff",
  baseBranch: "main",
  createdAt: "2026-10-08T00:00:00.000Z",
  agents: [],
  logs: [],
  draft: { title: "Back off between retries", body: "" },
  reviewedFiles: [],
  explanations: {
    "src/retry.ts": {
      fingerprint: "demo",
      status: "ready",
      content: {
        summary: "Waits longer after each failed attempt.",
        reason: "A busy server gets time to recover.",
        concept: "Exponential backoff",
        tip: "Check the maximum delay.",
        selfCheck: { question: "What caps the wait?", answer: "maxDelay." },
      },
    },
  },
  conversations: {
    "src/retry.ts": {
      fingerprint: "demo",
      updatedAt: "2026-10-08T01:00:00.000Z",
      messages: [
        { role: "user", content: "Why double the wait?", fingerprint: "demo" },
        { role: "assistant", content: "So retries thin out.", fingerprint: "demo" },
      ],
    },
  },
};
const demoLikeRepo: Repository = {
  id: "demo-repo",
  name: "retry",
  owner: "example",
  fullName: "example/retry",
  path: "",
  defaultBranch: "main",
  url: "https://github.com/example/retry",
};

test("a demo-like run exports in English without any Han, and in zh-TW on request", () => {
  const markdown = buildLearningExport(demoLikeRun, demoLikeRepo, "en");
  assertNoHan(markdown);
  assert.match(markdown, /^# Learning record: Make retries back off\n/);
  assert.match(markdown, /- Repository: example\/retry\n- Branch: bell\/backoff → main/);
  assert.match(markdown, /## Pull request\n\nNo pull request has been opened yet\./);
  assert.match(markdown, /\*\*Check yourself\*\*\n\nQuestion: What caps the wait\?/);
  assert.match(markdown, /## Agent usage\n\nNo usage was recorded\.\n$/);
  // A missing repository leaves its line out instead of failing.
  assert.doesNotMatch(
    buildLearningExport(demoLikeRun, undefined, "en"),
    /Repository:/,
  );
  assert.match(
    buildLearningExport(demoLikeRun, demoLikeRepo, "zh-TW"),
    /^# 學習紀錄：Make retries back off\n[\s\S]*## 檔案解說/,
  );
});

test("the bundled demo run and repository fit the builder in every locale", () => {
  for (const locale of locales) {
    const { run, repo } = getDemo(locale);
    const markdown = buildLearningExport(run, repo, locale);
    assert.ok(markdown.includes(run.title), locale);
    assert.ok(markdown.includes(repo.fullName), locale);
    assert.ok(markdown.endsWith("\n"), locale);
  }
});
