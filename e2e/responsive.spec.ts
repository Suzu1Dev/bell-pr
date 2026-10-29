// Every page of the screenshot set at the common widths, from a small phone
// to the smallest desktop, in English and zh-TW. On each view:
// - no text is cut off or spills out of its own box (the check that
//   expectNoOverflow makes);
// - nothing is cut off at the side: the page does not scroll sideways, and
//   no control or text runs past the window's edge or out of a box that
//   hides its overflow;
// - no control or text sticks out of the box it sits in;
// - the sample badge covers nothing in the top bar.
// The v1.1 views that take steps to reach (e2e/helpers/views.ts) are
// checked the same way on a common and the narrowest phone, and at the
// wider widths a view names where its layout changes.
// The pages show the sample project in presentation mode (`present=1`,
// `capture=1`) with the same ready setup as e2e/screenshots.spec.ts, so
// these are the views the screenshots show, between and below the captured
// widths, and the pages with the sample badge also at 320 px. Each view is
// loaded at its own width, as a phone or a tablet opens it. The run's tabs
// are also checked with the sidebar collapsed to its rail, which gives
// their panes another layout from 761 px up.
//
//   BELLPR_E2E_PORT=<port> npx playwright test e2e/responsive.spec.ts
import { expect, test, type Browser, type Page } from "@playwright/test";
import { e2eApiHeaders } from "./api-token.mjs";
import { htmlLang, locales, type Locale } from "../shared/i18n/locale";
import { findOverflow } from "./helpers/overflow";
import { startReadyServer } from "./helpers/ready-server";
import { startRealProject } from "./helpers/real-project";
import { stateViews } from "./helpers/views";
import { routes, sampleRoutes } from "./helpers/routes";
import type { LaunchedServer } from "./start-server.mjs";

/**
 * A small and a common phone, a tablet, a small laptop, the widest view
 * of the tablet layouts and the smallest desktop, with their heights.
 */
const viewports = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1100, height: 800 },
  { width: 1280, height: 800 },
];
/** The run's tabs, whose panes take another layout beside the rail. */
const runRoutes = routes.filter((route) => route.name.startsWith("run-"));
/** The widths at which the sidebar collapses to a rail (above 760 px). */
const railViewports = viewports.filter((viewport) => viewport.width > 760);

/** Relative times ("3 days ago") read the same on every run. */
const frozenAt = new Date("2026-10-14T09:00:00Z");

/** Waits until the page has rendered its data and its fonts. */
async function settled(page: Page, locale: Locale) {
  await expect(page.locator("html")).toHaveAttribute("lang", htmlLang(locale));
  await expect(page.locator("#main-content")).toBeVisible();
  await expect(page.locator(".app-starting")).toHaveCount(0);
  // Lazy views and their data: nothing is still loading.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Lists what does not fit at the side, besides the text that
 * findOverflow() finds:
 * - the page scrolling sideways;
 * - a control or text that runs past the window's edge or out of a box
 *   that hides its overflow (only the outermost of a nested group);
 * - a control or text that sticks out of the box it sits in, while that
 *   box lets its overflow show. A box with a negative side margin bleeds
 *   on purpose, and a box positioned on its own (a tooltip, a badge on a
 *   corner) is placed on purpose.
 * Content inside a box that scrolls sideways (code, tables, a row of
 * tabs) can be scrolled to and does not count, and neither does a
 * decoration without text.
 */
function findSideOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const result: string[] = [];
    const root = document.scrollingElement ?? document.documentElement;
    if (root.scrollWidth > width + 1)
      result.push(`the page scrolls sideways (${root.scrollWidth} px wide in ${width} px)`);
    const nameOf = (element: Element) =>
      [
        element.tagName.toLowerCase(),
        element.id ? `#${element.id}` : "",
        ...Array.from(element.classList, (name) => `.${name}`),
      ].join("");
    const describe = (element: Element) => {
      const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
      return text ? `${nameOf(element)} "${text}"` : nameOf(element);
    };
    const span = (rect: { left: number; right: number }) =>
      `${Math.round(rect.left)}-${Math.round(rect.right)} px`;
    const scrollsSideways = (style: CSSStyleDeclaration) =>
      style.overflowX === "auto" || style.overflowX === "scroll";
    const hidesOverflow = (style: CSSStyleDeclaration) =>
      style.overflowX === "hidden" || style.overflowX === "clip";
    const counts = (element: Element) =>
      element.matches("button, a[href], input, select, textarea, summary, [role='tab']") ||
      !!element.textContent?.trim();
    const shown = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 1 &&
        rect.height > 1 &&
        element.checkVisibility({ visibilityProperty: true })
      );
    };
    /**
     * The left and right edges that clip `element`: the window's,
     * narrowed by each ancestor that hides its overflow and holds the
     * element's box (an absolutely positioned box escapes the static
     * ancestors between it and its containing block, a fixed one all of
     * them). Undefined when an ancestor scrolls sideways.
     */
    const clipEdges = (element: Element) => {
      let left = 0;
      let right = width;
      let position = getComputedStyle(element).position;
      for (
        let parent = element.parentElement;
        parent && parent !== document.documentElement && position !== "fixed";
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (position === "absolute" && style.position === "static") continue;
        if (scrollsSideways(style)) return undefined;
        if (hidesOverflow(style)) {
          const box = parent.getBoundingClientRect();
          left = Math.max(left, box.left + parent.clientLeft);
          right = Math.min(right, box.left + parent.clientLeft + parent.clientWidth);
        }
        position = style.position;
      }
      return { left, right };
    };

    const cut: Element[] = [];
    for (const element of document.body.querySelectorAll("*")) {
      if (!counts(element) || !shown(element)) continue;
      const edges = clipEdges(element);
      const rect = element.getBoundingClientRect();
      if (!edges || (rect.left >= edges.left - 1 && rect.right <= edges.right + 1)) continue;
      if (cut.some((other) => other.contains(element))) continue;
      cut.push(element);
      result.push(
        `cut off: ${describe(element)} spans ${span(rect)}, shown ${span(edges)}`,
      );
    }

    for (const box of document.body.querySelectorAll("*")) {
      if (!shown(box)) continue;
      const style = getComputedStyle(box);
      if (style.display === "inline" || style.display === "contents") continue;
      if (scrollsSideways(style) || hidesOverflow(style)) continue;
      if (!clipEdges(box)) continue;
      const outer = box.getBoundingClientRect();
      for (const child of box.children) {
        if (!counts(child) || !shown(child)) continue;
        if (cut.some((other) => other === child || other.contains(child))) continue;
        const childStyle = getComputedStyle(child);
        if (childStyle.position === "absolute" || childStyle.position === "fixed") continue;
        if (parseFloat(childStyle.marginLeft) < 0 || parseFloat(childStyle.marginRight) < 0)
          continue;
        const rect = child.getBoundingClientRect();
        if (rect.left >= outer.left - 1 && rect.right <= outer.right + 1) continue;
        result.push(
          `sticks out: ${describe(child)} spans ${span(rect)} in ${nameOf(box)} at ${span(outer)}`,
        );
      }
    }
    return result;
  });
}

