// The project overview and Discovery: the live form, the sample results of
// the sample project, the sample analysis played in the overview, the
// section nav, and text that fits.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { locales } from "../shared/i18n/locale";
import { playbackTiming } from "../src/demo/playback";
import { getDemo } from "../src/demo/all";
import { getSampleDiscoveryJob } from "../src/demo/discovery";
import discovery from "../src/i18n/en/discovery";
import mission from "../src/i18n/en/mission";
import setup from "../src/i18n/en/setup";
import { expectNoOverflow } from "./helpers/overflow";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const demo = getDemo("en");
const widths = [1440, 390];

/** A signed-in page on a spec-local server; closed with `close()`. */
async function openOn(browser: Browser, server: LaunchedServer) {
  const context = await browser.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
    locale: "en-US",
  });
  return { page: await context.newPage(), close: () => context.close() };
}

/** Every request the page sends, as "METHOD /path". */
function recordRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/"))
      requests.push(`${request.method()} ${url.pathname}`);
  });
  return requests;
}

/** Fails on serious or critical axe issues, color contrast included. */
async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .options({ rules: { "color-contrast": { enabled: true } } })
    .analyze();
  const problems = violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .flatMap((violation) =>
      violation.nodes.map((node) => `${violation.id} at ${node.target.join(" ")}`),
    );
  expect(problems).toEqual([]);
}

test.describe("Discovery on a fresh data dir", () => {
  let server: LaunchedServer;
  test.beforeAll(async () => {
    server = await launchServer();
  });
  test.afterAll(async () => {
    await server?.stop();
  });

  test("the form is open and the fake gh makes it say how to fix the environment before it searches", async ({ browser }) => {
    const { page, close } = await openOn(browser, server);
    try {
      const requests = recordRequests(page);
      await page.goto("/#/discover?locale=en");
      await expect(page.locator(".discovery-sample-banner")).toHaveCount(0);
      await expect(page.locator(".discovery-opportunity")).toHaveCount(0);
      const interests = page.getByPlaceholder(discovery.form.interestsPlaceholder);
      await expect(interests).toBeEnabled();
      // The fake gh on this server fails its checks: the form says how to
      // fix it and searches only once the environment is ready.
      await expect(page.locator(".readiness-notice")).toContainText(setup.readiness.gh);
      await expect(page.getByRole("button", { name: discovery.form.submit })).toBeDisabled();
      expect(requests).toContain("GET /api/discovery");
      expect(requests.filter((request) => request === "POST /api/discovery")).toEqual([]);
    } finally {
      await close();
    }
  });

  test("the sample project's discovery shows labelled sample results, sends no search and offers no choice", async ({ browser }) => {
    const { page, close } = await openOn(browser, server);
    try {
      const requests = recordRequests(page);
      await page.goto("/#/discover?demo=play&locale=en");
      await expect(page.locator(".discovery-sample-banner")).toContainText(discovery.sample.title);
      await expect(page.locator(".discovery-opportunity")).toHaveCount(
        getSampleDiscoveryJob("en").opportunities.length,
      );
      // The sample's projects are fictional: no link and no choice.
      await expect(page.locator(".discovery-opportunity a[href]")).toHaveCount(0);
      for (const choose of await page.getByRole("button", { name: discovery.card.choose }).all())
        await expect(choose).toBeDisabled();
      // Searching shows the sample again and sends nothing.
      await page.locator("form.discovery-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
      await expect(page.locator(".discovery-sample-banner")).toBeVisible();
      expect(requests.filter((request) => request === "POST /api/discovery")).toEqual([]);
    } finally {
      await close();
    }
  });

  test("a newcomer issue in the sample is tagged Learn by hand and offers no agent team", async ({ browser }) => {
    const { page, close } = await openOn(browser, server);
    try {
      await page.goto("/#/discover?demo=play&locale=en");
      const sample = getSampleDiscoveryJob("en").opportunities;
      const byHand = sample.filter((item) => item.learnByHand);
      expect(byHand.length).toBeGreaterThan(0);
      const cards = page.locator(".discovery-opportunity");
      await expect(cards).toHaveCount(sample.length);
      for (const [index, item] of sample.entries()) {
        const card = cards.nth(index);
        await expect(card.locator("h3")).toHaveText(item.title);
        if (item.learnByHand) {
          await expect(card.locator(".discovery-learn-tag")).toHaveText(discovery.card.learnByHand);
          await expect(card.getByRole("button", { name: discovery.card.choose })).toHaveCount(0);
          await expect(card.locator("footer")).toContainText(discovery.card.learnByHandHint);
          // The overview and the reading stay.
          await expect(card.locator(".discovery-card-details")).toHaveCount(3);
        } else {
          await expect(card.locator(".discovery-learn-tag")).toHaveCount(0);
          await expect(card.getByRole("button", { name: discovery.card.choose })).toBeDisabled();
        }
      }
    } finally {
      await close();
    }
  });

  for (const width of widths)
    test(`fits and has no serious accessibility issue at ${width} px`, async ({ browser }) => {
      const { page, close } = await openOn(browser, server);
      try {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/#/discover?demo=play&locale=en");
        await expect(page.locator(".discovery-sample-banner")).toBeVisible();
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready);
        await expectNoOverflow(page);
        await expectAccessible(page);
      } finally {
        await close();
      }
    });
});

