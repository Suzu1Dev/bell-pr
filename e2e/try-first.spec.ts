// Try first on the sample run's explanation tab: the "Quiz yourself" card
// takes an answer and a confidence before it shows the reference, then a
// self-grade; the "What if it were done differently?" card takes a guess
// before it shows the alternative, then a choice and a why. The demo's
// "Fill with the sample answer" types on a timer that page.clock steps.
// Saving the attempts and finding them again after a reload need the
// workspace's onAttempt (L2D); the merge step checks those.
//
// The code walkthrough's "Check yourself" is tried first too (DESIGN v1.2
// D1): on the sample's src/client.ts it asks before it reveals and keeps
// the graded answer; on a real agent run, whose walkthrough the stand-in
// codex writes, a graded unit answer counts as the file's question in
// Explain it back.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { getDemo } from "../src/demo/all";
import en from "../src/i18n/en";
import zhTW from "../src/i18n/zh-TW";
import panelStrings from "../src/review/i18n/en";
import panelStringsZh from "../src/review/i18n/zh-TW";
import { typewriterStepMs } from "../src/review/try-first";
import { switchLocale } from "./fixtures";
import { expectNoOverflow } from "./helpers/overflow";
import { explanations, files, runId, startRealProject, type RealProject } from "./helpers/real-project";

const t = en.review.tryFirst;
const demo = getDemo("en");
const retry = "src/utils/retry.ts";
const explanationOf = (path: string) =>
  demo.files.find((file) => file.path === path)!.explanation!;
const quizSample = demo.quizSamples![retry];
const roadSample = demo.roadSamples![retry];
/** Markdown renders the reference; its first sentence is plain text. */
const firstSentence = (text: string) => text.slice(0, text.indexOf(". ") + 1);

/** The sample run's changes tab on `path`, with the explanation panel loaded. */
async function openFile(page: Page, path = retry) {
  await page.goto(`/#/runs/demo-run/changes?file=${path}&locale=en`);
  await expect(page.locator("#workspace-tab-changes")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".file-item.selected")).toHaveAttribute("title", path);
  await expect(page.locator(".explain-panel .explain-card-example")).toBeVisible();
}

const quizCard = (page: Page) => page.locator(".explain-card-selfcheck");
const roadCard = (page: Page) => page.locator(".explain-card-alternatives");

/** Answers the quiz with the sample at Think so, reveals it and grades it Got it. */
async function answerQuiz(page: Page) {
  const card = quizCard(page);
  const answer = card.getByRole("textbox", { name: t.quiz.answerLabel });
  await card.getByRole("button", { name: t.fill }).click();
  await expect(answer).toHaveValue(quizSample.answer);
  await card.getByRole("radio", { name: t.confidences.think }).check();
  await card.getByRole("button", { name: t.quiz.reveal }).click();
  await expect(card.getByRole("group", { name: t.quiz.gradeLabel })).toBeFocused();
  await card.getByRole("button", { name: t.grades.got }).click();
  await expect(card.locator(".tf-graded")).toHaveText(t.quiz.graded.got);
}

/** Guesses with the sample, reveals the alternative, keeps this approach and saves the why. */
async function chooseRoad(page: Page) {
  const card = roadCard(page);
  await card.getByRole("button", { name: t.fill }).click();
  await expect(card.getByRole("textbox", { name: t.road.guessLabel })).toHaveValue(roadSample.guess);
  await card.getByRole("button", { name: t.road.reveal }).click();
  await expect(card.getByRole("radiogroup", { name: t.road.choiceLabel })).toBeFocused();
  await card.getByRole("radio", { name: t.road.choices.keep }).check();
  await card.getByRole("button", { name: t.fill }).click();
  const why = card.getByRole("textbox", { name: t.road.whyLabel });
  await expect(why).toHaveValue(roadSample.why);
  const save = card.getByRole("button", { name: t.road.saveWhy, exact: true });
  await save.click();
  await expect(save).toBeDisabled();
}

