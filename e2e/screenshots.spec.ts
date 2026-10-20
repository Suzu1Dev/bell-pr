// The screenshot set: every route in English and zh-TW at 1280, 1440 and
// 390 px wide, shown with the sample project in presentation mode
// (`present=1`, `capture=1`) and a frozen clock, and the overflow check on
// each view. Each worker starts its own server whose stand-in codex, claude
// and gh answer the setup checks like signed-in CLIs (any other call fails,
// so no agent can run) and whose Git has a name and e-mail address, so the
// pages show a ready setup as a person who finished it sees them. The
// sample badge is checked at those widths and at 768 and 1024 px, where the
// top bar has the least room.
//
//   BELLPR_E2E_PORT=<port> BELLPR_SCREENSHOTS=docs npx playwright test e2e/screenshots.spec.ts
//
// writes docs/images/<locale>/<route>-<width>.png for the docs. Without
// BELLPR_SCREENSHOTS=docs the images go to e2e/output/screenshots/
// (gitignored), so a normal e2e run checks every view without changing
// tracked files.
//
// Besides the shared route list, `run-check` is the sample's Explain-it-back
// check after it passed: opened from `#/runs/demo-run/changes?panel=check`,
// every file ticked Reviewed and the check answered, graded and corrected
// with the sample's own words, as a person who just passed it sees it.
//
// The `run-by-hand-*` views are a Learn-by-hand run of a real (not sample)
// project, seeded with startRealProject({ run }) on a server of their own:
// the plan, Code changes while the person writes, the Ready for review
// dialog, the publish dialog's record and a fitted run's quoted confirm.
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, request, test, type Browser, type Page } from "@playwright/test";
import { byHandRulesCase } from "../shared/by-hand-rules";
import { changeFingerprint } from "../shared/change-fingerprint";
import { htmlLang, locales, type Locale } from "../shared/i18n/locale";
import { attachCarveOuts, classifyPolicy } from "../shared/project-policy";
import byHandRecordEn from "../src/byhand/record/i18n/en";
import byHandRecordZh from "../src/byhand/record/i18n/zh-TW";
import byHandEn from "../src/byhand/write/i18n/en";
import byHandZh from "../src/byhand/write/i18n/zh-TW";
import { getDemo } from "../src/demo/all";
import reviewEn from "../src/i18n/en/review";
import workspaceEn from "../src/i18n/en/workspace";
import reviewZh from "../src/i18n/zh-TW/review";
import workspaceZh from "../src/i18n/zh-TW/workspace";
import { expectNoOverflow } from "./helpers/overflow";
import { files as realFiles, repoId, runId, startRealProject, type RealProject } from "./helpers/real-project";
import { routes, sampleRoutes } from "./helpers/routes";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputRoot =
  process.env.BELLPR_SCREENSHOTS === "docs"
    ? path.join(root, "docs", "images")
    : path.join(root, "e2e", "output", "screenshots");

export const screenshotWidths = [1280, 1440, 390] as const;
/**
 * Not captured, only checked for the sample badge: a tablet and a small
 * laptop, where the top bar has the least room beside the sidebar.
 */
const checkedWidths = [768, 1024] as const;
const heights: Record<(typeof screenshotWidths | typeof checkedWidths)[number], number> = {
  1280: 800,
  1440: 900,
  390: 844,
  768: 1024,
  1024: 768,
};

/** Relative times ("3 days ago") read the same on every run. */
const frozenAt = new Date("2026-10-14T09:00:00Z");

