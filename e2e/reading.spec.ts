// Reading a change on a real run, against the seeded project of
// e2e/helpers/real-project.ts with one more file whose function changes in
// two places: the unchanged code around each change, read from the run's
// base; the code walkthrough an agent writes (the stand-in codex answers
// with what a test sets); the lead's premise check made again on the
// overview; the setup a teammate could not find; and, on a published run,
// the commits read from its worktree. The tests of each server share it
// and run in order. Axe checks each new view.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNoOverflow } from "./helpers/overflow";
import { prUrl, runId, startRealProject, type RealProject } from "./helpers/real-project";
import { messages } from "./helpers/sample-states";

const t = messages.en;
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

async function axe(page: Page, include: string) {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  const serious = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

function opener(project: () => RealProject) {
  return async (browser: Browser) => {
    const context = await browser.newContext({
      baseURL: project().baseURL,
      storageState: project().storageState,
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
      await expect(setup).toContainText(t.team.setupNeeds.reportedBy({ names: "Member 1" }));
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
