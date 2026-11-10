// The origin notice at a phone, just under the row breakpoint, and on wide
// screens. The command stays in its box and the copy button stays on screen.
// The text check is the same one e2e/responsive.spec.ts uses (findOverflow,
// through expectNoOverflow).
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { e2eApiHeaders } from "./api-token.mjs";
import { htmlLang, locales, type Locale } from "../shared/i18n/locale";
import { expectNoOverflow } from "./helpers/overflow";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const command = "git remote set-url origin https://github.com/OWNER/REPO";
const widths = [375, 759, 761, 1280];

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

/** The notice at `width`: nothing scrolls the page sideways, and the command stays in its frame. */
async function expectNoticeFits(
  browser: Browser,
  server: LaunchedServer,
  locale: Locale,
  hash: string,
  width: number,
) {
  const context = await browser.newContext({
    extraHTTPHeaders: e2eApiHeaders,
    baseURL: server.baseURL,
    locale: "en-US",
    viewport: { width, height: width < 760 ? 812 : 900 },
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
    const where = `${hash} in ${locale} at ${width}px`;
    expect(fit.pageOverflow, where).toBeLessThanOrEqual(1);
    expect(fit.frame, where).not.toBeNull();
    expect(fit.button, where).not.toBeNull();
    expect(fit.code, where).not.toBeNull();
    const frame = fit.frame!;
    const detail = `${where} code ${fit.code!.width.toFixed(1)}×${fit.code!.height.toFixed(1)} button ${fit.button!.width.toFixed(1)}×${fit.button!.height.toFixed(1)} frame ${frame.width.toFixed(1)}×${frame.height.toFixed(1)}`;
    for (const part of [fit.button!, fit.code!]) {
      expect(part.left, detail).toBeGreaterThanOrEqual(frame.left - 1);
      expect(part.right, detail).toBeLessThanOrEqual(frame.right + 1);
      expect(part.top, detail).toBeGreaterThanOrEqual(frame.top - 1);
      expect(part.bottom, detail).toBeLessThanOrEqual(frame.bottom + 1);
    }
    // Wide row: one line. A column of single characters is many times the line height.
    if (width >= 761) {
      expect(fit.codeTextHeight, detail).toBeLessThanOrEqual(fit.lineHeight * 2 + 1);
    }
  } finally {
    await context.close();
  }
}

function measure(page: Page) {
  return page.evaluate(() => {
    const notice = document.querySelector(".origin-ignored");
    const code = notice?.querySelector("code") ?? null;
    const button = notice?.querySelector(".copy-command-button") ?? null;
    const frame = notice?.closest(".repository-card, .page-title") ?? null;
    const box = (element: Element | null) => {
      const rect = element?.getBoundingClientRect();
      return rect
        ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
        : null;
    };
    const style = code ? getComputedStyle(code) : null;
    const fontSize = style ? parseFloat(style.fontSize) : 0;
    const parsedLine = style ? parseFloat(style.lineHeight) : Number.NaN;
    const lineHeight = Number.isFinite(parsedLine) ? parsedLine : fontSize * 1.2;
    const codeBox = box(code);
    const pad = style ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : 0;
    const border = style ? parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) : 0;
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      frame: box(frame),
      code: codeBox,
      button: box(button),
      lineHeight,
      codeTextHeight: codeBox ? codeBox.height - pad - border : -1,
    };
  });
}

test("the origin notice fits at phone and wide widths and keeps its copy button on screen", async ({ browser }) => {
  test.setTimeout(180_000);
  const server = await launchServer({ seed });
  try {
    for (const width of widths)
      for (const locale of locales)
        for (const hash of ["#/repos", "#/repos/ignored-repo"])
          await expectNoticeFits(browser, server, locale, hash, width);
  } finally {
    await server.stop();
  }
});