/** Waits until the page has rendered its data and its fonts. */
async function settled(page: Page, locale: Locale) {
  await expect(page.locator("html")).toHaveAttribute("lang", htmlLang(locale));
  await expect(page.locator("#main-content")).toBeVisible();
  await expect(page.locator(".app-starting")).toHaveCount(0);
  // Lazy views and their data: nothing is still loading.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Fails when the presentation badge covers any text, button or link in the
 * top bar (the overflow check does not see one box drawn over another).
 */
async function expectBadgeClear(page: Page) {
  const covered = await page.evaluate(() => {
    const badge = document.querySelector(".presentation-sample-badge");
    const bar = document.querySelector(".topbar");
    if (!badge || !bar) return [];
    const box = badge.getBoundingClientRect();
    const overlaps = (rect: DOMRect) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left < box.right &&
      rect.right > box.left &&
      rect.top < box.bottom &&
      rect.bottom > box.top;
    const result: string[] = [];
    const range = document.createRange();
    const texts = document.createTreeWalker(bar, NodeFilter.SHOW_TEXT);
    for (let node = texts.nextNode(); node; node = texts.nextNode()) {
      if (badge.contains(node) || !node.textContent?.trim()) continue;
      range.selectNodeContents(node);
      if (Array.from(range.getClientRects()).some(overlaps))
        result.push(node.textContent.trim());
    }
    for (const control of bar.querySelectorAll("button, a"))
      if (overlaps(control.getBoundingClientRect()))
        result.push(control.getAttribute("aria-label") ?? control.textContent ?? "");
    return result;
  });
  expect(covered, "The sample badge covers the top bar").toEqual([]);
}

/** Stand-ins that answer the doctor's probes; every other call fails. */
const standIns = {
  codex: `case "$1" in
  --version) echo "codex-cli 0.159.0" ;;
  login) echo "Logged in using ChatGPT" ;;
  *) exit 1 ;;
esac`,
  claude: `case "$1" in
  --version) echo "2.1.292 (Claude Code)" ;;
  auth) echo '{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "pro"}' ;;
  *) exit 1 ;;
esac`,
  gh: `case "$1" in
  --version) echo "gh version 2.46.0 (2024-03-13)" ;;
  auth) echo "gho_sample" ;;
  api) printf 'HTTP/2.0 200 OK\r\nX-Oauth-Scopes: repo, workflow, read:org\r\n\r\nsample-contributor\n1\n' ;;
  *) exit 1 ;;
esac`,
};

/** The words the run-check capture clicks, in each locale. */
const copy = {
  en: { review: reviewEn, workspace: workspaceEn },
  "zh-TW": { review: reviewZh, workspace: workspaceZh },
} satisfies Record<Locale, unknown>;

/**
 * Ticks every sample file Reviewed and passes the open check with the
 * sample's own answers (one file question graded Partly and corrected,
 * what was not tested, and the forecast), the way e2e/explain-back.spec.ts
 * passes it.
 */
async function passCheck(page: Page, locale: Locale) {
  const demo = getDemo(locale);
  const sample = demo.understandingSample!;
  const t = copy[locale].workspace.check;
  const panel = page.locator(".understanding-check");
  const step = (name: string) => panel.getByRole("region", { name });
  const item = (question: string) =>
    step(t.answerTitle).getByRole("listitem").filter({ hasText: question });
  await expect(panel.getByRole("heading", { name: t.title })).toBeVisible();

  for (const file of demo.files) {
    await page.locator(`.file-item[title="${file.path}"]`).click();
    await page.getByRole("checkbox", { name: copy[locale].review.diff.reviewed }).check();
  }
  await expect(page.locator(".file-item .file-reviewed")).toHaveCount(demo.files.length);

  await step(t.explainTitle).getByRole("button", { name: t.fill }).click();
  await expect(step(t.explainTitle).getByRole("textbox")).toHaveValue(sample.summary);
  const retry = demo.files.find((file) => file.path === "src/utils/retry.ts")!;
  const partly = sample.answers["selfCheck:src/utils/retry.ts"];
  for (const [question, text, confidence] of [
    [retry.explanation!.selfCheck!.question, partly.answer, t.confidences.think],
    [t.untestedQuestion, sample.untested, t.confidences.sure],
  ] as const) {
    await item(question).getByRole("button", { name: t.fill }).click();
    await expect(item(question).getByRole("textbox")).toHaveValue(text);
    await item(question).getByRole("radio", { name: confidence }).check();
  }
  await panel.getByRole("button", { name: t.lock }).click();

  await step(t.gradeTitle).getByRole("radio", { name: t.grades.partly }).check();
  await step(t.correctTitle).getByRole("button", { name: t.fill }).click();
  await expect(step(t.correctTitle).getByRole("textbox")).toHaveValue(partly.correction!);
  await panel.getByRole("button", { name: t.saveGrades }).click();

  const forecast = step(t.forecastTitle);
  await forecast.getByRole("radio", { name: t.dimensions.tests }).check();
  await forecast.getByRole("button", { name: t.fill }).click();
  await expect(forecast.getByRole("textbox")).toHaveValue(sample.forecast.question);
  await forecast.getByRole("button", { name: t.saveForecast }).click();

  await expect(panel.getByRole("region", { name: t.resultTitle })).toContainText(
    t.result({ questions: 2, misses: 1 }),
  );
  await expect(page.locator(".review-footer")).toContainText(copy[locale].workspace.footer.passed);
}

/**
 * Brings the passed check's record to the top of the view at the current
 * width: the person's explanation, then "Your check" with the result line,
 * the prediction, each answer with its grade and the correction.
 */
async function showRecord(page: Page, locale: Locale) {
  const t = copy[locale].workspace.check;
  await page
    .locator(".understanding-check")
    .getByRole("heading", { name: t.explainTitle })
    .evaluate((heading) => heading.scrollIntoView({ block: "start" }));
}

let server: LaunchedServer | undefined;
let tools: string | undefined;

test.beforeAll(async () => {
  tools = await mkdtemp(path.join(os.tmpdir(), "bellpr-screenshots-"));
  for (const [name, body] of Object.entries(standIns))
    await writeFile(path.join(tools, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  const gitconfig = path.join(tools, "gitconfig");
  await writeFile(gitconfig, "[user]\n\tname = Sample Contributor\n\temail = contributor@example.com\n");
  server = await launchServer({
    env: {
      PATH: [tools, process.env.PATH].filter(Boolean).join(path.delimiter),
      GIT_CONFIG_GLOBAL: gitconfig,
    },
  });
});

test.afterAll(async () => {
  await server?.stop();
  if (tools) await rm(tools, { recursive: true, force: true });
});

test.describe.configure({ mode: "parallel" });

for (const locale of locales)
  for (const route of routes)
    test(`${route.name} in ${locale} fits and is captured at every width`, async ({ browser }) => {
      const context = await browser.newContext({
        baseURL: server!.baseURL,
        storageState: server!.storageState,
        locale: "en-US",
        timezoneId: "UTC",
      });
      try {
        const page = await context.newPage();
        const directory = path.join(outputRoot, locale);
        await mkdir(directory, { recursive: true });
        await page.clock.setFixedTime(frozenAt);
        await page.setViewportSize({ width: screenshotWidths[0], height: heights[screenshotWidths[0]] });
        await page.goto(`/${route.hash}?present=1&capture=1&locale=${locale}`);
        await settled(page, locale);
        for (const width of [...screenshotWidths, ...checkedWidths]) {
          await page.setViewportSize({ width, height: heights[width] });
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
          const captured = (screenshotWidths as readonly number[]).includes(width);
          if (captured) await expectNoOverflow(page);
          if (sampleRoutes.test(route.name))
            await expect(page.locator(".presentation-sample-badge")).toBeVisible();
          await expectBadgeClear(page);
          if (!captured) continue;
          await page.screenshot({
            path: path.join(directory, `${route.name}-${width}.png`),
            animations: "disabled",
            caret: "hide",
          });
        }
      } finally {
        await context.close();
      }
    });

for (const locale of locales)
  test(`run-check in ${locale} fits and is captured at every width once the check passed`, async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: server!.baseURL,
      storageState: server!.storageState,
      locale: "en-US",
      timezoneId: "UTC",
    });
    try {
      const page = await context.newPage();
      const directory = path.join(outputRoot, locale);
      await mkdir(directory, { recursive: true });
      await page.clock.setFixedTime(frozenAt);
      await page.setViewportSize({ width: screenshotWidths[0], height: heights[screenshotWidths[0]] });
      await page.goto(`/#/runs/demo-run/changes?panel=check&present=1&capture=1&locale=${locale}`);
      await settled(page, locale);
      await passCheck(page, locale);
      await settled(page, locale);
      for (const width of [...screenshotWidths, ...checkedWidths]) {
        await page.setViewportSize({ width, height: heights[width] });
        await showRecord(page, locale);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
        const captured = (screenshotWidths as readonly number[]).includes(width);
        if (captured) await expectNoOverflow(page);
        await expect(page.locator(".presentation-sample-badge")).toBeVisible();
        await expectBadgeClear(page);
        if (!captured) continue;
        await page.screenshot({
          path: path.join(directory, `run-check-${width}.png`),
          animations: "disabled",
          caret: "hide",
        });
      }
    } finally {
      await context.close();
    }
  });

