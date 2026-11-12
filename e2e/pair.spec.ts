import { expect, test, type Page } from "@playwright/test";
import common from "../src/i18n/en/common";
import settings from "../src/i18n/en/settings";

const t = common.pair;
const token = `bpd_${"0".repeat(64)}`;

/**
 * S2 device auth is not on this branch. Without install headers, any real
 * API 401 for a forged `bpd_` clears the credential and sends the SPA to
 * /pair — mock the bootstrap surface so device-token UI can be exercised.
 */
async function mockAuthenticatedBootstrap(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/pair" || path === "/api/devices" || path.startsWith("/api/devices/"))
      return route.fallback();
    if (path === "/api/status")
      return route.fulfill({ json: { codex: false, github: false, ready: true, version: "0.0.0-e2e" } });
    if (path === "/api/repos") return route.fulfill({ json: { repos: [] } });
    if (path === "/api/runs") return route.fulfill({ json: { runs: [] } });
    if (path === "/api/app-settings")
      return route.fulfill({
        json: { settings: { onboardingCompletedAt: "2026-01-01T00:00:00.000Z" }, lockedBy: {} },
      });
    if (path === "/api/doctor") return route.fulfill({ json: { checks: [], ok: true } });
    if (path === "/api/session") return route.fulfill({ json: { remembered: false } });
    if (path.startsWith("/api/learning")) return route.fulfill({ json: { items: [], practice: null } });
    // Anything else the shell probes: succeed so a forged device token is not revoked.
    return route.fulfill({ status: 200, json: {} });
  });
}

test.describe("pair page without install credentials", () => {
  test.use({ extraHTTPHeaders: {} });

  test("QR prefill strips hash and pairs without credentials", async ({ page }) => {
    await mockAuthenticatedBootstrap(page);
    await page.route("**/api/pair", async (route) => {
      expect(route.request().headers().authorization).toBeUndefined();
      expect(route.request().postDataJSON()).toEqual({ code: "TEST-CODE", name: "Test phone" });
      await route.fulfill({ status: 201, json: { deviceId: "test-device", token, name: "Test phone" } });
    });
    await page.goto("/pair#code=TEST-CODE");
    await expect(page).toHaveURL(/\/pair$/);
    await expect(page.getByLabel(t.code)).toHaveValue("TEST-CODE");
    await page.getByLabel(t.name).fill("Test phone");
    await page.getByRole("button", { name: t.submit, exact: true }).click();
    await expect(page).toHaveURL(/\/(#\/home)?$/);
    expect(await page.evaluate(() => localStorage.getItem("bellpr-device-token"))).toBe(token);
  });

  test("query code is ignored and pairing waits for confirmation", async ({ page }) => {
    let posted = false;
    await page.route("**/api/pair", (route) => {
      posted = true;
      return route.fulfill({ status: 401, json: { error: "invalid_code" } });
    });
    await page.goto("/pair?code=TEST-CODE");
    await expect(page.getByLabel(t.code)).toHaveValue("");
    expect(posted).toBe(false);
  });

  for (const [status, message] of [
    [401, t.invalid],
    [423, t.locked],
    [429, t.rateLimited],
  ] as const) {
    test(`pairing handles ${status}`, async ({ page }) => {
      await page.route("**/api/pair", (route) =>
        route.fulfill({
          status,
          json: {
            error: "invalid_code",
            ...(status === 423
              ? { lockedUntil: new Date(Date.now() + 60_000).toISOString() }
              : {}),
          },
        }),
      );
      await page.goto("/pair#code=ABCD-EFGH");
      await page.getByRole("button", { name: t.submit, exact: true }).click();
      await expect(page.getByRole("alert")).toContainText(message);
      if (status === 423) await expect(page.getByRole("alert")).toContainText("seconds");
    });
  }
});

test("install token revokes a device in General settings", async ({ page }) => {
  let revoked = false;
  await page.route("**/api/devices", (route) =>
    route.fulfill({
      json: revoked
        ? []
        : [
            {
              id: "test-device",
              name: "Test phone",
              createdAt: "2026-01-01T00:00:00Z",
              lastUsedAt: null,
              current: false,
            },
          ],
    }),
  );
  await page.route("**/api/devices/test-device", (route) => {
    expect(route.request().method()).toBe("DELETE");
    revoked = true;
    return route.fulfill({ status: 204 });
  });
  await page.goto("/#/settings/general?locale=en");
  await expect(page.getByText("Test phone", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: settings.general.devices.revoke, exact: true }).click();
  await expect(page.getByText(settings.general.devices.empty, { exact: true })).toBeVisible();
  expect(revoked).toBe(true);
});

test.describe("device credential without install headers", () => {
  test.use({ extraHTTPHeaders: {} });

  test("device token lists all devices and can revoke another device and itself", async ({
    page,
  }) => {
    let listed = false;
    await mockAuthenticatedBootstrap(page);
    await page.addInitScript(({ token }) => {
      if (sessionStorage.getItem("test-device-initialized")) return;
      sessionStorage.setItem("test-device-initialized", "true");
      localStorage.setItem("bellpr-device-token", token);
      localStorage.setItem(
        "bellpr-device-info",
        JSON.stringify({ id: "self", name: "This test phone" }),
      );
    }, { token });
    await page.route("**/api/devices", (route) => {
      listed = true;
      expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
      return route.fulfill({
        json: [
          { id: "other", name: "Other phone", lastUsedAt: null, current: false },
          { id: "self", name: "This test phone", lastUsedAt: null, current: true },
        ],
      });
    });
    await page.route("**/api/devices/other", (route) => {
      expect(route.request().method()).toBe("DELETE");
      return route.fulfill({ status: 204 });
    });
    await page.route("**/api/devices/self", (route) => {
      expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
      return route.fulfill({ status: 204 });
    });
    await page.goto("/#/settings/general?locale=en");
    await expect(page.getByText("This test phone", { exact: true })).toBeVisible();
    expect(listed).toBe(true);
    await page
      .getByRole("button", { name: settings.general.devices.revoke, exact: true })
      .first()
      .click();
    await expect(page.getByText("Other phone", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: settings.general.devices.revoke, exact: true }).click();
    await expect(page).toHaveURL(/\/pair$/);
  });
});
