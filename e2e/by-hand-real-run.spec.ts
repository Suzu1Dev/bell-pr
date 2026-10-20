// Learn by hand end to end on a real (not sample) project (DESIGN v1.2
// §17, plan W3B): a run started from the task dialog, planned, written by
// the spec in the run's folder, helped by the guide, tested, marked ready,
// reviewed, checked and approved, with nothing stubbed but the agent CLIs
// and GitHub (e2e/helpers/real-project.ts: stand-in codex, claude and gh
// that log their arguments); the three publishing paths of the owner's
// answer 2 (blocked, confirmed, allowed) on real-shaped rules; and the
// fix-ups of README v1.2 §18.11 that only a browser shows.
import { randomUUID } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { changeFingerprint } from "../shared/change-fingerprint";
import { defaultDiscoveryPreferences, type DiscoveryCandidate } from "../shared/discovery";
import { parseDiscoveryResult } from "../server/discovery";
import { withLocale } from "../server/i18n/index";
import mission from "../src/i18n/en/mission";
import type { DraftCheck } from "../shared/draft-checks";
import type { Run } from "../src/types";
import record from "../src/byhand/record/i18n/en";
import byHandText from "../src/byhand/write/i18n/en";
import discovery from "../src/i18n/en/discovery";
import panelText from "../src/review/i18n/en";
import review from "../src/i18n/en/review";
import workspace from "../src/i18n/en/workspace";
import { issueNode, issueUrl, repoId, repoUrl, runId, startRealProject, welcomeFacts, type AgentCall, type RealProject } from "./helpers/real-project";

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

  test("while the person writes, the Changes tab shows no review progress, Reviewed ticks or review footer", async ({ browser }) => {
    test.setTimeout(120_000);
    const project = await startRealProject({ run: byHandRun("review", "developing") });
    const { context, page } = await open(browser, project);
    try {
      await page.goto(`/#/runs/${runId}/changes?locale=en`);
      await expect(page.locator(".file-item").first()).toBeVisible();
      await expect(page.locator(".review-footer")).toContainText(workspace.byHand.turn);
      await expect(page.getByText(workspace.changes.progress, { exact: true })).toHaveCount(0);
      await expect(page.getByText(workspace.changes.reviewHint)).toHaveCount(0);
      await expect(page.getByRole("checkbox", { name: review.diff.reviewed })).toHaveCount(0);
      await expect(page.locator(".review-footer")).not.toContainText(workspace.footer.learning);
      await expect(page.locator(".review-footer .footer-reviewed")).toHaveCount(0);
      // Marked ready, it is the person's review: the progress, the ticks and the footer come back.
      const { files } = (await (await page.request.get(`/api/runs/${runId}/diff`)).json()) as { files: { path: string; fingerprint: string }[] };
      expect((await page.request.post(`/api/runs/${runId}/by-hand/ready`, { data: { changeFingerprint: changeFingerprint(files), review: false } })).ok()).toBe(true);
      await page.reload();
      await expect(page.getByText(workspace.changes.progress, { exact: true })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: review.diff.reviewed })).toHaveCount(1);
      await expect(page.locator(".review-footer .footer-reviewed")).toBeVisible();
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

  test("the publish dialog of a Learn-by-hand run opens on its title, so the record is read before the quoted confirm", async ({ browser }) => {
    test.setTimeout(120_000);
    const quoted: DraftCheck = {
      id: "by-hand-rules",
      kind: "confirm",
      message: "The project declines AI-generated contributions, and its own text says some uses of AI are fine.",
      details: ["Why.", 'CONTRIBUTING.md:3: "We decline AI-generated contributions."'],
    };
    const project = await startRealProject({
      reviewed: true,
      appSettings: { skipUnderstandingCheck: true },
      run: {
        ...byHandRun("approved", "complete"),
        approvedFingerprint: "e2e-approved",
        draft: { title: "Greet people in their own language", body: "Greetings come from a table of languages; I wrote it myself." },
      },
    });
    const { context, page } = await open(browser, project);
    try {
      await page.route(`**/api/runs/${runId}/preflight`, (route) => route.fulfill({ json: { checks: [quoted] } }));
      const dialog = await publishDialog(page);
      await expect(dialog.getByRole("checkbox", { name: quoted.message })).toBeVisible();
      // The focus starts on the dialog's title, above the summary, the record and the confirm.
      await expect(dialog.getByRole("heading", { level: 2, name: workspace.publish.title })).toBeFocused();
      await expect(dialog.getByRole("checkbox", { name: quoted.message })).not.toBeFocused();
    } finally {
      await context.close();
      await project.stop();
    }
  });
});

// The real run's project: a JavaScript file and a test the person runs with Node.
const retrySource = [
  "export const attempts = 1;",
  "",
  "export async function getPage(url) {",
  "  const response = await fetch(url);",
  '  if (response.status === 503) throw new Error("Service unavailable");',
  "  return response.text();",
  "}",
  "",
].join("\n");
const testSource = 'const { readFileSync } = require("node:fs");\nif (!readFileSync("src/retry.js", "utf8").includes("attempts = 3")) {\n  console.error("expected three attempts");\n  process.exit(1);\n}\nconsole.log("three attempts");\n';
/** The person's edit: `attempts` as given, with enough notes (over 15 lines) for the check to ask about the file. */
const handEdit = (attempts: number, notes = 20) =>
  `${retrySource.replace("attempts = 1", `attempts = ${attempts}`)}${Array.from({ length: notes }, (_, index) => `// Retry note ${index + 1}.`).join("\n")}\n`;
/** Code no file has: an answer that carries it must have it removed before it is stored or shown. */
const invented = "makeRetryBudget";
const fence = `\n\`\`\`js\nexport const attempts = ${invented}(3);\n\`\`\`\n`;

const prompts = {
  orientation: "reading the project before the person plans",
  reviewer: "You are BELL's reviewer in a Learn-by-hand run",
  tester: "You are BELL's test analyst in a Learn-by-hand run",
  explanation: "preparing automatic explanations",
  walkthrough: "Before the person reviews a change, explain the existing code around it",
  guide: "You are BELL's guide in a Learn-by-hand run",
};
const orientation = JSON.stringify({
  summary: `A GET that meets a 503 fails at once, so a flaky server breaks the page.${fence}`,
  steps: [
    { title: "Find where the request fails", files: ["src/retry.js"] },
    { title: "Send the GET again after a 503", files: ["src/retry.js"] },
  ],
  readFirst: [{ path: "src/retry.js", startLine: 3, endLine: 6, why: "Where the request is sent." }],
  premise: null,
});
/** A guide answer, with code in its prose and a quote by reference, which BELL cuts from the base itself. */
const guideAnswer = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    text: `${text}${fence}`,
    question: "What does a second 503 do?",
    refs: [{ path: "src/retry.js", line: 4, endLine: null }],
    quotes: [{ path: "src/retry.js", startLine: 3, endLine: 4, from: "base", anchor: "export async function getPage" }],
    options: null,
    topic: "project",
    askedForCode: false,
    ...extra,
  });
