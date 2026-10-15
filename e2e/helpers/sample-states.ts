// The sample project's filmable states (the promo storyboard's demo states,
// plan direction-v1.1/VIDEO.md §4), driven the way the capture films them:
// presentation mode in English at the capture's window size, a paused page
// clock that moves only when a step says so, and the demo's "Fill with the
// sample answer" buttons. e2e/promo-states.spec.ts films each state twice
// and compares the frames; e2e/a11y.spec.ts and e2e/responsive.spec.ts
// reuse the drivers for the new views.
import { readFileSync } from "node:fs";
import { expect, type Locator, type Page } from "@playwright/test";
import { htmlLang, type Locale } from "../../shared/i18n/locale";
import { getDemo } from "../../src/demo";
import en from "../../src/i18n/en";
import zhTW from "../../src/i18n/zh-TW";

/** What the promo capture uses (marketing/promo-video/src/timeline.json). */
const timeline = JSON.parse(
  readFileSync(new URL("../../marketing/promo-video/src/timeline.json", import.meta.url), "utf8"),
) as {
  viewport: { width: number; height: number; deviceScaleFactor: number };
  baseFlags: Record<string, string>;
  clockStart: string;
};

/** The capture's window: 1440x810 CSS pixels at 2x. */
export const captureViewport = {
  width: timeline.viewport.width,
  height: timeline.viewport.height,
};
export const captureScale = timeline.viewport.deviceScaleFactor;
/** `present=1&locale=en&capture=1`. */
export const captureFlags = timeline.baseFlags;
/** The capture's clock; the page's own clock starts here and is paused. */
export const captureClock = new Date(timeline.clockStart);

export const messages = { en, "zh-TW": zhTW } as const;
export type Messages = (typeof messages)[Locale];

/**
 * The address of `route` (which may carry its own query, such as
 * `?file=src/client.ts`) with `flags` and the capture's flags, in `locale`.
 */
export function sampleUrl(route: string, flags: Record<string, string> = {}, locale: Locale = "en") {
  const [path, query = ""] = route.split("?");
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries({ ...flags, ...captureFlags, locale }))
    params.set(key, value);
  return `/${path}?${params.toString().replace(/%2F/gi, "/")}`;
}

/**
 * Pauses the page's clock at the capture's start before anything loads:
 * timers (the playback, the typewriters) fire only in tick(), so every
 * run sees the same times.
 */
export async function pauseClock(page: Page) {
  await page.clock.install({ time: new Date(captureClock.getTime() - 1000) });
  await page.clock.pauseAt(captureClock);
}

/** Moves the paused clock on by `ms`, firing every timer due on the way. */
export async function tick(page: Page, ms: number) {
  await page.clock.runFor(ms);
}

/**
 * Lets lazy views show: waits until the network is idle (their code and
 * data have arrived), then moves the clock on by a fixed second, since
 * React reveals a suspended view on a timer. A fixed step keeps every run
 * at the same time.
 */
export async function reveal(page: Page) {
  await page.waitForLoadState("networkidle");
  await tick(page, 1_000);
}

