// The screenshot set: every route in English and zh-TW at 1280, 1440 and
// 390 px wide, shown with the sample project in presentation mode
// (`present=1`, `capture=1`) and a frozen clock, and the overflow check on
// each view. Each worker starts its own server whose stand-in codex, claude
// and gh answer the setup checks like signed-in CLIs (any other call fails,
// so no agent can run) and whose Git has a name and e-mail address, so the
// pages show a ready setup as a person who finished it sees them.
//
//   BELLPR_E2E_PORT=<port> BELLPR_SCREENSHOTS=docs npx playwright test e2e/screenshots.spec.ts
//
// writes docs/images/<locale>/<route>-<width>.png for the docs. Without
// BELLPR_SCREENSHOTS=docs the images go to e2e/output/screenshots/
// (gitignored), so a normal e2e run checks every view without changing
// tracked files.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { htmlLang, locales, type Locale } from "../shared/i18n/locale";
import { settingsSections } from "../src/settings/sections";
import { expectNoOverflow } from "./helpers/overflow";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

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
  for (const route of screenshotRoutes)
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
      } finally {
        await context.close();
      }
    });
