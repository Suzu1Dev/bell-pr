// Real browser authentication, without the suite's bearer-header shortcut.
// Each test rotates credentials only in its own temporary server.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import common from "../src/i18n/en/common";
import settings from "../src/i18n/en/settings";
import { e2eApiToken } from "./api-token.mjs";
import { launchServer } from "./start-server.mjs";

const access = settings.general.browserAccess;
const sessionCookies = async (context: BrowserContext) =>
  (await context.cookies()).filter((cookie) => cookie.name.startsWith("bellpr-session"));
const signInMessage = (page: Page) => page.getByRole("status").filter({
  hasText: common.errors.apiTokenRequired,
});
const browserAccess = (page: Page) => page.getByRole("heading", { name: access.title, exact: true });
const remember = (page: Page) => page.getByRole("checkbox", { name: access.remember, exact: true });

async function openSettings(page: Page) {
  await page.goto("/#/settings/general?locale=en");
  await expect(browserAccess(page)).toBeVisible();
  await expect(remember(page)).toBeEnabled();
}

async function signIn(page: Page) {
  // A CLI link opens a new document; changing only a SPA fragment would not
  // rerun the bootstrap that exchanges the token.
  await page.goto("about:blank");
  const exchange = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/session" && response.request().method() === "POST",
  );
  await page.goto(`/#bell_token=${e2eApiToken}`);
  expect((await exchange).status()).toBe(200);
  await expect(page).not.toHaveURL(/bell_token/);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("bellpr-api-token"))).toBeNull();
  await openSettings(page);
}

test("browser sign-in shares tabs and remembers trusted browsers across a new browser context", async ({ browser }) => {
  const server = await launchServer();
  // An explicit empty header map overrides Playwright's project-wide bearer.
  const options = { baseURL: server.baseURL, locale: "en-US", extraHTTPHeaders: {} };
  const context = await browser.newContext(options);
  let restored: BrowserContext | undefined;
  try {
    const page = await context.newPage();
    await page.goto("/");
    await expect(signInMessage(page)).toBeVisible();
    await expect(browserAccess(page)).toHaveCount(0);
    expect((await context.request.get("/api/repos")).status()).toBe(401);

    await signIn(page);
    await expect(remember(page)).not.toBeChecked();
    const cookies = await sessionCookies(context);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/", expires: -1 });
    expect(cookies[0].value).not.toBe(e2eApiToken);
    expect(await page.evaluate(() => document.cookie)).not.toContain("bellpr-session");
    expect((await context.request.get("/api/repos")).status()).toBe(200);

    const sibling = await context.newPage();
    await openSettings(sibling);
    await expect(remember(sibling)).not.toBeChecked();
    expect(await sibling.evaluate(() => sessionStorage.getItem("bellpr-api-token"))).toBeNull();

    // The controlled checkbox changes only after the server saves it.
    await remember(page).click();
    await expect(remember(page)).toBeChecked();
    await expect.poll(async () => (await sessionCookies(context))[0]?.expires ?? -1).toBeGreaterThan(0);
    const persistent = (await sessionCookies(context))[0];
    const thirtyDays = 30 * 24 * 60 * 60;
    expect(persistent.expires - Date.now() / 1000).toBeGreaterThan(thirtyDays - 60);
    expect(persistent.expires - Date.now() / 1000).toBeLessThanOrEqual(thirtyDays);
    expect(await (await context.request.get("/api/session")).json()).toEqual({ remembered: true });

    const storageState = await context.storageState();
    await context.close();
    restored = await browser.newContext({ ...options, storageState });
    const restoredPage = await restored.newPage();
    await openSettings(restoredPage);
    await expect(remember(restoredPage)).toBeChecked();
    expect((await restored.request.get("/api/repos")).status()).toBe(200);

    // Opening a fresh CLI link must not reset the saved remember choice.
    await signIn(restoredPage);
    await expect(remember(restoredPage)).toBeChecked();
    expect((await sessionCookies(restored))[0].expires).toBeGreaterThan(Date.now() / 1000);
    expect(await (await restored.request.get("/api/session")).json()).toEqual({ remembered: true });

    // An old tab with only sessionStorage is upgraded on its next reload.
    await restored.clearCookies();
    await restoredPage.evaluate((token) => sessionStorage.setItem("bellpr-api-token", token), e2eApiToken);
    await restoredPage.reload();
    await expect(browserAccess(restoredPage)).toBeVisible();
    await expect(remember(restoredPage)).toBeEnabled();
    await expect(remember(restoredPage)).not.toBeChecked();
    expect(await restoredPage.evaluate(() => sessionStorage.getItem("bellpr-api-token"))).toBeNull();
    expect(await sessionCookies(restored)).toHaveLength(1);
    expect((await restored.request.get("/api/repos")).status()).toBe(200);
  } finally {
    await restored?.close();
    await context.close();
    await server.stop();
  }
});

