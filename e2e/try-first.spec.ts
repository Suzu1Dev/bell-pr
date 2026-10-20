// Try first on the sample run's explanation tab: the "Quiz yourself" card
// takes an answer and a confidence before it shows the reference, then a
// self-grade; the "What if it were done differently?" card takes a guess
// before it shows the alternative, then a choice and a why. The demo's
// "Fill with the sample answer" types on a timer that page.clock steps.
// Saving the attempts and finding them again after a reload need the
// workspace's onAttempt (L2D); the merge step checks those.
import { expect, test, type Page } from "@playwright/test";
import { getDemo } from "../src/demo/all";
import en from "../src/i18n/en";
import { typewriterStepMs } from "../src/review/try-first";
import { expectNoOverflow } from "./helpers/overflow";

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
