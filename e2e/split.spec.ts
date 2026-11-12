// Splitting a contribution that holds several fixes, through the UI on a spec-local
// server: a real Git worktree changes three fixes (a source file and its test each),
// the plan has one task per fix, and a fake codex answers nothing, so the PR drafts
// the split starts fail quietly. The Draft tab says the plan shows three parts, the
// dialog starts from them, and the split makes three contributions of their own.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { e2eApiHeaders } from "./api-token.mjs";
import draft from "../src/i18n/en/draft";
import modals from "../src/i18n/en/modals";
import workspace from "../src/i18n/en/workspace";
import { expectNoOverflow } from "./helpers/overflow";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const runId = "e2e-split-run";
const repoId = "e2e-split-repo";
const fixes = [
  { id: "runners", title: "Runners keep non-finite results", source: "web/runners.js", test: "tests/runners.test.js" },
  { id: "compiled", title: "Compiled harness reports cycles", source: "web/compiler-explorer.js", test: "tests/compiler-explorer.test.js" },
  { id: "board", title: "Example board resets the pen", source: "web/example-board.js", test: "tests/example-board.test.js" },
];

async function seed(dataDir: string) {
  const checkout = path.join(dataDir, "checkouts", "widgets");
  await mkdir(path.join(checkout, "web"), { recursive: true });
  await mkdir(path.join(checkout, "tests"), { recursive: true });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      // The person's own Git settings (signing, hooks) stay out of it.
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    }).trim();
  git(checkout, "init", "-q", "-b", "main");
  git(checkout, "config", "user.name", "Sample Author");
  git(checkout, "config", "user.email", "author@example.com");
  for (const fix of fixes) {
    await writeFile(path.join(checkout, fix.source), `export const ${fix.id} = 1;\n`);
    await writeFile(path.join(checkout, fix.test), `// ${fix.id}\n`);
  }
  git(checkout, "add", ".");
  git(checkout, "commit", "-q", "-m", "Add the three modules");
  const baseSha = git(checkout, "rev-parse", "HEAD");
  const worktreePath = path.join(dataDir, "worktrees", runId);
  await mkdir(path.dirname(worktreePath), { recursive: true });
  git(checkout, "worktree", "add", "-q", "-b", "fix/three-fixes", worktreePath, baseSha);
  for (const fix of fixes) {
    await writeFile(path.join(worktreePath, fix.source), `export const ${fix.id} = 2;\n`);
    await writeFile(path.join(worktreePath, fix.test), `// ${fix.id} changed\n`);
  }
  const now = new Date().toISOString();
  await writeFile(
    path.join(dataDir, "state.json"),
    JSON.stringify({
      version: 1,
      repos: [
        {
          id: repoId,
          name: "widgets",
          owner: "e2e-sample",
          fullName: "e2e-sample/widgets",
          path: checkout,
          defaultBranch: "main",
          url: "",
        },
      ],
      runs: [
        {
          id: runId,
          repoId,
          title: "Improve the experience for local users",
          prompt: "Improve the experience for local users.",
          status: "review",
          branch: "fix/three-fixes",
          baseBranch: "main",
          baseSha,
          worktreePath,
          createdAt: now,
          locale: "en",
          agents: [
            { id: "lead", name: "Atlas", role: "Team lead", status: "complete", detail: "" },
            { id: "reviewer", name: "Lens", role: "Reviewer", status: "complete", detail: "" },
            { id: "tester", name: "Scout", role: "Test analyst", status: "complete", detail: "" },
          ],
          logs: [],
          draft: { title: "Improve the experience for local users", body: "" },
          reviewedFiles: [],
          reviewedFingerprints: {},
          reports: {},
          team: {
            config: { maxTeammates: 3, requirePlanApproval: true, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
            phase: "complete",
            planSummary: "Three fixes.",
            tasks: fixes.map((fix) => ({
              id: fix.id,
              title: fix.title,
              description: `What the ${fix.id} fix changes.`,
              owner: "member-1",
              files: [fix.source, fix.test],
              dependsOn: [],
              status: "complete",
              integratedFiles: [fix.source, fix.test],
            })),
            messages: [],
          },
        },
      ],
    }),
  );
}

let server: LaunchedServer;

test.beforeAll(async () => {
  server = await launchServer({ seed });
});

test.afterAll(async () => {
  await server.stop();
});

async function open(browser: Browser, width = 1440) {
  const context = await browser.newContext({
    extraHTTPHeaders: e2eApiHeaders,
    baseURL: server.baseURL,
    locale: "en-US",
    viewport: { width, height: 900 },
  });
  return { context, page: await context.newPage() };
}

/** Fails on serious or critical axe issues inside `include`. */
async function expectAccessible(page: Page, include: string) {
  const { violations } = await new AxeBuilder({ page })
    .options({ rules: { "color-contrast": { enabled: true } } })
    .include(include)
    .analyze();
  expect(
    violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .flatMap((violation) => violation.nodes.map((node) => `${violation.id} at ${node.target.join(" ")}`)),
  ).toEqual([]);
}

const runs = async (page: Page) =>
  (await (await page.request.get("/api/runs")).json()).runs as {
    id: string;
    title: string;
    splitFrom?: { runId: string };
    splitInto?: { runId: string; title: string }[];
  }[];

