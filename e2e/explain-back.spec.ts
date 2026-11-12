// Explain it back in the sample workspace: the closed-book check opens from
// a deep link, refuses an answer that is too short, starts over, and passes
// with the sample's answers; with the check turned off, approval needs the
// reviewed ticks only and the run says so.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { e2eApiHeaders } from "./api-token.mjs";
import { getDemo } from "../src/demo/all";
import review from "../src/i18n/en/review";
import workspace from "../src/i18n/en/workspace";
import { expectNoOverflow } from "./helpers/overflow";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const demo = getDemo("en");
const t = workspace.check;
const sample = demo.understandingSample!;
const retry = demo.files.find((file) => file.path === "src/utils/retry.ts")!;
const retryQuestion = retry.explanation!.selfCheck!.question;
const panel = (page: Page) => page.locator(".understanding-check");
const step = (page: Page, name: string) => panel(page).getByRole("region", { name });
/** The sample's own answer to the question asked as `question`. */
const item = (page: Page, question: string) =>
  step(page, t.answerTitle).getByRole("listitem").filter({ hasText: question });

/** Fills the summary with the sample's words, typed out by its button. */
async function fillSummary(page: Page) {
  await step(page, t.explainTitle).getByRole("button", { name: t.fill }).click();
  await expect(step(page, t.explainTitle).getByRole("textbox")).toHaveValue(sample.summary);
}

/** Answers one question with the sample's answer at `confidence`. */
async function answer(page: Page, question: string, text: string, confidence: string) {
  const entry = item(page, question);
  await entry.getByRole("button", { name: t.fill }).click();
  await expect(entry.getByRole("textbox")).toHaveValue(text);
  await entry.getByRole("radio", { name: confidence }).check();
}

