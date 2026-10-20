// Learn by hand end to end on a real (not sample) project (DESIGN v1.2
// §17, plan W3B): a run started from the task dialog, planned, written by
// the spec in the run's folder, helped by the guide, tested, marked ready,
// reviewed, checked and approved, with nothing stubbed but the agent CLIs
// and GitHub (e2e/helpers/real-project.ts: stand-in codex, claude and gh
// that log their arguments); the three publishing paths of the owner's
// answer 2 (blocked, confirmed, allowed) on real-shaped rules; and the
// fix-ups of README v1.2 §18.11 that only a browser shows.
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { changeFingerprint } from "../shared/change-fingerprint";
import type { Run } from "../src/types";
import byHandText from "../src/byhand/write/i18n/en";
import workspace from "../src/i18n/en/workspace";
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

/** Opens the publish dialog of an approved run from the Draft tab's footer; approval answers with the run as it is. */
async function publishDialog(page: Page) {
  await page.route(`**/api/runs/${runId}/approve`, async (route) => route.fulfill({ json: await (await page.request.get(`/api/runs/${runId}`)).json() }));
  await page.goto(`/#/runs/${runId}/draft?locale=en`);
  await page.locator(".review-footer").getByRole("button", { name: workspace.footer.approvePr }).click();
  const dialog = page.getByRole("dialog", { name: workspace.publish.title });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText(workspace.publish.factsLoading)).toHaveCount(0, { timeout: 30_000 });
  return dialog;
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

  test("the changed-after-Ready notice comes into a status region that was there before, so it is announced", async ({ browser }) => {
    test.setTimeout(120_000);
    const project = await startRealProject({ run: byHandRun("review", "complete") });
    const { context, page } = await open(browser, project);
    try {
      // Marked ready at the current version, through the real route.
      const { files } = (await (await page.request.get(`/api/runs/${runId}/diff`)).json()) as { files: { path: string; fingerprint: string }[] };
      const ready = await page.request.post(`/api/runs/${runId}/by-hand/ready`, { data: { changeFingerprint: changeFingerprint(files), review: false } });
      expect(ready.ok()).toBe(true);
      await page.goto(`/#/runs/${runId}/changes?locale=en`);
      await expect(page.locator(".file-item").first()).toBeVisible();
      // The live region (just above the files and the diff) is on the page, empty, while the
      // change is the version marked ready.
      const notice = page.getByRole("status").filter({ hasText: workspace.byHand.changed });
      await expect(notice).toHaveCount(0);
      const live = page.locator('p[role="status"]:has(+ .review-grid)');
      await expect(live).toHaveCount(1);
      const region = await live.elementHandle();
      expect(region).not.toBeNull();
      expect(await region!.textContent()).toBe("");
      // The person edits a file; back in BELL, the diff is read again and the same region speaks.
      const { worktreePath } = await readRun(page);
      await appendFile(path.join(worktreePath!, "src/format.ts"), "\nexport const late = true;\n");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(notice).toBeVisible({ timeout: 15_000 });
      expect(await region!.textContent()).toBe(workspace.byHand.changed);
    } finally {
      await context.close();
      await project.stop();
    }
  });

  test("a refused publish of an agent run keeps the focus in the dialog, on why it was refused", async ({ browser }) => {
    test.setTimeout(120_000);
    const project = await startRealProject({ reviewed: true, appSettings: { skipUnderstandingCheck: true }, run: { status: "approved", approvedFingerprint: "e2e-approved" } });
    const { context, page } = await open(browser, project);
    try {
      await page.route(`**/api/runs/${runId}/preflight`, (route) => route.fulfill({ json: { checks: [] } }));
      await page.route(`**/api/runs/${runId}/publish`, (route) => route.fulfill({ status: 409, json: { error: "Not now." } }));
      const dialog = await publishDialog(page);
      await dialog.getByRole("button", { name: workspace.publish.submit }).click();
      const refusal = dialog.locator(".inline-error[role=alert]");
      await expect(refusal).toHaveText("Not now.");
      // Sending disabled Submit, which had the focus: it moves to the refusal, never to the page.
      await expect(refusal).toBeFocused();
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
    } finally {
      await context.close();
      await project.stop();
    }
  });
});
