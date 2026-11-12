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
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { e2eApiHeaders } from "./api-token.mjs";
import { messages } from "./helpers/messages";
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
 * Content counts as reachable only inside a box that is meant to scroll
 * sideways on its own: that box has overflow-x auto or scroll, and a
 * keyboard user can reach it (code, a wide table, a row of tabs). Any
 * other overflow:auto ancestor hides the overflow, so it counts. A
 * decoration without text does not.
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
    /** In the tab order, so the keyboard can move this box. */
    const keyboardReachable = (element: Element) => {
      if (!(element instanceof HTMLElement) || element.matches(":disabled")) return false;
      const attr = element.getAttribute("tabindex");
      if (attr !== null) {
        const index = Number(attr);
        return Number.isInteger(index) && index >= 0;
      }
      return element.matches(
        "a[href], button, input:not([type='hidden']), select, textarea, summary",
      );
    };
    /**
     * The box itself scrolls sideways and the keyboard can move it: the box
     * is in the tab order, or a roving tab stop inside it is.
     */
    const scrollsOnPurpose = (element: Element) =>
      scrollsSideways(getComputedStyle(element)) &&
      (keyboardReachable(element) || element.querySelector("[tabindex='0']") !== null);
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
     * narrowed by each ancestor that hides its overflow, or that scrolls
     * sideways without a keyboard stop on it or inside it, and holds the element's
     * box (an absolutely positioned box escapes the static ancestors
     * between it and its containing block, a fixed one all of them).
     * Undefined when an ancestor is meant to scroll sideways on its own.
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
        if (scrollsOnPurpose(parent)) return undefined;
        if (hidesOverflow(style) || scrollsSideways(style)) {
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
        // A negative side margin may bleed by that margin and no further.
        const bleedLeft = Math.min(0, parseFloat(childStyle.marginLeft) || 0);
        const bleedRight = Math.min(0, parseFloat(childStyle.marginRight) || 0);
        const rect = child.getBoundingClientRect();
        if (
          rect.left >= outer.left + bleedLeft - 1 &&
          rect.right <= outer.right - bleedRight + 1
        )
          continue;
        result.push(
          `sticks out: ${describe(child)} spans ${span(rect)} (${child.scrollWidth} px wide) in ${nameOf(box)} at ${span(outer)}`,
        );
      }
    }

    // A box that does not scroll still has overflow when its content is
    // wider than the box. A purposeful sideways scroller is exempt.
    for (const element of document.body.querySelectorAll("*")) {
      if (!(element instanceof HTMLElement) || !shown(element) || !counts(element)) continue;
      if (getComputedStyle(element).overflowX !== "visible") continue;
      if (element.scrollWidth <= element.clientWidth + 1) continue;
      if (!clipEdges(element)) continue;
      result.push(
        `wider than its box: ${nameOf(element)} is ${element.scrollWidth} px wide in ${element.clientWidth} px`,
      );
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
    after,
    dialogOnly = false,
  }: {
    collapsed?: boolean;
    /** Takes the opened page to a view that needs steps (e2e/helpers/views.ts). */
    drive?: (page: Page, locale: Locale) => Promise<void>;
    /** Extra checks on the opened page, after the fit check. */
    after?: (page: Page) => Promise<void>;
    /** Skip the page-wide overflow list and run only `after`. */
    dialogOnly?: boolean;
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
    if (!dialogOnly) {
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
    }
    if (after) await after(page);
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

// With another BELL product linked, the product switcher's button joins
// the top bar where the sidebar is a drawer. Below 390 px the sample badge
// leaves it no room, so it shows from 390 px up.
test.describe("with the product switcher beside the sample badge", () => {
  let server: LaunchedServer | undefined;
  test.beforeAll(async () => {
    server = await startServer({ env: { BELLPR_SUITE_LINKS: "explain=http://localhost:5173" } });
  });
  test.afterAll(async () => {
    await server?.stop();
  });

  for (const locale of locales)
    for (const route of routes.filter((entry) => sampleRoutes.test(entry.name)))
      for (const viewport of [{ width: 320, height: 640 }, ...viewports.slice(0, 2)])
        test(`${route.name} in ${locale} fits at ${viewport.width} px`, async ({ browser }) => {
          await expectFits(browser, server!, locale, route.hash, viewport, true, {
            async drive(page) {
              const trigger = page.locator(".breadcrumb .suite-trigger");
              await expect(trigger).toHaveCount(1);
              await expect(trigger).toBeVisible({ visible: viewport.width >= 390 });
            },
          });
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

/** The publish dialog stays inside the viewport. The title wraps. Only the
 * body preview stays preformatted and may scroll inside its own box. */
async function expectPublishBodyScrolls(page: Page) {
  const measured = await page.evaluate(() => {
    const outgoing = document.querySelector(".publish-outgoing");
    const modal = document.querySelector(".modal");
    const pres = [...document.querySelectorAll(".publish-outgoing pre")];
    if (!(outgoing instanceof HTMLElement) || !(modal instanceof HTMLElement) || pres.length < 3)
      return null;
    const measure = (element: HTMLElement) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
      whiteSpace: getComputedStyle(element).whiteSpace,
      overflowX: getComputedStyle(element).overflowX,
      overflowWrap: getComputedStyle(element).overflowWrap,
    });
    const title = pres[0] as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(title);
    const titleBox = title.getBoundingClientRect();
    const clipped = [...range.getClientRects()].some(
      (rect) => rect.width > 0 && (rect.right > titleBox.right + 1 || rect.left < titleBox.left - 1),
    );
    return {
      outgoing: measure(outgoing),
      modal: measure(modal),
      title: { ...measure(title), clipped, text: (title.textContent ?? "").replace(/\s+/g, " ").trim() },
      commit: measure(pres[1] as HTMLElement),
      body: measure(pres[2] as HTMLElement),
    };
  });
  expect(measured, "the publish dialog shows the draft").not.toBeNull();
  if (!measured) return;
  const dx = (name: string, box: { scroll: number; client: number }) =>
    `${name} ${box.scroll} px in ${box.client} px (dx=${box.scroll - box.client})`;
  expect.soft(measured.outgoing.scroll, dx("publish-outgoing", measured.outgoing)).toBeLessThanOrEqual(measured.outgoing.client);
  expect.soft(measured.modal.scroll, dx("modal", measured.modal)).toBeLessThanOrEqual(measured.modal.client);
  expect.soft(
    measured.title.scroll,
    `${dx("title", measured.title)}; clipped=${measured.title.clipped}; "${measured.title.text}"`,
  ).toBeLessThanOrEqual(measured.title.client);
  expect.soft(measured.title.clipped, measured.title.text).toBe(false);
  expect.soft(measured.title.whiteSpace).toBe("pre-wrap");
  expect.soft(measured.title.overflowWrap).toBe("break-word");
  expect.soft(measured.commit.scroll, dx("commit", measured.commit)).toBeLessThanOrEqual(measured.commit.client);
  expect.soft(measured.commit.whiteSpace).toBe("pre-wrap");
  expect.soft(measured.body.whiteSpace).toBe("pre");
  expect.soft(measured.body.overflowX).toBe("auto");
  if (measured.body.scroll > measured.body.client) {
    const moved = await page.locator(".publish-body-preview pre").evaluate((pre) => {
      pre.scrollLeft = 0;
      const before = pre.scrollLeft;
      pre.scrollLeft = 40;
      return pre.scrollLeft > before;
    });
    expect(moved).toBe(true);
  }
}

for (const view of stateViews.filter((entry) => entry.real))
  test.describe(`${view.name} on a real run, on phones`, () => {
    let project: LaunchedServer | undefined;
    test.beforeAll(async () => {
      project = await startRealProject(view.real);
    });
    test.afterAll(async () => {
      await project?.stop();
    });
    const dialogWidths = [
      { width: 320, height: 640 },
      { width: 375, height: 812 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ];
    // 768 and 1280 already ellipsize the sidebar title; only the dialog is
    // measured there. 320, 375 and 390 keep the page-wide fit check.
    const wideDialog = new Set([768, 1280]);
    const viewports = [
      ...phones,
      ...(view.name === "publish-groups" ? dialogWidths : []),
      ...(view.wider ?? []),
    ].filter((entry, index, all) => all.findIndex((other) => other.width === entry.width) === index);
    for (const locale of locales)
      for (const viewport of viewports)
        test(`${view.name} in ${locale} fits at ${viewport.width} px`, async ({ browser }) => {
          const dialog = view.name === "publish-groups" && dialogWidths.some((entry) => entry.width === viewport.width);
          await expectFits(browser, project!, locale, view.route, viewport, false, {
            drive: view.drive,
            ...(dialog ? { after: expectPublishBodyScrolls } : {}),
            ...(dialog && wideDialog.has(viewport.width) ? { dialogOnly: true } : {}),
          });
        });
  });

/** RGBA pixels of an 8-bit PNG screenshot (Playwright's). */
function pngPixels(png: Buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let color = 6;
  const parts: Buffer[] = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      color = data[9];
    } else if (type === "IDAT") parts.push(Buffer.from(data));
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = color === 2 ? 3 : 4;
  const raw = inflateSync(Buffer.concat(parts));
  const out = Buffer.alloc(width * height * channels);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = y * width * channels;
    const prev = row - width * channels;
    for (let i = 0; i < width * channels; i++) {
      const left = i >= channels ? out[row + i - channels] : 0;
      const up = y > 0 ? out[prev + i] : 0;
      const upLeft = y > 0 && i >= channels ? out[prev + i - channels] : 0;
      const value = raw[src++];
      let decoded = value;
      if (filter === 1) decoded = (value + left) & 255;
      else if (filter === 2) decoded = (value + up) & 255;
      else if (filter === 3) decoded = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const towardLeft = Math.abs(estimate - left);
        const towardUp = Math.abs(estimate - up);
        const towardUpLeft = Math.abs(estimate - upLeft);
        const pred = towardLeft <= towardUp && towardLeft <= towardUpLeft ? left
          : towardUp <= towardUpLeft ? up
          : upLeft;
        decoded = (value + pred) & 255;
      }
      out[row + i] = decoded;
    }
  }
  return { width, height, data: out, channels };
}

/** Mean luminance of a rectangle in a screenshot. */
function luminance(png: Buffer, x0: number, x1: number, y0: number, y1: number) {
  const { width, data, channels } = pngPixels(png);
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * channels;
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      count += 1;
    }
  return sum / count;
}

