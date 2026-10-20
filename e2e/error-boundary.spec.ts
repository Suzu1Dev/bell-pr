// A lazy chunk that cannot load (a stale tab after an update, a dropped
// connection) reloads the page once, then shows the error fallback with
// "Reload" instead of a blank page.
import { expect, test } from "@playwright/test";
import app from "../src/i18n/en/app";
import review from "../src/i18n/en/review";

test("the explanation panel failing twice shows the fallback, and Reload recovers", async ({ page }) => {
  let aborted = 0;
  await page.route(
    "**/assets/ExplanationPanel-*.js",
    (route) => {
      aborted++;
      return route.abort();
    },
    { times: 2 },
  );
  let loads = 0;
  page.on("load", () => loads++);

  await page.goto("/#/runs/demo-run/changes");
  const fallback = page.getByRole("alert").filter({ hasText: app.errorBoundary.title });
  await expect(fallback).toBeVisible();
  await expect(fallback.getByRole("button", { name: app.errorBoundary.reload })).toBeVisible();
  // vite:preloadError reloaded once (the first failure); the second failure
  // reached the error boundary. The rest of the workspace still works.
  expect(aborted).toBe(2);
  expect(loads).toBe(2);
  await expect(page).toHaveURL(/#\/runs\/demo-run\/changes$/);
  await expect(page.locator("#workspace-tab-changes")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".file-item")).not.toHaveCount(0);

  // The chunk loads again now: Reload brings the panel back.
  await fallback.getByRole("button", { name: app.errorBoundary.reload }).click();
  await expect(
    page.getByRole("complementary", { name: review.panel.label }),
  ).toBeVisible();
  expect(loads).toBe(3);
  await expect(fallback).toHaveCount(0);
});
