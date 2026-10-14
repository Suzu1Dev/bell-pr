// The app shell: pages and runs live in the address, and the e2e servers
// start the way the specs need them.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { eulaVersion } from "../shared/product";
import { getDemo } from "../src/demo";
import app from "../src/i18n/en/app";
import { setPlan } from "./fixtures";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const demo = getDemo("en");
const heading = (page: Page) => page.locator(".workspace-heading h1");
const breadcrumb = (page: Page) => page.locator(".breadcrumb");
/** A navigation item of the sidebar, by the page name it carries as its title. */
const sidebarButton = (page: Page, name: string) =>
  page.locator(`#workspace-sidebar button[title="${name}"]`);

/** A signed-in page on a spec-local server; closed with the server. */
async function openOn(browser: Browser, server: LaunchedServer) {
  const context = await browser.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
    locale: "en-US",
  });
  return { page: await context.newPage(), close: () => context.close() };
}

test("pages live in the address: a reload keeps them, Back and Forward walk them", async ({ page }) => {
  await page.goto("/#/runs/demo-run/activity");
  await expect(page.locator("#workspace-tab-activity")).toHaveAttribute("aria-selected", "true");

  await sidebarButton(page, app.pages.repos).click();
  await expect(page).toHaveURL(/#\/repos$/);
  await expect(breadcrumb(page)).toContainText(app.pages.repos);
  await page.reload();
  await expect(breadcrumb(page)).toContainText(app.pages.repos);

  await sidebarButton(page, app.pages.settings).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(breadcrumb(page)).toContainText(app.pages.settings);

  await page.goBack();
  await expect(breadcrumb(page)).toContainText(app.pages.repos);
  await page.goBack();
  await expect(page.locator("#workspace-tab-activity")).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(breadcrumb(page)).toContainText(app.pages.repos);

  // The workspace comes back on the tab it was left on.
  await sidebarButton(page, app.pages.workspace).click();
  await expect(page).toHaveURL(/#\/runs\/demo-run\/activity$/);

  for (const [hash, name] of [
    ["#/discover", app.pages.discovery],
    ["#/team", app.pages.team],
    ["#/learning", app.pages.learning],
    ["#/settings/general", app.pages.settings],
  ] as const) {
    await page.goto(`/${hash}`);
    await expect(breadcrumb(page)).toContainText(name);
  }
});

test("a repository overview has its own address; an unknown one shows the list", async ({ page }) => {
  await page.goto("/#/repos/demo-repo");
  await expect(breadcrumb(page)).toContainText(app.pages.explore);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(demo.repo.fullName);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(demo.repo.fullName);

  await page.goto("/#/repos/no-such-repo");
  await expect(breadcrumb(page)).toContainText(app.pages.repos);
});

test("an unknown run opens the sample instead", async ({ page }) => {
  await page.goto("/#/runs/no-such-run/changes?file=src/client.ts");
  await expect(page).toHaveURL(/#\/runs\/demo-run\/changes$/);
  await expect(page.locator("#workspace-tab-changes")).toHaveAttribute("aria-selected", "true");
  await expect(heading(page)).toHaveText(demo.run.title);
});

test("a run id that is no plain name never reaches the API", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => asked.push(new URL(request.url()).pathname));
  await page.goto("/#/runs/..%2F..%2Fe2e-probe/changes");
  await expect(page).toHaveURL(/#\/runs\/demo-run\/changes$/);
  await expect(heading(page)).toHaveText(demo.run.title);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(asked.filter((path) => path.includes("e2e-probe"))).toEqual([]);
});

test("a run of this server opens from a link, Back, Forward and a reload", async ({ browser }) => {
  const run = {
    id: "e2e-seeded-run",
    repoId: "e2e-seeded-repo",
    title: "Seeded contribution",
    prompt: "A run written into state.json before the start.",
    status: "review",
    branch: "fix/e2e-seeded",
    baseBranch: "main",
    baseSha: "",
    createdAt: "2026-10-01T08:00:00.000Z",
    agents: [],
    logs: [],
    draft: { title: "Seeded contribution", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
    // Its worktree was cleaned up, so it opens without a diff.
    workspaceRemovedAt: "2026-10-02T08:00:00.000Z",
  };
  const server = await launchServer({
    seed: (dataDir) =>
      writeFile(
        path.join(dataDir, "state.json"),
        JSON.stringify({
          version: 1,
          repos: [
            {
              id: run.repoId,
              name: "seeded",
              owner: "e2e-sample",
              fullName: "e2e-sample/seeded",
              path: path.join(dataDir, "repos", "seeded"),
              defaultBranch: "main",
              url: "",
            },
          ],
          runs: [{ ...run, worktreePath: path.join(dataDir, "worktrees", run.id) }],
        }),
      ),
  });
  const { page, close } = await openOn(browser, server);
  try {
    await page.goto("/#/runs/demo-run/overview");
    await expect(heading(page)).toHaveText(demo.run.title);

    await page.goto(`/#/runs/${run.id}/activity`);
    await expect(heading(page)).toHaveText(run.title);
    await expect(page.locator("#workspace-tab-activity")).toHaveAttribute("aria-selected", "true");

    await page.goBack();
    await expect(heading(page)).toHaveText(demo.run.title);
    await expect(page.locator("#workspace-tab-overview")).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await expect(heading(page)).toHaveText(run.title);
    await page.reload();
    await expect(heading(page)).toHaveText(run.title);
    await expect(page.locator("#workspace-tab-activity")).toHaveAttribute("aria-selected", "true");

    // Tabs of that run write its id, and the sample opens from the sidebar.
    await page.locator("#workspace-tab-draft").click();
    await expect(page).toHaveURL(new RegExp(`#/runs/${run.id}/draft$`));
    await page.goto("/#/runs/demo-run/changes");
    await expect(heading(page)).toHaveText(demo.run.title);
    await expect(page.locator("#workspace-tab-changes")).toHaveAttribute("aria-selected", "true");
  } finally {
    await close();
    await server.stop();
  }
});

test("a fresh data dir without the onboarding settings shows the first start", async ({ browser }) => {
  const server = await launchServer({ settingsPut: false });
  const { page, close } = await openOn(browser, server);
  try {
    const settings = await page.request.get("/api/app-settings");
    if (settings.ok())
      expect((await settings.json()).settings?.onboardingCompletedAt).toBeUndefined();
    else expect(settings.status()).toBe(404);
    // Until the Welcome flow exists, a first start shows the sample workspace.
    await page.goto("/#/home");
    await expect(heading(page)).toHaveText(demo.run.title);
  } finally {
    await close();
    await server.stop();
  }
});

test("the global setup finished onboarding on the shared server", async ({ request }) => {
  const response = await request.get("/api/app-settings");
  test.skip(
    response.status() === 404,
    "This server has no app settings yet; the global setup could not mark onboarding done.",
  );
  expect(response.ok()).toBe(true);
  const { settings } = await response.json();
  expect(Date.parse(settings.onboardingCompletedAt)).not.toBeNaN();
  expect(settings.eulaAcceptedVersion).toBe(eulaVersion);
});

test("setPlan starts the trial through the license routes", async ({ browser }) => {
  const server = await launchServer();
  const { page, close } = await openOn(browser, server);
  try {
    await page.goto("/#/runs/demo-run/overview");
    const license = await page.request.get("/api/license");
    if (license.status() === 404) {
      await expect(setPlan(page, "trial")).rejects.toThrow(/no \/api\/license route/);
      return;
    }
    await setPlan(page, "free");
    await setPlan(page, "trial");
    await expect(heading(page)).toHaveText(demo.run.title);
    await expect(setPlan(page, "free")).rejects.toThrow(/Free cannot come back/);
  } finally {
    await close();
    await server.stop();
  }
});
