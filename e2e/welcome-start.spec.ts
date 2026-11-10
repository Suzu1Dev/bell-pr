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
    await fits(page, 1280);
    await fits(page, 375);

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
    await fits(page, 1280);
    await fits(page, 375);
  } finally {
    await close();
    await server.stop();
  }
});
