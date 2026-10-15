// The learning page: the sample notes, a person's own notes read page by
// page from GET /api/learning, and the coach debrief view (Pro).
import { writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type Request } from "@playwright/test";
import { splitConceptHeading } from "../shared/explanations";
import { getDemo } from "../src/demo";
import app from "../src/i18n/en/app";
import learning from "../src/i18n/en/learning";
import license from "../src/i18n/en/license";
import settings from "../src/i18n/en/settings";
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

test("on the trial the debrief is asked for with the project only, and the new debrief replaces the sample", async ({ browser }) => {
  // POST /api/learning/debrief is stubbed: writing a real one needs an
  // agent. The server side (402 on Free, stored on the trial) is tested
  // with the learning-loop routes.
  const written = {
    at: "2026-10-12T09:00:00.000Z",
    locale: "en",
    runIds: ["e2e-debrief-run"],
    recurring: { dimension: "naming", quotes: ["Please call it retryDelay, as the rest of the client does."] },
    drills: [
      {
        context: "How the client names its wait setting.",
        optionA: "delay",
        optionB: "retryDelay",
        question: "Which fits this project, and why?",
        reveal: "retryDelay matches the client's other retry options; delay is shorter but vague.",
      },
    ],
    nextStep: "Before your next pull request here, read how the client names its options.",
  };
  await onServer(
    browser,
    { seed: (dataDir) => writeFile(path.join(dataDir, "state.json"), publishedState(dataDir)) },
    async (page) => {
      const trial = await page.request.post("/api/license/trial", { data: {} });
      expect(trial.status()).toBe(200);
      const posts: unknown[] = [];
      let practiceReads = 0;
      let answer: () => void = () => undefined;
      const answered = new Promise<void>((resolve) => {
        answer = resolve;
      });
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/learning/practice") practiceReads++;
      });
      await page.route("**/api/learning/debrief", async (route) => {
        posts.push(route.request().postDataJSON());
        await answered;
        await route.fulfill({ json: { debrief: written } });
      });
      await page.goto("/#/learning?view=debrief&locale=en");
      const view = page.locator("section.debrief");
      const request = view.getByRole("button", { name: learning.debrief.request, exact: true });
      await expect(view.getByLabel(learning.debrief.project)).toHaveValue(debriefRepo.id);
      // Nothing is locked on the trial; the sample shows while the project has no debrief.
      await expect(view.locator("section.debrief-sample")).toBeVisible();
      await expect(request.locator(".pro-badge")).toHaveCount(0);
      await expect(view).not.toContainText(learning.debrief.locked);

      const readsBefore = practiceReads;
      await request.click();
      await expect(view.getByRole("status").filter({ hasText: learning.debrief.working })).toBeVisible();
      await expect(request).toBeDisabled();
      answer();
      await expect(view.getByRole("status").filter({ hasText: learning.debrief.ready })).toBeVisible();
      expect(posts).toEqual([{ repoId: debriefRepo.id }]);
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const card = view.locator(".debrief-list .debrief-card");
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(learning.debrief.recurring({ dimension: learning.dimensions.naming }));
      await expect(card.locator("blockquote")).toHaveText(written.recurring.quotes[0]);
      await expect(card).toContainText(written.nextStep);
      // The trade-off waits until the person asks for it.
      const tradeOff = card.locator(".debrief-trade-off");
      await expect(tradeOff).toBeHidden();
      await card.getByRole("button", { name: learning.debrief.showTradeOff }).click();
      await expect(tradeOff).toBeVisible();
      await expect(tradeOff).toContainText(written.drills[0].reveal);
      await expect(view.locator("section.debrief-sample")).toHaveCount(0);
      // Its drills join the practice deck, so the sidebar counts again.
      await expect.poll(() => practiceReads).toBeGreaterThan(readsBefore);
      expect(await axeProblems(page)).toEqual([]);
    },
  );
});

