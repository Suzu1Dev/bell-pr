// The app shell: the first start and the license agreement, Home, pages
// and runs in the address, titles, the plan, presentation masking, About,
// and the e2e servers starting the way the specs need them.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { locales } from "../shared/i18n/locale";
import { eulaVersion, product } from "../shared/product";
import { getDemo } from "../src/demo";
import { localeStorageKey } from "../src/i18n";
import about from "../src/i18n/en/about";
import app from "../src/i18n/en/app";
import home from "../src/i18n/en/home";
import modals from "../src/i18n/en/modals";
import onboarding from "../src/i18n/en/onboarding";
import repos from "../src/i18n/en/repos";
import workspace from "../src/i18n/en/workspace";
import appZh from "../src/i18n/zh-TW/app";
import { setPlan, switchLocale } from "./fixtures";
import { expectNoOverflow } from "./helpers/overflow";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const demo = getDemo("en");
const heading = (page: Page) => page.locator(".workspace-heading h1");
const breadcrumb = (page: Page) => page.locator(".breadcrumb");
const homeHeading = (page: Page) => page.locator(".home-page h1");
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

/** A repository and two runs written into state.json before the start. */
function seededState(dataDir: string) {
  const repo = {
    id: "e2e-seeded-repo",
    name: "seeded",
    owner: "e2e-sample",
    fullName: "e2e-sample/seeded",
    path: path.join(dataDir, "repos", "seeded"),
    defaultBranch: "main",
    url: "",
  };
  const run = (id: string, title: string, createdAt: string) => ({
    id,
    repoId: repo.id,
    title,
    prompt: "A run written into state.json before the start.",
    status: "review",
    branch: `fix/${id}`,
    baseBranch: "main",
    baseSha: "",
    createdAt,
    agents: [],
    logs: [],
    draft: { title, body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
    worktreePath: path.join(dataDir, "worktrees", id),
  });
  return {
    repo,
    runs: [
      // Its worktree was cleaned up, so it opens without a diff.
      {
        ...run("e2e-seeded-run", "Seeded contribution", "2026-10-01T08:00:00.000Z"),
        workspaceRemovedAt: "2026-10-02T08:00:00.000Z",
      },
      run("e2e-seeded-files", "Seeded with files", "2026-10-03T08:00:00.000Z"),
    ],
  };
}

async function seed(dataDir: string) {
  const { repo, runs } = seededState(dataDir);
  await writeFile(
    path.join(dataDir, "state.json"),
    JSON.stringify({ version: 1, repos: [repo], runs }),
  );
}

test("an empty or unknown address opens Home, which the navigation marks", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/#\/home$/);
  await expect(homeHeading(page)).toHaveText(home.tagline);
  await expect(sidebarButton(page, app.pages.home)).toHaveAttribute("aria-current", "page");
  await expect(page.locator('#workspace-sidebar [aria-current="page"]')).toHaveCount(1);
  await expect(breadcrumb(page)).toContainText(app.pages.home);

  // An unknown path goes Home too, and keeps its flags.
  await page.goto("/#/nowhere?locale=en");
  await expect(page).toHaveURL(/#\/home\?locale=en$/);
  await expect(homeHeading(page)).toHaveText(home.tagline);

  await sidebarButton(page, app.pages.repos).click();
  await expect(sidebarButton(page, app.pages.repos)).toHaveAttribute("aria-current", "page");
  await expect(sidebarButton(page, app.pages.home)).not.toHaveAttribute("aria-current", "page");
});

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

test("the deep link #/settings survives a reload, and Back returns to the page before", async ({ page }) => {
  await page.goto("/#/repos");
  await expect(breadcrumb(page)).toContainText(app.pages.repos);
  await page.goto("/#/settings");
  await expect(breadcrumb(page)).toContainText(app.pages.settings);
  await page.reload();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(breadcrumb(page)).toContainText(app.pages.settings);
  await expect(sidebarButton(page, app.pages.settings)).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page).toHaveURL(/#\/repos$/);
  await expect(breadcrumb(page)).toContainText(app.pages.repos);
});

test("the document title names each page, also after the language changes", async ({ page }) => {
  const suffix = ` — ${product.name}`;
  for (const [hash, title] of [
    ["#/home", app.title],
    ["#/repos", `${app.pages.repos}${suffix}`],
    ["#/settings", `${app.pages.settings}${suffix}`],
    ["#/discover", `${app.pages.discovery}${suffix}`],
    ["#/runs/demo-run/changes", `${workspace.tabs.changes} · ${demo.repo.fullName}${suffix}`],
    ["#/repos/demo-repo", `${app.pages.explore} · ${demo.repo.fullName}${suffix}`],
    ["#/about", app.sidebar.about],
  ] as const) {
    await page.goto(`/${hash}`);
    await expect(page).toHaveTitle(title);
  }
  // "Repositories" reads the same in both languages; "Settings" does not.
  for (const [hash, en, zh] of [
    ["#/repos", app.pages.repos, appZh.pages.repos],
    ["#/settings", app.pages.settings, appZh.pages.settings],
  ] as const) {
    await page.goto(`/${hash}`);
    await expect(page).toHaveTitle(`${en}${suffix}`);
    try {
      await switchLocale(page, "zh-TW");
      await expect(page).toHaveTitle(`${zh}${suffix}`);
      await page.reload();
      await expect(page).toHaveTitle(`${zh}${suffix}`);
    } finally {
      await switchLocale(page, "en");
    }
    await expect(page).toHaveTitle(`${en}${suffix}`);
  }
});

test("#/home?locale=en reads English over a saved zh-TW and leaves it saved", async ({ page }) => {
  await page.goto("/#/home");
  await page.evaluate((key) => localStorage.setItem(key, "zh-TW"), localeStorageKey);
  await page.goto("/#/home?locale=en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(homeHeading(page)).toHaveText(home.tagline);
  await expect(sidebarButton(page, app.pages.home)).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), localeStorageKey)).toBe("zh-TW");
});

