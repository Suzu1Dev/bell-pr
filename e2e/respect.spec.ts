// Respect for the maintainer's time, outside the workspace frame: the
// "Before you contribute" card on the project overview, the task dialog's
// Before-you-start facts and its start confirm, and the Draft tab's live
// maintainer checklist. The sample reads nothing from GitHub; on a real
// project, an unanswered respect route is "Couldn't check", never a pass.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ContributionFacts } from "../shared/contribution";
import draft from "../src/i18n/en/draft";
import mission from "../src/i18n/en/mission";
import modals from "../src/i18n/en/modals";
import repos from "../src/i18n/en/repos";
import { expectNoOverflow } from "./helpers/overflow";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const widths = [1440, 390];

/** Every API request the page sends, as "METHOD /path?query". */
function recordRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/"))
      requests.push(`${request.method()} ${url.pathname}${url.search}`);
  });
  return requests;
}

/** Fails on serious or critical axe issues, color contrast included. */
async function expectAccessible(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).options({
    rules: { "color-contrast": { enabled: true } },
  });
  const { violations } = await (include ? builder.include(include) : builder).analyze();
  const problems = violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .flatMap((violation) =>
      violation.nodes.map((node) => `${violation.id} at ${node.target.join(" ")}`),
    );
  expect(problems).toEqual([]);
}

const settled = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
};