const reviewer = JSON.stringify({
  verified: "The tests pass at this version.",
  checked: ["src/retry.js"],
  findings: [
    {
      path: "src/retry.js",
      line: 1,
      observed: `Three attempts can take a while on a slow server.${fence}`,
      evidence: { type: "pattern", path: "src/retry.js", line: 4, quote: "const response = await fetch(url);" },
      why: "Each attempt sends the GET again.",
      question: "How long can three attempts take?",
      dimension: null,
    },
  ],
});
const explanationAnswer = JSON.stringify({
  files: [
    {
      path: "src/retry.js",
      summary: "The count of attempts rises, so a 503 is tried again.",
      reason: "A flaky server stops breaking the page.",
      concept: "Retry\nTrying a safe request again.",
      tip: "Test a 503 followed by a 200.",
      example: { scenario: "A shop page loads.", before: "The page showed an error.", after: "The page loads on the second try." },
      alternatives: "A circuit breaker.",
      lookup: ["retry"],
      selfCheck: { question: "Why only GET?", answer: "A GET can be sent twice safely." },
    },
  ],
});
const walkthroughAnswer = JSON.stringify({
  functions: [
    {
      name: "getPage",
      kind: "function",
      startLine: 3,
      endLine: 7,
      summary: "Fetches a page.",
      change: "Its module now tries three times.",
      steps: [{ startLine: 4, endLine: 4, explanation: "Sends the GET." }],
      callers: [],
      callees: [],
      analogy: "Like calling a busy shop again.",
      selfCheck: { question: "What does a second 503 do?", answer: "It fails again." },
    },
  ],
  newUnits: [],
});
/** The stand-in codex's answers, the guide's last. */
const answers = (guide: string) => [
  { when: prompts.orientation, text: orientation },
  { when: prompts.reviewer, text: reviewer },
  { when: prompts.tester, text: `No test sends two 503s in a row.${fence}` },
  { when: prompts.explanation, text: explanationAnswer },
  { when: prompts.walkthrough, text: walkthroughAnswer },
  { when: prompts.guide, text: guide },
];

/** Every agent CLI call of a run had read access only: no Codex write sandbox, no Claude tool past Read, Grep and Glob. */
function readOnly(calls: AgentCall[]) {
  const turns = calls.filter((call) => (call.cli === "codex" ? call.args[0] === "exec" : call.args.includes("--tools")));
  for (const call of turns) {
    expect(call.args.join(" ")).not.toContain("workspace-write");
    if (call.cli === "claude") expect(call.args[call.args.indexOf("--tools") + 1].split(",").sort()).toEqual(["Glob", "Grep", "Read"]);
    else expect(call.args[call.args.indexOf("--sandbox") + 1]).toBe("read-only");
  }
  return turns;
}