test("the Draft tab says the plan shows three parts, and the dialog starts from them", async ({ browser }) => {
  const { context, page } = await open(browser);
  try {
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    await expect(page.locator(".reviewability-split")).toContainText(draft.reviewability.parts({ count: 3 }));
    await page.getByRole("button", { name: draft.reviewability.splitNow }).click();

    const dialog = page.getByRole("dialog", { name: modals.split.title });
    await expect(dialog).toBeVisible();
    // One contribution per task of the plan, named after it, each with its two files.
    const titles = dialog.locator("input.text-input");
    await expect(titles).toHaveCount(fixes.length);
    for (const [index, fix] of fixes.entries()) await expect(titles.nth(index)).toHaveValue(fix.title);
    for (const [index, fix] of fixes.entries())
      for (const file of [fix.source, fix.test])
        await expect(dialog.getByLabel(modals.split.goesTo({ path: file }))).toHaveValue(String(index + 1));
    await expect(dialog.getByRole("status")).toHaveText(modals.split.summary({ contributions: 3, leftOut: 0 }));
    await expectAccessible(page, "[role=dialog]");

    // Nothing leaves the dialog until Split: a title that is emptied stops it.
    const split = dialog.getByRole("button", { name: modals.split.submit, exact: true });
    await expect(split).toBeEnabled();
    await titles.first().fill("");
    await expect(split).toBeDisabled();
    await titles.first().fill(fixes[0].title);
    await expect(split).toBeEnabled();
    expect((await runs(page)).length).toBe(1);
  } finally {
    await context.close();
  }
});

for (const width of [1440, 390])
  test(`the dialog keeps its files readable and its Split button in reach at ${width} px`, async ({ browser }) => {
    const { context, page } = await open(browser, width);
    try {
      await page.goto(`/#/runs/${runId}/draft?locale=en`);
      await page.getByRole("button", { name: draft.reviewability.splitNow }).click();
      const dialog = page.getByRole("dialog", { name: modals.split.title });
      await expect(dialog).toBeVisible();
      await expectNoOverflow(page, ["[role=dialog]"]);
      // A file's path is never squeezed into a sliver by the menu beside it.
      const widths = await dialog.locator(".split-path").evaluateAll((paths) =>
        paths.map((path) => path.getBoundingClientRect().width),
      );
      expect(widths.length).toBe(fixes.length * 2);
      expect(Math.min(...widths), `path widths: ${widths.join(", ")}`).toBeGreaterThan(110);
      // The summary and the buttons stay in view while the cards scroll: Split needs no hunting.
      await expect(dialog.getByRole("button", { name: modals.split.submit, exact: true })).toBeInViewport({ ratio: 1 });
      await expect(dialog.getByRole("status")).toBeInViewport({ ratio: 1 });
      await dialog.locator(".split-cards").evaluate((cards) => cards.scrollIntoView({ block: "end" }));
      await expect(dialog.getByRole("button", { name: modals.split.submit, exact: true })).toBeInViewport({ ratio: 1 });
    } finally {
      await context.close();
    }
  });

test("splitting makes three contributions of their own, opens the first, and leaves the original as it was", async ({ browser }) => {
  const { context, page } = await open(browser);
  try {
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    await page.getByRole("button", { name: draft.reviewability.splitNow }).click();
    const dialog = page.getByRole("dialog", { name: modals.split.title });
    // Move the second fix's test into the third contribution, and name the third one.
    await dialog.getByLabel(modals.split.goesTo({ path: fixes[1].test })).selectOption("3");
    await expect(dialog.getByRole("status")).toHaveText(modals.split.summary({ contributions: 3, leftOut: 0 }));
    await dialog.getByRole("button", { name: modals.split.submit, exact: true }).click();

    // The first new contribution opens, marked as split from the original.
    await expect(page.locator(".run-notice")).toContainText(
      workspace.splitNotice.from({ title: "Improve the experience for local users" }),
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const all = await runs(page);
    const original = all.find((run) => run.id === runId)!;
    const made = all.filter((run) => run.splitFrom?.runId === runId);
    expect(made.map((run) => run.title).sort()).toEqual(fixes.map((fix) => fix.title).sort());
    expect(original.splitInto?.map((ref) => ref.runId).sort()).toEqual(made.map((run) => run.id).sort());

    // Each has its own files: the second fix lost its test to the third, and the original has all six.
    const filesOf = async (id: string) =>
      ((await (await page.request.get(`/api/runs/${id}/diff`)).json()).files as { path: string }[]).map((file) => file.path).sort();
    const byTitle = (title: string) => made.find((run) => run.title === title)!.id;
    expect(await filesOf(byTitle(fixes[0].title))).toEqual([fixes[0].source, fixes[0].test].sort());
    expect(await filesOf(byTitle(fixes[1].title))).toEqual([fixes[1].source]);
    expect(await filesOf(byTitle(fixes[2].title))).toEqual([fixes[2].source, fixes[2].test, fixes[1].test].sort());
    expect(await filesOf(runId)).toHaveLength(6);

    // The original says so and offers no second split.
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    await expect(page.locator(".run-notice")).toContainText(workspace.splitNotice.into({ count: 3 }));
    await expect(page.getByRole("button", { name: draft.reviewability.splitNow })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