/**
 * Learn by hand on a real (not sample) project's run, seeded with
 * startRealProject({ run }) (e2e/helpers/real-project.ts: a stand-in for
 * GitHub, fake codex, claude and gh, so no agent runs), in each locale:
 * the person's plan with the guide's outline folded, Code changes while
 * they write (the guide's panel with a hint and a quote), the Ready for
 * review dialog, the publish dialog's record of a clean run, and the
 * publish dialog of a run fitted to a QEMU-shaped project's carve-out,
 * whose quoted confirm the real server gives. Stored guide text is in the
 * run's own language, as the guide would have written it.
 */
const byHandAt = (minute: number) => `2026-10-14T08:${String(minute).padStart(2, "0")}:00.000Z`;
const byHandAgents = [
  { id: "lead", name: "Atlas", role: "Team lead", status: "complete", detail: "" },
  { id: "reviewer", name: "Lens", role: "Reviewer", status: "complete", detail: "" },
  { id: "tester", name: "Scout", role: "Test analyst", status: "complete", detail: "" },
];
const greetingBase = ["export function greeting(name: string) {", "  return `Hello, ${name}!`;", "}"].join("\n");

/** What the person and the guide wrote, in the run's language. */
const byHandWords = {
  en: {
    title: "Greet in your language",
    prompt: "Greet people in their own language, falling back to English.",
    summary:
      "People can only be greeted in English today, so anyone who prefers another language reads a greeting that isn't theirs.",
    outline: ["Read how the greeting is built", "Add the languages", "Cover the new cases in the test"],
    readFirst: ["Where the greeting text is built today.", "The test that checks the greeting."],
    steps: ["Find where the greeting text comes from", "Look the greeting up by language, with English as the fallback"],
    how: "A table keyed by language.",
    tests: "Run the greeting test, then add a case for a language the table lacks.",
    unsure: "What an empty name should print.",
    prediction: "greeting(), because it builds the text.",
    ask: "How do I run only the greeting test?",
    askAnswer: "Your project's test command takes a file path after it; give it the greeting test's path.",
    hint: "Look at how the greeting text is built today, then at where a language could choose it.",
    tail: "FAIL test/greeting.test.ts > greets\nAssertionError: expected 'Hallo, Ada!' to be 'Hello, Ada!'",
    body: "## Summary\n\nGreetings come from a table of languages and fall back to English. I wrote and tested it myself.",
  },
  "zh-TW": {
    title: "用你的語言打招呼",
    prompt: "用每個人自己的語言打招呼，沒有的語言就用英文。",
    summary: "目前只能用英文打招呼，偏好其他語言的人讀到的問候語都不是自己的語言。",
    outline: ["讀懂問候語是怎麼組出來的", "加入各種語言", "在測試裡涵蓋新的情況"],
    readFirst: ["目前組出問候語文字的地方。", "檢查問候語的測試。"],
    steps: ["找出問候語的文字從哪裡來", "依語言查表取得問候語，沒有時改用英文"],
    how: "用語言當鍵的對照表。",
    tests: "先跑問候語的測試，再為表裡沒有的語言加一個案例。",
    unsure: "名字是空的時候該印出什麼。",
    prediction: "greeting()，因為文字是它組出來的。",
    ask: "怎麼只跑問候語的測試？",
    askAnswer: "專案的測試指令後面可以接檔案路徑；把問候語測試的路徑給它就好。",
    hint: "先看看現在問候語的文字是怎麼組出來的，再想想語言可以在哪裡決定要用哪一句。",
    tail: "FAIL test/greeting.test.ts > greets\nAssertionError: expected 'Hallo, Ada!' to be 'Hello, Ada!'",
    body: "## Summary\n\nGreetings come from a table of languages and fall back to English. I wrote and tested it myself.",
  },
} satisfies Record<Locale, unknown>;