/** The top bar's text, buttons and links that the sample badge covers. */
function findCoveredByBadge(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const badge = document.querySelector(".presentation-sample-badge");
    const bar = document.querySelector(".topbar");
    if (!badge || !bar) return [];
    const box = badge.getBoundingClientRect();
    const overlaps = (rect: DOMRect) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left < box.right &&
      rect.right > box.left &&
      rect.top < box.bottom &&
      rect.bottom > box.top;
    const result: string[] = [];
    const range = document.createRange();
    const texts = document.createTreeWalker(bar, NodeFilter.SHOW_TEXT);
    for (let node = texts.nextNode(); node; node = texts.nextNode()) {
      if (badge.contains(node) || !node.textContent?.trim()) continue;
      range.selectNodeContents(node);
      if (Array.from(range.getClientRects()).some(overlaps))
        result.push(node.textContent.trim());
    }
    for (const control of bar.querySelectorAll("button, a"))
      if (overlaps(control.getBoundingClientRect()))
        result.push(control.getAttribute("aria-label") ?? control.textContent ?? "");
    return result;
  });
}

/** A server whose setup looks ready, as in the screenshots. */
const startServer = startReadyServer;

/**
 * Opens `hash` at `viewport` and fails with every problem it finds. With
 * `collapsed` the sidebar is a rail, as the browser remembers it after
 * the person collapsed it.
 */
async function expectFits(
  browser: Browser,
  server: LaunchedServer,
  locale: Locale,
  hash: string,
  viewport: { width: number; height: number },
  sample: boolean,
  {
    collapsed = false,
    drive,
  }: {
    collapsed?: boolean;
    /** Takes the opened page to a view that needs steps (e2e/helpers/views.ts). */
    drive?: (page: Page, locale: Locale) => Promise<void>;
  } = {},
) {
  const context = await browser.newContext({
    extraHTTPHeaders: e2eApiHeaders,
    baseURL: server.baseURL,
    locale: "en-US",
    timezoneId: "UTC",
    viewport,
  });
  try {
    if (collapsed)
      await context.addInitScript(() =>
        localStorage.setItem("bellpr-sidebar-collapsed", "true"),
      );
    const page = await context.newPage();
    await page.clock.setFixedTime(frozenAt);
    const [path, query] = hash.split("?");
    await page.goto(`/${path}?${query ? `${query}&` : ""}present=1&capture=1&locale=${locale}`);
    await settled(page, locale);
    if (drive) {
      await drive(page, locale);
      await page.evaluate(() => document.fonts.ready);
    }
    if (collapsed) await expect(page.locator(".app-shell")).toHaveClass(/is-sidebar-collapsed/);
    if (sample) await expect(page.locator(".presentation-sample-badge")).toBeVisible();
    const problems = [
      ...(await findOverflow(page)).map(
        (problem) =>
          `${problem.reason}: ${problem.element} "${problem.text}" (${problem.scrollWidth}×${problem.scrollHeight} in ${problem.clientWidth}×${problem.clientHeight})`,
      ),
      ...(await findSideOverflow(page)),
      ...(await findCoveredByBadge(page)).map(
        (covered) => `the sample badge covers "${covered}"`,
      ),
    ];
    expect(problems, `${hash} in ${locale} at ${viewport.width} px`).toEqual([]);
  } finally {
    await context.close();
  }
}

