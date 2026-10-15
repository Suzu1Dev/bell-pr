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
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import type { Locale } from "../shared/i18n/locale";
import { getDemo } from "../src/demo";
import { assertNoHan } from "../src/test-utils/render";
import { expectNoOverflow } from "./helpers/overflow";
import { startReadyServer } from "./helpers/ready-server";
import {
  explanations,
  files,
  issueNode,
  issueUrl,
  otherPr,
  repoId,
  repoUrl,
  runId,
  startRealProject,
  welcomeFacts,
  type RealProject,
} from "./helpers/real-project";
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
/** The Draft PR the fake gh opens first. */
const prUrl = `${repoUrl}/pull/1`;
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

// The v1.1 journey across the workstreams, on a seeded real run with a
// fake gh (e2e/helpers/real-project.ts): what L2B reads from GitHub, shown
// in L2F's cards and chips and L2D's publish dialog, around L2C's try-first
// review, L2D's check and L2F's Draft cards, and the blocks at publish.
// Its steps share one server and run in order.
test.describe("the v1.1 journey on a seeded real run with a fake gh", () => {
  test.describe.configure({ mode: "serial" });
  let project: RealProject;
  test.beforeAll(async () => {
    project = await startRealProject();
  });
  test.afterAll(async () => {
    await project?.stop();
  });

  async function openPage(browser: Browser) {
    const context = await browser.newContext({
      baseURL: project.baseURL,
      storageState: project.storageState,
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      timezoneId: "UTC",
    });
    return { page: await context.newPage(), close: () => context.close() };
  }
  const en = messages.en;

  test("1. the rules card quotes the project's rules and says a collaborators-only door means practise only", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      await project.setFacts({ ...welcomeFacts, door: { pull_request_creation_policy: "collaborators_only", viewerPermission: "READ" } });
      await page.goto(`/#/repos/${repoId}?locale=en`);
      const card = page.locator(".rules-card");
      await expect(card.getByRole("heading", { name: en.mission.rules.title })).toBeVisible();
      await card.getByRole("button", { name: en.mission.rules.checkAgain }).click();
      await expect(card.locator(".rules-card-door")).toHaveText(en.mission.rules.door.collaborators);
      await expect(card.locator("figure")).toHaveCount(2);
      for (const quote of ["Open an issue before changing behavior.", "You must be able to explain your change in review."])
        await expect(card.locator("blockquote", { hasText: quote })).toHaveCount(1);
      await expectNoOverflow(page, [".rules-card"]);
      // Back to a door that is open, read again.
      await project.setFacts(welcomeFacts);
      await card.getByRole("button", { name: en.mission.rules.checkAgain }).click();
      await expect(card.locator(".rules-card-door")).toHaveText(en.mission.rules.door.open);
    } finally {
      await close();
    }
  });

  test("2. the task dialog reads the linked issue once and shows its facts as chips", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      await page.goto(`/#/repos/${repoId}?locale=en`);
      await page.getByRole("button", { name: en.repos.explore.chooseDirection }).click();
      const dialog = page.getByRole("dialog", { name: en.modals.newTask.title });
      await dialog.getByLabel(/Related issue link/).fill(issueUrl);
      const facts = dialog.locator(".before-start");
      await expect(facts.locator(".before-start-chip")).toHaveText([
        en.mission.start.open,
        en.mission.start.unassigned,
        en.mission.start.noOtherPr,
        /^A maintainer said: “PRs welcome for this one\.”/,
        en.mission.start.pacing({ open: 0, budget: 1 }),
      ]);
      await expect(facts.locator("a.before-start-issue")).toHaveAttribute("href", issueUrl);
      await expectNoOverflow(page, [".modal"]);
    } finally {
      await close();
    }
  });

  test("3. a try-first answer on the real run is saved and still there after a reload", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      const tf = en.review.tryFirst;
      await page.goto(`/#/runs/${runId}/changes?file=${files.greeting}&locale=en`);
      const card = page.locator(".explain-card-selfcheck");
      await expect(card).toContainText(explanations[files.greeting].selfCheck.question);
      await card.getByRole("textbox", { name: tf.quiz.answerLabel }).fill(
        "English, since a missing language falls back to the English greeting in the table.",
      );
      await card.getByRole("radio", { name: tf.confidences.think }).check();
      const saved = page.waitForResponse(
        (response) => response.url().endsWith(`/api/runs/${runId}/attempts`) && response.request().method() === "PATCH",
      );
      await card.getByRole("button", { name: tf.quiz.reveal }).click();
      expect((await saved).status()).toBe(200);
      const graded = page.waitForResponse(
        (response) => response.url().endsWith(`/api/runs/${runId}/attempts`) && response.request().method() === "PATCH",
      );
      await card.getByRole("button", { name: tf.grades.got }).click();
      expect((await graded).status()).toBe(200);
      await expect(card.locator(".tf-graded")).toHaveText(tf.quiz.graded.got);
      await page.reload();
      await expect(page.locator(".explain-card-selfcheck .tf-graded")).toHaveText(tf.quiz.graded.got);
      const { run } = (await (await page.request.get(`/api/runs/${runId}`)).json()) as {
        run: { attempts?: Record<string, { quiz?: { grade?: string; confidence?: string } }> };
      };
      expect(run.attempts?.[files.greeting]?.quiz).toMatchObject({ grade: "got", confidence: "think" });
    } finally {
      await close();
    }
  });

  test("4-5. the check credits the attempt, takes one Partly with its correction, and a forecast", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      const c = en.workspace.check;
      await page.goto(`/#/runs/${runId}/changes?locale=en`);
      for (const file of Object.values(files)) {
        await page.locator(`.file-item[title="${file}"]`).click();
        const reviewed = page.getByRole("checkbox", { name: en.review.diff.reviewed });
        // The server records each tick; the box follows its answer.
        await reviewed.click();
        await expect(reviewed).toBeChecked();
      }
      await page.getByRole("button", { name: en.workspace.footer.explainBack }).click();
      const panel = page.locator(".understanding-check");
      await expect(page.locator(".explain-panel")).toHaveCount(0);
      const answers = panel.getByRole("region", { name: c.answerTitle }).getByRole("listitem");
      // Two file questions for the changed lines, then what was not tested.
      await expect(answers).toHaveCount(3);
      const credited = answers.filter({ hasText: explanations[files.greeting].selfCheck.question });
      await expect(credited).toContainText(c.credited);
      await panel
        .getByRole("textbox", { name: c.explainPrompt })
        .fill(
          "People wanted greetings in their own language, so the greeting now comes from a table and falls back to English. A new helper lists names the way a sentence does. A wrong entry in the table would greet people wrongly.",
        );
      const format = answers.filter({ hasText: explanations[files.format].selfCheck.question });
      await format.getByRole("textbox").fill("It returns the name with a comma after it.");
      await format.getByRole("radio", { name: c.confidences.think }).check();
      const untested = answers.filter({ hasText: c.untestedQuestion });
      await untested.getByRole("textbox").fill("I did not test an empty name, because the old test only covered Ada.");
      await untested.getByRole("radio", { name: c.confidences.sure }).check();
      await panel.getByRole("button", { name: c.lock }).click();
      const grade = panel.getByRole("region", { name: c.gradeTitle });
      await grade
        .getByRole("listitem")
        .filter({ hasText: explanations[files.format].selfCheck.question })
        .getByRole("radio", { name: c.grades.partly })
        .check();
      await panel
        .getByRole("region", { name: c.correctTitle })
        .getByRole("textbox")
        .fill("A single name comes back alone, without a separator.");
      await panel.getByRole("button", { name: c.saveGrades }).click();
      const forecast = panel.getByRole("region", { name: c.forecastTitle });
      await forecast.getByRole("radio", { name: c.dimensions.tests }).check();
      await forecast.getByRole("textbox").fill("They will ask whether the empty name is tested.");
      await forecast.getByRole("button", { name: c.saveForecast }).click();
      const result = panel.getByRole("region", { name: c.resultTitle });
      await expect(result).toContainText(c.result({ questions: 3, misses: 1 }));
      await expect(result).toContainText(c.forecast({ dimension: c.dimensions.tests }));
      await expect(result).toContainText(c.credited);
      await expect(page.locator(".review-footer")).toContainText(en.workspace.footer.passed);
      const { run } = (await (await page.request.get(`/api/runs/${runId}`)).json()) as {
        run: { understanding?: { passedAt?: string; items?: { id: string; source: string; grade?: string }[] } };
      };
      expect(run.understanding?.passedAt).toBeTruthy();
      expect(run.understanding?.items?.map((item) => [item.id, item.source])).toEqual([
        [`attempt:${files.greeting}`, "attempt"],
        [`selfCheck:${files.format}`, "selfCheck"],
        ["untested", "untested"],
      ]);
    } finally {
      await close();
    }
  });

  test("6-7. the Draft tab takes my explanation and a reason for the weakened test", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      await page.goto(`/#/runs/${runId}/draft?locale=en`);
      const words = page.locator(".your-words");
      await words.getByRole("button", { name: en.draft.yourWords.useExplanation }).click();
      const body = page.getByRole("textbox", { name: en.workspace.draft.bodyLabel });
      await expect(body).toHaveValue(/^## Summary\n\nPeople wanted greetings in their own language/);
      const draftSaved = page.waitForResponse(
        (response) => response.url().endsWith(`/api/runs/${runId}/draft`) && response.request().method() === "PATCH",
      );
      await page.getByRole("button", { name: en.workspace.draft.save }).click();
      expect((await draftSaved).status()).toBe(200);
      const weakened = page.locator(".reviewability-weakened");
      await expect(weakened.locator(".reviewability-weakened-text")).toHaveText('expect(greeting("Ada")).toBe("Hello, Ada!");');
      await weakened
        .getByRole("textbox", { name: en.draft.reviewability.reason })
        .fill("The greeting text now depends on the language table, so the test checks a greeting comes back.");
      const reasons = page.waitForResponse(
        (response) => response.url().endsWith(`/api/runs/${runId}/test-reasons`) && response.request().method() === "PUT",
      );
      await weakened.getByRole("button", { name: en.draft.reviewability.save }).click();
      expect((await reasons).status()).toBe(200);
      await expect(page.locator(".reviewability-saved")).toBeVisible();
      await expectNoOverflow(page, ["#workspace-panel"]);
    } finally {
      await close();
    }
  });

  /** The approved fingerprint and status, as the server holds them. */
  async function storedRun(page: Page) {
    const { run } = (await (await page.request.get(`/api/runs/${runId}`)).json()) as {
      run: {
        status: string;
        approvedFingerprint?: string;
        prUrl?: string;
        guardOverrides?: { id: string; reason: string }[];
        feedbackTags?: Record<string, { dimension?: string; predicted?: boolean }>;
        followUps?: { restatements?: { url: string; text: string }[] }[];
      };
    };
    return run;
  }

  /** Approves from the footer; the publish dialog opens and reads the facts. */
  async function openPublishDialog(page: Page) {
    const t = en.workspace.publish;
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    // The footer approves only once the server's check has said it passed.
    const footer = page.locator(".review-footer");
    await expect(footer).toContainText(en.workspace.footer.passed);
    const factsRead = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/runs/${runId}/contribution-facts/refresh`,
    );
    const approved = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/runs/${runId}/approve`);
    await footer.getByRole("button", { name: en.workspace.footer.approvePr }).click();
    expect((await approved).status()).toBe(200);
    const dialog = page.getByRole("dialog", { name: t.title });
    await expect(dialog).toBeVisible();
    expect((await factsRead).status()).toBe(200);
    await expect(dialog.getByText(t.factsLoading)).toHaveCount(0);
    await expect(dialog.locator(".publish-checks fieldset, .publish-checks .is-clear").first()).toBeVisible();
    return dialog;
  }

  const submitOf = (dialog: Locator) => dialog.getByRole("button", { name: en.workspace.publish.submit });

  test("8. publishing waits for a typed reason while someone else's pull request would close the issue", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      await project.setFacts({ ...welcomeFacts, issues: { 7: issueNode(otherPr) } });
      const dialog = await openPublishDialog(page);
      const block = dialog.locator(".publish-block");
      await expect(block).toHaveCount(1);
      await expect(dialog.getByRole("group", { name: en.workspace.publish.groups.issue })).toBeVisible();
      const reason = block.getByRole("textbox", { name: /Why publish anyway/ });
      await expect(submitOf(dialog)).toBeDisabled();
      // The server refuses it too, without the reason.
      const { approvedFingerprint } = await storedRun(page);
      const refused = await page.request.post(`/api/runs/${runId}/publish`, {
        data: { fingerprint: approvedFingerprint, acknowledged: [] },
      });
      expect(refused.status()).toBeGreaterThanOrEqual(400);
      expect((await storedRun(page)).status).toBe("approved");
      await reason.fill("Their pull request has been idle for two months; its author asked me to take over.");
      for (const box of await dialog.getByRole("checkbox").all()) await box.check();
      await expect(submitOf(dialog)).toBeEnabled();
      await expectNoOverflow(page, [".modal"]);
      await dialog.getByRole("button", { name: en.workspace.publish.back }).click();
    } finally {
      await close();
    }
  });

  test("9. publishing stops for a collaborators-only door, with no way to override it", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      await project.setFacts({
        ...welcomeFacts,
        door: { pull_request_creation_policy: "collaborators_only", viewerPermission: "READ" },
      });
      const dialog = await openPublishDialog(page);
      const block = dialog.locator(".publish-block");
      await expect(block).toHaveCount(1);
      await expect(dialog.getByRole("group", { name: en.workspace.publish.groups.rules })).toContainText(
        en.workspace.publish.blocked({ message: "" }).trim(),
      );
      await expect(block.getByRole("textbox")).toHaveCount(0);
      for (const box of await dialog.getByRole("checkbox").all()) await box.check();
      await expect(submitOf(dialog)).toBeDisabled();
      // Only someone else's pull request on the issue can be overridden.
      const { approvedFingerprint } = await storedRun(page);
      const refused = await page.request.post(`/api/runs/${runId}/publish`, {
        data: {
          fingerprint: approvedFingerprint,
          acknowledged: [],
          overrides: [{ id: "pr-closed", reason: "I am sure the maintainers want this change anyway." }],
        },
      });
      expect(refused.status()).toBe(400);
      expect((await storedRun(page)).status).toBe("approved");
    } finally {
      await close();
    }
  });

  test("10. publishing stops at twice the pace budget", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      await project.setFacts({ ...welcomeFacts, pacing: { open: 2, merged: 0 } });
      const dialog = await openPublishDialog(page);
      const pace = dialog.getByRole("group", { name: en.workspace.publish.groups.pacing });
      await expect(pace.locator(".publish-block")).toHaveCount(1);
      await expect(dialog).toContainText(en.workspace.publish.pacing({ open: 2, budget: 1, first: true }));
      for (const box of await dialog.getByRole("checkbox").all()) await box.check();
      await expect(submitOf(dialog)).toBeDisabled();
    } finally {
      await close();
    }
  });

  test("11. a failing gh is \"Couldn't check\" in the publish dialog, on the rules card and in the task dialog, never a pass", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      const failing = { door: "exit", doorGraph: "exit", issue: "exit", pacing: "exit", viewer: "exit" } as const;
      await project.setFacts({ ...welcomeFacts, fail: failing });
      const dialog = await openPublishDialog(page);
      const unknown = dialog.getByRole("group", { name: en.workspace.publish.groups.unknown });
      await expect(unknown).toBeVisible();
      await expect(unknown.getByRole("checkbox")).toHaveCount(1);
      await expect(dialog).not.toContainText(en.workspace.publish.allClear);
      await expect(submitOf(dialog)).toBeDisabled();
      // The stored preflight agrees: facts-unknown, a confirm.
      const { checks } = (await (await page.request.get(`/api/runs/${runId}/preflight`)).json()) as {
        checks: { id: string; kind: string }[];
      };
      expect(checks.map((check) => `${check.id}:${check.kind}`)).toContain("facts-unknown:confirm");
      await dialog.getByRole("button", { name: en.workspace.publish.back }).click();

      await page.goto(`/#/repos/${repoId}?locale=en`);
      const card = page.locator(".rules-card");
      await card.getByRole("button", { name: en.mission.rules.checkAgain }).click();
      await expect(card.locator(".rules-card-state.is-unknown, .rules-card-door.is-unknown").first()).toContainText("Couldn't check");
      await expect(card).not.toContainText(en.mission.rules.door.open);

      await page.getByRole("button", { name: en.repos.explore.chooseDirection }).click();
      const task = page.getByRole("dialog", { name: en.modals.newTask.title });
      await task.getByLabel(/Related issue link/).fill(issueUrl);
      const chips = task.locator(".before-start-chip.is-unknown");
      await expect(chips.first()).toBeVisible();
      await expect(chips.filter({ hasText: en.mission.start.unknown({ part: "issue" }) })).toHaveCount(1);
      await expect(task.locator(".before-start-chip.is-ok")).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test("12. the task dialog shows a closed issue and another person's closing pull request, and Start still creates the run", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      const m = en.mission;
      await project.setFacts({
        ...welcomeFacts,
        issues: { 7: issueNode({ state: "CLOSED", stateReason: "COMPLETED", ...otherPr }) },
      });
      await page.goto(`/#/repos/${repoId}?locale=en`);
      await page.getByRole("button", { name: en.repos.explore.chooseDirection }).click();
      const dialog = page.getByRole("dialog", { name: en.modals.newTask.title });
      await dialog.getByLabel(/Related issue link/).fill(issueUrl);
      const chips = dialog.locator(".before-start-chip");
      await expect(chips.filter({ hasText: m.start.closed({ reason: "completed" }) })).toHaveCount(1);
      await expect(chips.filter({ hasText: m.start.otherPr({ author: "other_dev", number: 9 }) })).toHaveCount(1);
      await dialog.locator("#task-prompt").fill("Greet people in their own language.");
      const start = dialog.getByRole("button", { name: new RegExp(`^(?:${en.modals.newTask.planFirst}|${en.modals.newTask.start})$`) });
      await start.click();
      const confirm = dialog.locator(".start-confirm");
      await expect(confirm.locator("li")).toHaveText([
        m.startConfirm.practise["issue-closed"],
        m.startConfirm.otherPr({ author: "other_dev", number: 9 }),
      ]);
      const created = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/runs" && response.request().method() === "POST",
      );
      await confirm.getByRole("button", { name: m.startConfirm.practiseLocally }).click();
      const response = await created;
      expect(response.ok(), await response.text()).toBe(true);
      const { run } = (await response.json()) as { run: { id: string } };
      const { runs } = (await (await page.request.get("/api/runs")).json()) as { runs: { id: string }[] };
      expect(runs.map((entry) => entry.id)).toContain(run.id);
    } finally {
      await close();
    }
  });

  test("13. the preflight reads no GitHub fact; publishing reads them live and opens the Draft PR with my reason kept", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      const reason = "Their pull request has been idle for two months; its author asked me to take over.";
      await project.setFacts({ ...welcomeFacts, issues: { 7: issueNode(otherPr) } });
      const dialog = await openPublishDialog(page);
      await dialog.locator(".publish-block").getByRole("textbox").fill(reason);
      // The preflight answers from the stored facts: no gh call.
      const before = await project.ghCalls();
      const preflight = await page.request.get(`/api/runs/${runId}/preflight`);
      expect(preflight.status()).toBe(200);
      expect(await project.ghCalls()).toEqual(before);
      for (const box of await dialog.getByRole("checkbox").all()) await box.check();
      const published = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/api/runs/${runId}/publish`,
      );
      await submitOf(dialog).click();
      expect((await published).status()).toBe(200);
      await expect(dialog).toHaveCount(0);
      // Publishing read the issue and the pace again, live.
      const live = (await project.ghCalls()).slice(before.length).map((call) => call.join(" "));
      expect(live.some((call) => call.includes("BellIssueCheck"))).toBe(true);
      expect(live.some((call) => call.includes("BellPacing"))).toBe(true);
      expect(live.some((call) => call.startsWith("gh pr create"))).toBe(true);
      const run = await storedRun(page);
      expect(run.status).toBe("published");
      expect(run.prUrl).toBe(prUrl);
      // The lifted block is recorded with the person's reason.
      expect(run.guardOverrides?.map((override) => [override.id, override.reason])).toEqual([["issue-has-pr", reason]]);
      // The branch reached the stand-in GitHub.
      expect(await project.github.head("fix/greet-languages")).toMatch(/^[0-9a-f]{40}$/);
      await expect(page.locator(".workspace-heading .status-badge")).toHaveText(en.common.runStatus.published);
    } finally {
      await close();
    }
  });

  const review = {
    author: { login: "maintainer" },
    authorAssociation: "MEMBER",
    body: "Thanks for this. Please add a test for an empty name before we merge.",
    state: "CHANGES_REQUESTED",
    url: `${prUrl}#pullrequestreview-11`,
    createdAt: "2026-10-15T08:00:00Z",
  };
  const comment = {
    author: { login: "maintainer" },
    authorAssociation: "MEMBER",
    body: "Could listNames use Intl.ListFormat instead of its own joining?",
    url: `${prUrl}#discussion_r12`,
    createdAt: "2026-10-15T08:01:00Z",
  };
  /** The pull request's feedback as GitHub's GraphQL answers BellPrFeedback. */
  const feedback = {
    data: {
      repository: {
        pullRequest: {
          url: prUrl,
          state: "OPEN",
          merged: false,
          reviewDecision: "CHANGES_REQUESTED",
          labels: { totalCount: 0, nodes: [] },
          reviews: { totalCount: 1, nodes: [review] },
          comments: { totalCount: 0, nodes: [] },
          reviewThreads: {
            totalCount: 1,
            nodes: [{ isResolved: false, path: files.format, line: 6, comments: { totalCount: 1, nodes: [comment] } }],
          },
          commits: { nodes: [] },
        },
      },
    },
  };
  const feedbackItem = (page: Page, body: string) =>
    page.locator("section.forecast .forecast-item").filter({ hasText: body });

  test("14. reading the maintainers' feedback is Free and sits beside my forecast", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      const f = en.draft.forecast;
      await project.setPrFeedback(feedback);
      await page.goto(`/#/runs/${runId}/draft?locale=en`);
      const read = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/runs/${runId}/pr/feedback`);
      await page.getByRole("button", { name: new RegExp(`^${en.workspace.feedback.fetch}`) }).click();
      expect((await read).status()).toBe(200);
      const compare = page.locator("section.forecast");
      await expect(compare.locator(".forecast-yours .forecast-chip")).toHaveText(f.dimensions.tests);
      await expect(compare.locator(".forecast-outcome")).toContainText(f.outcomes.changes);
      await expect(compare.locator(".forecast-locked")).toHaveCount(0);
      await expect(feedbackItem(page, review.body)).toHaveCount(1);
      await expect(feedbackItem(page, comment.body)).toHaveCount(1);
      await expectNoOverflow(page, ["section.forecast"]);
    } finally {
      await close();
    }
  });

  test("15. tags on the feedback are saved on the run, and pressing a chip again clears it", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      const f = en.draft.forecast;
      const tagged = () =>
        page.waitForResponse(
          (response) => new URL(response.url()).pathname === `/api/runs/${runId}/feedback-tags` && response.request().method() === "PATCH",
        );
      await page.goto(`/#/runs/${runId}/draft?locale=en`);
      const item = feedbackItem(page, review.body);
      let saved = tagged();
      await item.getByRole("button", { name: f.dimensions.tests, exact: true }).click();
      expect((await saved).status()).toBe(200);
      saved = tagged();
      await item.getByRole("button", { name: f.sawIt }).click();
      expect((await saved).status()).toBe(200);
      await page.reload();
      await expect(item.getByRole("button", { name: f.dimensions.tests, exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(item.getByRole("button", { name: f.sawIt })).toHaveAttribute("aria-pressed", "true");
      // Un-pressing the dimension clears it on the server; the other tag stays.
      saved = tagged();
      await item.getByRole("button", { name: f.dimensions.tests, exact: true }).click();
      expect((await saved).status()).toBe(200);
      await page.reload();
      await expect(item.getByRole("button", { name: f.dimensions.tests, exact: true })).toHaveAttribute("aria-pressed", "false");
      const tags = (await storedRun(page)).feedbackTags ?? {};
      expect(tags[review.url]?.dimension).toBeUndefined();
      expect(tags[review.url]?.predicted).toBe(true);
    } finally {
      await close();
    }
  });

  test("16. an AI follow-up round needs my restatement of each comment: 422 without it, then it starts (trial)", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      const w = en.workspace;
      expect((await page.request.post("/api/license/trial", { data: {} })).status()).toBe(200);
      // The server refuses a restatement under 3 words with 422.
      const short = await page.request.post(`/api/runs/${runId}/follow-ups`, {
        data: { feedbackUrls: [review.url], restatements: [{ url: review.url, text: "add test" }] },
      });
      expect(short.status()).toBe(422);
      const missing = await page.request.post(`/api/runs/${runId}/follow-ups`, {
        data: { feedbackUrls: [review.url], restatements: [] },
      });
      expect(missing.status()).toBe(422);
      expect((await storedRun(page)).followUps ?? []).toEqual([]);

      await page.goto(`/#/runs/${runId}/draft?locale=en`);
      await page.getByRole("checkbox", { name: w.feedback.include({ author: "maintainer" }) }).check();
      const restatement = page.getByRole("textbox", { name: w.followUp.restatement({ author: "maintainer" }) });
      const start = page.getByRole("button", { name: w.followUp.startSelected({ count: 1 }) });
      // The form mirrors the rule: two words do not start a round.
      await restatement.fill("add test");
      await expect(start).toBeDisabled();
      const text = "They want a test that greets an empty name.";
      await restatement.fill(text);
      const started = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/api/runs/${runId}/follow-ups` && response.request().method() === "POST",
      );
      await start.click();
      expect((await started).status()).toBe(200);
      const rounds = (await storedRun(page)).followUps ?? [];
      expect(rounds.at(-1)?.restatements).toEqual([{ url: review.url, text }]);
      // The stand-in agent changes nothing, so the round ends and the PR stays as it was.
      await expect.poll(async () => (await storedRun(page)).status, { timeout: 60_000 }).toBe("published");
    } finally {
      await close();
    }
  });

  test("17. the coach debrief is written by the agent on the trial and stored on the project", async ({ browser }) => {
    const { page, close } = await openPage(browser);
    try {
      const d = en.learning.debrief;
      const quote = "A single name comes back alone, without a separator.";
      const nextStep = "Before your next pull request here, write the test for an empty name first.";
      await project.setAgentAnswer(
        JSON.stringify({
          recurring: { dimension: "tests", quotes: [quote] },
          drills: [
            {
              context: "How listNames treats a list of one.",
              optionA: "Join every list with the separator.",
              optionB: "Return a single name alone.",
              question: "Which fits this project, and why?",
              reveal: "B reads as a sentence; A adds a stray comma for one name.",
            },
          ],
          nextStep,
        }),
      );
      await page.goto("/#/learning?view=debrief&locale=en");
      const view = page.locator("section.debrief");
      await expect(view.getByLabel(d.project)).toHaveValue(repoId);
      const written = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/learning/debrief" && response.request().method() === "POST",
      );
      await view.getByRole("button", { name: d.request, exact: true }).click();
      const response = await written;
      expect(response.status(), await response.text()).toBe(200);
      const card = view.locator(".debrief-list .debrief-card");
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(nextStep);
      await expect(card.locator("blockquote")).toHaveText(quote);
      const stored = (await (await page.request.get(`/api/learning/debriefs?repoId=${repoId}`)).json()) as {
        debriefs: { nextStep: string }[];
      };
      expect(stored.debriefs.map((entry) => entry.nextStep)).toEqual([nextStep]);
    } finally {
      await close();
    }
  });
});

// The off-switch on a real run: approval needs the ticks only and marks
// the run for good; once the check is back on, publishing waits for it.
test("with the check off a real run is approved and marked; turned back on, publishing asks for the check", async ({ browser }) => {
  test.setTimeout(120_000);
  const en = messages.en;
  const project = await startRealProject({ appSettings: { skipUnderstandingCheck: true } });
  const context = await browser.newContext({
    baseURL: project.baseURL,
    storageState: project.storageState,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
  });
  try {
    const page = await context.newPage();
    await page.goto(`/#/runs/${runId}/changes?locale=en`);
    for (const file of Object.values(files)) {
      await page.locator(`.file-item[title="${file}"]`).click();
      const reviewed = page.getByRole("checkbox", { name: en.review.diff.reviewed });
      await reviewed.click();
      await expect(reviewed).toBeChecked();
    }
    // The loosened assertion needs its reason, check or no check.
    const reasons = await page.request.put(`/api/runs/${runId}/test-reasons`, {
      data: { reasons: { [`${files.test}#-5`]: "The greeting text now depends on the language table." } },
    });
    expect(reasons.status()).toBe(200);
    const footer = page.locator(".review-footer");
    await expect(footer).toContainText(en.workspace.footer.checkOff);
    const approved = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/runs/${runId}/approve`);
    await footer.getByRole("button", { name: en.workspace.footer.approvePr }).click();
    const approval = await approved;
    expect(approval.status(), await approval.text()).toBe(200);
    const dialog = page.getByRole("dialog", { name: en.workspace.publish.title });
    await expect(dialog).toContainText(en.workspace.publish.checkOff);
    await dialog.getByRole("button", { name: en.workspace.publish.back }).click();
    const badge = page.locator(".title-row .check-off-badge");
    await expect(badge).toContainText(en.workspace.checkOff.label);
    const run = async () =>
      ((await (await page.request.get(`/api/runs/${runId}`)).json()) as {
        run: { status: string; understandingCheckOff?: boolean; approvedFingerprint?: string };
      }).run;
    expect(await run()).toMatchObject({ status: "approved", understandingCheckOff: true });

    // Back on, without a confirmation.
    await page.goto("/#/settings/learning?locale=en");
    const toggle = page.getByRole("checkbox", { name: en.settings.learning.check.label });
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The run keeps its mark, and publishing now waits for the check.
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    await expect(badge).toContainText(en.workspace.checkOff.label);
    await expect(page.locator("#check-off-help")).toHaveText(en.workspace.checkOff.tooltip);
    await expect(footer.getByRole("button", { name: en.workspace.footer.explainBack })).toBeVisible();
    const refused = await page.request.post(`/api/runs/${runId}/publish`, {
      data: { fingerprint: (await run()).approvedFingerprint, acknowledged: [] },
    });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { code?: string }).code).toBe("understanding_check_required");
    await footer.getByRole("button", { name: en.workspace.footer.explainBack }).click();
    await expect(page.locator(".understanding-check").getByRole("heading", { name: en.workspace.check.title })).toBeVisible();
    expect((await run()).understandingCheckOff).toBe(true);
  } finally {
    await context.close();
    await project.stop();
  }
});