/** Waits until the app has rendered its data and its fonts. */
export async function settled(page: Page, locale: Locale = "en") {
  await expect(page.locator("html")).toHaveAttribute("lang", htmlLang(locale));
  await expect(page.locator("#main-content")).toBeVisible();
  await reveal(page);
  await expect(page.locator(".app-starting")).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

/** Opens `route` with the capture's flags (and `flags`) and waits for it. */
export async function openSample(
  page: Page,
  route: string,
  { flags = {}, locale = "en" }: { flags?: Record<string, string>; locale?: Locale } = {},
) {
  await page.goto(sampleUrl(route, flags, locale));
  await settled(page, locale);
}

/** Changes the address inside the running app, as a link would, without a reload. */
export async function goHash(
  page: Page,
  route: string,
  { flags = {}, locale = "en" }: { flags?: Record<string, string>; locale?: Locale } = {},
) {
  const hash = sampleUrl(route, flags, locale).slice(1);
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await expect(page).toHaveURL(new RegExp(`${hash.split("?")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?`));
}

/** The playback's flags: it plays at the capture's top speed. */
export const playFlags = { demo: "play", speed: "4" };

const statusBadge = (page: Page) => page.locator(".workspace-heading .status-badge");

/** v-plan: the sample plays from the activity tab until the plan waits for approval. */
export async function playToPlan(page: Page, locale: Locale = "en") {
  const t = messages[locale];
  await openSample(page, "#/runs/demo-run/activity", { flags: playFlags, locale });
  await tick(page, 20_000);
  await expect(statusBadge(page)).toHaveText(t.common.runStatus.awaiting_plan);
}

/** v-board: the plan is approved and the team is at work, a moment in. */
export async function approvePlan(page: Page, locale: Locale = "en") {
  const t = messages[locale];
  await page.getByRole("button", { name: t.team.approval.approve }).click();
  await tick(page, 1_200);
  await expect(statusBadge(page)).toHaveText(t.common.runStatus.running);
}

/** The played run waits for the person's review, every explanation ready. */
export async function playToReview(page: Page, locale: Locale = "en") {
  const t = messages[locale];
  await playToPlan(page, locale);
  await approvePlan(page, locale);
  await tick(page, 120_000);
  await expect(statusBadge(page)).toHaveText(t.common.runStatus.review);
}

const fileItem = (page: Page, path: string) => page.locator(`.file-item[title="${path}"]`);

/** Opens the changes tab of the played run on `path`, with its explanation loaded. */
export async function openPlayedFile(page: Page, path: string, locale: Locale = "en") {
  await goHash(page, `#/runs/demo-run/changes?file=${path}`, { flags: { demo: "play" }, locale });
  await expect(page.locator(".file-item.selected")).toHaveAttribute("title", path);
  await reveal(page);
  await expect(page.locator(".explain-panel .explain-card-example")).toBeVisible();
}

/** Ticks every file of the played sample as reviewed in its changes tab, as e2e/demo.spec.ts does. */
export async function reviewAll(page: Page, locale: Locale = "en") {
  const t = messages[locale];
  const demo = getDemo(locale);
  await openPlayedFile(page, demo.files[0].path, locale);
  for (const file of demo.files) {
    await fileItem(page, file.path).click();
    await page.getByRole("checkbox", { name: t.review.diff.reviewed }).check();
  }
  await expect(page.locator(".file-item .file-reviewed")).toHaveCount(demo.files.length);
}

/** The try-first quiz on src/client.ts: the sample answer at Think so, revealed, graded Got it. */
export async function quizAttempt(page: Page, locale: Locale = "en", { grade = true } = {}) {
  const t = messages[locale].review.tryFirst;
  const sample = getDemo(locale).quizSamples!["src/client.ts"];
  const card = page.locator(".explain-card-selfcheck");
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: t.fill }).click();
  await tick(page, 5_000);
  await expect(card.getByRole("textbox", { name: t.quiz.answerLabel })).toHaveValue(sample.answer);
  await card.getByRole("radio", { name: t.confidences.think }).check();
  await card.getByRole("button", { name: t.quiz.reveal }).click();
  await expect(card.getByRole("group", { name: t.quiz.gradeLabel })).toBeVisible();
  if (grade) {
    await card.getByRole("button", { name: t.grades.got }).click();
    await expect(card.locator(".tf-graded")).toHaveText(t.quiz.graded.got);
  }
  return card;
}

/** The road choice on src/utils/retry.ts: the sample guess, the alternative, "Keep this approach" and why. */
export async function roadChoice(page: Page, locale: Locale = "en") {
  const t = messages[locale].review.tryFirst;
  const sample = getDemo(locale).roadSamples!["src/utils/retry.ts"];
  const card = page.locator(".explain-card-alternatives");
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: t.fill }).click();
  await tick(page, 5_000);
  await expect(card.getByRole("textbox", { name: t.road.guessLabel })).toHaveValue(sample.guess);
  await card.getByRole("button", { name: t.road.reveal }).click();
  await card.getByRole("radio", { name: t.road.choices.keep }).check();
  await card.getByRole("button", { name: t.fill }).click();
  await tick(page, 5_000);
  await expect(card.getByRole("textbox", { name: t.road.whyLabel })).toHaveValue(sample.why);
  const save = card.getByRole("button", { name: t.road.saveWhy, exact: true });
  await save.click();
  await expect(save).toBeDisabled();
  return card;
}