test("the quiz takes an answer and a confidence before it shows the reference, then a grade", async ({ page }) => {
  // Time moves only when the test says so: the sample answer types on a timer.
  await page.clock.install({ time: new Date("2026-10-15T09:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-15T09:00:01Z"));
  await openFile(page);
  const card = quizCard(page);
  const reference = explanationOf(retry).selfCheck!.answer;
  await expect(card.locator("h3")).toContainText(t.badge);
  await expect(card).toContainText(explanationOf(retry).selfCheck!.question);
  const answer = card.getByRole("textbox", { name: t.quiz.answerLabel });
  await expect(answer).toHaveValue("");
  await expect(card.getByRole("radiogroup", { name: t.quiz.confidenceLabel }).getByRole("radio")).toHaveCount(3);
  // The reference is not on the page at all before the answer is in.
  await expect(card.locator(".tf-reference")).toBeEmpty();
  await expect(page.locator(".explain-panel")).not.toContainText(firstSentence(reference));

  await card.getByRole("button", { name: t.fill }).click();
  await page.clock.runFor(typewriterStepMs * 10);
  await expect(answer).toHaveValue(Array.from(quizSample.answer).slice(0, 10).join(""));
  await expect(card.getByRole("button", { name: t.fill })).toBeDisabled();
  await page.clock.runFor(typewriterStepMs * quizSample.answer.length);
  await expect(answer).toHaveValue(quizSample.answer);
  // An answer without a confidence is told how it can count.
  await expect(card.locator(".tf-hint")).toHaveText(t.quiz.confidenceHint);
  await card.getByRole("radio", { name: t.confidences.think }).check();
  await expect(card.locator(".tf-hint")).toHaveCount(0);

  await card.getByRole("button", { name: t.quiz.reveal }).click();
  await expect(card.locator(".tf-reference")).toContainText(t.quiz.referenceLabelDemo);
  await expect(card.locator(".tf-reference")).toContainText(firstSentence(reference));
  await expect(card.locator(".tf-yours")).toContainText(quizSample.answer);
  await expect(card.locator(".tf-yours .tf-tag")).toHaveText(t.confidences.think);
  await expect(answer).toHaveCount(0);
  const grades = card.getByRole("group", { name: t.quiz.gradeLabel });
  await expect(grades).toBeFocused();
  await expect(grades.getByRole("button")).toHaveText([
    `${t.grades.got}${t.gradeHints.got}`,
    `${t.grades.partly}${t.gradeHints.partly}`,
    `${t.grades.missed}${t.gradeHints.missed}`,
  ]);

  await card.getByRole("button", { name: t.grades.got }).click();
  await expect(card.locator(".tf-graded")).toHaveText(t.quiz.graded.got);
  await expect(card.locator(".tf-graded p").first()).toBeFocused();
  await expect(grades).toHaveCount(0);
  // The reference stays to read; Think so and Got it is not a miss.
  await expect(card.locator(".tf-reference")).toContainText(firstSentence(reference));
  await expect(card).not.toContainText(t.quiz.confidentMiss);
});

test("a confident miss says it comes back in practice", async ({ page }) => {
  await openFile(page, "src/client.ts");
  const card = quizCard(page);
  await card.getByRole("textbox", { name: t.quiz.answerLabel }).fill("Yes, every error is retried.");
  await card.getByRole("radio", { name: t.confidences.sure }).check();
  await card.getByRole("button", { name: t.quiz.reveal }).click();
  await card.getByRole("button", { name: t.grades.missed }).click();
  await expect(card.locator(".tf-graded")).toContainText(t.quiz.graded.missed);
  await expect(card.locator(".tf-miss")).toHaveText(t.quiz.confidentMiss);
});

test("I don't know records a miss at Guessing and shows the reference", async ({ page }) => {
  await openFile(page, "src/types.ts");
  const card = quizCard(page);
  await card.getByRole("button", { name: t.quiz.dontKnow }).click();
  await expect(card.locator(".tf-graded p").first()).toBeFocused();
  await expect(card.locator(".tf-graded")).toHaveText(t.quiz.graded.missed);
  await expect(card.locator(".tf-yours")).toContainText(t.quiz.dontKnowAnswer);
  await expect(card.locator(".tf-yours .tf-tag")).toHaveText(t.confidences.guess);
  await expect(card.locator(".tf-reference")).toContainText(
    firstSentence(explanationOf("src/types.ts").selfCheck!.answer),
  );
  // A miss at Guessing is not a confident one.
  await expect(card.locator(".tf-miss")).toHaveCount(0);
});

test("Show answer with the field empty skips the question in one click", async ({ page }) => {
  await openFile(page, "tests/retry.test.ts");
  const card = quizCard(page);
  await card.getByRole("button", { name: t.quiz.reveal }).click();
  await expect(card.locator(".tf-yours")).toContainText(t.quiz.skipped);
  await expect(card.locator(".tf-reference-body")).toBeFocused();
  await expect(card.locator(".tf-reference")).toContainText(
    firstSentence(explanationOf("tests/retry.test.ts").selfCheck!.answer),
  );
  await expect(card.getByRole("group", { name: t.quiz.gradeLabel })).toHaveCount(0);
});

test("the road choice takes a guess before it shows the alternative, then a choice and why", async ({ page }) => {
  await openFile(page);
  const card = roadCard(page);
  const alternative = firstSentence(explanationOf(retry).alternatives!);
  await expect(card.locator("h3")).toContainText(t.badge);
  await expect(card.locator(".tf-reference")).toBeEmpty();
  await expect(card).not.toContainText(alternative);
  // The lookup chips stay where they were.
  await expect(card.locator(".explain-lookup code")).toHaveText(explanationOf(retry).lookup!);

  await chooseRoad(page);
  await expect(card.locator(".tf-reference")).toContainText(alternative);
  await expect(card.locator(".tf-yours")).toContainText(roadSample.guess);
  await expect(card.getByRole("radio", { name: t.road.choices.keep })).toBeChecked();
  await expect(card.getByRole("textbox", { name: t.road.guessLabel })).toHaveCount(0);
  await expect(card.locator(".explain-lookup code")).toHaveText(explanationOf(retry).lookup!);
  // Another choice can still be made.
  await card.getByRole("radio", { name: t.road.choices.depends }).check();
  await expect(card.getByRole("radio", { name: t.road.choices.keep })).not.toBeChecked();
});

for (const width of [1440, 390])
  test(`every try-first state fits its text (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openFile(page);
    await page.evaluate(() => document.fonts.ready);
    await expectNoOverflow(page, [".explain-panel"]);
    await answerQuiz(page);
    await chooseRoad(page);
    await expect(quizCard(page).locator(".tf-reference")).not.toBeEmpty();
    await expectNoOverflow(page, [".explain-panel"]);
  });

/** The walkthrough tab of `path` on the sample, with its unit card loaded. */
async function openWalkthrough(page: Page, path: string) {
  await page.goto(`/#/runs/demo-run/changes?file=${path}&locale=en`);
  await expect(page.locator(".file-item.selected")).toHaveAttribute("title", path);
  await page.getByRole("tab", { name: en.review.panel.tabs.walkthrough }).click();
  await expect(page.locator(".walkthrough-card")).toHaveCount(1);
}

/** Answers a walkthrough unit's card at Think so, reveals its answer and grades it Got it. */
async function answerUnit(page: Page, answer: string, reference: string) {
  const card = page.locator(".walkthrough-card .tf-card");
  await expect(card.locator("h3")).toContainText(panelStrings.checkYourself);
  await expect(card.locator("h3")).toContainText(t.badge);
  // The unit's answer is not on the page at all before the person's is in.
  await expect(card.locator(".tf-reference")).toBeEmpty();
  await expect(page.locator(".explain-panel")).not.toContainText(reference);
  await card.getByRole("textbox", { name: t.quiz.answerLabel }).fill(answer);
  await card.getByRole("radio", { name: t.confidences.think }).check();
  await card.getByRole("button", { name: t.quiz.reveal }).click();
  await expect(card.locator(".tf-reference")).toContainText(reference);
  await expect(card.locator(".tf-yours")).toContainText(answer);
  await expect(card.getByRole("group", { name: t.quiz.gradeLabel })).toBeFocused();
  await card.getByRole("button", { name: t.grades.got }).click();
  await expect(card.locator(".tf-graded")).toHaveText(t.quiz.graded.got);
  return card;
}

test("the walkthrough's Check yourself asks before it reveals and keeps the graded answer", async ({ page }) => {
  const client = "src/client.ts";
  await openWalkthrough(page, client);
  // The fold of the try-first-off mode is gone.
  await expect(page.locator(".walkthrough-check")).toHaveCount(0);
  const answer = "Each retry runs the function again, so fetch sends a new request every time.";
  const card = await answerUnit(page, answer, "calls the function it was given again on every retry");
  // Saved with the sample in this browser (demoSaveAttempt): a reload finds it graded.
  await page.reload();
  await page.getByRole("tab", { name: en.review.panel.tabs.walkthrough }).click();
  await expect(card.locator(".tf-graded")).toHaveText(t.quiz.graded.got);
  await expect(card.locator(".tf-yours")).toContainText(answer);
  await expect(card.getByRole("textbox")).toHaveCount(0);
});

for (const width of [1440, 390])
  test(`the walkthrough's Check yourself fits its text (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openWalkthrough(page, "src/client.ts");
    await page.evaluate(() => document.fonts.ready);
    await expectNoOverflow(page, [".explain-panel"]);
    await answerUnit(page, "A new request goes out on every retry.", "calls the function it was given again on every retry");
    await expectNoOverflow(page, [".explain-panel"]);
  });

test("the walkthrough's Check yourself changes language with the page, without a reload", async ({ page }) => {
  const zh = zhTW.review.tryFirst;
  await page.goto("/#/runs/demo-run/changes?file=src/client.ts");
  await page.getByRole("tab", { name: en.review.panel.tabs.walkthrough }).click();
  const card = page.locator(".walkthrough-card .tf-card");
  await expect(card.locator("h3")).toHaveText(`${panelStrings.checkYourself}${t.badge}`);
  await page.evaluate(() => Object.assign(window, { stillHere: true }));
  await switchLocale(page, "zh-TW");
  // The card's own title comes from the panel's module-local strings; the rest from the zh-TW dictionary.
  await expect(card.locator("h3")).toHaveText(`${panelStringsZh.checkYourself}${zh.badge}`);
  await expect(card.getByRole("textbox", { name: zh.quiz.answerLabel })).toBeVisible();
  expect(await page.evaluate(() => "stillHere" in window)).toBe(true);
  await switchLocale(page, "en");
  await expect(card.locator("h3")).toHaveText(`${panelStrings.checkYourself}${t.badge}`);
});

for (const width of [1440, 390])
  test(`the walkthrough's Check yourself fits its zh-TW text (${width} px)`, async ({ page }) => {
    const zh = zhTW.review.tryFirst;
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/runs/demo-run/changes?file=src/client.ts&locale=zh-TW");
    await expect(page.locator(".file-item.selected")).toHaveAttribute("title", "src/client.ts");
    await page.getByRole("tab", { name: zhTW.review.panel.tabs.walkthrough }).click();
    const card = page.locator(".walkthrough-card .tf-card");
    await expect(card.locator("h3")).toContainText(panelStringsZh.checkYourself);
    await page.evaluate(() => document.fonts.ready);
    await expectNoOverflow(page, [".explain-panel"]);
    await card.getByRole("textbox", { name: zh.quiz.answerLabel }).fill("每次重試都會再呼叫一次傳進來的函式，所以會送出新的請求。");
    await card.getByRole("radio", { name: zh.confidences.think }).check();
    await card.getByRole("button", { name: zh.quiz.reveal }).click();
    await expect(card.getByRole("group", { name: zh.quiz.gradeLabel })).toBeFocused();
    await card.getByRole("button", { name: zh.grades.partly }).click();
    await expect(card.locator(".tf-graded")).toHaveText(zh.quiz.graded.partly);
    // A walkthrough miss promises no practice deck.
    await expect(card).not.toContainText(zh.quiz.confidentMiss);
    await expectNoOverflow(page, [".explain-panel"]);
  });

