// The contribution workspace on real runs: the phone filters, the Pro
// learning export on Free and on the trial, the unsandboxed badge, a run
// whose files were cleaned up, and an open follow-up round up to its push
// dialog.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { aiDisclosureLine } from "../shared/drafts";
import { getDemo } from "../src/demo";
import security from "../server/i18n/en/security";
import draftEn from "../src/i18n/en/draft";
import license from "../src/i18n/en/license";
import review from "../src/i18n/en/review";
import workspace from "../src/i18n/en/workspace";
import { setPlan } from "./fixtures";
import { expectNoOverflow } from "./helpers/overflow";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const now = () => new Date().toISOString();

/** A run as state.json stores it; `worktreePath` is filled in per data dir. */
const seededRun = {
  id: "e2e-workspace-run",
  repoId: "e2e-workspace-repo",
  title: "Greet the whole world",
  prompt: "Make the greeting friendlier.",
  status: "review",
  branch: "fix/greet",
  baseBranch: "main",
  baseSha: "",
  agents: [],
  logs: [],
  draft: { title: "Greet the whole world", body: "Greets the whole world." },
  reviewedFiles: [],
  reviewedFingerprints: {},
  reports: {},
  // A Claude agent of this run ran without the OS sandbox.
  unsandboxed: true,
  // Its working files were cleaned up, so it opens without a diff.
  workspaceRemovedAt: "2026-10-02T08:00:00.000Z",
};

const repoOf = (dataDir: string, directory = path.join(dataDir, "repos", "widgets")) => ({
  id: seededRun.repoId,
  name: "widgets",
  owner: "e2e-sample",
  fullName: "e2e-sample/widgets",
  path: directory,
  defaultBranch: "main",
  url: "",
});

/** Writes state.json with `runs` on the sample repository. */
async function seedState(dataDir: string, runs: object[], repoPath?: string) {
  await writeFile(
    path.join(dataDir, "state.json"),
    JSON.stringify({ version: 1, repos: [repoOf(dataDir, repoPath)], runs }),
  );
}

/** A fresh data dir (Free) holding the cleaned-up, unsandboxed run. */
const launchSeeded = () =>
  launchServer({
    seed: (dataDir) =>
      seedState(dataDir, [
        {
          ...seededRun,
          createdAt: now(),
          worktreePath: path.join(dataDir, "worktrees", seededRun.id),
        },
      ]),
  });

/** A signed-in page on a spec-local server; closed with the server. */
async function openOn(browser: Browser, server: LaunchedServer, width = 1440) {
  const context = await browser.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
    viewport: { width, height: width > 600 ? 900 : 844 },
    locale: "en-US",
    timezoneId: "UTC",
    acceptDownloads: true,
  });
  return { page: await context.newPage(), close: () => context.close() };
}

const heading = (page: Page) => page.locator(".workspace-heading h1");
const exportButton = (page: Page) =>
  page.getByRole("button", { name: new RegExp(workspace.exportLearning.replace(/[()]/g, "\\$&")) });

test("at 390 px the file filters sit side by side and the search opens from its icon", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/runs/demo-run/changes?locale=en");
  const toggles = page.locator(".file-filters .filter-toggle");
  await expect(toggles).toHaveCount(2);
  const [first, second] = await Promise.all([
    toggles.nth(0).boundingBox(),
    toggles.nth(1).boundingBox(),
  ]);
  expect(first && second).toBeTruthy();
  const apart =
    first!.x + first!.width <= second!.x ||
    second!.x + second!.width <= first!.x ||
    first!.y + first!.height <= second!.y ||
    second!.y + second!.height <= first!.y;
  expect(apart, `${JSON.stringify(first)} overlaps ${JSON.stringify(second)}`).toBe(true);
  await expect(page.getByRole("button", { name: workspace.changes.onlyUnreviewed })).toHaveAttribute("aria-pressed", "false");

  // The search hides behind an icon on a phone; opening it focuses the field.
  const search = page.getByRole("textbox", { name: workspace.changes.searchLabel });
  await expect(search).toBeHidden();
  const open = page.getByRole("button", { name: workspace.changes.openSearch });
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.click();
  await expect(search).toBeFocused();
  await search.fill("client");
  await expect(page.locator(".file-item")).toHaveCount(1);
  await page.getByRole("button", { name: workspace.changes.closeSearch }).click();
  await expect(search).toBeHidden();
  await expect(page.locator(".file-item")).toHaveCount(getDemo("en").files.length);
  await expectNoOverflow(page);
});