/** Opens the task dialog on the project with Learn by hand chosen and a task written; resolves with the dialog. */
async function taskDialog(page: Page, prompt = "Retry a GET twice after a 503, so a flaky server stops breaking the page.") {
  await page.goto("/#/home?locale=en");
  await page.getByRole("button", { name: "New task" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#task-repo").selectOption(repoId);
  await dialog.getByText(discovery.byHand.hand).click();
  await dialog.locator("#task-prompt").fill(prompt);
  return dialog;
}

/** The run, read again until `done` holds. */
async function runWhen(page: Page, id: string, done: (run: Run) => boolean, timeout = 30_000) {
  let run: Run | undefined;
  await expect.poll(async () => done((run = await readRun(page, id))), { timeout }).toBe(true);
  return run!;
}

/** Back from the editor: the app reads the diff again 2 s after the page is visible again. */
const backFromEditor = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

test.describe("a real Learn-by-hand run, end to end", () => {
  test("from the task dialog to a published Draft PR on a project without AI rules (the allowed path)", async ({ browser }) => {
    test.setTimeout(420_000);
    const project = await startRealProject({
      withoutRun: true,
      files: { "src/retry.js": retrySource, "test.js": testSource },
      facts: welcomeFacts,
    });
    await project.setAgentAnswers(answers(guideAnswer("Look where the status is checked.")));
    const { context, page } = await open(browser, project);
    const requests: { method: string; path: string; body?: unknown }[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) requests.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() ?? undefined });
    });
    const sent = (pattern: RegExp) => requests.filter((request) => request.method !== "GET" && pattern.test(request.path));
    try {
      let id = "";
      let worktree = "";
      await test.step("the task dialog starts a Learn-by-hand run, with no start reason on this project", async () => {
        const dialog = await taskDialog(page);
        const created = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/runs" && response.request().method() === "POST");
        await dialog.getByRole("button", { name: discovery.byHand.start }).click();
        const response = await created;
        expect(response.request().postDataJSON()).toMatchObject({ learnByHand: true });
        expect(response.request().postDataJSON().byHandFit).toBeUndefined();
        await expect(page.locator(".start-confirm")).toHaveCount(0);
        id = ((await response.json()) as { run: Run }).run.id;
        const ready = await runWhen(page, id, (run) => run.status === "awaiting_plan");
        worktree = ready.worktreePath!;
        expect(ready.learnByHand).toBe(true);
      });

      await test.step("the person plans first, compares with the guide's steps and confirms the plan", async () => {
        await page.goto(`/#/runs/${id}/activity?locale=en`);
        const plan = page.getByRole("region", { name: byHandText.plan.title });
        await expect(plan).toContainText(byHandText.plan.folded);
        await plan.getByRole("textbox", { name: byHandText.plan.step({ number: 1 }) }).fill("Read getPage and where it fails");
        await plan.getByRole("button", { name: byHandText.plan.add }).click();
        await plan.getByRole("textbox", { name: byHandText.plan.step({ number: 2 }) }).fill("Retry the GET three times after a 503");
        await plan.getByRole("textbox", { name: byHandText.plan.tests }).fill("node test.js checks the count.");
        await plan.getByRole("button", { name: byHandText.compare.action }).click();
        const compare = plan.getByRole("region", { name: byHandText.compare.title });
        await expect(compare).toContainText("Send the GET again after a 503");
        await expect(compare).toContainText("Retry the GET three times after a 503");
        await plan.getByRole("button", { name: byHandText.plan.confirm }).click();
        await expect(page.getByRole("tab", { name: /Code changes/ })).toBeFocused();
        const run = await runWhen(page, id, (value) => value.status === "review");
        expect(run.byHand?.plan?.steps.map((step) => step.title)).toEqual(["Read getPage and where it fails", "Retry the GET three times after a 503"]);
      });

      await test.step("Your turn: the person edits the file, and coming back reads the diff with nothing explained", async () => {
        await expect(page.getByRole("heading", { name: byHandText.turn.title })).toBeVisible();
        await writeFile(path.join(worktree, "src/retry.js"), handEdit(2));
        await backFromEditor(page);
        await expect(page.locator(`.file-item[title="src/retry.js"]`)).toBeVisible({ timeout: 15_000 });
        expect(sent(/\/explanations|\/walkthrough/)).toEqual([]);
      });

      const guide = page.locator(".guide-panel");
      await test.step("R1 shows the quote BELL cut and says it removed code; R2 waits for an attempt", async () => {
        await guide.getByRole("button", { name: byHandText.guide.next({ rung: byHandText.guide.rungs[1] }) }).click();
        await expect(guide).toContainText(byHandText.thread.removed, { timeout: 30_000 });
        const quote = guide.locator("figure", { has: page.locator("figcaption", { hasText: "src/retry.js:3-4" }) });
        await expect(quote).toContainText(byHandText.thread.base);
        await expect(quote).toContainText("export async function getPage(url) {");
        await expect(guide).not.toContainText(invented);
        const r2 = guide.getByRole("button", { name: byHandText.guide.next({ rung: byHandText.guide.rungs[2] }) });
        await expect(r2).toBeDisabled();
        await expect(guide).toContainText(byHandText.guide.tryFirst);
        // An attempt: the person changes the code; back in BELL, R2 is offered.
        await writeFile(path.join(worktree, "src/retry.js"), handEdit(2, 21));
        await project.setAgentAnswers(answers(guideAnswer("A retry applies where the status is checked.")));
        await backFromEditor(page);
        await expect(r2).toBeEnabled({ timeout: 15_000 });
        await r2.click();
        await expect(guide.locator(".by-hand-thread")).toContainText("A retry applies where the status is checked.", { timeout: 30_000 });
      });

      const tests = guide.getByRole("region", { name: byHandText.tests.title });
      await test.step("the person confirms node test.js, predicts Fail and it fails; then fixes it and it passes", async () => {
        await tests.getByRole("textbox", { name: byHandText.tests.command }).fill("node test.js");
        await tests.getByRole("button", { name: byHandText.tests.use }).click();
        await expect(tests).toContainText(byHandText.tests.confirmed({ command: "node test.js" }));
        await tests.getByRole("radio", { name: byHandText.tests.predictions.fail }).check();
        await tests.getByRole("button", { name: byHandText.tests.run }).click();
        await expect(tests).toContainText(byHandText.tests.result({ predicted: "Fail", outcome: "failed" }), { timeout: 30_000 });
        await writeFile(path.join(worktree, "src/retry.js"), handEdit(3));
        await backFromEditor(page);
        await runWhen(page, id, () => true);
        await page.waitForTimeout(2_500);
        await tests.getByRole("radio", { name: byHandText.tests.predictions.pass }).check();
        await tests.getByRole("button", { name: byHandText.tests.run }).click();
        await expect(tests).toContainText(byHandText.tests.result({ predicted: "Pass", outcome: "passed" }), { timeout: 30_000 });
        expect(sent(/\/explanations|\/walkthrough/)).toEqual([]);
      });

      await test.step("Ready for review with the guide's review; the Reports tab shows its finding with evidence", async () => {
        await page.locator(".review-footer").getByRole("button", { name: workspace.byHand.ready }).click();
        const dialog = page.getByRole("dialog", { name: byHandText.ready.title });
        await expect(dialog.getByRole("checkbox", { name: new RegExp(byHandText.ready.review) })).toBeChecked();
        await dialog.getByRole("button", { name: byHandText.ready.confirm }).click();
        await expect(dialog).toHaveCount(0);
        const reviewed = await runWhen(page, id, (run) => !run.byHand?.busy && (run.byHand?.reviews?.length ?? 0) > 0, 60_000);
        expect(reviewed.byHand?.reviews?.[0].findings[0].evidence.quote).toBe("const response = await fetch(url);");
        await page.reload();
        await page.getByRole("tab", { name: review.panel.tabs.reports }).click();
        const reports = page.locator(".explain-panel");
        await expect(reports).toContainText("Three attempts can take a while on a slow server.");
        await expect(reports.locator("code", { hasText: "const response = await fetch(url);" })).toBeVisible();
        await expect(reports).not.toContainText(invented);
      });

      await test.step("ticks, Explain it back in the person's own words, then how a reader sees the change", async () => {
        const tick = page.getByRole("checkbox", { name: review.diff.reviewed });
        await tick.click();
        await expect(tick).toBeChecked();
        await page.locator(".review-footer").getByRole("button", { name: workspace.footer.explainBack }).click();
        const check = workspace.check;
        const panel = page.locator(".understanding-check");
        // The person's own step text is their own words, never a copy of an AI reference.
        await panel
          .getByRole("textbox", { name: check.explainPrompt })
          .fill("Retry the GET three times after a 503, because a server that recovers in a few seconds should not break the page.");
        const items = panel.getByRole("region", { name: check.answerTitle }).getByRole("listitem");
        const count = await items.count();
        expect(count).toBeGreaterThan(0);
        for (let index = 0; index < count; index++) {
          await items.nth(index).getByRole("textbox").fill("Retry the GET three times after a 503, because the server recovers within seconds.");
          await items.nth(index).getByRole("radio", { name: check.confidences.think }).check();
        }
        await panel.getByRole("button", { name: check.lock }).click();
        // The person compares their answer with the references (their own words, and the guide's review) and grades it.
        const grade = panel.getByRole("region", { name: check.gradeTitle });
        await expect(grade).toBeVisible();
        for (const radio of await grade.getByRole("radio", { name: check.grades.got }).all()) await radio.check();
        await panel.getByRole("button", { name: check.saveGrades }).click();
        await expect(panel.getByRole("region", { name: check.resultTitle })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(".review-footer")).toContainText(workspace.footer.passed);
        // How a reader sees the change, for the answered file: an explanation and a walkthrough, only now.
        expect(sent(/\/explanations|\/walkthrough/)).toEqual([]);
        await panel.getByRole("button", { name: check.close }).click();
        await page.getByRole("tab", { name: review.panel.tabs.explain }).click();
        await page.getByRole("button", { name: panelText.reader.show }).click({ timeout: 30_000 });
        await expect(page.locator(".explain-panel")).toContainText("The count of attempts rises, so a 503 is tried again.", { timeout: 30_000 });
        const asked = sent(/\/explanations|\/walkthrough/);
        expect(asked.length).toBeGreaterThan(0);
        for (const request of asked) expect(JSON.stringify(request.body ?? {})).not.toMatch(/"files?":\s*\[(?![^\]]*src\/retry\.js)/);
      });

      await test.step("the person's PR text, approval, and the publish dialog with the claim and the record", async () => {
        await page.locator("#workspace-tab-draft").click();
        await page.getByRole("textbox", { name: workspace.draft.titleLabel }).fill("Retry a GET three times after a 503");
        await page.getByRole("textbox", { name: workspace.draft.bodyLabel }).fill("Retries a GET after a 503, up to three times. I wrote and tested it myself; node test.js passes.");
        await page.getByRole("button", { name: workspace.draft.save }).click();
        await expect(page.locator(".toast")).toContainText(workspace.notices.draftSaved);
        // The dialog reads the project's rules (none stored yet), then the server's checks again.
        const rulesRead = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/contribution-rules/refresh"));
        await page.locator(".review-footer").getByRole("button", { name: workspace.footer.approvePr }).click();
        const dialog = page.getByRole("dialog", { name: workspace.publish.title });
        await expect(dialog).toBeVisible({ timeout: 30_000 });
        await rulesRead;
        await expect(dialog.getByText(workspace.publish.factsLoading)).toHaveCount(0, { timeout: 30_000 });
        await page.waitForLoadState("networkidle");
        const shown = dialog.getByRole("region", { name: record.title });
        await expect(shown).toContainText(record.claim);
        await expect(shown).toContainText(record.quotes);
        await expect(shown).toContainText(record.otherTools);
        // No block, no quoted confirm: a project without AI rules publishes as an agent run does.
        await expect(dialog.locator(".publish-block")).toHaveCount(0);
        await expect(dialog.getByText(/quoting the project/)).toHaveCount(0);
        // The server's confirms (the project's rules to read, the change's size) shown, then ticked.
        const confirms = (await preflight(page, id)).filter((check) => check.kind === "confirm");
        expect(confirms.map((check) => check.id)).not.toContain("by-hand-rules");
        await expect(dialog.getByRole("checkbox")).toHaveCount(confirms.length);
        for (const box of await dialog.getByRole("checkbox").all()) await box.check();
        const publishing = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/runs/${id}/publish`, { timeout: 60_000 });
        await dialog.getByRole("button", { name: workspace.publish.submit }).click();
        const answer = await publishing;
        expect(answer.status(), await answer.text()).toBeLessThan(300);
        await expect(dialog).toHaveCount(0, { timeout: 30_000 });
        const published = await runWhen(page, id, (run) => run.status === "published", 30_000);
        expect(published.prUrl).toMatch(/\/pull\/1$/);
        expect((await project.ghCalls()).some((call) => call[1] === "pr" && call[2] === "create" && call.includes("--draft"))).toBe(true);
      });

      await test.step("the history and the agent CLIs: no write access, no code stored, no override sent", async () => {
        const run = await readRun(page, id);
        expect(run.team?.tasks ?? []).toEqual([]);
        expect(JSON.stringify(run)).not.toContain(invented);
        expect((run.byHand?.removedTotal ?? 0) > 0).toBe(true);
        const turns = readOnly(await project.agentCalls());
        // The orientation, R1, R2, the review (reviewer and test analyst), the explanation and the walkthrough.
        expect(turns.length).toBeGreaterThanOrEqual(7);
        expect(sent(/\/publish$/).flatMap((request) => (request.body as { overrides?: { id: string }[] }).overrides ?? [])).toEqual([]);
      });
    } finally {
      await context.close();
      await project.stop();
    }
  });
});

test.describe("the rest of the guide's, the exits' and the Tests card's requests, on the real routes", () => {
  test.use({ actionTimeout: 30_000 });
  test("plan questions, an R3 option and its why, Talk it through, I'm stuck and its exits, a repeated failure, the live tail and Stop, Record my result, the template and handing back", async ({ browser }) => {
    test.setTimeout(300_000);
    const at = new Date().toISOString();
    const template = "## What this changes\n\n## How I tested it\n";
    const project = await startRealProject({
      files: { "src/retry.js": retrySource, "test.js": testSource, ".github/pull_request_template.md": template },
      run: {
        ...byHandRun("awaiting_plan", "awaiting_approval", {
          guidePlan: { ...guidePlan, steps: [{ title: "Read the greeting", files: ["src/greeting.ts"] }, { title: "Look the greeting up by language", files: ["src/greeting.ts"] }] },
          plan: { steps: [{ id: "s1", title: "Read how the greeting is built" }, { id: "s2", title: "Add the table of languages" }], savedAt: at },
        }),
        createdAt: at,
      },
    });
    await project.setAgentAnswers(answers(guideAnswer("Which language should a missing greeting fall back to?\nWhere is the name inserted?")));
    const { context, page } = await open(browser, project);
    const log = requestLog(page);
    const call = (method: string, pathname: RegExp) => log.requests.filter((request) => request.method === method && pathname.test(request.path));
    try {
      await test.step("Questions on my plan, then This is my plan", async () => {
        await page.goto(`/#/runs/${runId}/activity?locale=en`);
        const plan = page.getByRole("region", { name: byHandText.plan.title });
        const questions = plan.getByRole("region", { name: byHandText.questions.title });
        await questions.getByRole("button", { name: byHandText.questions.title }).click();
        await expect(questions).toContainText(byHandText.questions.left({ left: 2, max: 3 }), { timeout: 30_000 });
        await expect(plan).toContainText("Which language should a missing greeting fall back to?");
        await plan.getByRole("button", { name: byHandText.plan.confirm }).click();
        await runWhen(page, runId, (run) => run.status === "review");
      });

      const guide = page.locator(".guide-panel");
      await test.step("R1, R2 and R3 on the first step, each after an attempt the person describes; the person picks an option and says why", async () => {
        await page.goto(`/#/runs/${runId}/changes?locale=en`);
        await page.reload();
        const next = (rung: number) => guide.getByRole("button", { name: byHandText.guide.next({ rung: byHandText.guide.rungs[rung] }) });
        await next(1).click();
        await expect(guide.locator(".by-hand-thread")).toContainText("Where is the name inserted?", { timeout: 30_000 });
        const tried = guide.getByRole("textbox", { name: byHandText.guide.tried });
        await guide.locator("summary", { hasText: byHandText.guide.tried }).click();
        await tried.fill("I read greeting and found where the name goes in.");
        await next(2).click();
        await expect(next(3)).toBeVisible({ timeout: 30_000 });
        await project.setAgentAnswers(answers(guideAnswer("Two ways fit this project.", {
          options: [{ name: "A table of languages", tradeoff: "One place to add a language." }, { name: "A switch per language", tradeoff: "New code for every language." }],
        })));
        // The fold is still open from the last attempt.
        await tried.fill("I wrote a table but the fallback still says Hello.");
        await next(3).click();
        // Each option's Choose is named by its option (aria-describedby).
        const choose = guide.getByRole("button", { name: byHandText.thread.choose, description: "A table of languages" });
        await expect(choose).toBeVisible({ timeout: 30_000 });
        await choose.click();
        const why = guide.getByRole("textbox", { name: byHandText.thread.chooseWhy });
        await why.fill("One place to add a language keeps it small.");
        await choose.click();
        await expect(guide).toContainText(byHandText.thread.chosen);
        // Done after Options asks the person's own why first.
        await guide.locator("li", { hasText: "Read how the greeting is built" }).getByRole("button", { name: byHandText.guide.done }).click();
        const stepWhy = guide.getByRole("textbox", { name: byHandText.guide.why });
        await stepWhy.fill("The table gives every language one line to read.");
        await stepWhy.press("Enter");
        const run = await runWhen(page, runId, (value) => !!value.byHand?.plan?.steps[0].doneAt);
        expect(run.byHand?.plan?.steps[0]).toMatchObject({ maxRung: 3, why: "The table gives every language one line to read.", chosen: { option: 0, why: "One place to add a language keeps it small." } });
      });

      await test.step("Talk it through, I'm stuck, Ask a human and Park on the second step", async () => {
        await guide.getByRole("button", { name: byHandText.talk.label }).first().click();
        await expect(guide.getByRole("group", { name: byHandText.talk.label })).toBeVisible();
        await guide.getByRole("button", { name: byHandText.exits.stuck }).click();
        const card = guide.getByRole("group", { name: byHandText.exits.title });
        await card.getByRole("button", { name: byHandText.exits.human }).click();
        await expect(card).toContainText(byHandText.exits.humanText);
        await card.getByRole("button", { name: byHandText.exits.park }).click();
        const run = await runWhen(page, runId, (value) => !!value.byHand?.plan?.steps[1].parkedAt);
        expect(run.byHand?.talks?.map((talk) => talk.stepId)).toEqual(["s2", "s2"]);
        expect(run.byHand?.checkIns?.map((entry) => [entry.signal, entry.choice])).toEqual([["button", "human"], ["button", "park"]]);
        expect(run.byHand?.exits?.map((entry) => entry.exit)).toEqual(["human", "park"]);
      });

      const tests = guide.getByRole("region", { name: byHandText.tests.title });
      const confirmCommand = async (command: string) => {
        await tests.getByRole("textbox", { name: byHandText.tests.command }).fill(command);
        await tests.getByRole("button", { name: byHandText.tests.use }).click();
        await expect(tests).toContainText(byHandText.tests.confirmed({ command }));
      };
      await test.step("the same failure three runs in a row: the repeated-failure card, recorded once", async () => {
        await confirmCommand(`node -e "console.error('greeting broke'); process.exit(3)"`);
        for (let index = 0; index < 3; index++) {
          await tests.getByRole("button", { name: byHandText.tests.run }).click();
          await expect.poll(async () => (await readRun(page, runId)).byHand?.tests?.length ?? 0, { timeout: 30_000 }).toBe(index + 1);
          await expect(tests.getByRole("button", { name: byHandText.tests.run })).toBeEnabled();
        }
        await expect(guide.getByRole("status").filter({ hasText: byHandText.talk.repeat })).toBeVisible();
        await expect.poll(async () => (await readRun(page, runId)).byHand?.checkIns?.filter((entry) => entry.signal === "repeat-failure").length).toBe(1);
      });

      await test.step("a long run: its output so far, then Stop; then a result from the person's own terminal", async () => {
        await confirmCommand(`node -e "console.log('still working'); setInterval(() => {}, 1000)"`);
        await tests.getByRole("button", { name: byHandText.tests.run }).click();
        await expect(tests.locator("details", { hasText: byHandText.live.tail }).locator("pre")).toContainText("still working", { timeout: 30_000 });
        await tests.getByRole("button", { name: byHandText.tests.stop }).click();
        await expect(tests).toContainText(byHandText.tests.result({ outcome: byHandText.tests.outcomes.stopped }), { timeout: 30_000 });
        await tests.locator("summary", { hasText: byHandText.live.record }).click();
        await tests.getByRole("radio", { name: byHandText.live.passed }).check();
        await tests.getByRole("textbox", { name: byHandText.live.output }).fill("12 passed");
        await tests.getByRole("button", { name: "Save" }).click();
        await expect(tests.locator("em", { hasText: byHandText.tests.reported })).toBeVisible();
        const run = await runWhen(page, runId, (value) => !!value.byHand?.tests?.at(-1)?.reported);
        expect(run.byHand?.tests?.slice(-2).map((test) => [test.outcome, !!test.reported])).toEqual([["stopped", false], ["passed", true]]);
        expect(call("GET", /\/by-hand\/tests\/live$/).length).toBeGreaterThan(0);
      });

      await test.step("the project's PR template, inserted into the person's empty description", async () => {
        await page.locator("#workspace-tab-draft").click();
        await page.getByRole("button", { name: record.template }).click();
        await expect(page.getByRole("textbox", { name: workspace.draft.bodyLabel })).toHaveValue(template);
        expect(call("GET", /\/by-hand\/template$/).length).toBe(1);
      });

      await test.step("Hand this task to the agent team: recorded, and the task dialog opens with the task", async () => {
        await page.locator("#workspace-tab-changes").click();
        await guide.getByRole("button", { name: byHandText.exits.stuck }).click();
        const card = guide.getByRole("group", { name: byHandText.exits.title });
        await card.getByRole("button", { name: byHandText.exits.leave }).click();
        await card.getByRole("button", { name: byHandText.exits.leaveGo }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.locator("#task-prompt")).toHaveValue(/Greet people in their own language/);
        await expect(dialog.getByRole("radio", { name: discovery.byHand.agents })).toBeChecked();
        const run = await readRun(page, runId);
        expect(run.byHand?.leftAt).toBeTruthy();
        expect(run.byHand?.exits?.at(-1)?.exit).toBe("leave");
        // The run itself stays a clean Learn-by-hand run.
        expect(run.learnByHand).toBe(true);
        expect(run.team?.tasks ?? []).toEqual([]);
      });
      readOnly(await project.agentCalls());
    } finally {
      await context.close();
      await project.stop();
    }
  });
});

