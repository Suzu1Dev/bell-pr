// The learning page: the sample notes, a person's own notes read page by
// page from GET /api/learning, and the coach debrief view (Pro).
import { writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type Request } from "@playwright/test";
import { splitConceptHeading } from "../shared/explanations";
import { getDemo } from "../src/demo";
import learning from "../src/i18n/en/learning";
import license from "../src/i18n/en/license";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const demo = getDemo("en");
const repoId = "e2e-learning-repo";
/** One more than a page of the learning record (20 runs). */
const seededRuns = 23;

/** Run `index` (0 is the oldest) and the concept its one explanation teaches. */
function seededRun(index: number, dataDir: string) {
  const id = `e2e-learning-run-${String(index).padStart(2, "0")}`;
  const created = new Date(Date.UTC(2026, 8, 1, 8, index)).toISOString();
  return {
    id,
    repoId,
    title: `Seeded contribution ${index}`,
    prompt: "A run written into state.json before the start.",
    status: "published",
    branch: `fix/${id}`,
    baseBranch: "main",
    baseSha: "",
    worktreePath: path.join(dataDir, "worktrees", id),
    createdAt: created,
    agents: [],
    logs: [],
    draft: { title: `Seeded contribution ${index}`, body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
    workspaceRemovedAt: created,
    explanations: {
      [`src/seeded-${index}.ts`]: {
        fingerprint: `seeded-${index}`,
        status: "ready",
        generatedAt: created,
        content: {
          summary: "Summary.",
          reason: "Reason.",
          concept: `Seeded concept ${index}\nWhat run ${index} taught.`,
          tip: `Tip for run ${index}.`,
        },
      },
    },
    ...(index === 0
      ? {
          notes: {
            "src/seeded-0.ts": {
              text: "My own note on the oldest run.",
              fingerprint: "seeded-0",
              updatedAt: created,
            },
          },
        }
      : {}),
  };
}

/** Serious and critical axe issues on the page, color contrast included. */
async function axeProblems(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .options({ rules: { "color-contrast": { enabled: true } } })
    .analyze();
  return violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .flatMap((violation) =>
      violation.nodes.map((node) => `${violation.id} at ${node.target.join(" ")}`),
    );
}

test("the learning page shows the sample notes", async ({ page }) => {
  await page.goto("/#/learning?locale=en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(learning.title);
  const sample = page.locator("section.learning-demo");
  await expect(sample.getByRole("heading", { level: 2, name: learning.demoTitle })).toBeVisible();
  const explained = demo.files.filter((file) => file.explanation);
  expect(explained.length).toBeGreaterThan(0);
  await expect(sample.locator(".note-card")).toHaveCount(explained.length);
  for (const file of explained) {
    const { heading } = splitConceptHeading(file.explanation!.concept);
    await expect(sample.getByRole("heading", { name: heading || file.path })).toBeVisible();
  }
  await expect(page.getByText(learning.aiNote)).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);
});

test("seeded notes load from /api/learning, 20 contributions at a time", async ({ browser }) => {
  const server = await launchServer({
    seed: (dataDir) =>
      writeFile(
        path.join(dataDir, "state.json"),
        JSON.stringify({
          version: 1,
          repos: [
            {
              id: repoId,
              name: "learning",
              owner: "e2e-sample",
              fullName: "e2e-sample/learning",
              path: path.join(dataDir, "repos", "learning"),
              defaultBranch: "main",
              url: "",
            },
          ],
          runs: Array.from({ length: seededRuns }, (_, index) =>
            seededRun(index, dataDir),
          ),
        }),
      ),
  });
  const context = await browser.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
    locale: "en-US",
  });
  try {
    const page = await context.newPage();
    const learningRequests: Request[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/learning")
        learningRequests.push(request);
    });
    const listed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/runs",
    );
    await page.goto("/#/learning?locale=en");

    // The polled runs list no longer carries explanations or notes.
    const { runs } = (await (await listed).json()) as {
      runs: Record<string, unknown>[];
    };
    expect(runs).toHaveLength(seededRuns);
    for (const run of runs) {
      expect(run).not.toHaveProperty("explanations");
      expect(run).not.toHaveProperty("notes");
    }

    const own = page.locator(".learning-grid").first();
    const cards = own.locator(".note-card");
    const loadMore = page.getByRole("button", { name: learning.loadMore, exact: true });
    // The newest 20 contributions first.
    await expect(cards).toHaveCount(20);
    await expect(own.getByRole("heading", { name: "Seeded concept 22" })).toBeVisible();
    await expect(own.getByRole("heading", { name: "Seeded concept 3", exact: true })).toBeVisible();
    await expect(own.getByRole("heading", { name: "Seeded concept 2", exact: true })).toHaveCount(0);
    await expect(page.locator("#learning-count")).toHaveText(
      learning.noteCountMore({ visible: 20, total: 20 }),
    );
    await expect(cards.first().locator(".note-ai-label")).toHaveText(learning.aiGenerated);
    await expect(loadMore).toBeVisible();
    expect(learningRequests.map((request) => new URL(request.url()).search)).toEqual([""]);

    await loadMore.click();
    await expect(cards).toHaveCount(seededRuns);
    await expect(loadMore).toHaveCount(0);
    await expect(page.locator("#learning-count")).toHaveText(
      learning.noteCount({ visible: seededRuns, total: seededRuns }),
    );
    // The second page was asked for with the first page's cursor.
    expect(learningRequests).toHaveLength(2);
    expect(new URL(learningRequests[1].url()).searchParams.get("cursor")).toBeTruthy();
    // Focus moves to the first note the page brought in.
    await expect(own.getByRole("heading", { name: "Seeded concept 2", exact: true })).toBeFocused();
    const oldest = cards.filter({ hasText: "Seeded concept 0" });
    await expect(oldest.locator(".learning-own-note")).toContainText(
      "My own note on the oldest run.",
    );

    expect(await axeProblems(page)).toEqual([]);

    // The filters work on every page read so far.
    await page.getByPlaceholder(learning.keywordPlaceholder).fill("Seeded concept 1");
    await expect(cards).toHaveCount(1 + 10);
  } finally {
    await context.close();
    await server.stop();
  }
});