/** The fields of a Learn-by-hand run that all the views share. */
function byHandRun(locale: Locale, fields: Record<string, unknown>, byHand: Record<string, unknown>) {
  const words = byHandWords[locale];
  return {
    title: words.title,
    prompt: words.prompt,
    createdAt: byHandAt(0),
    locale,
    learnByHand: true,
    agents: byHandAgents,
    draft: { title: "", body: "" },
    explanations: {},
    reports: {},
    modelExecution: { provider: "codex", source: "selected", reported: { model: "gpt-5.5-codex", cliVersion: "0.159.0" } },
    team: {
      config: { maxTeammates: 2, requirePlanApproval: true, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
      phase: "developing",
      planSummary: words.summary,
      tasks: [],
      messages: [],
    },
    ...fields,
    byHand: {
      guidePlan: {
        summary: words.summary,
        steps: words.outline.map((title, index) => ({ title, files: [index === 2 ? realFiles.test : realFiles.greeting] })),
        readFirst: [
          { path: realFiles.greeting, startLine: 1, endLine: 3, why: words.readFirst[0] },
          { path: realFiles.test, startLine: 4, endLine: 6, why: words.readFirst[1] },
        ],
        at: byHandAt(2),
      },
      events: [{ at: byHandAt(2), kind: "explain", source: "premise" }],
      ...byHand,
    },
  };
}

/** The person's plan: two steps of their own, the first done once they write. */
function personPlan(locale: Locale, confirmed: boolean) {
  const words = byHandWords[locale];
  return {
    steps: [
      { id: "s1", title: words.steps[0], files: [realFiles.greeting], ...(confirmed ? { doneAt: byHandAt(30) } : {}) },
      { id: "s2", title: words.steps[1], files: [realFiles.greeting], how: words.how, ...(confirmed ? { maxRung: 1 } : {}) },
    ],
    tests: words.tests,
    unsure: words.unsure,
    prediction: words.prediction,
    savedAt: byHandAt(10),
    ...(confirmed ? { confirmedAt: byHandAt(12) } : {}),
  };
}

/** The run while the person writes: a hint with a quote, a question answered, a failed test run at this version. */
function writingRun(locale: Locale, fingerprint: string) {
  const words = byHandWords[locale];
  return byHandRun(
    locale,
    { status: "review" },
    {
      plan: personPlan(locale, true),
      hints: { s2: { rung: 1, at: byHandAt(40), fingerprint } },
      thread: [
        { id: "e1", at: byHandAt(35), kind: "ask", entry: "tooling", question: words.ask, text: words.askAnswer },
        {
          id: "e2",
          at: byHandAt(40),
          kind: "hint",
          stepId: "s2",
          rung: 1,
          text: words.hint,
          refs: [{ path: realFiles.greeting, line: 2 }],
          quotes: [{ path: realFiles.greeting, startLine: 1, endLine: 3, from: "base", text: greetingBase }],
          changeFingerprint: fingerprint,
        },
      ],
      tests: [
        { at: byHandAt(57), command: "npm test", changeFingerprint: fingerprint, outcome: "failed", exitCode: 1, ms: 1800, prediction: "fail", outputTail: words.tail },
      ],
      events: [
        { at: byHandAt(2), kind: "explain", source: "premise" },
        { at: byHandAt(35), kind: "answer", source: "ask" },
        { at: byHandAt(40), kind: "answer", source: "hint", rung: 1, stepId: "s2" },
      ],
    },
  );
}

/** An approved, clean run, marked ready at its version: what its record shows in the publish dialog. */
function approvedRun(locale: Locale, fingerprint: string) {
  const words = byHandWords[locale];
  return byHandRun(
    locale,
    { status: "approved", approvedFingerprint: "e2e-approved", draft: { title: byHandWords.en.title, body: words.body } },
    {
      plan: personPlan(locale, true),
      ready: { at: byHandAt(56), changeFingerprint: fingerprint, review: true },
      tests: [
        { at: byHandAt(50), command: "npm test", changeFingerprint: "a", outcome: "failed", exitCode: 1, ms: 1800, prediction: "fail" },
        { at: byHandAt(55), command: "npm test", changeFingerprint: "b", outcome: "passed", exitCode: 0, ms: 1700, prediction: "pass" },
      ],
      events: [
        { at: byHandAt(2), kind: "explain", source: "premise" },
        { at: byHandAt(35), kind: "answer", source: "ask" },
        { at: byHandAt(40), kind: "answer", source: "hint", rung: 1 },
        { at: byHandAt(45), kind: "explain", source: "hint", rung: 2 },
        { at: byHandAt(58), kind: "review", source: "review" },
      ],
    },
  );
}

/** The fingerprint of the seeded run's change, as the server computes it. */
async function seededFingerprint() {
  const project = await startRealProject({ run: { learnByHand: true } });
  try {
    const context = await request.newContext({ baseURL: project.baseURL, storageState: project.storageState });
    const { files } = (await (await context.get(`/api/runs/${runId}/diff`)).json()) as { files: { path: string; fingerprint: string }[] };
    await context.dispose();
    return changeFingerprint(files);
  } finally {
    await project.stop();
  }
}

/** Opens the Draft tab's footer approval and waits for the publish dialog and its facts. */
async function openPublish(page: Page, locale: Locale) {
  const workspace = copy[locale].workspace;
  await page.locator(".review-footer").getByRole("button", { name: workspace.footer.approvePr }).click();
  const dialog = page.getByRole("dialog", { name: workspace.publish.title });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText(workspace.publish.factsLoading)).toHaveCount(0, { timeout: 30_000 });
  return dialog;
}

