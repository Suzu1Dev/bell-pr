// Pixel baseline of the main screens at 1440x900 with the demo run.
//
// Record the images on the commit before a refactor, then compare after it:
//
//   npm run build
//   BELLPR_PORT=4511 BELLPR_DATA_DIR="$(mktemp -d)" npx tsx server/index.ts &
//   UI_BASELINE_URL=http://127.0.0.1:4511 UI_BASELINE_DIR=/tmp/ui-baseline \
//     npx playwright test -c scripts/ui-baseline/playwright.config.ts \
//     [--update-snapshots]
//
// Start the server from the repository root (it serves dist/ from the
// current directory) with an empty data directory, and keep UI_BASELINE_DIR
// outside the repository. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use an
// installed Chromium build. Requests to other hosts are aborted, the clock is
// fixed and /api/status is answered here, so the images do not depend on the
// network or on which CLIs the machine has signed in to.
import { expect, test, type Page, type Request } from "@playwright/test";

const status = {
  codex: true,
  codexAuthenticated: true,
  claude: true,
  claudeAuthenticated: false,
  github: true,
  githubUser: "sample-user",
  limits: { maxActiveRuns: 2, maxAgentProcesses: 8, maxQueued: 20 },
};

const pendingRequests = new WeakMap<Page, Set<Request>>();

test.beforeEach(async ({ page }) => {
  const pending = new Set<Request>();
  pendingRequests.set(page, pending);
  page.on("request", (request) => pending.add(request));
  page.on("requestfinished", (request) => pending.delete(request));
  page.on("requestfailed", (request) => pending.delete(request));
  await page.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => route.abort(),
  );
  await page.route("**/api/status", (route) => route.fulfill({ json: status }));
  await page.clock.install({ time: new Date("2026-10-03T09:40:00+08:00") });
  await page.goto("/");
  // The demo run opens first; the status answer above names the profile.
  await expect(page.locator(".workspace-heading h1")).toBeVisible();
  await expect(page.locator(".profile strong")).toHaveText(status.githubUser);
});

/** Waits until no request (API call, lazy chunk, stylesheet) ran for 500 ms. */
async function waitForQuiet(page: Page) {
  const pending = pendingRequests.get(page)!;
  let quietSince = Date.now();
  while (Date.now() - quietSince < 500) {
    if (pending.size) quietSince = Date.now();
    await page.waitForTimeout(50);
  }
}

async function expectScreen(page: Page, name: string) {
  await expect(page.getByText(/^正在(準備|載入)/)).toHaveCount(0);
  await waitForQuiet(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    maxDiffPixelRatio: 0.001,
    animations: "disabled",
  });
}

const sidebar = (page: Page) => page.locator("#workspace-sidebar");

test("workspace overview", async ({ page }) => {
  await expect(page.getByRole("tab", { name: "全貌與動機" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expectScreen(page, "workspace-overview");
});

test("workspace changes", async ({ page }) => {
  await page.getByRole("tab", { name: /^程式碼變更/ }).click();
  await expect(page.locator(".diff-panel")).toBeVisible();
  await expect(page.locator(".explanation-wrap")).toBeVisible();
  await expectScreen(page, "workspace-changes");
});

test("workspace activity", async ({ page }) => {
  await page.getByRole("tab", { name: /^Agent 動態/ }).click();
  await expect(page.getByRole("heading", { name: "執行過程" })).toBeVisible();
  await expectScreen(page, "workspace-activity");
});

test("workspace draft", async ({ page }) => {
  await page.getByRole("tab", { name: /^PR 草稿/ }).click();
  await expect(
    page.getByRole("heading", { name: "讓好的改動，也有好的說明。" }),
  ).toBeVisible();
  await expectScreen(page, "workspace-draft");
});

test("repositories", async ({ page }) => {
  await sidebar(page).getByRole("button", { name: "Repositories" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "下一個貢獻，從這裡開始。",
  );
  await expectScreen(page, "repositories");
});

test("agent team", async ({ page }) => {
  await sidebar(page).getByRole("button", { name: "Agent team" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "一個目標，一支 Agent team。",
  );
  await expectScreen(page, "agent-team");
});

test("learning notes", async ({ page }) => {
  await sidebar(page)
    .getByRole("navigation")
    .getByRole("button", { name: /^學習筆記/ })
    .click();
  await expect(page.locator(".breadcrumb")).toContainText("學習筆記");
  await expectScreen(page, "learning-notes");
});

test("settings", async ({ page }) => {
  await sidebar(page)
    .getByRole("button", { name: "連線與設定", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "讓工作環境準備就緒。",
  );
  await expectScreen(page, "settings");
});
