// Learn by hand end to end on a real (not sample) project (DESIGN v1.2
// §17, plan W3B): a run started from the task dialog, planned, written by
// the spec in the run's folder, helped by the guide, tested, marked ready,
// reviewed, checked and approved, with nothing stubbed but the agent CLIs
// and GitHub (e2e/helpers/real-project.ts: stand-in codex, claude and gh
// that log their arguments); the three publishing paths of the owner's
// answer 2 (blocked, confirmed, allowed) on real-shaped rules; and the
// fix-ups of README v1.2 §18.11 that only a browser shows.
import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { changeFingerprint } from "../shared/change-fingerprint";
import type { DraftCheck } from "../shared/draft-checks";
import type { Run } from "../src/types";
import record from "../src/byhand/record/i18n/en";
import byHandText from "../src/byhand/write/i18n/en";
import discovery from "../src/i18n/en/discovery";
import panelText from "../src/review/i18n/en";
import review from "../src/i18n/en/review";
import workspace from "../src/i18n/en/workspace";
import { repoId, runId, startRealProject, welcomeFacts, type AgentCall, type RealProject } from "./helpers/real-project";

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