test("the notes show each contribution's own explanation and mark runs approved without the check", async ({ browser }) => {
  const summary =
    "The retry waited the same time after every failure. Now each wait doubles up to a cap, so a busy server can recover before the next attempt.";
  await onServer(
    browser,
    {
      seed: (dataDir) => {
        const [checked, unchecked] = [0, 1].map((index) => ({
          ...seededRun(index, dataDir),
          status: "approved",
          title: index ? "Approved with the check off" : "Explained back",
        }));
        return writeFile(
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
            runs: [
              {
                ...checked,
                understanding: {
                  summary: { text: summary, changeFingerprint: "c1", at: "2026-09-01T09:00:00.000Z" },
                },
              },
              { ...unchecked, understandingCheckOff: true },
            ],
          }),
        );
      },
    },
    async (page) => {
      await page.goto("/#/learning?locale=en");
      const runs = page.locator("section.learning-runs");
      await expect(runs.getByRole("heading", { level: 2, name: learning.runs.title })).toBeVisible();
      const explained = runs.locator(".learning-run-card").filter({ hasText: "Explained back" });
      await expect(explained.locator(".learning-own-note")).toContainText(summary);
      await expect(explained.locator(".learning-check-off")).toHaveCount(0);
      const off = runs.locator(".learning-run-card").filter({ hasText: "Approved with the check off" });
      await expect(off.locator(".learning-check-off")).toHaveText(learning.runs.checkOff);
      await expect(off).toContainText(learning.runs.checkOffText);
      // The file notes still follow.
      await expect(page.locator(".learning-grid").first().locator(".note-card")).toHaveCount(2);
      expect(await axeProblems(page)).toEqual([]);
    },
  );
});

// MERGE-STEP: the next two tests run against the learning-loop routes
// (GET /api/learning/practice, POST /api/runs/:id/practice,
// GET /api/learning/counts, GET /api/learning/debriefs and
// POST /api/learning/debrief). Before those routes exist they answer 404,
// and the tests skip themselves; after the L2 merge they run.