// The three publishing paths of the owner's answer 2 (DESIGN v1.2 F12), on
// real-shaped rules read by the server from the project's own files.
const gentoo =
  "It is expressly forbidden to contribute to Gentoo any content that has been created with the assistance of Natural Language Processing artificial intelligence tools.";
const llvm = 'Using AI tools to fix issues labelled as "good first issues" is forbidden.';
const qemuPolicy = readFile(path.join(import.meta.dirname, "..", "server", "fixtures", "policy", "real", "qemu-code-provenance.rst"), "utf8");
const goodFirstIssue = { ...welcomeFacts, issues: { 7: issueNode({ labels: { nodes: [{ name: "good first issue" }] } }) } };

/** The server reads the project's rules from its files ("Check again"). */
async function readRules(page: Page) {
  const response = await page.request.post(`/api/repos/${repoId}/contribution-rules/refresh`, { data: {} });
  expect(response.ok()).toBe(true);
}

/** Records every API request with its body; `overrides` lists the ones any publish carried. */
function requestLog(page: Page) {
  const requests: { method: string; path: string; body?: unknown }[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) requests.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() ?? undefined });
  });
  return {
    requests,
    overrides: () =>
      requests.flatMap((request) => (request.path.endsWith("/publish") ? ((request.body as { overrides?: { id: string }[] }).overrides ?? []) : [])),
  };
}

