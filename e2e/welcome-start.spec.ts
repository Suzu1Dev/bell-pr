// A first start with no provider CLI: Welcome opens and shows the install
// commands and documentation links. Another required failure still exits.
import { expect, test, type Browser, type Page } from "@playwright/test";
import onboarding from "../src/i18n/en/onboarding";
import onboardingZh from "../src/i18n/zh-TW/onboarding";
import { e2eApiHeaders } from "./api-token.mjs";
import { switchLocale } from "./fixtures";
import { expectNoOverflow } from "./helpers/overflow";
import { launchServer } from "./start-server.mjs";

async function openWelcome(browser: Browser, baseURL: string) {
  const context = await browser.newContext({
    extraHTTPHeaders: e2eApiHeaders,
    baseURL,
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto("/#/home");
  return { page, close: () => context.close() };
}

async function providerStep(page: Page, next: string) {
  await page.getByRole("button", { name: next }).click();
  await page.getByRole("button", { name: next }).click();
}

async function fits(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await expectNoOverflow(page, [".welcome-screen"]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
}

const widths = [320, 375, 390, 768, 1280];

/** Each install command is one line, and the page around it does not scroll sideways. */
async function commandsOnOneLine(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    if (!document.querySelector(".welcome-install code")) found.push("no install command");
    const range = document.createRange();
    for (const code of document.querySelectorAll(".welcome-install code")) {
      const texts = [...code.childNodes].filter(
        (node): node is Text => node.nodeType === Node.TEXT_NODE && !!node.textContent,
      );
      const rects = texts.flatMap((text) => {
        range.selectNodeContents(text);
        return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      });
      const lines = new Set(rects.map((rect) => Math.round(rect.top)));
      if (lines.size !== 1) found.push(`${lines.size} lines: ${code.textContent}`);
    }
    for (const node of [
      document.documentElement,
      document.querySelector(".welcome-screen"),
      document.querySelector(".welcome"),
      document.querySelector(".welcome-card"),
    ]) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.scrollWidth > node.clientWidth + 1)
        found.push(`sideways ${node.className || node.tagName}: ${node.scrollWidth}>${node.clientWidth}`);
    }
    return found;
  });
  expect(problems, `width ${width}`).toEqual([]);
}

test("a first start with no provider CLI opens Welcome and shows how to install one", async ({ browser }) => {
  const server = await launchServer({ settingsPut: false, force: false });
  const { page, close } = await openWelcome(browser, server.baseURL);
  try {
    await expect(page.locator(".welcome-screen")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: onboarding.title })).toBeVisible();
    await providerStep(page, onboarding.next);
    await expect(page.getByRole("heading", { level: 2, name: onboarding.provider.title })).toBeVisible();
    await expect(page.getByText("npm install -g @openai/codex", { exact: true })).toBeVisible();
    await expect(page.getByText("npm install -g @anthropic-ai/claude-code", { exact: true })).toBeVisible();
    await expect(page.getByText("agy", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Codex CLI" })).toHaveAttribute(
      "href",
      "https://github.com/openai/codex",
    );
    await expect(page.getByRole("link", { name: "Claude Code documentation" })).toHaveAttribute(
      "href",
      "https://code.claude.com/docs/en/overview",
    );
    await expect(page.getByRole("link", { name: "Antigravity documentation" })).toHaveAttribute(
      "href",
      "https://antigravity.google/docs",
    );
    await fits(page, 1280);
    await fits(page, 375);
    for (const width of widths) await commandsOnOneLine(page, width);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: onboarding.back }).click();
    await page.getByRole("button", { name: onboarding.back }).click();
    await switchLocale(page, "zh-TW");
    await providerStep(page, onboardingZh.next);
    await expect(page.getByRole("heading", { level: 1, name: onboardingZh.title })).toBeVisible();
    await expect(page.getByText("npm install -g @openai/codex", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Codex CLI" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Claude Code 文件" })).toHaveAttribute(
      "href",
      "https://code.claude.com/docs/en/overview",
    );
    await expect(page.getByRole("link", { name: "Antigravity 文件" })).toHaveAttribute(
      "href",
      "https://antigravity.google/docs",
    );
    await fits(page, 1280);
    await fits(page, 375);
    for (const width of widths) await commandsOnOneLine(page, width);
  } finally {
    await close();
    await server.stop();
  }
});