/** A signed-in page on a spec-local server; closed with the server. */
async function onServer(
  browser: Browser,
  options: Parameters<typeof launchServer>[0],
  fn: (page: Page, server: LaunchedServer) => Promise<void>,
) {
  const server = await launchServer(options);
  const context = await browser.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
    locale: "en-US",
  });
  try {
    await fn(await context.newPage(), server);
  } finally {
    await context.close();
    await server.stop();
  }
}

/** One imported project with one published contribution, nothing else. */
const debriefRepo = {
  id: "e2e-debrief-repo",
  name: "debrief",
  owner: "e2e-sample",
  fullName: "e2e-sample/debrief",
  defaultBranch: "main",
  url: "",
};
function publishedState(dataDir: string, repoExtra: Record<string, unknown> = {}) {
  const id = "e2e-debrief-run";
  return JSON.stringify({
    version: 1,
    repos: [{ ...debriefRepo, path: path.join(dataDir, "repos", "debrief"), ...repoExtra }],
    runs: [
      {
        id,
        repoId: debriefRepo.id,
        title: "Published contribution",
        prompt: "A run written into state.json before the start.",
        status: "published",
        branch: `fix/${id}`,
        baseBranch: "main",
        baseSha: "",
        worktreePath: path.join(dataDir, "worktrees", id),
        createdAt: "2026-10-01T08:00:00.000Z",
        workspaceRemovedAt: "2026-10-02T08:00:00.000Z",
        agents: [],
        logs: [],
        draft: { title: "Published contribution", body: "" },
        reviewedFiles: [],
        reviewedFingerprints: {},
        reports: {},
      },
    ],
  });
}

test("on Free the coach debrief opens the upgrade dialog without a request, and the sample shows", async ({ browser }) => {
  await onServer(
    browser,
    { seed: (dataDir) => writeFile(path.join(dataDir, "state.json"), publishedState(dataDir)) },
    async (page) => {
      const posts: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === "/api/learning/debrief")
          posts.push(request.url());
      });
      await page.goto("/#/learning?view=debrief&locale=en");
      await expect(page.locator('.learning-views a[aria-current="page"]')).toHaveText(learning.views.debrief);
      const view = page.locator("section.debrief");
      await expect(view.getByRole("heading", { level: 2, name: learning.debrief.title })).toBeVisible();
      await expect(view.getByLabel(learning.debrief.project)).toHaveValue(debriefRepo.id);
      const request = view.getByRole("button", { name: new RegExp(`^${learning.debrief.request}`) });
      // The plan is known once the PRO badge shows.
      await expect(request.locator(".pro-badge")).toBeVisible();
      await expect(view).toContainText(learning.debrief.locked);
      await request.click();
      const dialog = page.getByRole("dialog", { name: license.upgrade.title });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(license.upgrade.featureNeedsPro.coachDebrief);
      expect(posts).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);

      // With no debrief of its own, the sample shows, labelled PRO.
      const sample = view.locator("section.debrief-sample");
      await expect(sample.getByRole("heading", { level: 2, name: new RegExp(learning.debrief.sampleTitle) })).toBeVisible();
      await expect(sample.locator(".pro-badge")).toBeVisible();
      await expect(sample).toContainText(demo.debriefSample!.nextStep);
      const toggle = sample.getByRole("button", { name: learning.debrief.showTradeOff });
      await toggle.click();
      await expect(sample.getByRole("button", { name: learning.debrief.hideTradeOff })).toHaveAttribute("aria-expanded", "true");
      await expect(sample).toContainText(demo.debriefSample!.drills![0].reveal);
      expect(await axeProblems(page)).toEqual([]);
    },
  );
});