/** Starts a run from the task dialog; resolves with its id once the guide has read the project. */
async function startFromDialog(page: Page, dialog: Awaited<ReturnType<typeof taskDialog>>, confirm?: string) {
  const created = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/runs" && response.request().method() === "POST");
  await dialog.getByRole("button", { name: discovery.byHand.start }).click();
  if (confirm) {
    const asked = dialog.locator(".start-confirm");
    await expect(asked.getByRole("heading", { name: discovery.byHand.title })).toBeVisible();
    await asked.getByRole("button", { name: confirm }).click();
  }
  const response = await created;
  expect(response.status()).toBe(202);
  const id = ((await response.json()) as { run: Run }).run.id;
  return { id, body: response.request().postDataJSON() as Record<string, unknown>, run: await runWhen(page, id, (run) => run.status === "awaiting_plan") };
}

/** A run brought to approval through its own routes: the person's plan, an edit, Ready, the ticks and the PR text. */
async function toApproval(page: Page, id: string, { ready = true } = {}) {
  expect((await page.request.put(`/api/runs/${id}/by-hand/plan`, { data: { steps: [{ title: "Retry the GET three times after a 503" }] } })).ok()).toBe(true);
  expect((await page.request.post(`/api/runs/${id}/plan/approve`, { data: {} })).ok()).toBe(true);
  const run = await readRun(page, id);
  await writeFile(path.join(run.worktreePath!, "src/retry.js"), handEdit(3));
  const { files } = (await (await page.request.get(`/api/runs/${id}/diff`)).json()) as { files: { path: string; fingerprint: string }[] };
  if (ready) expect((await page.request.post(`/api/runs/${id}/by-hand/ready`, { data: { changeFingerprint: changeFingerprint(files), review: false } })).ok()).toBe(true);
  for (const file of files)
    expect((await page.request.post(`/api/runs/${id}/review`, { data: { filePath: file.path, reviewed: true, fingerprint: file.fingerprint } })).ok()).toBe(true);
  const draft = { title: "Retry a GET three times after a 503", body: "Retries a GET after a 503, up to three times. I wrote and tested it myself." };
  expect((await page.request.patch(`/api/runs/${id}/draft`, { data: draft })).ok()).toBe(true);
  return files;
}