test("on Free, Export opens the upgrade dialog and nothing is downloaded or requested", async ({ browser }) => {
  const server = await launchSeeded();
  const { page, close } = await openOn(browser, server);
  try {
    const exports: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/export.md")) exports.push(request.url());
    });
    const downloads: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    await page.goto(`/#/runs/${seededRun.id}/activity?locale=en`);
    await expect(heading(page)).toHaveText(seededRun.title);
    const button = exportButton(page);
    await expect(button.locator(".pro-badge")).toBeVisible();
    await button.click();
    await expect(page.getByRole("dialog", { name: license.upgrade.title })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.waitForTimeout(1_000);
    expect(downloads).toEqual([]);
    expect(exports).toEqual([]);
  } finally {
    await close();
    await server.stop();
  }
});

test("on the trial, Export saves the learning record as a Markdown file", async ({ browser }) => {
  const server = await launchSeeded();
  const { page, close } = await openOn(browser, server);
  try {
    await page.goto(`/#/runs/${seededRun.id}/activity?locale=en`);
    await setPlan(page, "trial");
    await expect(heading(page)).toHaveText(seededRun.title);
    const button = exportButton(page);
    await expect(button.locator(".pro-badge")).toHaveCount(0);
    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
    expect(download.suggestedFilename()).toBe(`bell-learning-${seededRun.id}.md`);
    const text = await readFile(await download.path(), "utf8");
    expect(text.startsWith(`# Learning record: ${seededRun.title}\n`)).toBe(true);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await close();
    await server.stop();
  }
});

test("an unsandboxed run shows its badge, and a cleaned-up run says its files are gone", async ({ browser }) => {
  const server = await launchSeeded();
  const { page, close } = await openOn(browser, server);
  try {
    await page.goto(`/#/runs/${seededRun.id}/activity?locale=en&present=1`);
    await expect(heading(page)).toHaveText(seededRun.title);
    const badge = page.getByRole("link", { name: workspace.unsandboxed.label });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAccessibleDescription(workspace.unsandboxed.tooltip);
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeHidden();
    await badge.focus();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(page.getByText(workspace.runNotices.workspaceRemoved)).toBeVisible();
    await expectNoOverflow(page);
    // The badge leads to the safety settings and keeps the presentation flags.
    await badge.click();
    await expect(page).toHaveURL(/#\/settings\/safety\?locale=en&present=1$/);
  } finally {
    await close();
    await server.stop();
  }
});

/**
 * A published PR with an open follow-up round, in a real Git checkout: the
 * PR commit is pushed, and the round changed the greeting once more.
 */
async function seedRound(dataDir: string) {
  const checkout = path.join(dataDir, "checkouts", "widgets");
  await mkdir(checkout, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: checkout,
      encoding: "utf8",
      // The person's own Git settings (signing, hooks) stay out of it.
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    }).trim();
  const file = path.join(checkout, "hello.ts");
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Sample Author");
  git("config", "user.email", "author@example.com");
  await writeFile(file, "export const greeting = 'hello';\n");
  git("add", ".");
  git("commit", "-q", "-m", "Add the greeting");
  const baseSha = git("rev-parse", "HEAD");
  await writeFile(file, "export const greeting = 'Hello, world';\n");
  git("commit", "-q", "-am", "Greet the world");
  const parentCommit = git("rev-parse", "HEAD");
  await writeFile(file, "export const greeting = 'Hello, world!';\n");
  await seedState(
    dataDir,
    [
      {
        ...seededRun,
        id: "e2e-round-run",
        unsandboxed: undefined,
        workspaceRemovedAt: undefined,
        baseSha,
        worktreePath: checkout,
        createdAt: now(),
        status: "review",
        draft: {
          title: "Greet the world",
          body: "Greets the world.",
          commitMessage: "Add the exclamation mark\n\nAddress the review on hello.ts.",
        },
        prUrl: "https://github.com/e2e-sample/widgets/pull/3",
        publishedBranch: "fix/greet",
        headRepository: "e2e-sample/widgets",
        followUps: [
          {
            id: "round-1",
            requestedAt: now(),
            feedbackUrls: [],
            note: "Add an exclamation mark.",
            status: "review",
            parentCommit,
          },
        ],
      },
    ],
    checkout,
  );
}

