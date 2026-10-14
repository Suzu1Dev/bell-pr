// The UI language: the reader's choice is remembered, and a locale= flag in
// the address wins for one page load without being remembered.
import { expect, test, type Page } from "@playwright/test";
import workspaceEn from "../src/i18n/en/workspace";
import workspaceZh from "../src/i18n/zh-TW/workspace";
import { localeStorageKey } from "../src/i18n";
import { switchLocale } from "./fixtures";

const overviewTab = (page: Page) => page.locator("#workspace-tab-overview");
const savedLocale = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), localeStorageKey);

test("the language the reader picks survives a reload", async ({ page }) => {
  await page.goto("/#/runs/demo-run/overview");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(overviewTab(page)).toHaveText(workspaceEn.tabs.overview);

  await switchLocale(page, "zh-TW");
  await expect(overviewTab(page)).toHaveText(workspaceZh.tabs.overview);
  expect(await savedLocale(page)).toBe("zh-TW");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant-TW");
  await expect(overviewTab(page)).toHaveText(workspaceZh.tabs.overview);

  await switchLocale(page, "en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(overviewTab(page)).toHaveText(workspaceEn.tabs.overview);
});

test("?locale=en wins over the saved zh-TW and leaves it saved", async ({ page }) => {
  await page.goto("/#/runs/demo-run/overview");
  await page.evaluate((key) => localStorage.setItem(key, "zh-TW"), localeStorageKey);
  await page.goto("/#/runs/demo-run/overview?locale=en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(overviewTab(page)).toHaveText(workspaceEn.tabs.overview);
  expect(await savedLocale(page)).toBe("zh-TW");

  // The flag stays in the address while the reader moves around.
  await page.locator("#workspace-tab-changes").click();
  await expect(page).toHaveURL(/#\/runs\/demo-run\/changes\?locale=en$/);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await savedLocale(page)).toBe("zh-TW");

  // Without the flag, the saved choice applies again.
  await page.goto("/#/runs/demo-run/overview");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant-TW");
  await expect(overviewTab(page)).toHaveText(workspaceZh.tabs.overview);
});

test("?locale=zh-TW wins over the browser language and saves nothing", async ({ page }) => {
  await page.goto("/#/runs/demo-run/overview?locale=zh-TW");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant-TW");
  await expect(overviewTab(page)).toHaveText(workspaceZh.tabs.overview);
  expect(await savedLocale(page)).toBeNull();
  // An unsupported tag is ignored: the browser language (en-US) applies.
  await page.goto("/#/runs/demo-run/overview?locale=ja");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await savedLocale(page)).toBeNull();
});