test("a fresh data dir shows Welcome with the license step, and finishing lands on Home", async ({ browser }) => {
  const server = await launchServer({ settingsPut: false });
  const { page, close } = await openOn(browser, server);
  try {
    const settings = await page.request.get("/api/app-settings");
    expect(settings.ok()).toBe(true);
    expect((await settings.json()).settings.onboardingCompletedAt).toBeUndefined();

    await page.goto("/#/home");
    await expect(page.getByRole("heading", { level: 1, name: onboarding.title })).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveCount(0);
    await page.getByRole("button", { name: onboarding.next }).click();

    // The license step: accepting needs the box, and saves this version.
    await expect(page.getByRole("heading", { level: 2, name: onboarding.license.title })).toBeVisible();
    await expect(page.getByRole("link", { name: onboarding.license.read })).toHaveAttribute("href", "/legal/EULA.txt");
    const accept = page.getByRole("button", { name: onboarding.license.acceptButton });
    await expect(accept).toBeDisabled();
    await page.getByRole("checkbox", { name: onboarding.license.accept }).check();
    await accept.click();

    await expect(page.getByRole("heading", { level: 2, name: onboarding.environment.title })).toBeVisible();
    await page.getByRole("button", { name: onboarding.next }).click();
    await expect(page.getByRole("heading", { level: 2, name: onboarding.provider.title })).toBeVisible();
    await page.getByRole("button", { name: onboarding.next }).click();
    await expect(page.getByRole("heading", { level: 2, name: onboarding.start.title })).toBeVisible();
    await page.locator(".welcome-choice").filter({ hasText: onboarding.start.import }).click();

    await expect(page).toHaveURL(/#\/home$/);
    await expect(homeHeading(page)).toHaveText(home.tagline);
    // The import the person chose opens over Home.
    await expect(page.getByRole("dialog", { name: repos.import.title })).toBeVisible();

    const saved = (await (await page.request.get("/api/app-settings")).json()).settings;
    expect(saved.eulaAcceptedVersion).toBe(eulaVersion);
    expect(Date.parse(saved.onboardingCompletedAt)).not.toBeNaN();
    await page.reload();
    await expect(homeHeading(page)).toHaveText(home.tagline);
    await expect(page.getByRole("heading", { level: 1, name: onboarding.title })).toHaveCount(0);
  } finally {
    await close();
    await server.stop();
  }
});

test("another accepted version asks for the license agreement again and blocks the app", async ({ browser }) => {
  const server = await launchServer();
  const { page, close } = await openOn(browser, server);
  try {
    const changed = await page.request.put("/api/app-settings", {
      data: { eulaAcceptedVersion: "old" },
    });
    expect(changed.ok()).toBe(true);
    await page.goto("/#/repos");
    const prompt = page.getByRole("dialog", { name: onboarding.eulaPrompt.title });
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText(eulaVersion);
    await expect(prompt.getByRole("link", { name: onboarding.license.read })).toHaveAttribute(
      "href",
      "/legal/EULA.txt",
    );
    // Nothing closes it, and the app behind it takes no input.
    await expect(page.locator(".app-shell")).toHaveAttribute("inert", "");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await expect(prompt).toBeVisible();
    await expect(page.locator(".command-palette")).toHaveCount(0);
    await expect(prompt.getByRole("button")).toHaveCount(1);

    await prompt.getByRole("button", { name: onboarding.eulaPrompt.accept }).click();
    await expect(prompt).toHaveCount(0);
    await expect(page.locator(".app-shell")).not.toHaveAttribute("inert", "");
    const saved = (await (await page.request.get("/api/app-settings")).json()).settings;
    expect(saved.eulaAcceptedVersion).toBe(eulaVersion);
    await page.reload();
    await expect(breadcrumb(page)).toContainText(app.pages.repos);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await close();
    await server.stop();
  }
});

test("on Free, discovery carries the PRO badge in the navigation and on Home", async ({ browser }) => {
  const server = await launchServer();
  const { page, close } = await openOn(browser, server);
  try {
    await page.goto("/#/home");
    await expect(page.locator(".plan-chip-free").first()).toBeVisible();
    const nav = sidebarButton(page, app.pages.discovery);
    await expect(nav.getByRole("img", { name: "Pro feature" })).toBeVisible();
    const cta = page.locator(".home-choice").filter({ hasText: home.start.discover.title });
    await expect(cta.getByRole("img", { name: "Pro feature" })).toBeVisible();
    // With nothing to link to, the upgrade opens the dialog.
    await page.getByRole("button", { name: home.plan.upgrade }).click();
    await expect(page.getByRole("dialog", { name: "Upgrade to Pro" })).toBeVisible();
  } finally {
    await close();
    await server.stop();
  }
});

test("presenting masks the GitHub login and the paths in the shell, Home and About", async ({ browser }) => {
  // The data dir is a temporary one, under /tmp or the system's temp folder.
  const server = await launchServer();
  const { page, close } = await openOn(browser, server);
  const personal = /real-user|\/home\/|\/Users\/|\/tmp\//;
  try {
    await page.route("**/api/status", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), githubUser: "real-user" },
      });
    });
    // Without the flag the stubbed login shows, so the check below means something.
    await page.goto("/#/home");
    await expect(page.locator(".profile strong")).toHaveText("real-user");

    await page.goto("/#/home?present=1");
    await page.reload();
    await expect(homeHeading(page)).toHaveText(home.tagline);
    await expect(page.locator(".profile strong")).toHaveText(app.maskedUser);
    await expect(page.locator(".profile-avatar svg")).toBeVisible();
    await expect(page.locator(".top-avatar svg")).toBeVisible();
    // No environment summary and no readiness pill while presenting.
    await expect(page.locator(".setup-checklist")).toHaveCount(0);
    await expect(page.locator(".readiness-pill")).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(personal);

    await sidebarButton(page, app.sidebar.about).click();
    const dialog = page.getByRole("dialog", { name: about.title });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".about-path code")).toHaveText(`…/${path.basename(server.dataDir)}`);
    await expect(dialog.getByRole("button", { name: about.copyDataDir })).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(personal);
    await expect(page).toHaveURL(/present=1/);
  } finally {
    await close();
    await server.stop();
  }
});

