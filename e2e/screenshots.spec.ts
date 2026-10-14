// The screenshot set: every route in English and zh-TW at 1280, 1440 and
// 390 px wide, shown with the sample project in presentation mode
// (`present=1`, `capture=1`) and a frozen clock, and the overflow check on
// each view.
//
//   BELLPR_E2E_PORT=<port> BELLPR_SCREENSHOTS=docs npx playwright test e2e/screenshots.spec.ts
//
// writes docs/images/<locale>/<route>-<width>.png for the docs. Without
// BELLPR_SCREENSHOTS=docs the images go to e2e/output/screenshots/
// (gitignored), so a normal e2e run checks every view without changing
// tracked files.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { htmlLang, locales, type Locale } from "../shared/i18n/locale";
import { settingsSections } from "../src/settings/sections";
import { expectNoOverflow } from "./helpers/overflow";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputRoot =
  process.env.BELLPR_SCREENSHOTS === "docs"
    ? path.join(root, "docs", "images")
    : path.join(root, "e2e", "output", "screenshots");

/** Every page of the app, named after the file it is saved to. */
export const screenshotRoutes: { name: string; hash: string }[] = [
  { name: "home", hash: "#/home" },
  { name: "run-overview", hash: "#/runs/demo-run/overview" },
  { name: "run-changes", hash: "#/runs/demo-run/changes" },
  { name: "run-activity", hash: "#/runs/demo-run/activity" },
  { name: "run-draft", hash: "#/runs/demo-run/draft" },
  { name: "repos", hash: "#/repos" },
  { name: "repo-overview", hash: "#/repos/demo-repo" },
  { name: "discover", hash: "#/discover" },
  { name: "team", hash: "#/team" },
  { name: "learning", hash: "#/learning" },
  ...settingsSections.map((section) => ({
    name: `settings-${section}`,
    hash: `#/settings/${section}`,
  })),
  { name: "about", hash: "#/about" },
];

export const screenshotWidths = [1280, 1440, 390] as const;
const heights: Record<(typeof screenshotWidths)[number], number> = {
  1280: 800,
  1440: 900,
  390: 844,
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

test.describe.configure({ mode: "parallel" });

for (const locale of locales)
  for (const route of screenshotRoutes)
    test(`${route.name} in ${locale} fits and is captured at every width`, async ({ page }) => {
      const directory = path.join(outputRoot, locale);
      await mkdir(directory, { recursive: true });
      await page.clock.setFixedTime(frozenAt);
      await page.setViewportSize({ width: screenshotWidths[0], height: heights[screenshotWidths[0]] });
      await page.goto(`/${route.hash}?present=1&capture=1&locale=${locale}`);
      await settled(page, locale);
      for (const width of screenshotWidths) {
        await page.setViewportSize({ width, height: heights[width] });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
        await expectNoOverflow(page);
        await page.screenshot({
          path: path.join(directory, `${route.name}-${width}.png`),
          animations: "disabled",
          caret: "hide",
        });
      }
    });