interface ByHandView {
  name: string;
  hash: string;
  /** Brings the view to the state the picture shows, once, before the widths. */
  prepare?(page: Page, locale: Locale): Promise<void>;
  /** At each width, before the picture. */
  frame?(page: Page, locale: Locale): Promise<void>;
}

/** Captures `view` at every width, with the overflow check, from `project`. */
async function captureByHand(browser: Browser, project: RealProject, locale: Locale, view: ByHandView) {
  const context = await browser.newContext({
    baseURL: project.baseURL,
    storageState: project.storageState,
    locale: "en-US",
    timezoneId: "UTC",
  });
  try {
    const page = await context.newPage();
    const directory = path.join(outputRoot, locale);
    await mkdir(directory, { recursive: true });
    await page.clock.setFixedTime(frozenAt);
    await page.setViewportSize({ width: screenshotWidths[0], height: heights[screenshotWidths[0]] });
    await page.goto(`/${view.hash}?present=1&capture=1&locale=${locale}`);
    await settled(page, locale);
    await view.prepare?.(page, locale);
    for (const width of screenshotWidths) {
      await page.setViewportSize({ width, height: heights[width] });
      await view.frame?.(page, locale);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      await expectNoOverflow(page);
      await page.screenshot({
        path: path.join(directory, `${view.name}-${width}.png`),
        animations: "disabled",
        caret: "hide",
      });
    }
  } finally {
    await context.close();
  }
}

