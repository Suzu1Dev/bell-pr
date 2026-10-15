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

/** The demo-like run with the person's own v1.1 records. */
const recorded: RunCore = {
  ...demoLikeRun,
  status: "published",
  notes: {
    "src/retry.ts": { text: "The cap matters more than the base.", fingerprint: "demo", updatedAt: "2026-10-08T02:00:00.000Z" },
    "src/empty.ts": { text: "  ", fingerprint: "demo", updatedAt: "2026-10-08T02:00:00.000Z" },
  },
  understandingCheckOff: true,
  understanding: {
    summary: { text: "Retries now wait longer each time, so a busy server can recover.", changeFingerprint: "0123456789abcdef", at: "2026-10-08T03:00:00.000Z" },
    items: [
      {
        id: "selfCheck:src/retry.ts",
        path: "src/retry.ts",
        fingerprint: "demo",
        source: "selfCheck",
        question: "What caps the wait?",
        answer: "the base delay",
        confidence: "think",
        lockedAt: "2026-10-08T03:01:00.000Z",
        grade: "partly",
        correction: "maxDelay caps it, not the base",
      },
      {
        id: "untested",
        source: "untested",
        question: "What did you not test, and why?",
        answer: "",
        dontKnow: true,
        confidence: "guess",
        lockedAt: "2026-10-08T03:01:00.000Z",
      },
    ],
    forecast: { dimension: "tests", question: "Is the cap tested?", at: "2026-10-08T03:02:00.000Z" },
    history: [{ passedAt: "2026-10-08T03:02:00.000Z", questions: 2, misses: 1, confidentMisses: 1, seconds: 180 }],
  },
  attempts: {
    "src/retry.ts": {
      fingerprint: "demo",
      road: { guess: "a fixed delay", choice: "keep", why: "load spikes", at: "2026-10-08T02:30:00.000Z" },
    },
  },
  feedbackTags: {
    "#review-1": { dimension: "tests", predicted: true, at: "2026-10-09T00:00:00.000Z" },
    "#thread-1": { dimension: "naming", predicted: false, lesson: "Name the unit in the option.", at: "2026-10-09T00:00:00.000Z" },
  },
  guardOverrides: [
    { id: "issue-has-pr", reason: "Their PR was abandoned in June.", at: "2026-10-08T04:00:00.000Z" },
  ],
};

test("the export adds the person's own records in order, in English", () => {
  const markdown = buildLearningExport(recorded, demoLikeRepo, "en");
  assertNoHan(markdown);
  // The person's own words are not called agent output.
  assert.match(markdown, /^# .*\n\n> The explanations, chat answers and reviews .* may be wrong; the parts marked as yours are your own words\./);
  const order = [
    "## Questions and answers",
    "## Your notes",
    "## Explain it back",
    "## Road choices",
    "## Your forecast",
    "## Maintainer feedback you tagged",
    "## Checks you overrode, with your reasons",
    "## Pull request",
  ].map((heading) => markdown.indexOf(heading));
  assert.ok(order.every((at) => at > 0), String(order));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(markdown, /## Your notes\n\n### `src\/retry.ts`\n\nThe cap matters more than the base\.\n\n## /);
  assert.ok(markdown.includes([
    "## Explain it back",
    "Approved with the understanding check off.",
    "**Your explanation**\n\nRetries now wait longer each time, so a busy server can recover.",
    "**Question:** What caps the wait?",
    "**Your answer** (Think so): the base delay",
    "**Your grade:** Partly",
    "**What you had wrong:** maxDelay caps it, not the base",
    "**Question:** What did you not test, and why?",
    "**Your answer** (Guessing): I don't know",
    "**Your grade:** Missed",
    "- Passed 2026-10-08T03:02:00.000Z: 2 questions, 1 missed",
  ].join("\n\n")));
  assert.match(markdown, /## Road choices\n\n### `src\/retry.ts`\n\n\*\*How else it could be done \(your guess\):\*\* a fixed delay\n\n\*\*Your choice:\*\* Keep this approach\n\n\*\*Why:\*\* load spikes/);
  assert.match(markdown, /## Your forecast\n\n\*\*What the maintainer would question:\*\* Tests\n\nIs the cap tested\?/);
  assert.match(markdown, /## Maintainer feedback you tagged\n\n- #review-1: Tests, saw it coming\n- #thread-1: Naming, surprised me\n {2}Lesson: Name the unit in the option\./);
  assert.match(markdown, /## Checks you overrode, with your reasons\n\n- Someone else's pull request already closes the issue \(2026-10-08T04:00:00.000Z\): Their PR was abandoned in June\./);
});

test("the person's sections are left out when empty, and render in zh-TW", () => {
  const bare = buildLearningExport(demoLikeRun, demoLikeRepo, "en");
  for (const heading of ["## Your notes", "## Explain it back", "## Road choices", "## Your forecast", "## Maintainer feedback you tagged", "## Checks you overrode"])
    assert.ok(!bare.includes(heading), heading);
  // A check-off mark alone still shows: the run was approved without the check.
  assert.match(
    buildLearningExport({ ...demoLikeRun, understandingCheckOff: true }, demoLikeRepo, "en"),
    /## Explain it back\n\nApproved with the understanding check off\.\n/,
  );
  // A vocabulary value from a later build is shown as written.
  const later = buildLearningExport(
    { ...demoLikeRun, feedbackTags: { "#x": { dimension: "security" as never, at: "t" } } },
    demoLikeRepo,
    "en",
  );
  assert.match(later, /- #x: security/);
  const chinese = buildLearningExport(recorded, demoLikeRepo, "zh-TW");
  for (const text of [
    "標示為「你的」的部分是你自己寫的。",
    "## 你的筆記",
    "## 用自己的話講一遍\n\n在理解檢查關閉時核准。",
    "**你的答案**（大概）：the base delay",
    "**你的評分：**部分對",
    "**你的答案**（用猜的）：我不知道",
    "**你的選擇：**維持這個做法",
    "**維護者可能質疑的地方：**測試",
    "- #review-1：測試、早就料到",
    "## 你略過的檢查與理由",
  ])
    assert.ok(chinese.includes(text), text);
});