test("About shows the versions and the local documents, and no link for an empty product URL", async ({ page }) => {
  await page.goto("/#/about");
  const dialog = page.getByRole("dialog", { name: about.title });
  await expect(dialog).toBeVisible();
  // Home is behind it; the address names About until it closes.
  await expect(homeHeading(page)).toHaveText(home.tagline);
  // It counts as the open dialog: "?" opens no user guide over it.
  await page.keyboard.press("Shift+?");
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await page.getByRole("dialog").count()).toBe(1);
  const version = (await (await page.request.get("/api/health")).json()).version;
  await expect(dialog.locator("dd").nth(1)).toHaveText(version);
  await expect(dialog.locator("dd").first()).toHaveText(version);
  await expect(dialog.locator(".about-warning")).toHaveCount(0);
  for (const name of Object.values(about.links))
    await expect(dialog.getByRole("link", { name })).toHaveCount(0);
  await expect(page.locator('[href=""]')).toHaveCount(0);
  for (const [name, href] of [
    [about.documentNames.eula, "/legal/EULA.txt"],
    [about.documentNames.privacy, "/legal/PRIVACY.txt"],
    [about.documentNames.terms, "/legal/TERMS.txt"],
    [about.documentNames.security, "/legal/SECURITY.txt"],
    [about.documentNames.notices, "/THIRD_PARTY_NOTICES.txt"],
  ] as const) {
    await expect(dialog.getByRole("link", { name })).toHaveAttribute("href", href);
    const document = await page.request.get(href);
    expect(document.ok(), href).toBe(true);
    expect(document.headers()["content-type"]).toMatch(/^text\/plain/);
  }
  await expect(dialog).toContainText("Ponytail by DietrichGebert (MIT)");
  await expect(dialog).toContainText("not affiliated with");

  await dialog.getByRole("button", { name: about.close, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#\/home$/);

  // The user guide and the sidebar open it too.
  await sidebarButton(page, app.sidebar.help).click();
  await page
    .getByRole("dialog", { name: modals.help.title })
    .getByRole("button", { name: modals.help.about })
    .click();
  await expect(page.getByRole("dialog", { name: about.title })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the sample project imports in the browser, without the server", async ({ page }) => {
  const posted: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/repos")
      posted.push(request.url());
  });
  await page.goto("/#/repos");
  await page.locator(".page-title .button.primary").click();
  const dialog = page.getByRole("dialog", { name: repos.import.title });
  await dialog.getByLabel(repos.import.source).fill(demo.repo.fullName);
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog.locator(".import-progress li").first()).toHaveText(demo.importSteps![0]);
  await expect(page).toHaveURL(/#\/repos\/demo-repo$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(demo.repo.fullName);
  await expect(page.locator(".toast")).toContainText(
    repos.import.sampleImported({ name: demo.repo.fullName }),
  );
  expect(posted).toEqual([]);
});