/** No serious or critical axe issue (color contrast included) on the page as it is. */
async function expectAccessible(page: Page, where: string) {
  await page.evaluate(() => document.fonts.ready);
  // Let transitions (focus rings, chips) settle before colors are read.
  await page.waitForTimeout(300);
  const { violations } = await new AxeBuilder({ page })
    .options({ rules: { "color-contrast": { enabled: true } } })
    .analyze();
  const serious = violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`));
  expect(serious, where).toEqual([]);
}

/** Ticks every file of the sample as reviewed. */
async function reviewAll(page: Page) {
  for (const file of demo.files) {
    await page.locator(`.file-item[title="${file.path}"]`).click();
    await page.getByRole("checkbox", { name: review.diff.reviewed }).check();
  }
  await expect(page.locator(".file-item .file-reviewed")).toHaveCount(demo.files.length);
}

test("a deep link opens the closed-book check, which refuses short answers and starts over", async ({ page }) => {
  await page.goto("/#/runs/demo-run/changes?panel=check&locale=en");
  await expect(panel(page).getByRole("heading", { name: t.title })).toBeVisible();
  // The address only asked for the panel; the flag does not stay.
  await expect(page).toHaveURL(/#\/runs\/demo-run\/changes\?locale=en$/);
  // Closed book: no explanation, notes, reviews or questions to the agent.
  await expect(page.locator(".explain-panel")).toHaveCount(0);
  await expect(page.locator(".explain-note-input")).toHaveCount(0);
  // The diff and the file list stay.
  await expect(page.locator(".diff-panel")).toBeVisible();
  await expect(page.locator(".file-item")).toHaveCount(demo.files.length);
  // One file question (retry.ts) for the sample's 97 changed lines, then what was not tested.
  await expect(panel(page)).toContainText(t.plan({ questions: 1, lines: 97 }));
  await expect(step(page, t.answerTitle).getByRole("listitem")).toHaveCount(2);

  await fillSummary(page);
  const first = item(page, retryQuestion);
  await first.getByRole("textbox").fill("Four seconds");
  await first.getByRole("radio", { name: t.confidences.think }).check();
  await answer(page, t.untestedQuestion, sample.untested, t.confidences.sure);
  await page.getByRole("button", { name: t.lock }).click();
  await expect(step(page, t.answerTitle).getByRole("alert")).toHaveText(t.answerShort({ min: 3 }));
  await expect(step(page, t.gradeTitle)).toHaveCount(0);

  // A real answer locks; the references appear only now.
  await answer(page, retryQuestion, sample.answers["selfCheck:src/utils/retry.ts"].answer, t.confidences.think);
  await page.getByRole("button", { name: t.lock }).click();
  const grade = step(page, t.gradeTitle);
  await expect(grade.getByRole("heading", { name: t.gradeTitle })).toBeFocused();
  await expect(grade).toContainText(retry.explanation!.selfCheck!.answer);
  await expect(grade).toContainText(t.reference);

  // Start over asks first, then clears the check.
  await page.getByRole("button", { name: t.startOver }).click();
  await expect(panel(page).getByRole("alert")).toHaveText(t.startOverConfirm);
  await panel(page).getByRole("button", { name: t.startOver }).click();
  await expect(step(page, t.explainTitle).getByRole("textbox")).toHaveValue("");
  await expect(step(page, t.gradeTitle)).toHaveCount(0);
  await expect(item(page, retryQuestion).getByRole("textbox")).toHaveValue("");
});

test("the sample passes with its own answers: a correction, a prediction and the result line", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/runs"))
      writes.push(request.url());
  });
  await page.goto("/#/runs/demo-run/changes?locale=en");
  await reviewAll(page);
  const footer = page.locator(".review-footer");
  await expect(footer).toContainText(workspace.footer.allReviewed);
  await expect(page.locator(".review-progress")).toContainText(workspace.changes.allReviewed);
  const explain = page.getByRole("button", { name: workspace.footer.explainBack });
  await expect(explain).toHaveAttribute("title", workspace.footer.needsCheck);
  await explain.click();

  await fillSummary(page);
  const partly = sample.answers["selfCheck:src/utils/retry.ts"];
  await answer(page, retryQuestion, partly.answer, t.confidences.think);
  await answer(page, t.untestedQuestion, sample.untested, t.confidences.sure);
  await page.getByRole("button", { name: t.lock }).click();

  const grade = step(page, t.gradeTitle);
  await grade.getByRole("radio", { name: t.grades.partly }).check();
  const correct = step(page, t.correctTitle);
  await correct.getByRole("button", { name: t.fill }).click();
  await expect(correct.getByRole("textbox")).toHaveValue(partly.correction!);
  await page.getByRole("button", { name: t.saveGrades }).click();

  const forecast = step(page, t.forecastTitle);
  await expect(forecast.getByRole("heading")).toBeFocused();
  await forecast.getByRole("radio", { name: t.dimensions.tests }).check();
  await forecast.getByRole("button", { name: t.fill }).click();
  await expect(forecast.getByRole("textbox")).toHaveValue(sample.forecast.question);
  await forecast.getByRole("button", { name: t.saveForecast }).click();

  const result = panel(page).getByRole("region", { name: t.resultTitle });
  await expect(result).toContainText(t.result({ questions: 2, misses: 1 }));
  await expect(result).toContainText(t.forecast({ dimension: t.dimensions.tests }));
  await expect(footer).toContainText(workspace.footer.passed);

  // The check is kept with the sample in this browser.
  await page.reload();
  await page.locator("#workspace-tab-changes").click();
  await expect(page.locator(".review-footer")).toContainText(workspace.footer.passed);
  await page.getByRole("button", { name: workspace.changes.openCheck }).click();
  await expect(panel(page).getByRole("region", { name: t.resultTitle })).toContainText(
    t.result({ questions: 2, misses: 1 }),
  );
  expect(writes).toEqual([]);
});

for (const width of [1440, 390])
  test(`the open check fits at ${width} px and reads well at every step`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
    await page.goto("/#/runs/demo-run/changes?panel=check&locale=en");
    await expect(panel(page).getByRole("heading", { name: t.title })).toBeVisible();
    await fillSummary(page);
    await page.evaluate(() => document.fonts.ready);
    await expectNoOverflow(page);
    await expectAccessible(page, `answering at ${width} px`);
    const partly = sample.answers["selfCheck:src/utils/retry.ts"];
    await answer(page, retryQuestion, partly.answer, t.confidences.think);
    await answer(page, t.untestedQuestion, sample.untested, t.confidences.sure);
    await page.getByRole("button", { name: t.lock }).click();
    await step(page, t.gradeTitle).getByRole("radio", { name: t.grades.partly }).check();
    await expectNoOverflow(page);
    await expectAccessible(page, `grading at ${width} px`);
    await step(page, t.correctTitle).getByRole("button", { name: t.fill }).click();
    await expect(step(page, t.correctTitle).getByRole("textbox")).toHaveValue(partly.correction!);
    await page.getByRole("button", { name: t.saveGrades }).click();
    await expect(panel(page).getByRole("region", { name: t.resultTitle })).toBeVisible();
    await expectNoOverflow(page);
    await expectAccessible(page, `passed at ${width} px`);
  });

/** A page on a spec-local server. */
async function openOn(browser: Browser, server: LaunchedServer) {
  const context = await browser.newContext({
    extraHTTPHeaders: e2eApiHeaders,
    baseURL: server.baseURL,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
  });
  return { page: await context.newPage(), close: () => context.close() };
}

test("with the check turned off, the run says so and approval needs the ticks only", async ({ browser }) => {
  const server = await launchServer({
    seed: (dataDir) =>
      writeFile(
        path.join(dataDir, "app-settings.json"),
        JSON.stringify({ skipUnderstandingCheck: true }),
      ),
  });
  const { page, close } = await openOn(browser, server);
  try {
    await page.goto("/#/runs/demo-run/changes?locale=en");
    const badge = page.locator(".title-row .check-off-badge");
    await expect(badge).toContainText(workspace.checkOff.label);
    await expect(page.locator("#check-off-help")).toHaveText(workspace.checkOff.tooltipSetting);
    await reviewAll(page);
    await expect(page.locator(".review-footer")).toContainText(workspace.footer.checkOff);
    await expect(page.locator(".review-progress")).toContainText(workspace.changes.allReviewedDone);
    await page.getByRole("button", { name: workspace.footer.approvePr }).click();
    const dialog = page.getByRole("dialog", { name: workspace.publish.titleDemo });
    await expect(dialog).toContainText(workspace.publish.checkOff);
    // The sample's own rule asks contributors to explain their change: with
    // the check off, the dialog asks the person to confirm they read it.
    await expect(dialog.getByRole("group", { name: workspace.publish.groups.rules })).toBeVisible();
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: workspace.publish.finishDemo }).click();
    await expect(page.locator(".sample-published")).toContainText(demo.publishedCard!.title);
    // Approved without the check: the mark stays on the run.
    await expect(badge).toContainText(workspace.checkOff.label);
    await expect(page.locator("#check-off-help")).toHaveText(workspace.checkOff.tooltip);
  } finally {
    await close();
    await server.stop();
  }
});

test("a quiz answered during review counts in the check, after a reload too", async ({ page }) => {
  const quiz = review.tryFirst;
  await page.goto(`/#/runs/demo-run/changes?file=${retry.path}&locale=en`);
  const card = page.locator(".explain-card-selfcheck");
  await card.getByRole("textbox", { name: quiz.quiz.answerLabel }).fill(demo.quizSamples!["src/utils/retry.ts"].answer);
  await card.getByRole("radio", { name: quiz.confidences.think }).check();
  await card.getByRole("button", { name: quiz.quiz.reveal }).click();
  await card.getByRole("button", { name: quiz.grades.got }).click();
  await expect(card.locator(".tf-graded")).toHaveText(quiz.quiz.graded.got);
  // The attempt is kept with the sample in this browser.
  await page.reload();
  await expect(page.locator(".explain-card-selfcheck .tf-graded")).toHaveText(quiz.quiz.graded.got);
  await page.goto("/#/runs/demo-run/changes?panel=check&locale=en");
  await expect(item(page, retryQuestion)).toContainText(t.credited);
});