test.describe("the sample project", () => {
  test("the overview opens with Before you contribute and the sample's 3 quoted rules", async ({ page }) => {
    const requests = recordRequests(page);
    await page.goto("/#/runs/demo-run/overview?locale=en");
    const card = page.locator(".rules-card");
    await expect(card.getByRole("heading", { name: mission.rules.title })).toBeVisible();
    await expect(card.locator(".rules-card-door")).toHaveText(mission.rules.door.open);
    await expect(card.locator("figure")).toHaveCount(3);
    for (const quote of [
      "Open an issue before changing behavior.",
      "You must be able to explain your change in review.",
      "If you used AI tools, say so in the PR description.",
    ])
      await expect(card.locator("blockquote", { hasText: quote })).toHaveCount(1);
    await expect(card.locator("figcaption code").first()).toHaveText(/^CONTRIBUTING\.md:\d+$/);
    await expect(card.locator(".rules-card-effect.is-block")).toHaveText(mission.rules.effects.block);
    await expect(card).toContainText(mission.rules.found({ count: 3, files: 2 }));
    // The card leads the overview, before the project card.
    const order = await page.evaluate(() => {
      const rules = document.querySelector(".rules-card");
      const purpose = document.querySelector("#overview-purpose");
      return !!rules && !!purpose && !!(rules.compareDocumentPosition(purpose) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
    // The sample asks the server nothing about its rules.
    expect(requests.filter((request) => request.includes("contribution"))).toEqual([]);
  });

  test("Start with this direction shows the sample's facts as green chips", async ({ page }) => {
    const requests = recordRequests(page);
    await page.goto("/#/runs/demo-run/overview?locale=en");
    await page.getByRole("button", { name: mission.ideas.choose }).first().click();
    const dialog = page.getByRole("dialog", { name: modals.newTask.title });
    const facts = dialog.locator(".before-start");
    await expect(facts.getByRole("heading", { name: /Before you start/ })).toBeVisible();
    await expect(facts.locator(".before-start-issue")).toHaveText(mission.start.sampleIssue({ number: 42 }));
    // "#42 (sample)" is no link: the sample's issue does not exist.
    await expect(facts.locator("a")).toHaveCount(0);
    const chips = facts.locator(".before-start-chip");
    await expect(chips).toHaveText([
      mission.start.open,
      mission.start.unassigned,
      mission.start.noOtherPr,
      /^A maintainer said: “PRs welcome for the retry cap\.”/,
      mission.start.pacing({ open: 0, budget: 1 }),
    ]);
    await expect(facts.locator(".before-start-chip.is-ok")).toHaveCount(4);
    // The maintainer's words are quoted, not judged.
    await expect(facts.locator(".before-start-chip.is-info")).toHaveText(/^A maintainer said/);
    expect(requests.filter((request) => request.includes("contribution"))).toEqual([]);
    await expectAccessible(page, ".modal");
  });

  test("the Draft tab lists the maintainer checklist rows, each with its state and why", async ({ page }) => {
    await page.goto("/#/runs/demo-run/draft?locale=en");
    const checklist = page.locator(".draft-checklist");
    await expect(checklist.getByRole("heading", { name: draft.guidance.checklist.title })).toBeVisible();
    const rows = checklist.locator(".draft-checklist-row");
    await expect(rows).toHaveCount(8);
    await expect(rows.locator("strong")).toHaveText(Object.values(draft.guidance.checklist.rows));
    await expect(checklist.locator(".draft-checklist-why")).toHaveCount(8);
    // Every row says where it stands; the next test checks which.
    await expect(rows.locator(".draft-checklist-status")).toHaveCount(8);
  });

  test("MERGE-STEP: with L2D's props the snapshot shows and the respect rows are green", async ({ page }) => {
    await page.goto("/#/runs/demo-run/draft?locale=en");
    await expect(page.locator(".draft-checklist")).toBeVisible();
    await settled(page);
    await expect(page.locator(".reviewability")).toBeVisible();
    await expect(page.locator(".reviewability-band").first()).toHaveText(
      draft.reviewability.band({ band: draft.reviewability.bands.small }),
    );
    for (const id of ["rules", "door", "issue", "pacing", "reviewability", "disclosure"])
      await expect(page.locator(`.draft-checklist-row[data-row="${id}"]`)).toHaveClass(/is-ok/);
    // The untouched sample has no suggested description yet: BELL PR has
    // nothing to compare its words with, and never says whose they are.
    const words = page.locator('.draft-checklist-row[data-row="words"]');
    await expect(words).toHaveClass(/is-unknown/);
    await expect(words).toContainText(draft.guidance.checklist.wordsUnknown);
  });

  for (const width of widths)
    test(`the card, the task dialog's facts and the checklist fit at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/#/runs/demo-run/overview?locale=en");
      await expect(page.locator(".rules-card figure")).toHaveCount(3);
      await settled(page);
      await expectNoOverflow(page);
      await page.getByRole("button", { name: mission.ideas.choose }).first().click();
      await expect(page.locator(".before-start-chip")).toHaveCount(5);
      await settled(page);
      await expectNoOverflow(page);
      await page.goto("/#/runs/demo-run/draft?locale=en");
      await expect(page.locator(".draft-checklist-row")).toHaveCount(8);
      await settled(page);
      await expectNoOverflow(page);
    });
});

// A real project, imported before: its rules have not been read here.
const repo = {
  id: "e2e-respect-repo",
  name: "widgets",
  owner: "e2e-sample",
  fullName: "e2e-sample/widgets",
  defaultBranch: "main",
  url: "",
};
const issueUrl = "https://github.com/e2e-sample/widgets/issues/7";
/** What the task dialog's check would read for a closed issue someone else fixes. */
const badFacts: ContributionFacts = {
  checkedAt: "2026-10-14T09:00:00.000Z",
  issue: {
    url: issueUrl,
    number: 7,
    state: "CLOSED",
    stateReason: "COMPLETED",
    labels: [],
    assignees: [],
    claims: [],
    otherPrs: [{ number: 9, author: "other_dev", state: "OPEN", willClose: true }],
  },
  pacing: { openPrs: 0, mergedPrs: 0, viewerPermission: "READ" },
};

test.describe("a real project", () => {
  let server: LaunchedServer;
  test.beforeAll(async () => {
    server = await launchServer({
      seed: (dataDir) =>
        writeFile(
          path.join(dataDir, "state.json"),
          JSON.stringify({
            version: 1,
            repos: [{ ...repo, path: path.join(dataDir, "repos", "widgets") }],
            runs: [],
          }),
        ),
    });
  });
  test.afterAll(async () => {
    await server?.stop();
  });

  async function openOn(browser: Browser, width = 1440) {
    const context = await browser.newContext({
      baseURL: server.baseURL,
      storageState: server.storageState,
      viewport: { width, height: 900 },
      locale: "en-US",
    });
    return { page: await context.newPage(), close: () => context.close() };
  }

  test("the card says it couldn't check the rules, never that pull requests are open", async ({ browser }) => {
    const { page, close } = await openOn(browser);
    try {
      const requests = recordRequests(page);
      await page.goto(`/#/repos/${repo.id}?locale=en`);
      const card = page.locator(".rules-card");
      await expect(card.getByRole("heading", { name: mission.rules.title })).toBeVisible();
      await expect(card.locator(".rules-card-state.is-unknown")).toContainText("Couldn't check");
      await expect(card).not.toContainText(mission.rules.door.open);
      expect(requests).toContain(`GET /api/repos/${repo.id}/contribution-rules`);
      await card.getByRole("button", { name: mission.rules.checkAgain }).click();
      await expect.poll(() => requests).toContain(`POST /api/repos/${repo.id}/contribution-rules/refresh`);
      await expect(card.getByRole("button", { name: mission.rules.checkAgain })).toBeEnabled();
      await expect(card).not.toContainText(mission.rules.door.open);
      await expectAccessible(page, ".rules-card");
    } finally {
      await close();
    }
  });

  test("the task dialog reads the issue once, and Start asks once when publishing will wait", async ({ browser }) => {
    const { page, close } = await openOn(browser);
    try {
      const requests = recordRequests(page);
      // The setup checks pass, the issue's facts are bad, and no run starts.
      await page.route("**/api/doctor*", (route) =>
        route.fulfill({ json: { checks: [], ready: true, checkedAt: badFacts.checkedAt, platform: "linux" } }),
      );
      await page.route("**/api/repos/*/contribution-check*", (route) => route.fulfill({ json: badFacts }));
      await page.route("**/api/runs", (route) =>
        route.request().method() === "POST"
          ? route.fulfill({ status: 400, json: { error: "Stopped by the test." } })
          : route.fallback(),
      );
      await page.goto(`/#/repos/${repo.id}?locale=en`);
      await page.getByRole("button", { name: repos.explore.chooseDirection }).click();
      const dialog = page.getByRole("dialog", { name: modals.newTask.title });
      const facts = dialog.locator(".before-start");
      await expect(facts).toContainText(mission.start.noIssue);
      await settled(page);
      await dialog.getByLabel(/Related issue link/).fill(issueUrl);
      await expect(facts.locator(".before-start-chip")).toHaveText([
        mission.start.closed({ reason: "completed" }),
        mission.start.unassigned,
        mission.start.otherPr({ author: "other_dev", number: 9 }),
        mission.start.pacing({ open: 0, budget: 1 }),
      ]);
      await expect(facts.locator("a.before-start-issue")).toHaveAttribute("href", issueUrl);
      const checks = () => requests.filter((request) => request.includes("/contribution-check"));
      expect(checks()).toEqual([
        `GET /api/repos/${repo.id}/contribution-check?issue=${encodeURIComponent(issueUrl)}`,
      ]);

      await dialog.locator("#task-prompt").fill("Keep focus on the trigger after the dialog closes.");
      const start = dialog.getByRole("button", { name: new RegExp(`^(?:${modals.newTask.planFirst}|${modals.newTask.start})$`) });
      await start.click();
      const confirm = dialog.locator(".start-confirm");
      await expect(confirm.getByRole("heading", { name: mission.startConfirm.title })).toBeFocused();
      await expect(confirm.locator("li")).toHaveText([
        mission.startConfirm.practise["issue-closed"],
        mission.startConfirm.otherPr({ author: "other_dev", number: 9 }),
      ]);
      // Back: nothing starts.
      await confirm.getByRole("button", { name: mission.startConfirm.back }).click();
      await expect(confirm).toHaveCount(0);
      expect(requests.filter((request) => request === "POST /api/runs")).toEqual([]);
      // Practising locally is always possible: the run is created.
      await start.click();
      await confirm.getByRole("button", { name: mission.startConfirm.practiseLocally }).click();
      await expect(dialog.locator(".inline-error")).toHaveText("Stopped by the test.");
      expect(requests.filter((request) => request === "POST /api/runs")).toHaveLength(1);
      // Asked once: the same facts do not ask again.
      await start.click();
      await expect.poll(() => requests.filter((request) => request === "POST /api/runs")).toHaveLength(2);
      await expect(confirm).toHaveCount(0);
      // The same link again is not read again.
      expect(checks()).toHaveLength(1);
      await expectAccessible(page, ".modal");
    } finally {
      await close();
    }
  });

  test("the task dialog's facts and confirm fit at 390 px", async ({ browser }) => {
    const { page, close } = await openOn(browser, 390);
    try {
      await page.route("**/api/doctor*", (route) =>
        route.fulfill({ json: { checks: [], ready: true, checkedAt: badFacts.checkedAt, platform: "linux" } }),
      );
      await page.route("**/api/repos/*/contribution-check*", (route) => route.fulfill({ json: badFacts }));
      await page.goto(`/#/repos/${repo.id}?locale=en`);
      await page.getByRole("button", { name: repos.explore.chooseDirection }).click();
      const dialog = page.getByRole("dialog", { name: modals.newTask.title });
      // The form has its settings before anything is typed.
      await expect(dialog.locator(".before-start")).toContainText(mission.start.noIssue);
      await settled(page);
      const issue = dialog.getByLabel(/Related issue link/);
      await issue.fill(issueUrl);
      await expect(issue).toHaveValue(issueUrl);
      await expect(dialog.locator(".before-start-chip")).toHaveCount(4);
      await dialog.locator("#task-prompt").fill("Keep focus on the trigger after the dialog closes.");
      await dialog.getByRole("button", { name: new RegExp(`^(?:${modals.newTask.planFirst}|${modals.newTask.start})$`) }).click();
      await expect(dialog.locator(".start-confirm")).toBeVisible();
      await settled(page);
      await expectNoOverflow(page);
    } finally {
      await close();
    }
  });
});
