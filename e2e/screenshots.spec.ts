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
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { e2eApiHeaders } from "./api-token.mjs";
import { htmlLang, locales, type Locale } from "../shared/i18n/locale";
import { getDemo } from "../src/demo/all";
import reviewEn from "../src/i18n/en/review";
import workspaceEn from "../src/i18n/en/workspace";
import reviewZh from "../src/i18n/zh-TW/review";
import workspaceZh from "../src/i18n/zh-TW/workspace";
import { expectNoOverflow } from "./helpers/overflow";
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
  auth) echo '{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "max"}' ;;
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
        extraHTTPHeaders: e2eApiHeaders,
        baseURL: server!.baseURL,
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
      extraHTTPHeaders: e2eApiHeaders,
      baseURL: server!.baseURL,
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
