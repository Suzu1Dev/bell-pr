// Every demo state the v1.1 promo films (plan direction-v1.1/VIDEO.md §4),
// one test per state id. Each state is opened with the capture's flags
// (present=1&locale=en&capture=1) at the capture's window (1440x810 at 2x)
// on a server whose setup looks ready, driven with the demo's "Fill with
// the sample answer" buttons under a paused page clock, and checked for:
// - the elements the storyboard names;
// - no Han characters in the page (the language switcher's own name for
//   Traditional Chinese aside);
// - no text cut off or spilling out (expectNoOverflow);
// - no request leaving the machine, no request to a Pro-gated route and,
//   in the sample, no write to a run;
// - the same frames on two films in fresh browsers (a SHA-256 of each
//   screenshot), so the capture is deterministic.
// The frames and their hashes are kept in e2e/output/promo-states/
// (gitignored), so two runs of the suite can be compared too. The five
// main states are also opened in zh-TW, for the optional zh-TW cut.
//
//   BELLPR_E2E_PORT=<port> npx playwright test e2e/promo-states.spec.ts
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Locale } from "../shared/i18n/locale";
import { getDemo } from "../src/demo";
import { assertNoHan } from "../src/test-utils/render";
import { expectNoOverflow } from "./helpers/overflow";
import { startReadyServer } from "./helpers/ready-server";
import {
  answerCheck,
  approvePlan,
  askAboutLines,
  captureScale,
  captureViewport,
  checkStep,
  fillSummary,
  finishPublish,
  forecastCheck,
  gradeCheck,
  insertYourWords,
  messages,
  openCheck,
  openPlayedFile,
  openPublish,
  openSample,
  parkPointer,
  passPlayedCheck,
  pauseClock,
  playToPlan,
  playToReview,
  quizAttempt,
  readSampleFeedback,
  reviewAll,
  roadChoice,
  settled,
  stillAnimations,
  stillScrolls,
} from "./helpers/sample-states";
import type { LaunchedServer } from "./start-server.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = path.join(root, "e2e", "output", "promo-states");

/** Routes a Pro plan gates (requirePro); the demo never calls them. */
const gatedRoutes = [
  /^POST \/api\/discovery$/,
  /^POST \/api\/repos\/[^/]+\/insights\/recommendations$/,
  /^GET \/api\/runs\/[^/]+\/export\.md$/,
  /^POST \/api\/runs\/[^/]+\/follow-ups$/,
  /^POST \/api\/learning\/debrief$/,
];

interface Film {
  page: Page;
  locale: Locale;
  t: (typeof messages)[Locale];
  /** Checks the page as it is and keeps its frame under `name`. */
  shot(name: string): Promise<void>;
}

interface PromoState {
  id: string;
  /** VIDEO.md §4's route, for the report. */
  route: string;
  /** One of the five main states, also opened in zh-TW. */
  main?: boolean;
  /** Writes it may send: the check-off state saves the setting. */
  writes?: RegExp;
  drive(film: Film): Promise<void>;
}

const demo = (locale: Locale) => getDemo(locale);