/** What the stand-in codex answers a walkthrough: languages() in src/greeting.ts (lines 56-58, the last one unchanged). */
const unitQuestion = "What does languages() return, and in what order?";
const unitReference = "The keys of the greetings table, sorted alphabetically.";
const walkthroughAnswer = JSON.stringify({
  functions: [
    {
      name: "languages",
      kind: "function",
      startLine: 56,
      endLine: 58,
      summary: "Lists the languages that have a greeting.",
      change: "New in this change: it reads the table's keys.",
      steps: [{ startLine: 57, endLine: 57, explanation: "Sorts the table's keys." }],
      callers: [],
      callees: [],
      analogy: "Like the index of a phrase book.",
      selfCheck: { question: unitQuestion, answer: unitReference },
    },
  ],
  newUnits: ["greeting"],
});

test.describe("the walkthrough's Check yourself on a real agent run", () => {
  test.describe.configure({ mode: "serial" });
  let project: RealProject;
  test.beforeAll(async () => {
    project = await startRealProject();
    // Each code file's walkthrough is asked for as soon as the run opens.
    await project.setAgentAnswer(walkthroughAnswer);
  });
  test.afterAll(async () => {
    await project?.stop();
  });

  async function open(browser: Browser) {
    const context = await browser.newContext({
      baseURL: project.baseURL,
      storageState: project.storageState,
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      timezoneId: "UTC",
      reducedMotion: "reduce",
    });
    return { page: await context.newPage(), close: () => context.close() };
  }

  test("a graded unit answer counts as the file's question in Explain it back", async ({ browser }) => {
    const { page, close } = await open(browser);
    try {
      await page.goto(`/#/runs/${runId}/changes?file=${files.greeting}&locale=en`);
      await page.getByRole("tab", { name: en.review.panel.tabs.walkthrough }).click();
      await expect(page.locator(".walkthrough-title strong")).toHaveText("languages", { timeout: 30_000 });
      const answer = "An array of every language name the table knows, alphabetical.";
      await answerUnit(page, answer, unitReference);
      // The check asks the unit's question for this file, answered during review.
      await page.goto(`/#/runs/${runId}/changes?panel=check&locale=en`);
      const check = page.locator(".understanding-check");
      const item = check
        .getByRole("region", { name: en.workspace.check.answerTitle })
        .getByRole("listitem")
        .filter({ hasText: unitQuestion });
      await expect(item).toContainText(en.workspace.check.credited);
      await expect(item).toContainText(answer);
    } finally {
      await close();
    }
  });
});