/** The server's checks for publishing the run, as the publish dialog reads them. */
const preflight = async (page: Page, id: string) =>
  ((await (await page.request.get(`/api/runs/${id}/preflight`, { headers: { "x-bell-locale": "en" } })).json()) as { checks: DraftCheck[] }).checks;

test.describe("the three publishing paths of a Learn-by-hand run (owner answer 2)", () => {
  test.use({ actionTimeout: 30_000 });
  test("blocked: a project whose rules ban AI help itself never offers the fitted guide or a confirm", async ({ browser }) => {
    test.setTimeout(240_000);
    const project = await startRealProject({
      withoutRun: true,
      files: { "src/retry.js": retrySource, "test.js": testSource, "CONTRIBUTING.md": `# Contributing\n\n${gentoo}\n` },
      appSettings: { skipUnderstandingCheck: true },
    });
    await project.setAgentAnswers(answers(guideAnswer("Look where the status is checked.")));
    const { context, page } = await open(browser, project);
    const log = requestLog(page);
    try {
      await readRules(page);
      await page.goto("/#/home?locale=en");
      await page.getByRole("button", { name: "New task" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.locator("#task-repo").selectOption(repoId);
      // A banning project is never a reason to preselect Learn by hand.
      await expect(dialog.getByRole("radio", { name: discovery.byHand.agents })).toBeChecked();
      await dialog.getByText(discovery.byHand.hand).click();
      const reason = discovery.byHand.ban({ reach: "assistance", condition: "" });
      await expect(dialog.locator(".mode-case")).toContainText(reason);
      await expect(dialog.getByRole("radio", { name: discovery.byHand.fit })).toHaveCount(0);
      await dialog.locator("#task-prompt").fill("Retry a GET twice after a 503, so a flaky server stops breaking the page.");
      const { id, body, run } = await startFromDialog(page, dialog, discovery.byHand.practise);
      expect(body.learnByHand).toBe(true);
      expect(body).not.toHaveProperty("byHandFit");
      // Every kind of help: no help set fixed at the start.
      expect(run.byHand?.helpLock).toBeUndefined();

      // While the person writes, the guide says it won't publish here, and gives every kind of help.
      await toApproval(page, id, { ready: false });
      await page.goto(`/#/runs/${id}/changes?locale=en`);
      const guide = page.locator(".guide-panel");
      await expect(guide.locator(".by-hand-note")).toHaveText(/won't publish this run here: .+\. Practise freely\.$/);
      await expect(guide.getByRole("button", { name: byHandText.guide.next({ rung: byHandText.guide.rungs[1] }) })).toBeEnabled();
      const { files } = (await (await page.request.get(`/api/runs/${id}/diff`)).json()) as { files: { path: string; fingerprint: string }[] };
      expect((await page.request.post(`/api/runs/${id}/by-hand/ready`, { data: { changeFingerprint: changeFingerprint(files), review: false } })).ok()).toBe(true);

      // Approval is refused by ai-ban in Learn-by-hand words: no confirm, no reason to type.
      await page.goto(`/#/runs/${id}/draft?locale=en`);
      await page.reload();
      const approving = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/runs/${id}/approve`);
      await page.locator(".review-footer").getByRole("button", { name: workspace.footer.approvePr }).click();
      const refused = await approving;
      expect(refused.status()).toBe(422);
      const message = ((await refused.json()) as { error: string }).error;
      expect(message).toContain("The project's rules restrict AI help itself, so BELL PR won't publish a run its guide helped with.");
      expect(message).toContain(gentoo);
      expect(message).not.toContain("AI agents wrote this change");
      await expect(page.getByRole("dialog", { name: workspace.publish.title })).toHaveCount(0);
      const checks = await preflight(page, id);
      expect(checks.filter((check) => check.kind === "block").map((check) => [check.id, check.reason])).toEqual([["ai-ban", "reach"]]);
      expect(checks.some((check) => check.id === "by-hand-rules")).toBe(false);
      expect(log.overrides()).toEqual([]);
      readOnly(await project.agentCalls());
    } finally {
      await context.close();
      await project.stop();
    }
  });

  test("blocked: an issue kept for people learning without AI tools (LLVM's words) offers no Start learning by hand, and publishing blocks", async ({ browser }) => {
    test.setTimeout(240_000);
    const contributing = `# Contributing\n\n${llvm}\n`;
    // The discovery job as the server stores it: its own derivation from the evidence (server/discovery.ts).
    const candidate: DiscoveryCandidate = {
      fullName: "e2e-org/widgets",
      url: repoUrl,
      description: "Widgets.",
      language: "TypeScript",
      stars: 120,
      forks: 8,
      pushedAt: "2026-10-01T00:00:00Z",
      openIssues: 3,
      warnings: [],
      sources: [
        { id: "issue-7", kind: "issue", title: "#7 Greet people in their own language", url: issueUrl, content: "Greet people in their own language.\nLabels: good first issue" },
        { id: "contributing", kind: "contributing", title: "CONTRIBUTING.md", url: `${repoUrl}/blob/main/CONTRIBUTING.md`, content: contributing },
      ],
    };
    const answer = JSON.stringify({
      opportunities: [
        {
          id: "greet",
          repository: "e2e-org/widgets",
          title: "Greet people in their own language",
          summary: "Greetings are always in English.",
          userNeed: "People read a greeting in their language.",
          contributionRules: llvm,
          popularity: "120 stars",
          feasibility: "Small.",
          difficulty: "beginner",
          effort: "An afternoon.",
          firstSteps: ["Read src/greeting.ts."],
          acceptanceChecks: ["A greeting test per language."],
          risks: ["None."],
          evidence: [
            { sourceId: "issue-7", quote: "Greet people in their own language.", reason: "The issue." },
            { sourceId: "contributing", quote: llvm, reason: "The project's rule." },
          ],
          learnByHand: true,
        },
      ],
    });
    const { opportunities } = await withLocale("en", async () => parseDiscoveryResult(answer, [candidate], defaultDiscoveryPreferences, new Set(["issue-7"])));
    expect(opportunities.map((item) => [item.byHandReserved, item.byHandReservedOutput])).toEqual([[true, undefined]]);
    const now = new Date().toISOString();
    const project = await startRealProject({
      trial: true,
      // Its loosened test assertion has its reason written, as the person would.
      reviewed: true,
      files: { "CONTRIBUTING.md": contributing },
      facts: goodFirstIssue,
      appSettings: { skipUnderstandingCheck: true },
      run: {
        learnByHand: true,
        createdAt: now,
        agents: [agent("lead", "Guide"), agent("reviewer", "Reviewer"), agent("tester", "Test analyst")],
        team: team("developing"),
        draft: { title: "Greet people in their own language", body: "Greetings come from a table of languages; I wrote and tested it myself." },
        byHand: { guidePlan, plan: { steps: [{ id: "s1", title: "Look greetings up in a table" }], savedAt: now, confirmedAt: now } },
      },
      async seedData(dataDir) {
        const job = { id: randomUUID(), status: "ready", phase: "complete", message: "", preferences: defaultDiscoveryPreferences, createdAt: now, completedAt: now, candidates: [candidate], opportunities, warnings: [], locale: "en" };
        await writeFile(path.join(dataDir, "discovery.json"), JSON.stringify({ version: 1, job }));
      },
    });
    const { context, page } = await open(browser, project);
    const log = requestLog(page);
    try {
      // The discovery card: no Start learning by hand on this issue; the project's words say why.
      await page.goto("/#/discover?locale=en");
      const card = page.locator(".discovery-opportunity", { has: page.getByRole("heading", { name: "Greet people in their own language" }) });
      await expect(card).toBeVisible();
      await expect(card.getByRole("button", { name: discovery.card.startByHand })).toHaveCount(0);
      await expect(card.locator(".by-hand-note")).toHaveText(discovery.byHand.area({ reach: "use", condition: "" }));
      await expect(card.locator("footer blockquote")).toHaveText(llvm);

      // A Learn-by-hand run on that issue: approved, the publish dialog blocks area-reserved in Learn-by-hand words.
      const { files } = (await (await page.request.get(`/api/runs/${runId}/diff`)).json()) as { files: { path: string; fingerprint: string }[] };
      expect((await page.request.post(`/api/runs/${runId}/by-hand/ready`, { data: { changeFingerprint: changeFingerprint(files), review: false } })).ok()).toBe(true);
      for (const file of files)
        await page.request.post(`/api/runs/${runId}/review`, { data: { filePath: file.path, reviewed: true, fingerprint: file.fingerprint } });
      await page.goto(`/#/runs/${runId}/draft?locale=en`);
      await page.reload();
      // Approval goes ahead: a reserved issue is enforced where publishing is.
      const approving = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/runs/${runId}/approve`);
      await page.locator(".review-footer").getByRole("button", { name: workspace.footer.approvePr }).click();
      const approved = await approving;
      expect(approved.status(), await approved.text()).toBe(200);
      const dialog = page.getByRole("dialog", { name: workspace.publish.title });
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      const block = dialog.locator(".publish-block", { hasText: "keeps this issue for people learning without AI tools" });
      await expect(block).toContainText("The project keeps this issue for people learning without AI tools, so BELL PR won't publish a run its guide helped with.", { timeout: 30_000 });
      await expect(block).toContainText(llvm);
      await expect(block.getByRole("textbox")).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: workspace.publish.submit })).toBeDisabled();
      await expect(dialog.getByText(/quoting the project/)).toHaveCount(0);
      const blocks = (await preflight(page, runId)).filter((check) => check.kind === "block");
      expect(blocks.map((check) => [check.id, check.reason])).toEqual([["area-reserved", "reach"]]);
      expect(log.overrides()).toEqual([]);
    } finally {
      await context.close();
      await project.stop();
    }
  });

  test("confirmed: an output ban with the project's own carve-out (QEMU's words), on a repository that takes pull requests", async ({ browser }) => {
    test.setTimeout(300_000);
    const project = await startRealProject({
      withoutRun: true,
      files: { "src/retry.js": retrySource, "test.js": testSource, "docs/devel/code-provenance.rst": await qemuPolicy },
      appSettings: { skipUnderstandingCheck: true },
    });
    await project.setAgentAnswers(answers(guideAnswer("Look where the status is checked.")));
    const { context, page } = await open(browser, project);
    const log = requestLog(page);
    try {
      await readRules(page);
      const dialog = await taskDialog(page);
      // The fitted guide, preselected, with the kinds the carve-out names and its words.
      const fit = dialog.getByRole("radio", { name: discovery.byHand.fit });
      await expect(fit).toBeChecked();
      await expect(dialog.locator(".mode-fit")).toContainText("explanations, answers, and test help");
      await expect(dialog.locator(".mode-fit")).toContainText("researching APIs or algorithms");
      const { id, body, run } = await startFromDialog(page, dialog, mission.startConfirm.startAnyway);
      expect(body).toMatchObject({ learnByHand: true, byHandFit: { learningIssue: false } });
      expect(run.byHand?.helpLock?.kinds).toEqual(["explain", "answer", "test"]);

      // The plan: the guide's outline stays closed, and there are no questions on the plan.
      await page.goto(`/#/runs/${id}/activity?locale=en`);
      const plan = page.getByRole("region", { name: byHandText.plan.title });
      await expect(plan).toContainText(byHandText.plan.closed);
      await expect(plan.getByRole("button", { name: byHandText.plan.noIdea })).toHaveCount(0);
      await expect(plan.getByRole("button", { name: byHandText.questions.title })).toHaveCount(0);
      await plan.getByRole("textbox", { name: byHandText.plan.step({ number: 1 }) }).fill("Retry the GET three times after a 503");
      await plan.getByRole("button", { name: byHandText.plan.confirm }).click();
      await runWhen(page, id, (value) => value.status === "review");
      const worktree = (await readRun(page, id)).worktreePath!;
      await writeFile(path.join(worktree, "src/retry.js"), handEdit(3));
      await page.goto(`/#/runs/${id}/changes?locale=en`);
      await page.reload();
      // The guide: the fitted banner, what isn't offered, R1 and no review at Ready.
      const guide = page.locator(".guide-panel");
      await expect(guide).toContainText(byHandText.guide.fitted({ kinds: "explanations, answers, and test help" }));
      await expect(guide).toContainText(byHandText.guide.notOffered({ kinds: "planning help and reviews" }));
      await expect(guide.getByRole("button", { name: byHandText.guide.next({ rung: byHandText.guide.rungs[1] }) })).toBeVisible();
      await page.locator(".review-footer").getByRole("button", { name: workspace.byHand.ready }).click();
      const ready = page.getByRole("dialog", { name: byHandText.ready.title });
      await expect(ready).toContainText(byHandText.ready.noReview);
      await expect(ready.getByRole("checkbox", { name: new RegExp(byHandText.ready.review) })).toHaveCount(0);
      await ready.getByRole("button", { name: byHandText.ready.confirm }).click();
      await expect(ready).toHaveCount(0);
      await toApprovalTicks(page, id);

      // Approved; publishing first asks to read the rules again, then quotes them for a confirm.
      await page.goto(`/#/runs/${id}/draft?locale=en`);
      await page.reload();
      await page.locator(".review-footer").getByRole("button", { name: workspace.footer.approvePr }).click();
      const publish = page.getByRole("dialog", { name: workspace.publish.title });
      await expect(publish).toBeVisible({ timeout: 30_000 });
      const block = publish.locator(".publish-block", { hasText: "decline AI-generated content" });
      await expect(block).toContainText("weren't read since this run started", { timeout: 30_000 });
      await block.getByRole("button", { name: mission.rules.checkAgain }).click();
      await expect(block).toHaveCount(0, { timeout: 30_000 });
      const rules = publish.locator("fieldset", { has: page.locator("legend", { hasText: workspace.publish.groups.rules }) });
      const confirm = rules.locator("label", { hasText: "its own text says some uses of AI are fine" });
      await expect(confirm).toContainText("DECLINE any contributions");
      await expect(confirm).toContainText("researching APIs or algorithms");
      await expect(confirm).toContainText("explanations, answers, and test help");
      // The record beside it, the claim once; no field for a reason anywhere.
      await expect(rules.locator(":scope > section.byhand-record")).toContainText(record.claim);
      await expect(publish.locator("textarea")).toHaveCount(0);
      const submit = publish.getByRole("button", { name: workspace.publish.submit });
      for (const box of await publish.getByRole("checkbox").all())
        if (!(await box.evaluate((input) => !!input.closest("label")?.textContent?.includes("its own text says some uses of AI are fine")))) await box.check();
      await expect(submit).toBeDisabled();
      await confirm.getByRole("checkbox").check();
      await expect(submit).toBeEnabled();
      const publishing = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/runs/${id}/publish`, { timeout: 60_000 });
      await submit.click();
      const answer = await publishing;
      expect(answer.status(), await answer.text()).toBeLessThan(300);
      const published = await runWhen(page, id, (value) => value.status === "published");
      expect(published.prUrl).toMatch(/\/pull\/1$/);
      expect((await project.ghCalls()).some((call) => call[1] === "pr" && call[2] === "create" && call.includes("--draft"))).toBe(true);
      // The tick went with the confirm's words, never as an override.
      const sentPublish = log.requests.filter((request) => request.path.endsWith("/publish") && request.method === "POST").at(-1)!.body as { acknowledged: string[]; rulesDigest?: string };
      expect(sentPublish.acknowledged).toContain("by-hand-rules");
      expect(sentPublish.rulesDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(log.overrides()).toEqual([]);

      // The same project, a run started with every kind of help: it ends at the ai-ban block naming not-fitted.
      const full = await page.request.post("/api/runs", {
        data: { repoId, prompt: "Retry a GET twice after a 503, so a flaky server stops breaking the page.", title: "Retry twice", learnByHand: true },
      });
      expect(full.status()).toBe(202);
      const fullId = ((await full.json()) as { run: Run }).run.id;
      await runWhen(page, fullId, (value) => value.status === "awaiting_plan");
      await readRules(page);
      const checks = await preflight(page, fullId);
      const ban = checks.find((check) => check.id === "ai-ban");
      expect([ban?.kind, ban?.reason]).toEqual(["block", "not-fitted"]);
      expect(ban?.message).toContain("this run wasn't fitted to its rules when it started");
      expect(checks.some((check) => check.id === "by-hand-rules")).toBe(false);
      readOnly(await project.agentCalls());
    } finally {
      await context.close();
      await project.stop();
    }
  });
});

/** The ticks and the PR text of a run already marked ready. */
async function toApprovalTicks(page: Page, id: string) {
  const { files } = (await (await page.request.get(`/api/runs/${id}/diff`)).json()) as { files: { path: string; fingerprint: string }[] };
  for (const file of files)
    expect((await page.request.post(`/api/runs/${id}/review`, { data: { filePath: file.path, reviewed: true, fingerprint: file.fingerprint } })).ok()).toBe(true);
  const draft = { title: "Retry a GET three times after a 503", body: "Retries a GET after a 503, up to three times. I wrote and tested it myself." };
  expect((await page.request.patch(`/api/runs/${id}/draft`, { data: draft })).ok()).toBe(true);
}