test("the overview plays the sample's analysis lines, then shows the project card", async ({ page }) => {
  // Time moves only when the test says so; the analysis plays at speed 4.
  await page.clock.install({ time: new Date("2026-10-14T09:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-14T09:00:01Z"));
  await page.goto("/#/runs/demo-run/overview?demo=play&speed=4&locale=en");
  const steps = demo.analysisSteps ?? [];
  expect(steps).toHaveLength(5);
  const lines = page.locator(".mission-analysis-steps li");
  const card = page.locator("#overview-purpose");
  await expect(lines).toHaveText(steps.slice(0, 1));
  await expect(page.getByRole("progressbar", { name: mission.empty.progressLabel })).toBeVisible();
  await expect(card).toHaveCount(0);
  for (let shown = 2; shown <= steps.length; shown++) {
    await page.clock.runFor(playbackTiming.analysisStep / 4);
    await expect(lines).toHaveText(steps.slice(0, shown));
  }
  await expect(card).toHaveCount(0);
  await page.clock.runFor(playbackTiming.analysisReady / 4);
  await expect(card.locator("h3")).toHaveText(demo.insights.summary);
  await expect(page.locator(".mission-analysis-steps")).toHaveCount(0);
});

test("#overview-directions and the section nav scroll to the directions and keep the route", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/runs/demo-run/overview?locale=en");
  const directions = page.locator("#overview-directions");
  await expect(directions).toBeVisible();
  await expect(directions).not.toBeInViewport();

  // A link to the anchor, as a person follows it.
  await page.evaluate(() => {
    window.location.hash = "overview-directions";
  });
  await expect(directions).toBeInViewport();
  await expect(directions).toBeFocused();
  await expect(page.locator("#workspace-tab-overview")).toHaveAttribute("aria-selected", "true");
  // The nav sticks to the top and the section starts below it.
  const nav = page.getByRole("navigation", { name: mission.sections.label });
  const navBox = (await nav.boundingBox())!;
  const box = (await directions.boundingBox())!;
  expect(navBox.y).toBeLessThanOrEqual(1);
  expect(box.y).toBeGreaterThanOrEqual(navBox.y + navBox.height - 1);

  // The nav's own link scrolls there and leaves the route in the address.
  await page.goto("/#/runs/demo-run/overview?locale=en");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(directions).not.toBeInViewport();
  const link = nav.getByRole("link", { name: mission.sections.directions });
  await link.click();
  await expect(directions).toBeInViewport();
  await expect(link).toHaveAttribute("aria-current", "location");
  await expect(page).toHaveURL(/#\/runs\/demo-run\/overview\?locale=en$/);
});

test("a repository without a run lists the directions right after the project card", async ({ page }) => {
  await page.goto("/#/repos/demo-repo?locale=en");
  await expect(page.locator("#overview-purpose")).toBeVisible();
  const ids = await page
    .locator('.mission-overview > section[id^="overview-"]')
    .evaluateAll((sections) => sections.map((section) => section.id));
  expect(ids.slice(0, 2)).toEqual(["overview-purpose", "overview-directions"]);
});

for (const width of widths)
  for (const locale of locales)
    test(`the overview's text fits at ${width} px (${locale})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const hash of ["#/runs/demo-run/overview", "#/repos/demo-repo"]) {
        await page.goto(`/${hash}?locale=${locale}`);
        await expect(page.locator("#overview-purpose")).toBeVisible();
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready);
        await expectNoOverflow(page);
      }
    });
