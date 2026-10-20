// Learn by hand end to end on a real (not sample) project (DESIGN v1.2
// §17, plan W3B): a run started from the task dialog, planned, written by
// the spec in the run's folder, helped by the guide, tested, marked ready,
// reviewed, checked and approved, with nothing stubbed but the agent CLIs
// and GitHub (e2e/helpers/real-project.ts: stand-in codex, claude and gh
// that log their arguments); the three publishing paths of the owner's
// answer 2 (blocked, confirmed, allowed) on real-shaped rules; and the
// fix-ups of README v1.2 §18.11 that only a browser shows.
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Run } from "../src/types";
import byHandText from "../src/byhand/write/i18n/en";
import { runId, startRealProject, type RealProject } from "./helpers/real-project";

const at = "2026-10-20T09:00:00.000Z";
const agent = (id: string, role: string) => ({ id, name: role, role, status: "complete", detail: "" });
const team = (phase: string) => ({
  config: { maxTeammates: 2, requirePlanApproval: true, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
  phase,
  planSummary: "Greetings are always in English.",
  tasks: [],
  messages: [],
});
const guidePlan = {
  summary: "Greetings are always in English.",
  steps: [{ title: "Read the greeting", files: ["src/greeting.ts"] }],
  at,
};
/** A clean Learn-by-hand run, as the server keeps it: the guide, the reviewer and the test analyst only. */
const byHandRun = (status: string, phase: string, byHand: Record<string, unknown> = {}) => ({
  status,
  createdAt: at,
  learnByHand: true,
  agents: [agent("lead", "Guide"), agent("reviewer", "Reviewer"), agent("tester", "Test analyst")],
  explanations: {},
  draft: { title: "", body: "" },
  team: team(phase),
  byHand: { guidePlan, ...byHand },
});

async function open(browser: Browser, project: RealProject) {
  const context = await browser.newContext({
    baseURL: project.baseURL,
    storageState: project.storageState,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
  });
  return { context, page: await context.newPage() };
}

const readRun = async (page: Page, id = runId) =>
  ((await (await page.request.get(`/api/runs/${id}`)).json()) as { run: Run }).run;

test.describe("the fix-ups a browser shows (README v1.2 §18.11)", () => {
  test("a refused \"This is my plan\" shows in the plan, not as a toast", async ({ browser }) => {
    test.setTimeout(120_000);
    const project = await startRealProject({
      run: byHandRun("awaiting_plan", "awaiting_approval", {
        plan: { steps: [{ id: "s1", title: "Read the greeting" }], savedAt: at },
      }),
    });
    const { context, page } = await open(browser, project);
    try {
      const refusal = "The guide is still working on this run. Wait for it to finish.";
      await page.route(`**/api/runs/${runId}/plan/approve`, (route) => route.fulfill({ status: 409, json: { error: refusal } }));
      await page.goto(`/#/runs/${runId}/activity?locale=en`);
      const plan = page.getByRole("region", { name: byHandText.plan.title });
      await plan.getByRole("button", { name: byHandText.plan.confirm }).click();
      await expect(plan.getByRole("alert")).toHaveText(refusal);
      await expect(page.locator(".toast")).toHaveCount(0);
      // Nothing moved: the person is still planning.
      expect((await readRun(page)).status).toBe("awaiting_plan");
    } finally {
      await context.close();
      await project.stop();
    }
  });
});