test("a run and a repository can be freed and deleted, and the workbench reopens the last run", async ({ browser }) => {
  const server = await launchServer({ seed });
  const { page, close } = await openOn(browser, server);
  const [opened, withFiles] = seededState(server.dataDir).runs;
  try {
    await page.goto(`/#/runs/${opened.id}/overview`);
    await expect(heading(page)).toHaveText(opened.title);

    // Home lists the person's runs, the one opened last first.
    await page.goto("/#/home");
    const continued = page.locator(".home-run");
    await expect(continued).toHaveCount(2);
    await expect(continued.first()).toContainText(opened.title);
    await expect(continued.first()).toContainText(home.continue.lastOpened);
    // With real runs the sample leaves the recent list, and the count leaves it out.
    await expect(page.locator(".recent-sample-heading")).toHaveCount(0);
    await expect(sidebarButton(page, app.pages.workspace).locator(".nav-count")).toHaveText("2");

    // After a reload the workbench holds the sample; its item reopens the last run.
    await page.reload();
    await sidebarButton(page, app.pages.workspace).click();
    await expect(page).toHaveURL(new RegExp(`#/runs/${opened.id}/overview$`));
    await expect(heading(page)).toHaveText(opened.title);

    await page.locator(".all-runs-link").click();
    const list = page.getByRole("dialog", { name: modals.runs.title });
    await list.getByRole("button", { name: modals.runs.freeSpaceLabel({ title: withFiles.title }) }).click();
    const freeing = list.getByRole("group", { name: modals.runs.freeSpaceLabel({ title: withFiles.title }) });
    await expect(freeing).toContainText(modals.runs.freeConfirm);
    await freeing.getByRole("button", { name: modals.runs.freeYes }).click();
    await expect(page.locator(".toast")).toContainText(modals.runs.freed);
    await expect(list.locator(".run-list-entry", { hasText: withFiles.title }).locator(".run-files-removed")).toBeVisible();

    await list.getByRole("button", { name: modals.runs.deleteRunLabel({ title: opened.title }) }).click();
    const deleting = list.getByRole("group", { name: modals.runs.deleteRunLabel({ title: opened.title }) });
    // The confirmation takes the focus on its safe choice.
    await expect(deleting.getByRole("button", { name: "Cancel" })).toBeFocused();
    await deleting.getByRole("button", { name: modals.runs.deleteYes }).click();
    await expect(list.locator(".run-list-entry", { hasText: opened.title })).toHaveCount(0);
    await expect(page.locator(".toast")).toContainText(modals.runs.deleted);
    // The deleted run was open: the sample takes its place.
    await expect(page).toHaveURL(/#\/runs\/demo-run\/overview$/);
    await page.keyboard.press("Escape");

    const runs = (await (await page.request.get("/api/runs")).json()).runs;
    expect(runs.map((run: { id: string }) => run.id)).toEqual([withFiles.id]);
    expect(runs[0].workspaceRemovedAt).toBeTruthy();

    await page.goto("/#/repos");
    const name = "e2e-sample/seeded";
    const remove = page.getByRole("button", { name: repos.list.deleteLabel({ name }) });
    const confirm = page.getByRole("group", { name: repos.list.deleteLabel({ name }) });
    // Keeping it returns the focus to the Delete button.
    await remove.click();
    await confirm.getByRole("button", { name: repos.list.deleteNo }).click();
    await expect(remove).toBeFocused();
    await remove.click();
    await expect(confirm).toContainText(repos.list.deleteConfirm({ name }));
    await confirm.getByRole("button", { name: repos.list.deleteYes }).click();
    await expect(page.locator(".toast")).toContainText(repos.list.deleted({ name }));
    await expect(page.locator(".repository-card", { hasText: "seeded" })).toHaveCount(0);
    expect((await (await page.request.get("/api/repos")).json()).repos).toEqual([]);
    expect((await (await page.request.get("/api/runs")).json()).runs).toEqual([]);
  } finally {
    await close();
    await server.stop();
  }
});

test("an ended session keeps the page and says how to sign in again", async ({ page }) => {
  await page.goto("/#/runs/demo-run/draft");
  await expect(page.locator("#workspace-tab-draft")).toHaveAttribute("aria-selected", "true");
  let loads = 0;
  page.on("load", () => loads++);
  // The next runs-list poll finds the session gone.
  await page.route("**/api/runs", (route) =>
    route.fulfill({ status: 401, json: { error: "Sign in again.", code: "auth_required" } }),
  );
  const notice = page.getByRole("alert").filter({ hasText: app.sessionEnded.title });
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice.locator("code")).toHaveText(app.sessionEnded.command);
  expect(loads).toBe(0);
  await expect(page).toHaveURL(/#\/runs\/demo-run\/draft$/);
  await notice.getByRole("button", { name: app.dismissNotice }).click();
  await expect(notice).toHaveCount(0);
});

test("Home and the sidebar fit at 1440 and 390 px in both languages", async ({ page }) => {
  for (const locale of locales)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
      await page.goto(`/#/home?locale=${locale}`);
      await page.reload();
      await expect(page.locator(".home-page h1")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await expectNoOverflow(page, [".home-page", ".topbar"]);
      if (width < 761) await page.locator(".mobile-menu").click();
      await expect(page.locator("#workspace-sidebar")).toBeVisible();
      await expectNoOverflow(page, ["#workspace-sidebar"]);
    }
});

test("an unknown run opens the sample instead", async ({ page }) => {
  await page.goto("/#/runs/no-such-run/changes?file=src/client.ts");
  await expect(page).toHaveURL(/#\/runs\/demo-run\/changes$/);
  await expect(page.locator("#workspace-tab-changes")).toHaveAttribute("aria-selected", "true");
  await expect(heading(page)).toHaveText(demo.run.title);
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
  const server = await launchServer({ seed });
  const { page, close } = await openOn(browser, server);
  const [run] = seededState(server.dataDir).runs;
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

test("the global setup finished onboarding on the shared server", async ({ request }) => {
  const response = await request.get("/api/app-settings");
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
    await setPlan(page, "free");
    await setPlan(page, "trial");
    await expect(heading(page)).toHaveText(demo.run.title);
    await expect(setPlan(page, "free")).rejects.toThrow(/Free cannot come back/);
  } finally {
    await close();
    await server.stop();
  }
});