/** A run approved after its check, with a confident miss, and one approved with the check off. */
function checkedState(dataDir: string) {
  const at = "2026-10-01T09:00:00.000Z";
  const base = (id: string, title: string) => ({
    id,
    repoId: debriefRepo.id,
    title,
    prompt: "A run written into state.json before the start.",
    status: "approved",
    branch: `fix/${id}`,
    baseBranch: "main",
    baseSha: "",
    worktreePath: path.join(dataDir, "worktrees", id),
    createdAt: at,
    workspaceRemovedAt: at,
    agents: [],
    logs: [],
    draft: { title, body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
  });
  return JSON.stringify({
    version: 1,
    repos: [{ ...debriefRepo, path: path.join(dataDir, "repos", "debrief") }],
    runs: [
      {
        ...base(checkedRun.id, "Explained contribution"),
        understanding: {
          summary: {
            text: "Writes used to clear the whole cache. Now a write drops only its own key, so other reads stay fast and none of them sees stale data.",
            changeFingerprint: "c1",
            at,
          },
          items: [
            {
              id: checkedRun.itemId,
              path: "src/cache.ts",
              fingerprint: "f1",
              source: "selfCheck",
              question: checkedRun.question,
              answer: "It clears the whole cache to be safe.",
              confidence: "sure",
              lockedAt: at,
              grade: "missed",
              correction: checkedRun.correction,
              gradedAt: at,
            },
          ],
          passedAt: at,
          passedFingerprint: "c1",
          history: [{ passedAt: at, questions: 1, misses: 1, confidentMisses: 1, seconds: 200 }],
        },
      },
      { ...base("e2e-check-off-run", "Approved with the check off"), understandingCheckOff: true },
    ],
  });
}
const checkedRun = {
  id: "e2e-checked-run",
  itemId: "selfCheck:src/cache.ts",
  question: "What does the cache drop after a write, and why?",
  correction: "Only the written key's entry is dropped, not the whole cache.",
};

test("MERGE-STEP: the deck grades a seeded confident miss through the learning-loop routes, and the counts read every run", async ({ browser }) => {
  await onServer(
    browser,
    { seed: (dataDir) => writeFile(path.join(dataDir, "state.json"), checkedState(dataDir)) },
    async (page) => {
      const probe = await page.request.get("/api/learning/practice");
      test.skip(probe.status() === 404, "needs the learning-loop routes (L2A); runs after the L2 merge");
      expect(probe.status()).toBe(200);

      await page.goto("/#/learning?view=practice&locale=en");
      const p = learning.practice;
      const card = page.locator(".practice > .practice-card");
      await expect(card.getByRole("heading", { level: 3, name: checkedRun.question })).toBeVisible();
      await expect(page.locator("section.practice-sample")).toHaveCount(0);
      await expect(page.locator(".sidebar .learning-ready")).toHaveText(app.sidebar.practiceReady({ count: 1 }));
      const answer = "Only the entry of the key that was written, so reads stay correct.";
      await card.getByLabel(p.answer).fill(answer);
      await card.getByRole("radio", { name: p.confidences.sure }).check();
      await card.getByRole("button", { name: p.show }).click();
      await expect(card.locator(".learning-own-note")).toContainText(checkedRun.correction);
      await expect(card).toContainText(p.cleanedUp);
      const graded = page.waitForResponse(
        (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/runs/${checkedRun.id}/practice`,
      );
      await card.getByRole("button", { name: new RegExp(`^${p.grades.got}`) }).click();
      expect((await graded).status()).toBe(200);
      // A new item graded Got it comes back in 3 days.
      await expect(card.locator(".practice-next")).toHaveText(p.nextReview({ days: 3 }));
      await expect(page.locator(".sidebar .learning-ready")).toHaveCount(0);
      // Only the grade is stored, never the answer.
      const { run } = await (await page.request.get(`/api/runs/${checkedRun.id}`)).json();
      expect(run.practice[`check:${checkedRun.itemId}`]).toMatchObject({ box: 1, lastGrade: "got", lastConfidence: "sure" });
      expect(JSON.stringify(run.practice)).not.toContain(answer);
      await card.getByRole("button", { name: p.finish }).click();
      await expect(page.locator(".practice-empty-title")).toHaveText(p.empty);
      await expect(page.locator(".practice-empty")).toContainText(p.nextReview({ days: 3 }));

      // The counts come from every run, notes or not.
      await page.goto("/#/learning?locale=en");
      await expect(page.locator(".learning-counts")).toContainText(
        learning.counts.explained({ explained: 1, of: 2, checkOff: 1 }),
      );
      await page.goto("/#/settings/learning?locale=en");
      await expect(page.locator(".settings-learning-counts")).toContainText(
        settings.learning.counts.checkOff({ count: 1 }),
      );
      // One timed check is too few for a median.
      await expect(page.locator(".settings-learning-counts")).not.toContainText("Median");
    },
  );
});

test("MERGE-STEP: the debrief is Pro on Free, and stored debriefs read on every plan", async ({ browser }) => {
  const stored = {
    at: "2026-10-06T12:00:00.000Z",
    locale: "en",
    runIds: ["e2e-debrief-run"],
    recurring: { dimension: "tests", quotes: ["Please add a test for the exhausted case."] },
    drills: [],
    nextStep: "Before your next pull request here, write the test for the last attempt first.",
  };
  await onServer(
    browser,
    {
      seed: (dataDir) =>
        writeFile(path.join(dataDir, "state.json"), publishedState(dataDir, { debriefs: [stored] })),
    },
    async (page) => {
      const read = await page.request.get(`/api/learning/debriefs?repoId=${debriefRepo.id}`);
      test.skip(read.status() === 404, "needs the learning-loop routes (L2A); runs after the L2 merge");
      expect(read.status()).toBe(200);
      expect((await read.json()).debriefs).toMatchObject([{ nextStep: stored.nextStep }]);
      const post = await page.request.post("/api/learning/debrief", { data: { repoId: debriefRepo.id } });
      expect(post.status()).toBe(402);
      expect(await post.json()).toMatchObject({ code: "pro_required", feature: "coachDebrief" });

      await page.goto("/#/learning?view=debrief&locale=en");
      const list = page.locator("section.debrief .debrief-list");
      await expect(list.locator(".debrief-card")).toHaveCount(1);
      await expect(list).toContainText(stored.nextStep);
      await expect(list).toContainText(learning.debrief.recurring({ dimension: learning.dimensions.tests }));
      await expect(page.locator("section.debrief-sample")).toHaveCount(0);
    },
  );
});