const states: PromoState[] = [
  {
    id: "v-rules-card",
    route: "#/runs/demo-run/overview",
    main: true,
    async drive({ page, locale, t, shot }) {
      await openSample(page, "#/runs/demo-run/overview", { locale });
      const card = page.locator(".rules-card");
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByRole("heading", { name: t.mission.rules.title })).toBeVisible();
      await expect(card.locator("figure")).toHaveCount(3);
      for (const figure of await card.locator("figure").all())
        await expect(figure.locator("figcaption code")).toHaveText(/^CONTRIBUTING\.md:\d+$/);
      if (locale === "en")
        for (const quote of [
          "Open an issue before changing behavior.",
          "You must be able to explain your change in review.",
          "If you used AI tools, say so in the PR description.",
        ])
          await expect(card.locator("blockquote", { hasText: quote })).toHaveCount(1);
      await expect(card.locator(".rules-card-door")).toHaveText(t.mission.rules.door.open);
      // What BELL PR does about each rule when publishing.
      await expect(card.locator(".rules-card-effect")).toHaveCount(3);
      await shot("card");
    },
  },
  {
    id: "v-before-you-start",
    route: "#/runs/demo-run/overview → Start with this direction",
    async drive({ page, locale, t, shot }) {
      await openSample(page, "#/runs/demo-run/overview", { locale });
      await page.getByRole("button", { name: t.mission.ideas.choose }).first().click();
      const dialog = page.getByRole("dialog", { name: t.modals.newTask.title });
      const facts = dialog.locator(".before-start");
      await expect(facts.locator(".before-start-issue")).toHaveText(t.mission.start.sampleIssue({ number: 42 }));
      // The sample's issue exists nowhere: it is no link.
      await expect(facts.locator("a")).toHaveCount(0);
      await expect(facts.locator(".before-start-chip")).toHaveText([
        t.mission.start.open,
        t.mission.start.unassigned,
        t.mission.start.noOtherPr,
        new RegExp(`^${t.mission.start.maintainer({ quote: "x", date: "y" }).split("“")[0]}`),
        t.mission.start.pacing({ open: 0, budget: 1 }),
      ]);
      await expect(facts.locator(".before-start-chip.is-ok")).toHaveCount(4);
      await facts.scrollIntoViewIfNeeded();
      await settled(page, locale);
      await shot("task-dialog");
    },
  },
  {
    id: "v-plan",
    route: "#/runs/demo-run/activity?demo=play&speed=4",
    async drive({ page, locale, t, shot }) {
      await playToPlan(page, locale);
      const plan = page.locator(".team-plan.needs-approval");
      await expect(plan).toBeVisible();
      await expect(plan).toContainText(t.team.phase.awaiting_approval);
      const approve = page.getByRole("button", { name: t.team.approval.approve });
      await expect(approve).toBeVisible();
      await approve.scrollIntoViewIfNeeded();
      await shot("plan");
    },
  },
  {
    id: "v-board",
    route: "#/runs/demo-run/activity?demo=play&speed=4 → approve the plan",
    async drive({ page, locale, shot }) {
      await playToPlan(page, locale);
      await approvePlan(page, locale);
      const board = page.locator(".team-kanban");
      await expect(board.locator(".team-task.task-running").first()).toBeVisible();
      await expect(page.locator(".team-messages .team-message").first()).toBeVisible();
      await board.scrollIntoViewIfNeeded();
      await shot("board");
    },
  },
  {
    id: "v-quiz-attempt",
    route: "#/runs/demo-run/changes?file=src/client.ts&demo=play",
    main: true,
    async drive({ page, locale, t, shot }) {
      const tf = t.review.tryFirst;
      await playToReview(page, locale);
      await openPlayedFile(page, "src/client.ts", locale);
      const card = page.locator(".explain-card-selfcheck");
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByRole("textbox", { name: tf.quiz.answerLabel })).toBeVisible();
      await expect(card.getByRole("radiogroup", { name: tf.quiz.confidenceLabel }).getByRole("radio")).toHaveCount(3);
      await quizAttempt(page, locale, { grade: false });
      // The reference, labelled as a sample of an AI-written answer, and the grade chips.
      await expect(card.locator(".tf-reference")).toContainText(tf.quiz.referenceLabelDemo);
      await expect(card.getByRole("group", { name: tf.quiz.gradeLabel }).getByRole("button")).toHaveCount(3);
      await shot("reveal");
      await card.getByRole("button", { name: tf.grades.got }).click();
      await expect(card.locator(".tf-graded")).toHaveText(tf.quiz.graded.got);
      const example = page.locator(".explain-card-example");
      await example.scrollIntoViewIfNeeded();
      await expect(example).toBeVisible();
      await shot("example");
    },
  },
  {
    id: "v-road-choice",
    route: "#/runs/demo-run/changes?file=src/utils/retry.ts&demo=play",
    async drive({ page, locale, t, shot }) {
      const tf = t.review.tryFirst;
      await playToReview(page, locale);
      await openPlayedFile(page, "src/utils/retry.ts", locale);
      const card = await roadChoice(page, locale);
      await expect(card.locator(".tf-reference")).not.toBeEmpty();
      await expect(card.getByRole("radio", { name: tf.road.choices.keep })).toBeChecked();
      await expect(card.getByRole("textbox", { name: tf.road.whyLabel })).toHaveValue(
        demo(locale).roadSamples!["src/utils/retry.ts"].why,
      );
      await shot("choice");
    },
  },
  {
    id: "v-line-ask",
    route: "#/runs/demo-run/changes?file=src/utils/retry.ts → lines 10-15 → Explain",
    async drive({ page, locale, t, shot }) {
      await playToReview(page, locale);
      await openPlayedFile(page, "src/utils/retry.ts", locale);
      const { bubble, answer } = await askAboutLines(page, locale);
      await expect(bubble.locator(".markdown-content > p").first()).toHaveText(
        t.review.selection.question({ path: "src/utils/retry.ts", count: 7 }),
      );
      await expect(answer.locator(".explain-message-body")).not.toBeEmpty();
      await shot("answer");
    },
  },
  {
    id: "v-check",
    route: "#/runs/demo-run/changes?panel=check&demo=play (every file ticked)",
    main: true,
    async drive({ page, locale, t, shot }) {
      const c = t.workspace.check;
      await playToReview(page, locale);
      await reviewAll(page, locale);
      await openCheck(page, locale);
      // One file question (retry.ts) for the sample's 97 changed lines, and what was not tested.
      await expect(page.locator(".understanding-check")).toContainText(c.plan({ questions: 1, lines: 97 }));
      await fillSummary(page, locale);
      await answerCheck(page, locale);
      const grade = checkStep(page, c.gradeTitle);
      await expect(grade).toContainText(demo(locale).files.find((file) => file.path === "src/utils/retry.ts")!.explanation!.selfCheck!.answer);
      await shot("reveal");
      const result = await gradeCheck(page, locale);
      await result.scrollIntoViewIfNeeded();
      await shot("result");
    },
  },
  {
    id: "v-forecast",
    route: "step 5 of the check panel",
    async drive({ page, locale, t, shot }) {
      const c = t.workspace.check;
      await playToReview(page, locale);
      await reviewAll(page, locale);
      await openCheck(page, locale);
      await fillSummary(page, locale);
      await answerCheck(page, locale);
      await gradeCheck(page, locale);
      const step = checkStep(page, c.forecastTitle);
      await expect(step.getByRole("radio")).toHaveCount(8);
      const result = await forecastCheck(page, locale);
      await expect(result).toContainText(demo(locale).understandingSample!.forecast.question);
      await result.scrollIntoViewIfNeeded();
      await shot("forecast");
    },
  },
  {
    id: "v-draft-your-words",
    route: "#/runs/demo-run/draft after the check",
    main: true,
    async drive({ page, locale, t, shot }) {
      const sample = demo(locale).understandingSample!;
      await playToReview(page, locale);
      await passPlayedCheck(page, locale);
      const card = await insertYourWords(page, locale);
      const body = page.getByRole("textbox", { name: t.workspace.draft.bodyLabel });
      await expect(body).toHaveValue(new RegExp(sample.summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      await expect(body).toHaveValue(new RegExp(sample.untested.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      await expect(page.locator(".reviewability-band").first()).toHaveText(
        t.draft.reviewability.band({ band: t.draft.reviewability.bands.small }),
      );
      for (const id of ["rules", "door", "issue", "pacing", "reviewability", "disclosure", "understanding"])
        await expect(page.locator(`.draft-checklist-row[data-row="${id}"]`)).toHaveClass(/is-ok/);
      await expect(page.locator('.draft-checklist-row[data-row="understanding"]')).toContainText(
        t.draft.guidance.checklist.understandingPassed,
      );
      await card.scrollIntoViewIfNeeded();
      await shot("your-words");
      await page.locator(".draft-checklist").scrollIntoViewIfNeeded();
      await shot("checklist");
    },
  },
  {
    id: "v-publish",
    route: "footer → Approve and prepare the PR",
    main: true,
    async drive({ page, locale, t, shot }) {
      await playToReview(page, locale);
      await passPlayedCheck(page, locale);
      await insertYourWords(page, locale);
      const dialog = await openPublish(page, locale);
      await expect(dialog).toContainText(t.workspace.publish.pacing({ open: 0, budget: 1, first: true }));
      await expect(dialog.getByRole("button", { name: t.workspace.publish.finishDemo })).toBeEnabled();
      await shot("dialog");
      const card = await finishPublish(page, dialog, locale);
      await expect(card).toContainText(demo(locale).publishedCard!.note);
      await shot("published");
    },
  },
  {
    id: "v-forecast-vs-reality",
    route: "#/runs/demo-run/draft after publish → Read feedback",
    async drive({ page, locale, t, shot }) {
      const f = t.draft.forecast;
      await playToReview(page, locale);
      await passPlayedCheck(page, locale);
      await insertYourWords(page, locale);
      await finishPublish(page, await openPublish(page, locale), locale);
      const compare = await readSampleFeedback(page, locale);
      await expect(compare.locator(".forecast-yours .forecast-chip")).toHaveText(f.dimensions.tests);
      await expect(compare.locator(".forecast-outcome")).toContainText(f.outcomes.changes);
      await expect(compare.locator(".forecast-locked")).toHaveCount(0);
      const first = compare.locator(".forecast-item").first();
      await expect(first.getByRole("button", { name: f.dimensions.tests, pressed: true })).toBeVisible();
      await expect(first.getByRole("button", { name: f.sawIt, pressed: true })).toBeVisible();
      await compare.scrollIntoViewIfNeeded();
      await shot("compare");
    },
  },
  {
    id: "v-practice",
    route: "#/learning?view=practice",
    async drive({ page, locale, t, shot }) {
      const p = t.learning.practice;
      await openSample(page, "#/learning", { flags: { view: "practice" }, locale });
      const deck = page.locator("section.practice-sample");
      const item = demo(locale).practiceSample![0];
      await expect(deck.getByRole("heading", { level: 3, name: item.question })).toBeVisible();
      await deck.getByLabel(p.answer).fill(locale === "en" ? "The wait doubles each time, up to the cap." : "每次等待加倍，直到上限。");
      await deck.getByRole("radio", { name: p.confidences.think }).check();
      await deck.getByRole("button", { name: p.show }).click();
      await deck.getByRole("button", { name: new RegExp(`^${p.grades.got}`) }).click();
      await expect(deck.locator(".practice-next")).toHaveText(p.nextReview({ days: 3 }));
      // Plain items, never a reward: no streaks, points or totals.
      await expect(page.locator("#main-content")).not.toContainText(/streak|points|badge earned/i);
      await shot("graded");
    },
  },
];

/** The check off, on its own server: it saves the setting. Docs and FAQ only, not in the video. */
const checkOff: PromoState = {
  id: "v-check-off",
  route: "#/settings/learning → turn the check off",
  writes: /^PUT \/api\/app-settings$/,
  async drive({ page, locale, t, shot }) {
    const s = t.settings.learning.check;
    await openSample(page, "#/settings/learning", { locale });
    await page.getByRole("checkbox", { name: s.label }).click();
    const dialog = page.getByRole("dialog", { name: s.confirmTitle });
    for (const sentence of [s.confirmLost, s.confirmKept, s.confirmRecorded, s.confirmBack])
      await expect(dialog).toContainText(sentence);
    await expect(dialog.getByRole("button", { name: s.keep })).toBeFocused();
    await shot("modal");
    await dialog.getByRole("button", { name: s.turnOff }).click();
    await expect(dialog).toHaveCount(0);
    await openSample(page, "#/runs/demo-run/overview", { locale });
    await expect(page.locator(".title-row .check-off-badge")).toContainText(t.workspace.checkOff.label);
    await shot("badge");
  },
};

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** The page as the capture would film it now, and its hash. */
async function frame(page: Page) {
  const png = await page.screenshot({ animations: "disabled", caret: "hide" });
  return { png, hash: sha256(png) };
}

/**
 * Films `state` once in a fresh browser on `server`: drives it, checks each
 * frame and returns the frames' hashes.
 */
async function film(browser: Browser, server: LaunchedServer, state: PromoState, locale: Locale, take: number) {
  const context = await browser.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
    viewport: captureViewport,
    deviceScaleFactor: captureScale,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  const outside: string[] = [];
  const gated: string[] = [];
  const writes: string[] = [];
  const origin = new URL(server.baseURL).origin;
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.fallback();
    outside.push(url.href);
    return route.abort();
  });
  const frames: { name: string; hash: string }[] = [];
  try {
    const page = await context.newPage();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== origin || !url.pathname.startsWith("/api/")) return;
      const call = `${request.method()} ${url.pathname}`;
      if (gatedRoutes.some((route) => route.test(call))) gated.push(call);
      if (request.method() !== "GET" && !state.writes?.test(call)) writes.push(call);
    });
    await pauseClock(page);
    const directory = path.join(outputRoot, locale);
    await mkdir(directory, { recursive: true });
    await state.drive({
      page,
      locale,
      t: messages[locale],
      async shot(name) {
        await parkPointer(page);
        await stillScrolls(page);
        await stillAnimations(page);
        await page.evaluate(() => document.fonts.ready);
        await expectNoOverflow(page);
        // The sample's workspace says it is sample data (the capture's badge check).
        if (/#\/runs\//.test(page.url()))
          await expect(page.locator(".presentation-sample-badge")).toHaveCount(1);
        if (locale === "en")
          // The language switcher names Traditional Chinese in its own script (an autonym).
          assertNoHan(
            (await page.content()).replace(/<option[^>]*\slang="zh[^"]*"[^>]*>[^<]*<\/option>/g, ""),
          );
        const { png, hash } = await frame(page);
        frames.push({ name, hash });
        const repeat = test.info().repeatEachIndex;
        await writeFile(
          path.join(directory, `${state.id}-${name}-${take}${repeat ? `-repeat${repeat}` : ""}.png`),
          png,
        );
      },
    });
  } finally {
    await context.close();
  }
  expect(outside, "requests that left the machine").toEqual([]);
  expect(gated, "requests to a Pro-gated route").toEqual([]);
  expect(writes, "writes the sample should not send").toEqual([]);
  return frames;
}

