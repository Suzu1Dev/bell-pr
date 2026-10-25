// Reading a change on a real run, against the seeded project of
// e2e/helpers/real-project.ts with one more file whose function changes in
// two places: the unchanged code around each change, read from the run's
// base; the code walkthrough an agent writes (the stand-in codex answers
// with what a test sets); the lead's premise check made again on the
// overview; the setup a teammate could not find; on a published run,
// the commits read from its worktree; and, on a Learn-by-hand run marked
// ready, no explanation or walkthrough asked for on its own, the reader
// view and the check it opens, and a reload while they are written (the
// stand-in's turn held) read with GETs only. The tests of each server
// share it and run in order. Axe checks each new view.
import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type Browser, type Page } from "@playwright/test";
import { readyNow } from "../shared/by-hand";
import { changeFingerprint } from "../shared/change-fingerprint";
import panelStrings from "../src/review/i18n/en";
import panelStringsZh from "../src/review/i18n/zh-TW";
import { expectNoOverflow } from "./helpers/overflow";
import { messages } from "./helpers/messages";
import { files, prUrl, runId, startRealProject, type RealProject } from "./helpers/real-project";

const t = messages.en;
const zh = messages["zh-TW"];
const tablePath = "src/table.ts";
const rows = Array.from({ length: 50 }, (_, index) => `export const row${index + 1} = ${index + 1};`);
/** total() and 50 rows: the change edits line 3 and row 40 (line 46). */
const tableBefore = [
  "export function total(values: number[]) {",
  "  let sum = 0;",
  "  for (const value of values) sum += value;",
  "  return sum;",
  "}",
  ...rows,
  "",
].join("\n");
const tableAfter = tableBefore
  .replace("  for (const value of values) sum += value;", "  for (const value of values) sum += Number.isFinite(value) ? value : 0;")
  .replace("export const row40 = 40;", "export const row40 = 400;");

const premise = {
  verdict: "refuted",
  statement: "The table's total counts values that are not numbers.",
  evidence: "src/table.ts:3 adds every value, NaN included, before the change.",
};
const team = {
  config: {
    maxTeammates: 2,
    requirePlanApproval: true,
    provider: "codex",
    protocol: "bell-shared-tasks",
    messageDelivery: "between-turns",
  },
  phase: "complete",
  planSummary: "One task: skip values that are not finite numbers in total().",
  tasks: [
    {
      id: "task-1",
      title: "Skip values that are not numbers",
      description: "Change total() in src/table.ts.",
      owner: "member-1",
      files: [tablePath],
      dependsOn: [],
      status: "complete",
      setup: [
        {
          need: "Deno for the benchmark",
          command: "curl -fsSL https://deno.land/install.sh | sh",
          reason: "npm run bench runs on Deno, as CONTRIBUTING.md says; it did not run here.",
        },
      ],
    },
  ],
  messages: [],
};

/** What the stand-in codex answers a walkthrough of src/table.ts. */
const walkthroughAnswer = JSON.stringify({
  functions: [
    {
      name: "total",
      kind: "function",
      startLine: 1,
      endLine: 5,
      summary: "Adds up the values.",
      change: "Values that are not finite numbers now add 0.",
      steps: [
        { startLine: 2, endLine: 2, explanation: "Starts the sum at 0." },
        { startLine: 3, endLine: 3, explanation: "Adds each finite value." },
      ],
      callers: [],
      callees: [],
      analogy: "Like a cashier who skips torn notes.",
      selfCheck: { question: "What does total([1, NaN]) return?", answer: "1." },
    },
  ],
  newUnits: [],
});

/**
 * What the stand-in codex answers a walkthrough of src/greeting.ts in the
 * Learn-by-hand run; BELL reads greeting() as new code, so the walkthrough
 * says the file's changes are all new.
 */
const greetingWalkthrough = JSON.stringify({
  functions: [
    {
      name: "greeting",
      kind: "function",
      startLine: 49,
      endLine: 53,
      summary: "Greets a person in their language.",
      change: "The greeting now comes from a table of languages, with English when a language has none.",
      steps: [{ startLine: 50, endLine: 50, explanation: "Picks the language's greeting, or the English one." }],
      callers: [],
      callees: [],
      analogy: "Like a phrase book that opens at English when a page is missing.",
      selfCheck: { question: "What does a language without a greeting get?", answer: "The English greeting." },
    },
  ],
  newUnits: [],
});