/** Asks about lines 10-15 of src/utils/retry.ts (the removed line through the added ones) and lets the answer type out. */
export async function askAboutLines(page: Page, locale: Locale = "en") {
  const t = messages[locale].review;
  const line = (label: string) => page.locator(`[role=option][aria-label^="${label}"]`).first();
  await line(t.diff.lineLabel.removed({ line: 10, text: "" })).click();
  await line(t.diff.lineLabel.added({ line: 15, text: "" })).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: t.diff.askSelection }).click();
  await tick(page, 10_000);
  await expect(page.locator(".explain-loading")).toHaveCount(0);
  const bubble = page.locator(".explain-message-user").last();
  await expect(bubble.locator("pre > code.language-diff")).toBeVisible();
  const answer = page.locator(".explain-message-assistant").last();
  await expect(answer).toBeVisible();
  return { bubble, answer };
}

const panel = (page: Page) => page.locator(".understanding-check");
export const checkStep = (page: Page, name: string) => panel(page).getByRole("region", { name });

/** The played run's check, opened through the `panel=check` deep link with every file ticked. */
export async function openCheck(page: Page, locale: Locale = "en") {
  const t = messages[locale].workspace.check;
  await goHash(page, "#/runs/demo-run/changes?panel=check", { flags: { demo: "play" }, locale });
  await reveal(page);
  await expect(panel(page).getByRole("heading", { name: t.title })).toBeVisible();
  // Closed book: the explanation panel is gone, the diff stays.
  await expect(page.locator(".explain-panel")).toHaveCount(0);
  return panel(page);
}

/** Step 1: the summary, typed out by its Fill button. */
export async function fillSummary(page: Page, locale: Locale = "en") {
  const t = messages[locale].workspace.check;
  const sample = getDemo(locale).understandingSample!;
  const step = checkStep(page, t.explainTitle);
  await step.getByRole("button", { name: t.fill }).click();
  await tick(page, 5_000);
  await expect(step.getByRole("textbox")).toHaveValue(sample.summary);
}

/**
 * Step 2: retry.ts's question at Think so (the sample's own answer), and
 * what was not tested; then "Lock my answers".
 */
export async function answerCheck(page: Page, locale: Locale = "en") {
  const t = messages[locale].workspace.check;
  const sample = getDemo(locale).understandingSample!;
  const answers = checkStep(page, t.answerTitle).getByRole("listitem");
  await expect(answers).toHaveCount(2);
  for (const [index, id] of ["selfCheck:src/utils/retry.ts", "untested"].entries()) {
    const entry = answers.nth(index);
    await entry.getByRole("button", { name: t.fill }).click();
    await tick(page, 5_000);
    await expect(entry.getByRole("textbox")).toHaveValue(sample.answers[id].answer);
    await entry.getByRole("radio", { name: t.confidences[sample.answers[id].confidence] }).check();
  }
  await panel(page).getByRole("button", { name: t.lock }).click();
  await expect(checkStep(page, t.gradeTitle)).toBeVisible();
}

/** Steps 3 and 4: Partly, with the sample's one-line correction; the result line follows. */
export async function gradeCheck(page: Page, locale: Locale = "en") {
  const t = messages[locale].workspace.check;
  const sample = getDemo(locale).understandingSample!;
  await checkStep(page, t.gradeTitle).getByRole("radio", { name: t.grades.partly }).check();
  const correct = checkStep(page, t.correctTitle);
  await correct.getByRole("button", { name: t.fill }).click();
  await tick(page, 5_000);
  await expect(correct.getByRole("textbox")).toHaveValue(
    sample.answers["selfCheck:src/utils/retry.ts"].correction!,
  );
  await panel(page).getByRole("button", { name: t.saveGrades }).click();
  const result = panel(page).getByRole("region", { name: t.resultTitle });
  await expect(result).toContainText(t.result({ questions: 2, misses: 1 }));
  return result;
}

/** Step 5: the forecast, Tests and the sample's line. */
export async function forecastCheck(page: Page, locale: Locale = "en") {
  const t = messages[locale].workspace.check;
  const sample = getDemo(locale).understandingSample!;
  const forecast = checkStep(page, t.forecastTitle);
  await forecast.getByRole("radio", { name: t.dimensions[sample.forecast.dimension] }).check();
  await forecast.getByRole("button", { name: t.fill }).click();
  await tick(page, 5_000);
  await expect(forecast.getByRole("textbox")).toHaveValue(sample.forecast.question);
  await forecast.getByRole("button", { name: t.saveForecast }).click();
  const result = panel(page).getByRole("region", { name: t.resultTitle });
  await expect(result).toContainText(t.forecast({ dimension: t.dimensions[sample.forecast.dimension] }));
  return result;
}

