// The origin notice at a phone width. The command stays inside its own box
// and the copy button stays on screen. The text check is the same one
// e2e/responsive.spec.ts uses (findOverflow, through expectNoOverflow).
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { e2eApiHeaders } from "./api-token.mjs";
import { htmlLang, locales, type Locale } from "../shared/i18n/locale";
import { expectNoOverflow } from "./helpers/overflow";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const command = "git remote set-url origin https://github.com/OWNER/REPO";
const width = 375;

async function seed(dataDir: string) {
  await writeFile(
    path.join(dataDir, "state.json"),
    JSON.stringify({
      version: 1,
      repos: [
        {
          id: "ignored-repo",
          name: "widgets",
          owner: "local",
          fullName: "local/widgets",
          path: path.join(dataDir, "repositories", "widgets"),
          defaultBranch: "main",
          url: "",
          originUserinfoIgnored: true,
        },
      ],
      runs: [],
    }),
  );
}

/** The notice at 375 px: nothing on the page scrolls sideways, and the button is in view. */
async function expectNoticeFits(
  browser: Browser,
  server: LaunchedServer,
  locale: Locale,
  hash: string,
) {
  const context = await browser.newContext({
    extraHTTPHeaders: e2eApiHeaders,
    baseURL: server.baseURL,
    locale: "en-US",
    viewport: { width, height: 812 },
  });
  try {
    const page = await context.newPage();
    await page.goto(`/${hash}?locale=${locale}`);
    await expect(page.locator("html")).toHaveAttribute("lang", htmlLang(locale));
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.locator(".app-starting")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    const notice = page.locator(".origin-ignored");
    await expect(notice).toHaveCount(1);
    const label =
      locale === "zh-TW"
        ? `複製指令。請替換 OWNER 與 REPO：${command}`
        : `Copy the command. Replace OWNER and REPO: ${command}`;
    await expect(notice.getByRole("button", { name: label })).toBeVisible();
    await expectNoOverflow(page, [".origin-ignored"]);
    const fit = await measure(page);
    const where = `${hash} in ${locale}`;
    expect(fit.pageOverflow, where).toBeLessThanOrEqual(1);
    expect(fit.button, where).not.toBeNull();
    expect(fit.code, where).not.toBeNull();
    expect(fit.button!.left, where).toBeGreaterThanOrEqual(0);
    expect(fit.button!.right, where).toBeLessThanOrEqual(width + 1);
    expect(fit.code!.right, where).toBeLessThanOrEqual(width + 1);
    expect(fit.codeScroll, where).toBeLessThanOrEqual(1);
  } finally {
    await context.close();
  }
}

function measure(page: Page) {
  return page.evaluate(() => {
    const code = document.querySelector(".origin-ignored code");
    const button = document.querySelector(".origin-ignored .copy-command-button");
    const rect = (element: Element | null) => {
      const box = element?.getBoundingClientRect();
      return box ? { left: box.left, right: box.right } : null;
    };
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      code: rect(code),
      button: rect(button),
      codeScroll: code ? code.scrollWidth - code.clientWidth : -1,
    };
  });
}

test("the origin notice fits at 375 px and keeps its copy button on screen", async ({ browser }) => {
  test.setTimeout(120_000);
  const server = await launchServer({ seed });
  try {
    for (const locale of locales)
      for (const hash of ["#/repos", "#/repos/ignored-repo"])
        await expectNoticeFits(browser, server, locale, hash);
  } finally {
    await server.stop();
  }
});