test("an open follow-up round asks for its commit message and pushes through its own dialog", async ({ browser }) => {
  const server = await launchServer({ seed: seedRound });
  const { page, close } = await openOn(browser, server, 390);
  try {
    await page.goto("/#/runs/e2e-round-run/draft?locale=en");
    await expect(heading(page)).toHaveText(seededRun.title);
    await expect(page.getByText(workspace.draft.roundNotice)).toBeVisible();
    const message = page.locator("#pr-commit-message");
    await expect(message).toHaveValue("Add the exclamation mark\n\nAddress the review on hello.ts.");
    await expect(message).toBeEditable();
    await expect(page.locator("#pr-title")).toBeDisabled();
    await expect(page.locator(".sync-panel")).toBeVisible();
    await expect(page.locator(".follow-up-rounds")).toBeVisible();
    await expectNoOverflow(page, [".sync-panel", ".follow-up-rounds"]);

    // The reader reviews the round's file, then approves the push.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("#workspace-tab-changes").click();
    const reviewed = page.getByRole("checkbox", { name: review.diff.reviewed });
    // The server records the review; the box ticks with its answer.
    await reviewed.click();
    await expect(reviewed).toBeChecked();
    await page.getByRole("button", { name: workspace.footer.approvePush }).click();
    const dialog = page.getByRole("dialog", { name: workspace.publish.titleRound });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".publish-commit-preview pre")).toHaveText(
      "Add the exclamation mark\n\nAddress the review on hello.ts.",
    );
    // This server's GitHub CLI cannot push: the dialog says so and waits.
    await expect(dialog.locator(".readiness-notice")).toBeVisible();
    await expect(dialog.getByRole("button", { name: workspace.publish.pushRound })).toBeDisabled();
  } finally {
    await close();
    await server.stop();
  }
});

/** Two runs in review holding a ready draft suggestion that does not mention AI. */
const suggestion = {
  title: "Greet the whole world in the README",
  body: "## Summary\n\nThe README example greets the whole world.",
  policy: "repository",
  summary: "The project keeps PR descriptions short.",
  rules: [],
  checklist: ["Say what changed"],
  templateSourceId: "",
};
const suggested = (dataDir: string, id: string) => ({
  ...seededRun,
  id,
  createdAt: now(),
  worktreePath: path.join(dataDir, "worktrees", id),
  draftPreparation: {
    status: "ready",
    fingerprint: "e2e",
    proposal: suggestion,
    generatedAt: now(),
  },
});

