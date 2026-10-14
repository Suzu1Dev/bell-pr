// Every page of the screenshot set at the common widths, from a small phone
// to the smallest desktop, in English and zh-TW. On each view:
// - no text is cut off or spills out of its own box (the check that
//   expectNoOverflow makes);
// - nothing is cut off at the side: the page does not scroll sideways, and
//   no control or text runs past the window's edge or out of a box that
//   hides its overflow;
// - no control or text sticks out of the box it sits in;
// - the sample badge covers nothing in the top bar.
// The pages show the sample project in presentation mode (`present=1`,
// `capture=1`) with the same ready setup as e2e/screenshots.spec.ts, so
// these are the views the screenshots show, between and below the captured
// widths. Each view is loaded at its own width, as a phone or a tablet
// opens it. Home is also checked on the 14-day trial, whose plan chip in
// the sidebar is the widest.
//
//   BELLPR_E2E_PORT=<port> npx playwright test e2e/responsive.spec.ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, request, test, type Browser, type Page } from "@playwright/test";
import { htmlLang, locales, type Locale } from "../shared/i18n/locale";
import { settingsSections } from "../src/settings/sections";
import { findOverflow } from "./helpers/overflow";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

/**
 * The routes of e2e/screenshots.spec.ts. A spec cannot import another
 * spec, so the list is repeated here: keep the two in step.
 */
const routes: { name: string; hash: string }[] = [
  { name: "home", hash: "#/home" },
  { name: "run-overview", hash: "#/runs/demo-run/overview" },
  { name: "run-changes", hash: "#/runs/demo-run/changes" },
  { name: "run-activity", hash: "#/runs/demo-run/activity" },
  { name: "run-draft", hash: "#/runs/demo-run/draft" },
  { name: "repos", hash: "#/repos" },
  { name: "repo-overview", hash: "#/repos/demo-repo" },
  { name: "discover", hash: "#/discover" },
  { name: "team", hash: "#/team" },
  { name: "learning", hash: "#/learning" },
  ...settingsSections.map((section) => ({
    name: `settings-${section}`,
    hash: `#/settings/${section}`,
  })),
  { name: "about", hash: "#/about" },
];

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
/** The routes that show the sample project, so present=1 shows its badge. */
const sampleRoutes = /^(run-.+|repo-overview)$/;

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

/** Stand-ins that answer the doctor's probes; every other call fails. */
const standIns = {
  codex: `case "$1" in
  --version) echo "codex-cli 0.159.0" ;;
  login) echo "Logged in using ChatGPT" ;;
  *) exit 1 ;;
esac`,
  claude: `case "$1" in
  --version) echo "2.1.292 (Claude Code)" ;;
  auth) echo '{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "pro"}' ;;
  *) exit 1 ;;
esac`,
  gh: `case "$1" in
  --version) echo "gh version 2.46.0 (2024-03-13)" ;;
  auth) echo "gho_sample" ;;
  api) printf 'HTTP/2.0 200 OK\r\nX-Oauth-Scopes: repo, workflow, read:org\r\n\r\nsample-contributor\n1\n' ;;
  *) exit 1 ;;
esac`,
};

/** Starts the 14-day trial on `server`, as the trial button does. */
async function startTrial(server: LaunchedServer) {
  const context = await request.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
  });
  try {
    const response = await context.post("/api/license/trial", { data: {} });
    if (!response.ok())
      throw new Error(`POST /api/license/trial answered ${response.status()}.`);
  } finally {
    await context.dispose();
  }
}

/**
 * A server whose setup looks ready, as in the screenshots, on Free or on
 * the trial. Its stop() also removes the stand-ins.
 */
async function startServer({ trial = false } = {}): Promise<LaunchedServer> {
  const tools = await mkdtemp(path.join(os.tmpdir(), "bellpr-responsive-"));
  const removeTools = () => rm(tools, { recursive: true, force: true });
  let server: LaunchedServer | undefined;
  try {
    for (const [name, body] of Object.entries(standIns))
      await writeFile(path.join(tools, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    const gitconfig = path.join(tools, "gitconfig");
    await writeFile(gitconfig, "[user]\n\tname = Sample Contributor\n\temail = contributor@example.com\n");
    server = await launchServer({
      env: {
        PATH: [tools, process.env.PATH].filter(Boolean).join(path.delimiter),
        GIT_CONFIG_GLOBAL: gitconfig,
      },
    });
    if (trial) await startTrial(server);
  } catch (error) {
    await server?.stop();
    await removeTools();
    throw error;
  }
  const { stop } = server;
  return {
    ...server,
    stop: async () => {
      await stop();
      await removeTools();
    },
  };
}

/** Opens `hash` at `viewport` and fails with every problem it finds. */
async function expectFits(
  browser: Browser,
  server: LaunchedServer,
  locale: Locale,
  hash: string,
  viewport: { width: number; height: number },
  sample: boolean,
) {
  const context = await browser.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
    locale: "en-US",
    timezoneId: "UTC",
    viewport,
  });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(frozenAt);
    await page.goto(`/${hash}?present=1&capture=1&locale=${locale}`);
    await settled(page, locale);
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
});

// The trial's chip ("TRIAL · 14d") is the widest plan chip in the sidebar.
test.describe("on the 14-day trial", () => {
  let server: LaunchedServer | undefined;
  test.beforeAll(async () => {
    server = await startServer({ trial: true });
  });
  test.afterAll(async () => {
    await server?.stop();
  });

  for (const locale of locales)
    for (const viewport of viewports)
      test(`home in ${locale} fits at ${viewport.width} px`, async ({ browser }) => {
        await expectFits(browser, server!, locale, "#/home", viewport, false);
      });
});