const byHandCopy = { en: byHandEn, "zh-TW": byHandZh } satisfies Record<Locale, unknown>;
const byHandRecordCopy = { en: byHandRecordEn, "zh-TW": byHandRecordZh } satisfies Record<Locale, unknown>;

/** Scrolls the guide's panel so its newest answer, with its quote, is in view. */
async function showGuide(page: Page, locale: Locale) {
  await page
    .locator(".guide-panel")
    .getByRole("heading", { name: byHandCopy[locale].thread.title, exact: true })
    .evaluate((heading) => heading.scrollIntoView({ block: "start" }));
}

for (const locale of locales)
  test.describe(`Learn by hand in ${locale}`, () => {
    test.describe.configure({ mode: "serial" });
    let fingerprint = "";
    test.beforeAll(async () => {
      fingerprint = await seededFingerprint();
    });

    test(`run-by-hand-plan in ${locale}: the person's plan, the guide's outline folded`, async ({ browser }) => {
      const project = await startRealProject({
        run: byHandRun(locale, { status: "awaiting_plan", team: { ...byHandRun(locale, {}, {}).team, phase: "awaiting_approval" } }, { plan: personPlan(locale, false) }),
      });
      try {
        await captureByHand(browser, project, locale, {
          name: "run-by-hand-plan",
          hash: `#/runs/${runId}/activity`,
          prepare: async (page) => {
            await expect(page.getByRole("region", { name: byHandCopy[locale].plan.title })).toBeVisible();
          },
        });
      } finally {
        await project.stop();
      }
    });

    test(`run-by-hand-your-turn and run-by-hand-ready in ${locale}: the guide's panel, then the Ready dialog`, async ({ browser }) => {
      const project = await startRealProject({ run: writingRun(locale, fingerprint) });
      try {
        await captureByHand(browser, project, locale, {
          name: "run-by-hand-your-turn",
          hash: `#/runs/${runId}/changes`,
          prepare: async (page) => {
            await expect(page.locator(".guide-panel").locator("figcaption", { hasText: `${realFiles.greeting}:1-3` })).toBeVisible();
          },
          frame: (page) => showGuide(page, locale),
        });
        await captureByHand(browser, project, locale, {
          name: "run-by-hand-ready",
          hash: `#/runs/${runId}/changes`,
          prepare: async (page) => {
            const t = byHandCopy[locale];
            await page.locator(".review-footer").getByRole("button", { name: copy[locale].workspace.byHand.ready }).click();
            await expect(page.getByRole("dialog", { name: t.ready.title })).toContainText(t.ready.cost);
          },
        });
      } finally {
        await project.stop();
      }
    });

    test(`run-by-hand-record in ${locale}: the publish dialog's record of a clean run`, async ({ browser }) => {
      const project = await startRealProject({ reviewed: true, appSettings: { skipUnderstandingCheck: true }, run: approvedRun(locale, fingerprint) });
      try {
        await captureByHand(browser, project, locale, {
          name: "run-by-hand-record",
          hash: `#/runs/${runId}/draft`,
          prepare: async (page) => {
            // Approval answers with the seeded approved run as it is (the run is approved already).
            await page.route(`**/api/runs/${runId}/approve`, async (route) => {
              const response = await page.request.get(`/api/runs/${runId}`);
              await route.fulfill({ json: await response.json() });
            });
            const dialog = await openPublish(page, locale);
            await expect(dialog.getByRole("region", { name: byHandRecordCopy[locale].title })).toContainText(byHandRecordCopy[locale].claim);
          },
          frame: (page) =>
            page
              .getByRole("dialog")
              .getByRole("region", { name: byHandRecordCopy[locale].title })
              .evaluate((record) => record.scrollIntoView({ block: "start" })),
        });
      } finally {
        await project.stop();
      }
    });

    test(`run-by-hand-confirm in ${locale}: the quoted confirm beside the record of a fitted run`, async ({ browser }) => {
      test.setTimeout(120_000);
      const file = "docs/devel/code-provenance.rst";
      const qemu = readFileSync(fileURLToPath(new URL("../server/fixtures/policy/real/qemu-code-provenance.rst", import.meta.url)), "utf8");
      const findings = attachCarveOuts(file, qemu, classifyPolicy(file, qemu));
      const started = byHandAt(0);
      const fitted = byHandRulesCase({ checkedAt: started, findings, filesRead: [file] }, { learningIssue: false, now: started });
      if (fitted.case !== "fitted") throw new Error(`The QEMU-shaped rules gave ${fitted.case}, not a fitted case.`);
      const words = byHandWords[locale];
      const project = await startRealProject({
        reviewed: true,
        appSettings: { skipUnderstandingCheck: true },
        extraFiles: [{ path: file, before: qemu, after: qemu }],
        run: byHandRun(
          locale,
          { status: "review", draft: { title: byHandWords.en.title, body: words.body } },
          {
            plan: personPlan(locale, true),
            helpLock: { ...fitted.lock, at: started },
            events: [
              { at: byHandAt(2), kind: "explain", source: "premise" },
              { at: byHandAt(35), kind: "answer", source: "ask" },
            ],
          },
        ),
      });
      try {
        // The person marks the change ready, and Check again reads the project's rules after the run started.
        const api = await request.newContext({ baseURL: project.baseURL, storageState: project.storageState });
        expect((await api.post(`/api/runs/${runId}/by-hand/ready`, { data: { changeFingerprint: fingerprint, review: false } })).ok()).toBe(true);
        expect((await api.post(`/api/repos/${repoId}/contribution-rules/refresh`, { data: {} })).ok()).toBe(true);
        await api.dispose();
        await captureByHand(browser, project, locale, {
          name: "run-by-hand-confirm",
          hash: `#/runs/${runId}/draft`,
          prepare: async (page) => {
            const dialog = await openPublish(page, locale);
            await expect(dialog.getByRole("region", { name: byHandRecordCopy[locale].title })).toBeVisible();
            await expect(dialog.locator("label", { hasText: `${file}:6` })).toBeVisible();
          },
          frame: (page) =>
            page
              .getByRole("dialog")
              .getByRole("region", { name: byHandRecordCopy[locale].title })
              .evaluate((record) => record.scrollIntoView({ block: "start" })),
        });
      } finally {
        await project.stop();
      }
    });
  });