test("a tab still open on the question can't change the answer another tab saved, and shows that one", async ({ browser }) => {
  test.setTimeout(120_000);
  const project = await startRealProject();
  const context = await browser.newContext({
    baseURL: project.baseURL,
    storageState: project.storageState,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
  });
  try {
    // Two tabs on the same file's quiz, both before any answer is saved.
    const tabs = [await context.newPage(), await context.newPage()];
    for (const tab of tabs) {
      await tab.goto(`/#/runs/${runId}/changes?file=${files.greeting}&locale=en`);
      await expect(tab.locator(".file-item.selected")).toHaveAttribute("title", files.greeting);
      await expect(quizCard(tab).getByRole("textbox", { name: t.quiz.answerLabel })).toBeVisible();
    }
    const [first, stale] = tabs.map(quizCard);
    const answer = "The English greeting, because a missing language falls back to greetings.en.";
    const later = "Something else entirely, written after reading the reference.";
    await first.getByRole("textbox", { name: t.quiz.answerLabel }).fill(answer);
    await first.getByRole("radio", { name: t.confidences.sure }).check();
    await first.getByRole("button", { name: t.quiz.reveal }).click();
    await expect(first.locator(".tf-yours")).toContainText(answer);
    // The other tab still asks; the server keeps the answer on record (409) and the card says so,
    // then shows the saved answer with the reference instead of the one it was sent.
    await stale.getByRole("textbox", { name: t.quiz.answerLabel }).fill(later);
    await stale.getByRole("radio", { name: t.confidences.sure }).check();
    await stale.getByRole("button", { name: t.quiz.reveal }).click();
    await expect(stale.getByRole("alert")).toHaveText(t.fileChanged);
    await expect(stale.locator(".tf-yours")).toContainText(answer);
    await expect(stale).not.toContainText(later);
    await expect(stale.locator(".tf-reference")).toContainText(explanations[files.greeting].selfCheck.answer.slice(0, 40));
    const { run } = (await (await tabs[1].request.get(`/api/runs/${runId}`)).json()) as {
      run: { attempts: Record<string, { quiz?: { answer?: string } }> };
    };
    expect(run.attempts[files.greeting].quiz?.answer).toBe(answer);
  } finally {
    await context.close();
    await project.stop();
  }
});