test("the AI-assistance switch saves the line into the draft, and an applied suggestion stays applied", async ({ browser }) => {
  const server = await launchServer({
    seed: (dataDir) =>
      seedState(dataDir, [
        suggested(dataDir, "e2e-apply-first"),
        suggested(dataDir, "e2e-switch-first"),
      ]),
  });
  const { page, close } = await openOn(browser, server);
  const guidance = draftEn.guidance;
  const disclosure = page.getByRole("switch", { name: guidance.disclosure.label });
  const description = page.getByRole("textbox", { name: workspace.draft.bodyLabel });
  const savedDraft = async (id: string) =>
    (await (await page.request.get(`/api/runs/${id}`)).json()).run.draft;
  const withLine = `${suggestion.body}\n\n${aiDisclosureLine}`;
  try {
    // Apply, then turn the line on and off: the saved draft follows, and
    // the suggestion still counts as applied.
    await page.goto("/#/runs/e2e-apply-first/draft?locale=en");
    await expect(disclosure).not.toBeChecked();
    await page.getByRole("button", { name: guidance.apply.apply }).click();
    const applied = page.getByRole("button", { name: guidance.apply.applied });
    await expect(applied).toBeDisabled();
    await disclosure.click();
    await expect(disclosure).toBeChecked();
    await page.getByRole("button", { name: workspace.draft.edit, exact: true }).click();
    await expect(description).toHaveValue(withLine);
    await expect(applied).toBeDisabled();
    expect(await savedDraft("e2e-apply-first")).toMatchObject({
      title: suggestion.title,
      body: withLine,
      aiDisclosure: true,
    });
    await disclosure.click();
    await expect(disclosure).not.toBeChecked();
    await expect(description).toHaveValue(suggestion.body);
    expect(await savedDraft("e2e-apply-first")).toMatchObject({
      body: suggestion.body,
      aiDisclosure: false,
    });

    // Turn the line on, then apply: the suggestion with the line counts as
    // applied, and as text nobody has revised yet.
    await page.goto("/#/runs/e2e-switch-first/draft?locale=en");
    await disclosure.click();
    await expect(disclosure).toBeChecked();
    expect(await savedDraft("e2e-switch-first")).toMatchObject({
      body: `${seededRun.draft.body}\n\n${aiDisclosureLine}`,
      aiDisclosure: true,
    });
    await page.getByRole("button", { name: guidance.apply.apply }).click();
    await expect(page.getByRole("button", { name: guidance.apply.applied })).toBeDisabled();
    await page.getByRole("button", { name: workspace.draft.edit, exact: true }).click();
    await expect(description).toHaveValue(withLine);
    await expect(page.getByText(workspace.draft.proposalNotice)).toBeVisible();

    // The sample keeps the choice in the browser, the same way. (A new
    // page: leaving the unsaved draft above would ask for a confirmation.)
    const sample = await page.context().newPage();
    await sample.goto("/#/runs/demo-run/draft?locale=en");
    await sample.getByRole("button", { name: guidance.generate.demo }).click();
    await sample.getByRole("button", { name: guidance.apply.apply }).click();
    const sampleSwitch = sample.getByRole("switch", { name: guidance.disclosure.label });
    // The sample project asks contributors to say when AI helped, so the
    // switch starts on; it still turns off and on.
    await expect(sampleSwitch).toBeChecked();
    await sampleSwitch.click();
    await expect(sampleSwitch).not.toBeChecked();
    await sampleSwitch.click();
    await expect(sampleSwitch).toBeChecked();
    await sample.getByRole("button", { name: workspace.draft.edit, exact: true }).click();
    const line = aiDisclosureLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await expect(
      sample.getByRole("textbox", { name: workspace.draft.bodyLabel }),
    ).toHaveValue(new RegExp(`\\n\\n${line}$`));
    await expect(sample.getByRole("button", { name: guidance.apply.applied })).toBeDisabled();
  } finally {
    await close();
    await server.stop();
  }
});

test("the draft guide lists the checks publishing runs on the saved draft", async ({ browser }) => {
  const token = "ghp_" + "a".repeat(36);
  const server = await launchServer({
    seed: (dataDir) =>
      seedState(dataDir, [
        {
          ...seededRun,
          createdAt: now(),
          worktreePath: path.join(dataDir, "worktrees", seededRun.id),
          draft: { title: seededRun.draft.title, body: `Greets the whole world.\n\nToken: ${token}` },
        },
      ]),
  });
  const { page, close } = await openOn(browser, server);
  const preflight = draftEn.guidance.preflight;
  const checks = page.locator(".draft-guidance-preflight");
  try {
    await page.goto(`/#/runs/${seededRun.id}/draft?locale=en`);
    await expect(checks.getByRole("heading", { name: preflight.title })).toBeVisible();
    const secret = checks.locator("li.is-block");
    await expect(secret).toContainText(preflight.block);
    await expect(secret).toContainText(security.draftChecks.secret);
    await expect(secret).toContainText(security.draftChecks.secretIn({ field: "body" }));

    // Saving a draft without the token clears the block.
    await page
      .getByRole("textbox", { name: workspace.draft.bodyLabel })
      .fill("Greets the whole world.");
    await page.getByRole("button", { name: workspace.draft.save, exact: true }).click();
    await expect(checks).toContainText(preflight.clear);
    await expect(secret).toHaveCount(0);

    // The sample has no server to check with.
    await page.goto("/#/runs/demo-run/draft?locale=en");
    await expect(page.locator(".draft-guidance-panel")).toBeVisible();
    await expect(checks).toHaveCount(0);
  } finally {
    await close();
    await server.stop();
  }
});