// The description keeps long lines and scrolls them. At 320 a fade sits on
// the side that still has more, and it is gone once that side is scrolled
// to the end. The fade is a background, so it does not take the keyboard.
test.describe("the publish body preview at 320 px", () => {
  let server: LaunchedServer | undefined;
  test.beforeAll(async () => {
    server = await startServer({
      seed: (dataDir) =>
        writeFile(
          path.join(dataDir, "app-settings.json"),
          JSON.stringify({ skipUnderstandingCheck: true }),
        ),
    });
  });
  test.afterAll(async () => {
    await server?.stop();
  });

  for (const locale of locales)
    test(`the description shows that it scrolls in ${locale}`, async ({ browser }) => {
      const context = await browser.newContext({
        extraHTTPHeaders: e2eApiHeaders,
        baseURL: server!.baseURL,
        locale: "en-US",
        timezoneId: "UTC",
        viewport: { width: 320, height: 700 },
        deviceScaleFactor: 1,
      });
      try {
        const page = await context.newPage();
        const copy = messages[locale];
        await page.goto(`/#/runs/demo-run/changes?present=1&capture=1&locale=${locale}`);
        await settled(page, locale);
        const files = page.locator(".file-item");
        for (let index = 0; index < (await files.count()); index++) {
          await files.nth(index).click();
          await page.getByRole("checkbox", { name: copy.review.diff.reviewed }).check();
        }
        await page.getByRole("button", { name: copy.workspace.footer.approvePr }).click();
        const dialog = page.getByRole("dialog", { name: copy.workspace.publish.titleDemo });
        const pre = dialog.locator(".publish-body-preview pre");
        await expect(pre).toBeVisible();
        const box = await pre.evaluate((element) => ({
          scroll: element.scrollWidth,
          client: element.clientWidth,
          overflowX: getComputedStyle(element).overflowX,
          attachment: getComputedStyle(element).backgroundAttachment,
        }));
        expect(box.scroll).toBeGreaterThan(box.client + 1);
        expect(box.overflowX).toBe("auto");
        expect(box.attachment).toContain("local");
        await dialog.locator("button").first().focus();
        for (let step = 0; step < 30 && !(await pre.evaluate((element) => element === document.activeElement)); step++)
          await page.keyboard.press("Tab");
        await expect(pre).toBeFocused();
        const ring = await pre.evaluate((element) => getComputedStyle(element).boxShadow);
        expect(ring).toContain("inset");
        const start = await pre.evaluate((element) => element.scrollLeft);
        await page.keyboard.press("ArrowRight");
        expect(await pre.evaluate((element) => element.scrollLeft)).toBeGreaterThan(start);
        await pre.evaluate((element) => {
          element.scrollLeft = 0;
        });
        const atStart = await pre.screenshot();
        await pre.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
        });
        const atEnd = await pre.screenshot();
        const edge = (shot: Buffer) => {
          const { width } = pngPixels(shot);
          return luminance(shot, width - 10, width - 2, 2, 10) - luminance(shot, Math.floor(width / 2) - 4, Math.floor(width / 2) + 4, 2, 10);
        };
        const startEdge = edge(atStart);
        const endEdge = edge(atEnd);
        // The trailing fade is darker than the padding beside it, and it
        // leaves once the line is scrolled to its end.
        expect(startEdge, `fade at the start (${startEdge})`).toBeLessThan(-8);
        expect(endEdge, `fade at the end (${endEdge}), start was ${startEdge}`).toBeGreaterThan(-3);
      } finally {
        await context.close();
      }
    });
});
