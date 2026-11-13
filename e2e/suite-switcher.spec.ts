// The product switcher (docs/bell-suite.md): a button that shows once
// BELLPR_SUITE_LINKS names another BELL product, and its dialog. The open
// dialog's accessibility and narrow widths are in e2e/helpers/views.ts.
import { expect, test, type Route } from "@playwright/test";
import { e2eApiHeaders } from "./api-token.mjs";
import { product } from "../shared/product";
import app from "../src/i18n/en/app";
import common from "../src/i18n/en/common";
import modals from "../src/i18n/en/modals";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const t = app.suite;

test("no switcher shows while no other BELL product is linked", async ({ page }) => {
  const manifest = page.waitForResponse("**/api/suite/manifest");
  await page.goto("/#/home");
  expect(await (await manifest).json()).toMatchObject({ appId: "pr", links: {} });
  await expect(page.locator(".home-page h1")).toBeVisible();
  await expect(page.locator(".suite-trigger")).toHaveCount(0);
});

test("an answer that is no manifest or links nowhere shows no switcher", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let answer: Parameters<Route["fulfill"]>[0] = {};
  await page.route("**/api/suite/manifest", (route) => route.fulfill(answer));
  await page.goto("/#/home");
  const answers = [
    // As a proxy may answer for an address it does not know.
    { body: "" },
    { json: { links: "http://localhost:5173" } },
    // Nothing the switcher would link to.
    { json: { links: { explain: "javascript:alert(1)", personal: 4400 } } },
  ];
  for (const next of answers) {
    answer = next;
    await page.reload();
    await expect(page.locator(".home-page h1")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".suite-trigger"), JSON.stringify(next)).toHaveCount(0);
    expect(errors, JSON.stringify(next)).toEqual([]);
  }
  // The same page shows the button for a link.
  answer = { json: { links: { explain: "javascript:alert(1)", personal: "http://localhost:5173" } } };
  await page.reload();
  await page.getByRole("button", { name: t.open }).click();
  await expect(page.getByRole("dialog", { name: t.title }).getByRole("link")).toHaveCount(1);
});

test.describe("with BELLPR_SUITE_LINKS", () => {
  let server: LaunchedServer | undefined;
  test.beforeAll(async () => {
    server = await launchServer({
      env: { BELLPR_SUITE_LINKS: "explain=http://localhost:5173,personal=http://127.0.0.1:4400" },
    });
  });
  test.afterAll(async () => {
    await server?.stop();
  });

  test("the switcher links to the other products and keeps the shell's keys out", async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: e2eApiHeaders,
      baseURL: server!.baseURL,
      locale: "en-US",
    });
    try {
      const page = await context.newPage();
      await page.goto("/#/home");
      const trigger = page.getByRole("button", { name: t.open });
      const dialog = page.getByRole("dialog", { name: t.title });
      const help = page.getByRole("dialog", { name: modals.help.title });
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");

      // Personal, Explain, then this product; a link is the origin and nothing more.
      const links = dialog.getByRole("link");
      await expect(links).toHaveText([
        `${t.personal.name}${t.personal.summary}`,
        `${t.explain.name}${t.explain.summary}`,
      ]);
      await expect(links.nth(0)).toHaveAttribute("href", "http://127.0.0.1:4400/");
      await expect(links.nth(1)).toHaveAttribute("href", "http://localhost:5173/");
      await expect(links.nth(0)).toBeFocused();
      await expect(dialog.locator('[aria-current="true"]')).toHaveText(
        `${product.name}${t.prSummary}${t.current}`,
      );

      // The dialog is modal: Help or the quick switch would open where nobody can reach them.
      await page.keyboard.press("?");
      await page.keyboard.press("ControlOrMeta+k");
      await expect(dialog).toBeVisible();
      await expect(help).toHaveCount(0);
      await expect(page.locator(".command-palette")).toHaveCount(0);

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.keyboard.press("?");
      await expect(help).toBeVisible();
      await help.locator(".modal-close").click();

      // Where the sidebar is a drawer, the button sits beside the menu button.
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator(".brand-row .suite-trigger")).toBeHidden();
      await page.locator(".breadcrumb .suite-trigger").click();
      await dialog.getByRole("button", { name: common.actions.close }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator(".breadcrumb .suite-trigger")).toBeFocused();
    } finally {
      await context.close();
    }
  });

  test("suite frame, 5-app search, zero-write incoming handoff, and light/dark theme toggle work end-to-end", async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: e2eApiHeaders,
      baseURL: server!.baseURL,
      locale: "en-US",
    });
    try {
      const page = await context.newPage();
      await page.goto(
        "/#/discover?draft=Add%20dark%20mode%20contrast%20audit&title=Dark%20mode%20audit&from=explain&back=%23%2Fexplain",
      );
      await expect(page.locator(".app-shell")).toHaveClass(/is-suite-edition/);
      await expect(page.locator("html")).toHaveAttribute("data-edition", "suite");

      // Handoff parameters are stripped immediately from the URL and shown in a zero-write banner.
      await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/discover");
      const banner = page.locator(".suite-handoff-banner");
      await expect(banner).toContainText("Dark mode audit — Add dark mode contrast audit");
      await expect(banner.locator(".suite-handoff-back")).toHaveAttribute(
        "href",
        "http://localhost:5173/#/explain",
      );

      // Search filtering inside the 5-product Suite switcher.
      await page.getByRole("button", { name: t.open }).click();
      const dialog = page.getByRole("dialog", { name: t.title });
      await expect(dialog.locator("ul > li")).toHaveCount(5);
      await dialog.getByRole("searchbox", { name: t.searchPlaceholder }).fill("campaign");
      await expect(dialog.locator("ul > li")).toHaveCount(1);
      await expect(dialog.locator("ul > li")).toContainText(t.campaign.name);
      await page.keyboard.press("Escape");

      // Light <-> Dark mode toggle updates data-theme and persists in localStorage.
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await page.locator(".topbar .theme-toggle").click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      expect(await page.evaluate(() => localStorage.getItem("bell.theme"))).toBe("dark");
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

      // Applying the stored handoff opens the New Task modal prefilled and clears the banner.
      await expect(banner).toBeVisible();
      await banner.locator(".suite-handoff-apply").click();
      await expect(banner).toHaveCount(0);
      await expect(page.locator('[role="dialog"]')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