/** Films the state twice and requires the same frames; keeps the hashes for the report. */
async function filmTwice(browser: Browser, server: LaunchedServer, state: PromoState) {
  const first = await film(browser, server, state, "en", 1);
  const second = await film(browser, server, state, "en", 2);
  expect(second, `${state.id} films the same frames twice`).toEqual(first);
  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    path.join(outputRoot, `${state.id}.json`),
    `${JSON.stringify({ id: state.id, route: state.route, frames: first }, null, 2)}\n`,
  );
}

test.describe.configure({ mode: "parallel" });
// Chrome does not always rasterize the same page the same way twice: over
// a dialog's blurred backdrop, its shadow came out in one of a few
// versions (at most 4 of 255 levels apart) on screenshots taken one after
// another of a page that did not change. Software rendering on one raster
// thread draws it the same every time, so a changed hash is the app's.
test.use({
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
    args: ["--disable-gpu", "--num-raster-threads=1"],
  },
});

test.describe("the sample's promo states", () => {
  let server: LaunchedServer | undefined;
  test.beforeAll(async () => {
    server = await startReadyServer();
  });
  test.afterAll(async () => {
    await server?.stop();
  });

  for (const state of states)
    test(`${state.id} is filmable: deterministic, in English, and it fits at 1440x810`, async ({ browser }) => {
      test.setTimeout(180_000);
      await filmTwice(browser, server!, state);
    });

  for (const state of states.filter((entry) => entry.main))
    test(`${state.id} fits in zh-TW too`, async ({ browser }) => {
      test.setTimeout(120_000);
      await film(browser, server!, state, "zh-TW", 1);
    });
});

test("v-check-off is filmable: the modal and the run's badge", async ({ browser }) => {
  test.setTimeout(180_000);
  const server = await startReadyServer();
  try {
    const reset = async () => {
      const context = await browser.newContext({ baseURL: server.baseURL, storageState: server.storageState });
      try {
        const response = await context.request.put("/api/app-settings", { data: { skipUnderstandingCheck: false } });
        expect(response.ok()).toBe(true);
      } finally {
        await context.close();
      }
    };
    const first = await film(browser, server, checkOff, "en", 1);
    await reset();
    const second = await film(browser, server, checkOff, "en", 2);
    expect(second, "v-check-off films the same frames twice").toEqual(first);
    await writeFile(
      path.join(outputRoot, `${checkOff.id}.json`),
      `${JSON.stringify({ id: checkOff.id, route: checkOff.route, frames: first }, null, 2)}\n`,
    );
  } finally {
    await server.stop();
  }
});