/** The whole check on the played run: v-check, then v-forecast. */
export async function passPlayedCheck(page: Page, locale: Locale = "en") {
  await reviewAll(page, locale);
  await openCheck(page, locale);
  await fillSummary(page, locale);
  await answerCheck(page, locale);
  await gradeCheck(page, locale);
  await forecastCheck(page, locale);
}

/** v-draft-your-words: both inserts, then the draft is saved. */
export async function insertYourWords(page: Page, locale: Locale = "en") {
  const t = messages[locale];
  await page.locator("#workspace-tab-draft").click();
  await reveal(page);
  const card = page.locator(".your-words");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: t.draft.yourWords.useExplanation }).click();
  await card.getByRole("button", { name: t.draft.yourWords.addUntested }).click();
  await page.getByRole("button", { name: t.workspace.draft.save }).click();
  // The "PR draft saved" toast goes away on its own after 4.5 s.
  await tick(page, 5_000);
  await expect(page.locator(".toast")).toHaveCount(0);
  return card;
}

/** v-publish: the footer's approve opens the sample's publish dialog. */
export async function openPublish(page: Page, locale: Locale = "en") {
  const t = messages[locale].workspace;
  await page.getByRole("button", { name: t.footer.approvePr }).click();
  await reveal(page);
  const dialog = page.getByRole("dialog", { name: t.publish.titleDemo });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(t.publish.allClear);
  // The dialog scrolls its focused button into view once its checks load;
  // the frame then shows the checks, the same on every run.
  await expect(dialog.getByRole("button", { name: t.publish.finishDemo })).toBeEnabled();
  await stillScrolls(page);
  await dialog.locator(".publish-checks").evaluate((element) =>
    element.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  return dialog;
}

/** Opens the sample Draft PR from the dialog; the published card shows. */
export async function finishPublish(page: Page, dialog: Locator, locale: Locale = "en") {
  const t = messages[locale].workspace;
  await dialog.getByRole("button", { name: t.publish.finishDemo }).click();
  await tick(page, 10_000);
  const card = page.locator(".sample-published");
  await expect(card).toContainText(getDemo(locale).publishedCard!.title);
  return card;
}

/** v-forecast-vs-reality: "Read feedback" on the published sample. */
export async function readSampleFeedback(page: Page, locale: Locale = "en") {
  const t = messages[locale].workspace;
  await page.locator("#workspace-tab-draft").click();
  await reveal(page);
  await page.getByRole("button", { name: new RegExp(`^${t.feedback.fetch}`) }).click();
  await tick(page, 5_000);
  await reveal(page);
  const compare = page.locator("section.forecast");
  await expect(compare).toBeVisible();
  return compare;
}

/** Every scroll position on the page: the window's and each scrolled box's. */
const scrollPositions = (page: Page) =>
  page.evaluate(() => [
    window.scrollX,
    window.scrollY,
    ...Array.from(document.querySelectorAll("*"))
      .filter((element) => element.scrollTop || element.scrollLeft)
      .flatMap((element) => [element.scrollTop, element.scrollLeft]),
  ]);

/**
 * Waits until no smooth scroll is still moving (the chat scrolls to a new
 * answer smoothly, which the browser animates on its own clock).
 */
export async function stillScrolls(page: Page) {
  let previous = JSON.stringify(await scrollPositions(page));
  for (let calm = 0; calm < 3; ) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const now = JSON.stringify(await scrollPositions(page));
    calm = now === previous ? calm + 1 : 0;
    previous = now;
  }
}

/**
 * Waits until every finite CSS animation and transition has ended (a
 * dialog's backdrop fades in on the browser's own clock), so a frame never
 * catches one part way.
 */
export async function stillAnimations(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.playState === "running" &&
                animation.effect?.getTiming().iterations !== Infinity,
            ).length,
      ),
    )
    .toBe(0);
}

/** Moves the mouse out of the way, so no hover style shows in a frame. */
export async function parkPointer(page: Page) {
  await page.mouse.move(1, captureViewport.height - 2);
}