test("sign-out affects its browser and confirmed revocation removes every browser and old login credential", async ({ browser }) => {
  const server = await launchServer();
  const options = { baseURL: server.baseURL, locale: "en-US", extraHTTPHeaders: {} };
  const context = await browser.newContext(options);
  const independent = await browser.newContext(options);
  try {
    const page = await context.newPage();
    const otherPage = await independent.newPage();
    await signIn(page);
    await signIn(otherPage);
    const sibling = await context.newPage();
    await openSettings(sibling);

    await page.getByRole("button", { name: access.signOut, exact: true }).click();
    await expect(signInMessage(page)).toBeVisible();
    expect(await sessionCookies(context)).toHaveLength(0);
    expect((await context.request.get("/api/repos")).status()).toBe(401);
    // Existing tabs hide their sensitive UI on the next four-second poll.
    await expect(signInMessage(sibling)).toBeVisible({ timeout: 6_000 });
    await expect(browserAccess(sibling)).toHaveCount(0);
    await expect(browserAccess(otherPage)).toBeVisible();
    expect((await independent.request.get("/api/repos")).status()).toBe(200);

    await signIn(page);
    let revokeRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/session/revoke" && request.method() === "POST")
        revokeRequests++;
    });
    const revoke = page.getByRole("button", { name: access.revoke, exact: true });
    const dialog = page.getByRole("dialog", { name: access.confirmTitle, exact: true });
    await revoke.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(access.confirmText);
    await expect(dialog).toContainText(access.confirmBack);
    await expect(dialog).toContainText(access.signOutHelp);
    const cancel = dialog.getByRole("button", { name: settings.state.cancel, exact: true });
    await expect(cancel).toBeFocused();
    await cancel.click();
    await expect(dialog).toHaveCount(0);
    await expect(revoke).toBeFocused();
    expect(revokeRequests).toBe(0);
    expect((await independent.request.get("/api/repos")).status()).toBe(200);

    await revoke.click();
    await dialog.getByRole("button", { name: access.confirm, exact: true }).click();
    await expect(signInMessage(page)).toBeVisible();
    expect(revokeRequests).toBe(1);
    expect(await sessionCookies(context)).toHaveLength(0);
    await expect(signInMessage(otherPage)).toBeVisible({ timeout: 6_000 });
    await expect(browserAccess(otherPage)).toHaveCount(0);
    expect((await independent.request.get("/api/repos")).status()).toBe(401);
    expect((await context.request.get("/api/repos", {
      headers: { Authorization: `Bearer ${e2eApiToken}` },
    })).status()).toBe(401);

    // The old CLI link also cannot bootstrap another browser session.
    await page.goto("about:blank");
    await page.goto(`/#bell_token=${e2eApiToken}`);
    await expect(signInMessage(page)).toBeVisible();
    await expect(page).not.toHaveURL(/bell_token/);
    expect(await page.evaluate(() => sessionStorage.getItem("bellpr-api-token"))).toBeNull();
    expect(await sessionCookies(context)).toHaveLength(0);
    expect((await context.request.get("/api/session")).status()).toBe(401);
  } finally {
    await context.close();
    await independent.close();
    await server.stop();
  }
});
