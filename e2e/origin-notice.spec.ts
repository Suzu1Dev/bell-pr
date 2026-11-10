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
    permissions: ["clipboard-read", "clipboard-write"],
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
    const detail = `${where} code ${fit.code!.width.toFixed(1)}×${fit.code!.height.toFixed(1)} client ${fit.clientWidth} content ${fit.contentWidth.toFixed(1)} scroll ${fit.scrollWidth} prefix ${fit.prefixWidth.toFixed(1)} widest ${fit.widestPrefixLine.toFixed(1)} clipped ${fit.prefixClipped} button ${fit.button!.width.toFixed(1)}×${fit.button!.height.toFixed(1)} frame ${frame.width.toFixed(1)}×${frame.height.toFixed(1)}`;
    for (const part of [fit.button!, fit.code!]) {
      expect(part.left, detail).toBeGreaterThanOrEqual(frame.left - 1);
      expect(part.right, detail).toBeLessThanOrEqual(frame.right + 1);
      expect(part.top, detail).toBeGreaterThanOrEqual(frame.top - 1);
      expect(part.bottom, detail).toBeLessThanOrEqual(frame.bottom + 1);
    }
    expect(fit.scrollWidth, detail).toBeLessThanOrEqual(fit.clientWidth + 1);
    await expect(notice.locator("code")).toHaveText(command);
    if (width === 761 && locale === "en" && hash === "#/repos") {
      await notice.getByRole("button", { name: label }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(command);
    }
    if (width >= 761) {
      expect(fit.prefixClipped, detail).toBe(false);
      expect(fit.widestPrefixLine + 1, detail).toBeGreaterThanOrEqual(fit.prefixWidth * 0.45);
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
    const prefix = "git remote set-url origin";
    let prefixWidth = 0;
    let prefixClipped = true;
    let widestPrefixLine = 0;
    let contentWidth = 0;
    if (code && style) {
      const probe = document.createElement("span");
      probe.textContent = prefix;
      probe.style.font = style.font;
      probe.style.whiteSpace = "nowrap";
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      document.body.appendChild(probe);
      prefixWidth = probe.getBoundingClientRect().width;
      probe.remove();
      const text = code.firstChild;
      const at = text?.textContent?.indexOf(prefix) ?? -1;
      if (text && at >= 0) {
        const range = document.createRange();
        range.setStart(text, at);
        range.setEnd(text, at + prefix.length);
        const visibleLeft = code.getBoundingClientRect().left + code.clientLeft;
        const visibleRight = visibleLeft + code.clientWidth;
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
        prefixClipped = rects.some(
          (rect) => rect.right > visibleRight + 1 || rect.left < visibleLeft - 1,
        );
        widestPrefixLine = rects.reduce((wide, rect) => Math.max(wide, rect.width), 0);
        contentWidth = code.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      }
    }
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      frame: box(frame),
      code: codeBox,
      button: box(button),
      lineHeight,
      clientWidth: code?.clientWidth ?? 0,
      scrollWidth: code?.scrollWidth ?? 0,
      prefixWidth,
      prefixClipped,
      widestPrefixLine,
      contentWidth,
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