/** The explanation and walkthrough states of `path` in the run's diff, read with a GET. */
async function readerStatus(page: Page, path: string) {
  const { files: diff } = (await (await page.request.get(`/api/runs/${runId}/diff`)).json()) as {
    files: { path: string; explanationStatus?: string; walkthroughStatus?: string }[];
  };
  const file = diff.find((entry) => entry.path === path);
  return [file?.explanationStatus, file?.walkthroughStatus];
}

async function axe(page: Page, include: string) {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  const serious = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

function opener(project: () => RealProject) {
  return async (browser: Browser) => {
    const context = await browser.newContext({
      baseURL: project().baseURL,
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      timezoneId: "UTC",
      reducedMotion: "reduce",
    });
    return { page: await context.newPage(), close: () => context.close() };
  };
}

test.describe("reading a real run in review", () => {
  test.describe.configure({ mode: "serial" });
  let project: RealProject;
  const open = opener(() => project);
  test.beforeAll(async () => {
    project = await startRealProject({
      extraFiles: [{ path: tablePath, before: tableBefore, after: tableAfter }],
      run: {
        prompt: "Assumption (unverified): total() counts values that are not numbers. Skip them.",
        team,
        agents: [{ id: "member-1", name: "Member 1", role: "Teammate", status: "complete", detail: "" }],
      },
    });
    // Each code file's walkthrough is asked for as soon as the run opens.
    await project.setAgentAnswer(walkthroughAnswer);
  });
  test.afterAll(async () => {
    await project?.stop();
  });

  test("1. the unchanged code around a change opens 20 lines at a time, all at once, or as the whole file", async ({ browser }) => {
    const { page, close } = await open(browser);
    try {
      await page.goto(`/#/runs/${runId}/changes?file=${tablePath}&locale=en`);
      const diff = page.locator(".rv-diff");
      await expect(diff.locator(".rv-line-added")).toHaveCount(2);
      // Lines 7 to 41 sit between the two changes; more follow the last one.
      const gap = diff.locator(".rv-gap").filter({ hasText: t.review.diff.gap.hidden({ count: 35 }) });
      await expect(gap).toHaveCount(1);
      await gap.getByRole("button", { name: t.review.diff.gap.showBelow({ count: 20 }) }).click();
      await expect(diff.locator(".rv-gap").filter({ hasText: t.review.diff.gap.hidden({ count: 15 }) })).toHaveCount(1);
      // The lines come from the base and are marked as context read from it.
      await expect(diff.locator(".rv-line-expanded").first()).toBeVisible();
      await expect(diff.locator(".rv-line-expanded", { hasText: "export const row2 = 2;" })).toHaveCount(1);
      await diff
        .locator(".rv-gap")
        .filter({ hasText: t.review.diff.gap.hidden({ count: 15 }) })
        .getByRole("button", { name: t.review.diff.gap.showAll({ count: 15 }) })
        .click();
      await expect(diff.locator(".rv-gap").filter({ hasText: t.review.diff.gap.hidden({ count: 15 }) })).toHaveCount(0);
      await expect(diff.locator(".rv-line-expanded", { hasText: "export const row36 = 36;" })).toHaveCount(1);
      // The whole file shows every line, the last ones included.
      const whole = page.getByRole("button", { name: t.review.diff.gap.wholeFile });
      await whole.click();
      await expect(whole).toHaveAttribute("aria-pressed", "true");
      await expect(diff.locator(".rv-line", { hasText: "export const row50 = 50;" })).toHaveCount(1);
      await expect(diff.locator(".rv-gap")).toHaveCount(0);
      await axe(page, ".rv-diff");
      await expectNoOverflow(page, [".rv-diff"]);
    } finally {
      await close();
    }
  });

  test("2. the code walkthrough an agent writes for the function marks its lines in the diff", async ({ browser }) => {
    const { page, close } = await open(browser);
    try {
      await page.goto(`/#/runs/${runId}/changes?file=${tablePath}&locale=en`);
      await page.getByRole("tab", { name: t.review.panel.tabs.walkthrough }).click();
      const card = page.locator(".walkthrough-card");
      await expect(card.locator(".walkthrough-title strong")).toHaveText("total", { timeout: 30_000 });
      await expect(card.getByText("Adds each finite value.")).toBeVisible();
      // A step's line button marks its lines in the diff.
      const step = card.getByRole("button", { name: t.review.walkthrough.lines({ start: 3, end: 3 }) });
      await expect(step).toHaveAttribute("title", t.review.walkthrough.locateStep);
      await step.click();
      await expect(step).toHaveAttribute("aria-pressed", "true");
      const marked = page.locator(".rv-diff .rv-line-highlighted");
      await expect(marked).toHaveCount(1);
      await expect(marked).toContainText("Number.isFinite(value)");
      await axe(page, ".explain-panel");
      await expectNoOverflow(page, [".explain-panel"]);
    } finally {
      await close();
    }
  });

  test("3. the overview lists the missing setup, and the premise is checked again against the code", async ({ browser }) => {
    await project.setAgentAnswer(JSON.stringify({ premise }));
    const { page, close } = await open(browser);
    try {
      await page.goto(`/#/runs/${runId}/overview?locale=en`);
      // The stand-in agent gives every turn the same answer: let the
      // walkthroughs and explanations finish before it answers the premise.
      await expect
        .poll(
          async () => {
            const { files } = (await (await page.request.get(`/api/runs/${runId}/diff`)).json()) as {
              files: { walkthroughStatus?: string; explanationStatus?: string }[];
            };
            return files.filter(
              (file) =>
                file.walkthroughStatus === "pending" ||
                file.walkthroughStatus === "generating" ||
                file.explanationStatus === "generating",
            ).length;
          },
          { timeout: 30_000 },
        )
        .toBe(0);
      const setup = page.locator(".setup-needs");
      await expect(setup.getByRole("heading", { name: t.team.setupNeeds.title })).toBeVisible();
      await expect(setup).toContainText("Deno for the benchmark");
      await expect(setup).toContainText(
        t.team.setupNeeds.reportedBy({ names: t.team.setupNeeds.agent({ name: "Member 1", id: "member-1" }) }),
      );
      await expect(setup.locator("code")).toHaveText("curl -fsSL https://deno.land/install.sh | sh");
      // A run made before premise checks offers one; the verdict then leads the brief.
      const brief = page.locator("#overview-contribution");
      await brief.getByRole("button", { name: t.mission.brief.premiseCheck }).click();
      await expect(brief.locator(".premise-notice.premise-refuted")).toContainText(premise.evidence);
      await expect(brief.getByRole("button", { name: t.mission.brief.premiseRecheck })).toBeVisible();
      await axe(page, ".mission-overview");
      // The code changes tab carries the verdict folded, on one row with the worktree.
      await page.goto(`/#/runs/${runId}/changes?locale=en`);
      const bar = page.locator(".diff-context-bar");
      await expect(bar.locator(".premise-compact summary")).toContainText(premise.statement);
      await expect(bar.locator(".worktree-hint")).toContainText(t.workspace.changes.worktreeLabel);
      await axe(page, ".diff-context-bar");
    } finally {
      await close();
    }
  });
});

test.describe("the commits of a published real run", () => {
  test.describe.configure({ mode: "serial" });
  let project: RealProject;
  const open = opener(() => project);
  test.beforeAll(async () => {
    project = await startRealProject({ published: true });
  });
  test.afterAll(async () => {
    await project?.stop();
  });

  test("the history lists the first push from the worktree, linked to the PR, and opens its files' diffs", async ({ browser }) => {
    const { page, close } = await open(browser);
    try {
      await page.goto(`/#/runs/${runId}/commits?locale=en`);
      const history = page.locator(".commit-history");
      await expect(history.getByRole("heading", { name: t.review.commits.title })).toBeVisible();
      const commit = history.locator(".commit-item");
      await expect(commit).toHaveCount(1);
      await expect(commit).toContainText(t.review.commits.sources.initial);
      await expect(commit).toContainText("Greet people in their own language");
      await expect(commit).toContainText("Sample Contributor");
      await expect(commit.getByRole("link")).toHaveAttribute("href", new RegExp(`^${prUrl}/commits/[0-9a-f]{40}$`));
      await commit.getByRole("button", { name: t.review.commits.show }).click();
      const files = commit.locator(".commit-files .file-item");
      await expect(files).toHaveCount(3);
      await files.filter({ hasText: "src/greeting.ts" }).click();
      await expect(commit.locator(".rv-line-added").first()).toBeVisible();
      await axe(page, ".commit-history");
      await expectNoOverflow(page, [".commit-history"]);
    } finally {
      await close();
    }
  });
});

test.describe("a Learn-by-hand run in review, marked ready", () => {
  test.describe.configure({ mode: "serial" });
  let project: RealProject;
  let ready: string;
  const open = opener(() => project);
  test.beforeAll(async () => {
    // A file's fingerprint depends only on its path and patch, so the
    // seeded project's change has the same fingerprint on every start: read
    // it from a first one, and mark that version ready on the second.
    const first = await startRealProject();
    try {
      const api = await request.newContext({ baseURL: first.baseURL });
      const { files: diff } = (await (await api.get(`/api/runs/${runId}/diff`)).json()) as {
        files: { path: string; fingerprint: string }[];
      };
      ready = changeFingerprint(diff);
      await api.dispose();
    } finally {
      await first.stop();
    }
    project = await startRealProject({
      run: {
        learnByHand: true,
        // Nothing explained yet: an explanation comes only on a click after Ready.
        explanations: {},
        byHand: { ready: { at: "2026-10-14T10:00:00.000Z", changeFingerprint: ready, review: false } },
      },
    });
  });
  test.afterAll(async () => {
    await project?.stop();
  });

  test("no explanation or walkthrough is asked for on load or on a refresh", async ({ browser }) => {
    const { page, close } = await open(browser);
    const asked: string[] = [];
    page.on("request", (sent) => {
      const { pathname } = new URL(sent.url());
      if (sent.method() === "POST" && /^\/api\/runs\/[^/]+\/(explanations|walkthroughs)$/.test(pathname))
        asked.push(pathname);
    });
    try {
      const { run } = (await (await page.request.get(`/api/runs/${runId}`)).json()) as {
        run: Parameters<typeof readyNow>[0];
      };
      const { files: diff } = (await (await page.request.get(`/api/runs/${runId}/diff`)).json()) as {
        files: { path: string; fingerprint: string; explanationStatus?: string; walkthroughStatus?: string }[];
      };
      // The seeded run is Learn by hand, ready at this version, and its files wait.
      expect(readyNow(run, diff)).toBe(true);
      expect(diff.find((file) => file.path === files.greeting)?.explanationStatus).toBe("pending");
      expect(diff.find((file) => file.path === files.greeting)?.walkthroughStatus).toBe("pending");
      await page.goto(`/#/runs/${runId}/changes?file=${files.greeting}&locale=en`);
      await expect(page.locator(".file-item.selected")).toHaveAttribute("title", files.greeting);
      await expect(page.locator(".explain-panel")).toBeVisible();
      await page.getByRole("tab", { name: t.review.panel.tabs.walkthrough }).click();
      await page.locator(`.file-item[title="${files.format}"]`).click();
      await expect(page.locator(".file-item.selected")).toHaveAttribute("title", files.format);
      await page.reload();
      await expect(page.locator(".explain-panel")).toBeVisible();
      // The polls and refreshes of a few seconds pass; the network log stays empty.
      await page.waitForTimeout(3_000);
      expect(asked).toEqual([]);
      const after = (await (await page.request.get(`/api/runs/${runId}/diff`)).json()) as {
        files: { explanationStatus?: string; walkthroughStatus?: string }[];
      };
      expect(after.files.filter((file) => file.explanationStatus === "generating" || file.walkthroughStatus === "generating")).toEqual([]);
    } finally {
      await close();
    }
  });

  // The reader view shows because the Changes tab passes byHandReview to
  // ExplanationPanel (W2D's mount, with the check view and openCheckPanel).
  test("the reader view says to answer the file's question first and opens the check", async ({ browser }) => {
    const { page, close } = await open(browser);
    try {
      await page.goto(`/#/runs/${runId}/changes?file=${files.greeting}&locale=en`);
      const panel = page.locator(".explain-panel");
      await expect(panel.getByRole("heading", { name: panelStrings.reader.title })).toBeVisible();
      await expect(panel).toContainText(panelStrings.reader.answerFirst);
      await expect(panel).not.toContainText(panelStrings.reader.show);
      await panel.getByRole("button", { name: t.workspace.check.title }).click();
      await expect(page.locator(".understanding-check")).toBeVisible();
      await axe(page, ".understanding-check");
    } finally {
      await close();
    }
  });

  test("from the reader view, Explain it back leaves the focus on the check's close button", async ({ browser }) => {
    const { page, close } = await open(browser);
    try {
      await page.goto(`/#/runs/${runId}/changes?file=${files.greeting}&locale=en`);
      const panel = page.locator(".explain-panel");
      await expect(panel.getByRole("heading", { name: panelStrings.reader.title })).toBeVisible();
      await panel.getByRole("button", { name: t.workspace.check.title }).focus();
      await page.keyboard.press("Enter");
      // The check takes the place of the panel that held the button: the focus goes into it, not to the page.
      const check = page.locator(".understanding-check");
      await expect(check.getByRole("button", { name: t.workspace.check.close })).toBeFocused();
      await expect(page.locator("body")).not.toBeFocused();
    } finally {
      await close();
    }
  });

  for (const width of [1440, 390])
    test(`in zh-TW the reader view fits at ${width} px and names its parts for a screen reader`, async ({ browser }) => {
      const { page, close } = await open(browser);
      try {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/#/runs/${runId}/changes?file=${files.greeting}&locale=zh-TW`);
        const panel = page.locator(".explain-panel");
        for (const tab of [zh.review.panel.tabs.explain, zh.review.panel.tabs.walkthrough]) {
          await panel.getByRole("tab", { name: tab }).click();
          await expect(panel.getByRole("heading", { name: panelStringsZh.reader.title })).toBeVisible();
          await expect(panel).toContainText(panelStringsZh.reader.answerFirst);
          await expect(panel.getByRole("button", { name: zh.workspace.check.title })).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          await expectNoOverflow(page, [".explain-panel"]);
          await axe(page, ".explain-panel");
        }
      } finally {
        await close();
      }
    });

  // byHandReview carries checkError and onRetryCheck (useUnderstanding's error and refresh).
  test("when the check can't be read, the reader view says why, and Try again reads it again", async ({ browser }) => {
    const { page, close } = await open(browser);
    const message = "The check is not available right now.";
    await page.route(`**/api/runs/${runId}/understanding`, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: message }) }),
    );
    try {
      await page.goto(`/#/runs/${runId}/changes?file=${files.greeting}&locale=en`);
      const panel = page.locator(".explain-panel");
      await expect(panel.getByRole("alert")).toHaveText(t.workspace.check.loadFailed({ message }));
      await expect(panel.getByRole("button", { name: panelStrings.reader.show })).toHaveCount(0);
      await page.unroute(`**/api/runs/${runId}/understanding`);
      await panel.getByRole("button", { name: t.workspace.check.retry }).click();
      await expect(panel).toContainText(panelStrings.reader.answerFirst);
      await expect(panel.getByRole("alert")).toHaveCount(0);
      // The button gave way; focus stayed in the tab panel.
      await expect(panel.getByRole("tabpanel")).toBeFocused();
    } finally {
      await close();
    }
  });

  test("the Reports tab names the guide and makes no promise about the agent team", async ({ browser }) => {
    const { page, close } = await open(browser);
    try {
      await page.goto(`/#/runs/${runId}/changes?file=${files.greeting}&locale=en`);
      const panel = page.locator(".explain-panel");
      await panel.getByRole("tab", { name: t.review.panel.tabs.reports }).click();
      await expect(panel.locator(".explain-report-author")).toHaveText([panelStrings.guide]);
      await expect(panel).not.toContainText(t.review.reports.sections.tester.author);
      await expect(panel).not.toContainText(t.review.reports.rerunNote);
      await axe(page, ".explain-panel");
    } finally {
      await close();
    }
  });

  // With the check off in Settings the file may be explained at once
  // (DESIGN v1.2 F10), and W2A's server takes one file per request.
  test("with the check off, Show how a reader sees it asks for this file only and keeps focus in the panel", async ({ browser }) => {
    const checkOff = await startRealProject({
      appSettings: { skipUnderstandingCheck: true },
      run: {
        learnByHand: true,
        explanations: {},
        byHand: { ready: { at: "2026-10-14T10:00:00.000Z", changeFingerprint: ready, review: false } },
      },
    });
    const { page, close } = await opener(() => checkOff)(browser);
    const asked: { path: string; body: unknown }[] = [];
    page.on("request", (sent) => {
      const { pathname } = new URL(sent.url());
      if (sent.method() === "POST" && /^\/api\/runs\/[^/]+\/(explanations|walkthroughs)$/.test(pathname))
        asked.push({ path: pathname.split("/").pop()!, body: sent.postDataJSON() });
    });
    try {
      await page.goto(`/#/runs/${runId}/changes?file=${files.greeting}&locale=en`);
      const panel = page.locator(".explain-panel");
      const show = panel.getByRole("button", { name: panelStrings.reader.show });
      await expect(show).toBeEnabled();
      await expect(panel).not.toContainText(panelStrings.reader.answerFirst);
      await show.focus();
      await page.keyboard.press("Enter");
      await expect(show).toHaveCount(0);
      // The button gave way to the progress; focus stays in the tab panel.
      await expect(panel.getByRole("tabpanel")).toBeFocused();
      await expect.poll(() => asked.length).toBe(2);
      expect(asked).toEqual(
        expect.arrayContaining([
          { path: "explanations", body: { retry: true, filePath: files.greeting } },
          { path: "walkthroughs", body: { filePath: files.greeting, retry: true } },
        ]),
      );
    } finally {
      await close();
      await checkOff.stop();
    }
  });

  test("a reload while the reader view's explanation and walkthrough are written updates them with reads only", async ({ browser }) => {
    const checkOff = await startRealProject({
      appSettings: { skipUnderstandingCheck: true },
      run: {
        learnByHand: true,
        explanations: {},
        byHand: { ready: { at: "2026-10-14T10:00:00.000Z", changeFingerprint: ready, review: false } },
      },
    });
    // The agent's turns wait until the test lets them answer: both are still written after the reload.
    await checkOff.holdAgent(true);
    await checkOff.setAgentAnswer(greetingWalkthrough);
    const { page, close } = await opener(() => checkOff)(browser);
    try {
      await page.goto(`/#/runs/${runId}/changes?file=${files.greeting}&locale=en`);
      await page.locator(".explain-panel").getByRole("button", { name: panelStrings.reader.show }).click();
      await expect.poll(() => readerStatus(page, files.greeting)).toEqual(["generating", "generating"]);
      const asked: string[] = [];
      const reads: string[] = [];
      page.on("request", (sent) => {
        const { pathname } = new URL(sent.url());
        if (sent.method() === "POST" && /^\/api\/runs\/[^/]+\/(explanations|walkthroughs)$/.test(pathname))
          asked.push(pathname);
        if (sent.method() === "GET" && pathname === `/api/runs/${runId}/diff`) reads.push(pathname);
      });
      await page.reload();
      await expect(page.locator(".file-item.selected")).toHaveAttribute("title", files.greeting);
      const panel = page.locator(".explain-panel");
      await panel.getByRole("tab", { name: t.review.panel.tabs.walkthrough }).click();
      const writing = panel.getByRole("heading", { name: t.review.walkthrough.generatingTitle });
      await expect(writing).toBeVisible();
      const readsBefore = reads.length;
      await checkOff.holdAgent(false);
      // The card fills in from a read of the diff; this tab never asks for one itself.
      await expect(panel.getByRole("heading", { name: t.review.walkthrough.onlyNewTitle })).toBeVisible({ timeout: 30_000 });
      await expect(writing).toHaveCount(0);
      expect(reads.length).toBeGreaterThan(readsBefore);
      expect(asked).toEqual([]);
      expect((await readerStatus(page, files.greeting))[1]).toBe("ready");
    } finally {
      await close();
      await checkOff.stop();
    }
  });
});