test.describe.configure({ mode: "parallel" });

test.describe("every page", () => {
  let server: LaunchedServer | undefined;
  test.beforeAll(async () => {
    server = await startServer();
  });
  test.afterAll(async () => {
    await server?.stop();
  });

  for (const locale of locales)
    for (const route of routes)
      for (const viewport of viewports)
        test(`${route.name} in ${locale} fits at ${viewport.width} px`, async ({ browser }) => {
          await expectFits(
            browser,
            server!,
            locale,
            route.hash,
            viewport,
            sampleRoutes.test(route.name),
          );
        });

  // The run's five tabs and the +/− totals beside them never touch, and the
  // review-mode label shows only where the row has room for it.
  for (const locale of locales)
    test(`the run's tabs keep clear of the totals in ${locale}`, async ({ browser }) => {
      for (const width of [900, 1024, 1100, 1181, 1280, 1440]) {
        const context = await browser.newContext({
          extraHTTPHeaders: e2eApiHeaders,
          baseURL: server!.baseURL,
          viewport: { width, height: 800 },
        });
        try {
          const page = await context.newPage();
          await page.goto(`/#/runs/demo-run/changes?present=1&capture=1&locale=${locale}`);
          await settled(page, locale);
          const row = await page.evaluate(() => {
            const bar = document.querySelector(".review-toolbar")!;
            const tab = [...document.querySelectorAll(".review-tabs > button")].at(-1)!;
            const totals = document.querySelector(".review-totals")!;
            return {
              gap: totals.getBoundingClientRect().left - tab.getBoundingClientRect().right,
              cut: bar.scrollWidth - bar.clientWidth,
              label: getComputedStyle(totals.lastElementChild!).display !== "none",
            };
          });
          expect(row.gap, `${locale} at ${width} px`).toBeGreaterThanOrEqual(16);
          if (row.label) expect(row.cut, `${locale} at ${width} px`).toBe(0);
        } finally {
          await context.close();
        }
      }
    });

  for (const locale of locales)
    for (const route of runRoutes)
      for (const viewport of railViewports)
        test(`${route.name} in ${locale} fits at ${viewport.width} px with the sidebar collapsed`, async ({
          browser,
        }) => {
          await expectFits(browser, server!, locale, route.hash, viewport, true, {
            collapsed: true,
          });
        });
});

// The narrowest common phone: the sample badge shares the top bar with the
// page name, the quick switch and the profile button.
test.describe("at 320 px with the sample badge", () => {
  let server: LaunchedServer | undefined;
  test.beforeAll(async () => {
    server = await startServer();
  });
  test.afterAll(async () => {
    await server?.stop();
  });

  for (const locale of locales)
    for (const route of routes.filter((entry) => sampleRoutes.test(entry.name)))
      test(`${route.name} in ${locale} fits at 320 px`, async ({ browser }) => {
        await expectFits(browser, server!, locale, route.hash, { width: 320, height: 640 }, true);
      });
});

// The v1.1 views that take steps to reach (e2e/helpers/views.ts), on a
// common and the narrowest phone.
const phones = [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
];

test.describe("the v1.1 views on phones", () => {
  let server: LaunchedServer | undefined;
  test.beforeAll(async () => {
    server = await startServer();
  });
  test.afterAll(async () => {
    await server?.stop();
  });

  for (const locale of locales)
    for (const view of stateViews.filter((entry) => !entry.real))
      for (const viewport of phones)
        test(`${view.name} in ${locale} fits at ${viewport.width} px`, async ({ browser }) => {
          await expectFits(browser, server!, locale, view.route, viewport, view.route.startsWith("#/runs/"), {
            drive: view.drive,
          });
        });
});

for (const view of stateViews.filter((entry) => entry.real))
  test.describe(`${view.name} on a real run, on phones`, () => {
    let project: LaunchedServer | undefined;
    test.beforeAll(async () => {
      project = await startRealProject(view.real);
    });
    test.afterAll(async () => {
      await project?.stop();
    });
    for (const locale of locales)
      for (const viewport of [...phones, ...(view.wider ?? [])])
        test(`${view.name} in ${locale} fits at ${viewport.width} px`, async ({ browser }) => {
          await expectFits(browser, project!, locale, view.route, viewport, false, { drive: view.drive });
        });
  });
