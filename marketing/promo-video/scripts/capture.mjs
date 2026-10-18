#!/usr/bin/env node
/**
 * Captures the promo footage from the real product: the sample project in
 * presentation mode, filmed state by state (plan direction-v1.1/VIDEO.md §4)
 * by Playwright and Chrome at device scale 4.
 *
 *   npm run capture                          every state (builds the product first)
 *   npm run capture -- --skip-build          reuse the existing build
 *   npm run capture -- --only=v-check,v-publish
 *   npm run capture -- --scale=1             a quick low-resolution pass
 *
 * Steps:
 * 1. Checks the licensed music copy in public/<audioFile of
 *    music/track.analysis.json> (MD5); copies it from PROMO_MUSIC_FILE first
 *    when it is missing.
 * 2. Builds the product (the repository's `npm run build`).
 * 3. Starts `bell-pr start --no-open --port 4651` with a temporary HOME and
 *    data dir and stand-in codex, claude and gh (scripts/lib/bell-server.mjs),
 *    signs in, and marks onboarding done and the EULA accepted through
 *    PUT /api/app-settings, so neither Welcome nor the EULA prompt shows.
 * 4. Films every state below in a fresh browser context: the page clock is
 *    installed and paused before the page loads (2026-10-14 10:24 UTC, from
 *    src/timeline.json), the state is reached with the drivers of
 *    e2e/helpers/sample-states.ts (the same steps e2e/promo-states.spec.ts
 *    checks), and the filmed part is a PNG still or a frame-stepped clip
 *    (JPEG quality 100, the page clock moving 1/30 s per frame). Footage goes
 *    to public/footage/<state>/ (gitignored) with frames.json and
 *    targets.json (element boxes, pointer moves and clicks, named marks).
 * 5. Fails on any privacy finding at any named state (scripts/lib/privacy.mjs,
 *    no exemption) and when a state does not show the "Sample project"
 *    badge.
 * 6. Stops the server and removes the temporary directories, whatever
 *    happened.
 *
 * The capture log goes to out/capture.log. It holds no path, token or
 * matched text, so it can be quoted in a commit message.
 *
 * The browser is the local Chrome named by PLAYWRIGHT_CHROMIUM_EXECUTABLE,
 * launched with a forced device scale factor and a 1440x810 window (no
 * viewport emulation), with GPU off and one raster thread so the same page
 * gives the same pixels on every run.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { tsImport } from "tsx/esm/api";
import { startBellServer } from "./lib/bell-server.mjs";
import { ShotRecorder, privacyGuard, privacyGuardArgs, sleep } from "./lib/recording.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(packageRoot, "..", "..");
const footageRoot = path.join(packageRoot, "public", "footage");
const logFile = path.join(packageRoot, "out", "capture.log");

const analysis = JSON.parse(await readFile(path.join(packageRoot, "music", "track.analysis.json"), "utf8"));
const music = { file: path.join(packageRoot, "public", analysis.audioFile), md5: analysis.md5 };

const timeline = JSON.parse(await readFile(path.join(packageRoot, "src", "timeline.json"), "utf8"));

const logLines = [];
function log(line) {
  logLines.push(line);
  console.log(line);
}

const md5 = async (file) => createHash("md5").update(await readFile(file)).digest("hex");

/** The music copy must exist and be the owner's licensed file. */
async function ensureMusic() {
  const name = `public/${analysis.audioFile}`;
  if (!existsSync(music.file)) {
    const source = process.env.PROMO_MUSIC_FILE;
    if (!source)
      throw new Error(`The music is missing: put the licensed file at ${name} or set PROMO_MUSIC_FILE (see MUSIC-LICENSE.md).`);
    if (!existsSync(source)) throw new Error("PROMO_MUSIC_FILE names no file.");
    if ((await md5(source)) !== music.md5) throw new Error("PROMO_MUSIC_FILE is not the licensed track (MD5 differs).");
    await mkdir(path.dirname(music.file), { recursive: true });
    await copyFile(source, music.file);
  }
  if ((await md5(music.file)) !== music.md5) throw new Error(`${name} is not the licensed track (MD5 differs).`);
  log(`music: ${name}, MD5 ${music.md5} (ok)`);
}

/** The product's brand SVGs, for the logo moments and the end card. */
async function copyBrandAssets() {
  const target = path.join(packageRoot, "public", "brand-assets");
  await rm(target, { recursive: true, force: true });
  await cp(path.join(repoRoot, "public", "brand"), target, {
    recursive: true,
    filter: (source) => !/\.png$/i.test(source),
  });
}

/** The window must give a 1440x810 CSS viewport at the capture's scale. */
async function fitWindow(page, viewport) {
  const measure = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio }));
  let size = await measure();
  if (size.width !== viewport.width || size.height !== viewport.height) {
    // A full Chrome window has browser UI around the page; grow it by that much.
    const cdp = await page.context().newCDPSession(page);
    const { windowId, bounds } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: {
        width: bounds.width + viewport.width - size.width,
        height: bounds.height + viewport.height - size.height,
      },
    });
    await cdp.detach();
    await sleep(300);
    size = await measure();
  }
  if (size.width !== viewport.width || size.height !== viewport.height || size.scale !== viewport.deviceScaleFactor)
    throw new Error(
      `The browser page is ${size.width}x${size.height} at ${size.scale}x, not ${viewport.width}x${viewport.height} at ${viewport.deviceScaleFactor}x.`,
    );
}

// The drivers e2e/promo-states.spec.ts checks every state with, and the
// product's own English copy, so the capture follows UI and copy changes.
const S = await tsImport("../../../e2e/helpers/sample-states.ts", import.meta.url);
const { getDemo } = await tsImport("../../../src/demo/index.ts", import.meta.url);
const { eulaVersion } = await tsImport("../../../shared/product.ts", import.meta.url);
const t = S.messages.en;
const demo = getDemo("en");

// Shared steps -----------------------------------------------------------------

/** Scrolls the window at once so `locator` starts `offset` CSS pixels from the top. */
async function placeInWindow(page, locator, offset) {
  const top = await locator.evaluate(
    (element, gap) => Math.max(0, element.getBoundingClientRect().top + window.scrollY - gap),
    offset,
  );
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), top);
  await sleep(150);
}

/** The nearest scrollable ancestor of `locator`, as an element handle. */
function scrollerOf(locator) {
  return locator.evaluateHandle((element) => {
    let box = element.parentElement;
    while (box && !(box.scrollHeight > box.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(box).overflowY)))
      box = box.parentElement;
    return box ?? document.scrollingElement;
  });
}

/** The scrollTop of the scroller around `locator` that puts it `offset` pixels below the scroller's top. */
async function scrollerTarget(locator, offset = 0) {
  const scroller = await scrollerOf(locator);
  const top = await locator.evaluate(
    (element, [box, gap]) =>
      Math.max(0, Math.min(
        box.scrollHeight - box.clientHeight,
        box.scrollTop + element.getBoundingClientRect().top - box.getBoundingClientRect().top - gap,
      )),
    [scroller, offset],
  );
  return { scroller, top };
}

/** Scrolls the box around `locator` at once (no frames) to put it `offset` pixels below the box's top. */
async function placeInScroller(locator, offset = 0) {
  const { scroller, top } = await scrollerTarget(locator, offset);
  await scroller.evaluate((element, y) => (element.scrollTop = y), top);
  await sleep(150);
}

/** Tweens the box around `locator` over the next frames to put it `offset` pixels below the box's top. */
async function glideInScroller(rec, locator, offset = 0, duration = 0.8) {
  const { scroller, top } = await scrollerTarget(locator, offset);
  await rec.scrollTo(top, { scroller, duration });
  await rec.hold(duration + 1 / 30);
}

/** Tweens the window to put `locator` `offset` pixels below the window's top. */
async function glideInWindow(rec, page, locator, offset = 0, duration = 0.8) {
  const top = await locator.evaluate(
    (element, gap) => Math.max(0, element.getBoundingClientRect().top + window.scrollY - gap),
    offset,
  );
  await rec.scrollTo(top, { duration });
  await rec.hold(duration + 1 / 30);
}

/** Clicks a demo-only "Fill with the sample answer" button without the pointer (no hover, no drawn click). */
const fill = (locator) => locator.dispatchEvent("click");

/** Steps frames until a field holds `text` (a typewriter at 30 ms a character). */
async function typedOut(rec, field, text, seconds = 12) {
  await rec.until(async () => (await field.inputValue()) === text, seconds);
}

const fileItem = (page, file) => page.locator(`.file-item[title="${file}"]`);
const checkPanel = (page) => page.locator(".understanding-check");

// The states -------------------------------------------------------------------
//
// Each films one state id of VIDEO.md §4. `rec.mark(name)` names the moments
// the composition cuts on (src/timeline.json refers to them by name).

const states = {
  /** S3: the "Before you contribute" card, quoted rules and the open door. */
  async "v-rules-card"({ page, rec }) {
    await S.openSample(page, "#/runs/demo-run/overview");
    const card = page.locator(".rules-card");
    await S.parkPointer(page);
    await rec.target("card", card);
    await rec.still("overview");
    // The card whole and centred, for the push.
    const height = (await card.boundingBox()).height;
    await placeInWindow(page, card, Math.max(16, Math.round((810 - height) / 2)));
    await rec.target("card", card);
    await rec.target("door", card.locator(".rules-card-door"));
    for (const [index, figure] of (await card.locator("figure").all()).entries())
      await rec.target(`rule-${index + 1}`, figure);
    await rec.still("card");
  },

  /** S4: the task dialog's "Before you start" facts. */
  async "v-before-you-start"({ page, rec }) {
    await S.openSample(page, "#/runs/demo-run/overview");
    const choose = page.getByRole("button", { name: t.mission.ideas.choose }).first();
    await placeInWindow(page, choose, 520);
    await rec.park(1000, 600);
    await rec.startFrames();
    await rec.check("directions");
    await rec.hold(0.3);
    await rec.moveTo("choose", choose, { duration: 0.5 });
    await rec.click("choose");
    const dialog = page.getByRole("dialog", { name: t.modals.newTask.title });
    await rec.until(() => dialog.isVisible(), 3);
    await rec.hold(0.6);
    rec.mark("dialog");
    const facts = dialog.locator(".before-start");
    await glideInScroller(rec, facts, 120, 1.0);
    rec.hideCursor();
    rec.mark("facts");
    await rec.target("facts", facts);
    await rec.target("chips", facts.locator(".before-start-chips"));
    await rec.check("before you start");
    await rec.hold(2.0);
    await rec.stopFrames();
  },

  /** S4: the Lead's plan waits for approval. */
  async "v-plan"({ page, rec }) {
    await S.playToPlan(page);
    const plan = page.locator(".team-plan.needs-approval");
    await S.parkPointer(page);
    await rec.target("plan", plan);
    await rec.still("top");
    await placeInWindow(page, plan, 150);
    await rec.target("plan", plan);
    await rec.target("approve", page.getByRole("button", { name: t.team.approval.approve }));
    await rec.still("plan");
  },

  /** S5: the plan is approved; tasks move across the board and the team talks. */
  async "v-board"({ page, rec }) {
    await S.playToPlan(page);
    const plan = page.locator(".team-plan.needs-approval");
    await placeInWindow(page, plan, 150);
    await rec.park(900, 640);
    await rec.startFrames();
    await rec.check("plan");
    await rec.hold(0.3);
    await rec.moveTo("approve", page.getByRole("button", { name: t.team.approval.approve }), { duration: 0.5 });
    await rec.click("approve");
    rec.mark("approved");
    // The approved plan folds up, which brings the board up into view.
    await rec.hold(0.4);
    rec.hideCursor();
    rec.mark("board");
    await rec.target("board", page.locator(".team-kanban"));
    await rec.check("tasks running");
    const done = page.locator(".team-plan").filter({ hasText: t.team.phase.done });
    await rec.until(async () => (await page.locator(".team-task.task-running").count()) === 0 && (await done.count()) > 0, 12);
    rec.mark("done");
    await rec.check("team work done");
    await rec.hold(1.0);
    await rec.stopFrames();
  },

  /** S6: try first on src/client.ts: answer, confidence, reveal, grade, then the example. */
  async "v-quiz-attempt"({ page, rec }) {
    const tf = t.review.tryFirst;
    const sample = demo.quizSamples["src/client.ts"];
    await S.playToReview(page);
    await S.openPlayedFile(page, "src/client.ts");
    const card = page.locator(".explain-card-selfcheck");
    await placeInScroller(card, 8);
    await S.parkPointer(page);
    await rec.target("panel", page.locator(".explain-panel"));
    await rec.still("establish");
    await rec.park(1250, 700);
    await rec.startFrames();
    await rec.check("question");
    await rec.target("card", card);
    await rec.hold(0.4);
    rec.mark("typing");
    const answer = card.getByRole("textbox", { name: tf.quiz.answerLabel });
    await fill(card.getByRole("button", { name: tf.fill }));
    await typedOut(rec, answer, sample.answer);
    rec.mark("typed");
    await rec.hold(0.3);
    await rec.moveTo("think", card.getByRole("radio", { name: tf.confidences.think }), { duration: 0.45 });
    await rec.click("think");
    await rec.hold(0.35);
    await rec.moveTo("reveal", card.getByRole("button", { name: tf.quiz.reveal }), { duration: 0.4 });
    await rec.click("reveal");
    rec.mark("revealed");
    await rec.hold(0.2);
    await glideInScroller(rec, card.getByRole("group", { name: tf.quiz.gradeLabel }), 300, 0.8);
    await rec.check("reference and grades");
    await rec.target("reference", card.locator(".tf-reference"));
    await rec.target("grades", card.getByRole("group", { name: tf.quiz.gradeLabel }));
    await rec.hold(0.5);
    await rec.moveTo("got", card.getByRole("button", { name: tf.grades.got }), { duration: 0.45 });
    await rec.click("got");
    rec.mark("graded");
    await rec.hold(0.6);
    rec.hideCursor();
    const example = page.locator(".explain-card-example");
    await glideInScroller(rec, example, 8, 1.0);
    rec.mark("example");
    await rec.target("example", example);
    await rec.check("example");
    await rec.hold(2.0);
    await rec.stopFrames();
  },

  /** S7: how else could this be done: the guess, the alternative, "Keep this approach" and why. */
  async "v-road-choice"({ page, rec }) {
    const tf = t.review.tryFirst;
    const sample = demo.roadSamples["src/utils/retry.ts"];
    await S.playToReview(page);
    await S.openPlayedFile(page, "src/utils/retry.ts");
    const card = page.locator(".explain-card-alternatives");
    await placeInScroller(card, 8);
    await rec.park(1250, 700);
    await rec.startFrames();
    await rec.check("question");
    await rec.target("card", card);
    await rec.hold(0.4);
    rec.mark("typing");
    const guess = card.getByRole("textbox", { name: tf.road.guessLabel });
    await fill(card.getByRole("button", { name: tf.fill }));
    await typedOut(rec, guess, sample.guess);
    rec.mark("typed");
    await rec.hold(0.3);
    await rec.moveTo("reveal", card.getByRole("button", { name: tf.road.reveal }), { duration: 0.45 });
    await rec.click("reveal");
    rec.mark("revealed");
    await rec.hold(0.3);
    await glideInScroller(rec, card.getByRole("radio", { name: tf.road.choices.keep }), 330, 1.0);
    await rec.target("reference", card.locator(".tf-reference"));
    await rec.check("alternative");
    await rec.hold(0.6);
    await rec.moveTo("keep", card.getByRole("radio", { name: tf.road.choices.keep }), { duration: 0.45 });
    await rec.click("keep");
    rec.mark("kept");
    await rec.hold(0.3);
    rec.hideCursor();
    const why = card.getByRole("textbox", { name: tf.road.whyLabel });
    await glideInScroller(rec, why, 200, 0.6);
    rec.mark("why");
    await fill(card.getByRole("button", { name: tf.fill }));
    await typedOut(rec, why, sample.why);
    rec.mark("why-typed");
    await rec.target("why", why);
    await rec.hold(0.3);
    const save = card.getByRole("button", { name: tf.road.saveWhy, exact: true });
    await save.dispatchEvent("click");
    await rec.until(() => save.isDisabled(), 3);
    rec.mark("saved");
    await rec.check("kept with why");
    await rec.hold(1.5);
    await rec.stopFrames();
  },

  /** S8: select lines 10-15 of retry.ts, Explain, the question with its diff block, the typed answer. */
  async "v-line-ask"({ page, rec }) {
    const r = t.review;
    await S.playToReview(page);
    await S.openPlayedFile(page, "src/utils/retry.ts");
    const line = (label) => page.locator(`[role=option][aria-label^="${label}"]`).first();
    const first = line(r.diff.lineLabel.removed({ line: 10, text: "" }));
    const last = line(r.diff.lineLabel.added({ line: 15, text: "" }));
    await rec.park(760, 400);
    await rec.startFrames();
    await rec.check("diff");
    await rec.target("lines", page.locator(".diff-view, .diff-panel, .diff").first());
    await rec.hold(0.3);
    await rec.moveTo("first-line", first, { duration: 0.5, dx: -120 });
    await rec.click("first-line");
    await rec.hold(0.25);
    await rec.moveTo("last-line", last, { duration: 0.45, dx: -120 });
    await rec.click("last-line", { shift: true });
    rec.mark("selected");
    await rec.check("lines selected");
    await rec.hold(0.4);
    await rec.moveTo("explain", page.getByRole("button", { name: r.diff.askSelection }), { duration: 0.45 });
    await rec.click("explain");
    rec.mark("asked");
    await rec.hold(0.3);
    rec.hideCursor();
    const bubble = page.locator(".explain-message-user").last();
    await rec.until(() => bubble.locator("pre > code.language-diff").isVisible(), 5);
    rec.mark("bubble");
    await rec.target("bubble", bubble);
    await rec.until(async () => (await page.locator(".explain-loading").count()) === 0, 12);
    const answer = page.locator(".explain-message-assistant").last();
    await rec.until(() => answer.isVisible(), 5);
    rec.mark("answer");
    await rec.hold(1.2);
    await rec.target("answer", answer);
    await rec.check("answer");
    await rec.hold(1.0);
    await rec.stopFrames();
  },

  /**
   * S9: the check, closed book: the summary, retry.ts's question at Think so,
   * what was not tested, the reveal, Partly with a one-line correction, the
   * result line.
   */
  async "v-check"({ page, rec }) {
    const c = t.workspace.check;
    const sample = demo.understandingSample;
    await S.playToReview(page);
    await S.reviewAll(page);
    await S.openCheck(page);
    const panel = checkPanel(page);
    await S.parkPointer(page);
    await rec.target("panel", panel);
    await rec.still("closed-book");
    const explain = S.checkStep(page, c.explainTitle);
    await placeInScroller(explain, 16);
    await rec.park(1250, 700);
    await rec.startFrames();
    await rec.check("explain");
    await rec.target("explain", explain);
    await rec.hold(0.4);
    rec.mark("summary");
    await fill(explain.getByRole("button", { name: c.fill }));
    await typedOut(rec, explain.getByRole("textbox"), sample.summary);
    rec.mark("summary-typed");
    await rec.hold(0.4);
    const answers = S.checkStep(page, c.answerTitle).getByRole("listitem");
    const question = answers.nth(0);
    await glideInScroller(rec, question, 16, 0.8);
    rec.mark("question");
    await rec.target("question", question);
    await fill(question.getByRole("button", { name: c.fill }));
    await typedOut(rec, question.getByRole("textbox"), sample.answers["selfCheck:src/utils/retry.ts"].answer);
    rec.mark("question-typed");
    await rec.hold(0.2);
    await rec.moveTo("think", question.getByRole("radio", { name: c.confidences.think }), { duration: 0.45 });
    await rec.click("think");
    rec.mark("think");
    await rec.hold(0.3);
    rec.hideCursor();
    const untested = answers.nth(1);
    await glideInScroller(rec, untested, 16, 0.7);
    rec.mark("untested");
    await rec.target("untested", untested);
    await fill(untested.getByRole("button", { name: c.fill }));
    await typedOut(rec, untested.getByRole("textbox"), sample.answers.untested.answer);
    rec.mark("untested-typed");
    await untested.getByRole("radio", { name: c.confidences[sample.answers.untested.confidence] }).dispatchEvent("click");
    await rec.hold(0.3);
    const lock = panel.getByRole("button", { name: c.lock });
    await glideInScroller(rec, lock, 520, 0.5);
    await rec.moveTo("lock", lock, { duration: 0.4 });
    await rec.click("lock");
    rec.mark("locked");
    const grade = S.checkStep(page, c.gradeTitle);
    await rec.until(() => grade.isVisible(), 3);
    await rec.hold(0.2);
    rec.hideCursor();
    await glideInScroller(rec, grade.getByRole("radio", { name: c.grades.partly }), 420, 0.8);
    rec.mark("reveal");
    await rec.target("grade", grade);
    await rec.check("reveal");
    await rec.hold(0.6);
    await rec.moveTo("partly", grade.getByRole("radio", { name: c.grades.partly }), { duration: 0.45 });
    await rec.click("partly");
    rec.mark("partly");
    await rec.hold(0.3);
    rec.hideCursor();
    const correct = S.checkStep(page, c.correctTitle);
    await glideInScroller(rec, correct, 60, 0.6);
    rec.mark("correction");
    await rec.target("correction", correct);
    await fill(correct.getByRole("button", { name: c.fill }));
    await typedOut(rec, correct.getByRole("textbox"), sample.answers["selfCheck:src/utils/retry.ts"].correction);
    rec.mark("correction-typed");
    await rec.hold(0.3);
    await panel.getByRole("button", { name: c.saveGrades }).dispatchEvent("click");
    const result = panel.getByRole("region", { name: c.resultTitle });
    await rec.until(async () => (await result.textContent())?.includes(c.result({ questions: 2, misses: 1 })), 3);
    await rec.hold(0.1);
    await glideInScroller(rec, result, 60, 0.8);
    rec.mark("result");
    await rec.target("result", result);
    await rec.check("result");
    await rec.hold(1.6);
    await rec.stopFrames();
  },

  /** S10: predict the maintainer: the Tests chip and the forecast line. */
  async "v-forecast"({ page, rec }) {
    const c = t.workspace.check;
    const sample = demo.understandingSample;
    await S.playToReview(page);
    await S.reviewAll(page);
    await S.openCheck(page);
    await S.fillSummary(page);
    await S.answerCheck(page);
    await S.gradeCheck(page);
    const forecast = S.checkStep(page, c.forecastTitle);
    await placeInScroller(forecast, 16);
    await rec.park(1250, 700);
    await rec.startFrames();
    await rec.check("forecast");
    await rec.target("forecast", forecast);
    await rec.hold(0.3);
    await rec.moveTo("tests", forecast.getByRole("radio", { name: c.dimensions[sample.forecast.dimension] }), { duration: 0.45 });
    await rec.click("tests");
    rec.mark("tests");
    await rec.hold(0.3);
    rec.hideCursor();
    rec.mark("typing");
    await fill(forecast.getByRole("button", { name: c.fill }));
    await typedOut(rec, forecast.getByRole("textbox"), sample.forecast.question);
    rec.mark("typed");
    await rec.hold(0.3);
    await forecast.getByRole("button", { name: c.saveForecast }).dispatchEvent("click");
    const result = checkPanel(page).getByRole("region", { name: c.resultTitle });
    const line = c.forecast({ dimension: c.dimensions[sample.forecast.dimension] });
    await rec.until(async () => (await result.textContent())?.includes(line), 3);
    await glideInScroller(rec, result, 60, 0.8);
    rec.mark("result");
    await rec.target("result", result);
    await rec.check("forecast saved");
    await rec.hold(1.5);
    await rec.stopFrames();
  },

  /** S11: your words in the description, then the maintainer checklist, all green. */
  async "v-draft-your-words"({ page, rec }) {
    const d = t.draft;
    await S.playToReview(page);
    await S.passPlayedCheck(page);
    await page.locator("#workspace-tab-draft").click();
    await S.reveal(page);
    const card = page.locator(".your-words");
    await placeInWindow(page, card, 90);
    await S.parkPointer(page);
    await rec.still("draft");
    await rec.park(1100, 700);
    await rec.startFrames();
    await rec.check("your words");
    await rec.target("card", card);
    await rec.hold(0.3);
    await rec.moveTo("use", card.getByRole("button", { name: d.yourWords.useExplanation }), { duration: 0.5 });
    await rec.click("use");
    rec.mark("used");
    await rec.hold(0.6);
    await rec.moveTo("add", card.getByRole("button", { name: d.yourWords.addUntested }), { duration: 0.45 });
    await rec.click("add");
    rec.mark("added");
    await rec.hold(0.5);
    rec.hideCursor();
    const body = page.getByRole("textbox", { name: t.workspace.draft.bodyLabel });
    await glideInWindow(rec, page, body, 120, 1.0);
    rec.mark("description");
    await rec.target("description", body);
    await rec.check("description");
    await rec.hold(1.2);
    await page.getByRole("button", { name: t.workspace.draft.save }).dispatchEvent("click");
    // The "PR draft saved" toast goes on its own after 4.5 s; the clip cuts over it.
    await rec.skipUntil(async () => (await page.locator(".toast").count()) === 0, 6);
    const checklist = page.locator(".draft-checklist");
    await glideInWindow(rec, page, checklist, 24, 1.2);
    rec.mark("checklist");
    await rec.target("checklist", checklist);
    await rec.check("checklist");
    await rec.hold(2.0);
    await rec.stopFrames();
    // The establishing still, filmed last so the clip above is unchanged: the draft tab from the
    // top with the "Sample project" badge in view, once its lazily loaded guide has shown.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const loading = page.getByText(t.workspace.draft.loadingGuide);
    for (let waited = 0; (await loading.count()) > 0 && waited < 10_000; waited += 250) await S.tick(page, 250);
    if ((await loading.count()) > 0) throw new Error("v-draft-your-words: the draft guide did not load.");
    await S.reveal(page);
    await rec.still("top");
  },

  /** S12: the publish dialog with the pacing line; open the sample Draft PR; the published card. */
  async "v-publish"({ page, rec }) {
    const w = t.workspace;
    await S.playToReview(page);
    await S.passPlayedCheck(page);
    await S.insertYourWords(page);
    const approve = page.getByRole("button", { name: w.footer.approvePr });
    await approve.scrollIntoViewIfNeeded();
    await rec.park(1000, 560);
    await rec.startFrames();
    await rec.check("draft footer");
    await rec.hold(0.3);
    await rec.moveTo("approve", approve, { duration: 0.5 });
    await rec.click("approve");
    const dialog = page.getByRole("dialog", { name: w.publish.titleDemo });
    await rec.until(() => dialog.isVisible(), 3);
    rec.hideCursor();
    // The checks load lazily; the finish button is enabled once they have.
    const finish = dialog.getByRole("button", { name: w.publish.finishDemo });
    await rec.until(() => finish.isEnabled(), 6);
    await rec.hold(0.3);
    const checks = dialog.locator(".publish-checks");
    await glideInScroller(rec, checks, 120, 1.0);
    rec.mark("checks");
    await rec.target("checks", checks);
    await rec.target("dialog", dialog);
    await rec.check("publish dialog");
    await rec.hold(0.8);
    await rec.moveTo("finish", finish, { duration: 0.5 });
    // The published card opens in the draft tab: the clip cuts there as the dialog closes.
    rec.onFrame(async () => {
      if (await dialog.isVisible()) return false;
      const card = page.locator(".sample-published");
      if (!(await card.isVisible())) return false;
      await card.evaluate((element) => {
        const top = element.getBoundingClientRect().top + window.scrollY - 200;
        window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
      });
      rec.mark("published");
      rec.hideCursor();
      return true;
    });
    await rec.click("finish");
    await rec.until(() => page.locator(".sample-published").isVisible(), 8);
    await rec.hold(0.2);
    await rec.target("published", page.locator(".sample-published"));
    await rec.check("published sample card");
    await rec.hold(1.6);
    await rec.stopFrames();
  },

  /** S13: what the maintainers said, beside the forecast. */
  async "v-forecast-vs-reality"({ page, rec }) {
    const w = t.workspace;
    await S.playToReview(page);
    await S.passPlayedCheck(page);
    await S.insertYourWords(page);
    await S.finishPublish(page, await S.openPublish(page));
    await page.locator("#workspace-tab-draft").click();
    await S.reveal(page);
    const read = page.getByRole("button", { name: new RegExp(`^${w.feedback.fetch}`) });
    await placeInWindow(page, read, 560);
    await rec.park(1000, 620);
    await rec.startFrames();
    await rec.check("feedback button");
    await rec.hold(0.3);
    await rec.moveTo("read", read, { duration: 0.5 });
    await rec.click("read");
    rec.hideCursor();
    const compare = page.locator("section.forecast");
    await rec.until(() => compare.isVisible(), 8);
    await rec.hold(0.2);
    await glideInWindow(rec, page, compare, 40, 1.0);
    rec.mark("compare");
    await rec.target("compare", compare);
    await rec.target("yours", compare.locator(".forecast-yours"));
    await rec.target("first", compare.locator(".forecast-item").first());
    await rec.check("forecast and feedback");
    await rec.hold(2.0);
    await rec.stopFrames();
  },

  /** S13: practice: one due item from the sample run, "Next review in 3 days". */
  async "v-practice"({ page, rec }) {
    const p = t.learning.practice;
    await S.openSample(page, "#/learning", { flags: { view: "practice", demo: "play" } });
    const deck = page.locator("section.practice-sample");
    const item = demo.practiceSample[0];
    await deck.getByRole("heading", { level: 3, name: item.question }).waitFor();
    await placeInWindow(page, deck, 60);
    await deck.getByLabel(p.answer).fill("The wait doubles each time, up to the cap.");
    await deck.getByRole("radio", { name: p.confidences.think }).dispatchEvent("click");
    await deck.getByRole("button", { name: p.show }).dispatchEvent("click");
    await S.tick(page, 500);
    const got = deck.getByRole("button", { name: new RegExp(`^${p.grades.got}`) });
    await got.scrollIntoViewIfNeeded();
    await rec.park(1000, 640);
    await rec.startFrames();
    await rec.check("practice item");
    await rec.target("deck", deck);
    await rec.hold(0.3);
    await rec.moveTo("got", got, { duration: 0.45 });
    await rec.click("got");
    rec.mark("graded");
    await rec.hold(0.3);
    rec.hideCursor();
    const next = deck.locator(".practice-next");
    await rec.until(() => next.isVisible(), 3);
    await glideInWindow(rec, page, next, 520, 0.6);
    rec.mark("next");
    await rec.target("next", next);
    await rec.check("next review");
    await rec.hold(1.5);
    await rec.stopFrames();
  },
};

// Main -------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { build: true, only: undefined, scale: timeline.viewport.deviceScaleFactor };
  for (const arg of argv) {
    if (arg === "--skip-build") options.build = false;
    else if (arg.startsWith("--only=")) options.only = arg.slice(7).split(",").filter(Boolean);
    else if (arg.startsWith("--scale=")) options.scale = Number(arg.slice(8));
    else throw new Error(`Unknown option ${arg}. Use --skip-build, --only=<state,...> and --scale=<n>.`);
  }
  if (![1, 2, 4].includes(options.scale)) throw new Error("--scale must be 1, 2 or 4.");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (!executablePath)
    throw new Error("Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to a local Chrome or Chrome headless shell (see README.md).");
  const ids = options.only ?? Object.keys(states);
  for (const id of ids) if (!states[id]) throw new Error(`No state "${id}" to capture.`);
  const viewport = { ...timeline.viewport, deviceScaleFactor: options.scale };

  await ensureMusic();
  if (options.build) {
    log("build: npm run build (repository root)");
    execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });
  }
  await copyBrandAssets();
  await mkdir(footageRoot, { recursive: true });

  const port = Number(process.env.PROMO_CAPTURE_PORT || 4651);
  // The temporary HOME and data dir go under /tmp/claude-1000 unless TMPDIR
  // names another place.
  const tempRoot = process.env.TMPDIR ? os.tmpdir() : "/tmp/claude-1000";
  await mkdir(tempRoot, { recursive: true });
  const temp = await mkdtemp(path.join(tempRoot, "bellpr-V1R-capture-"));
  let server;
  let browser;
  try {
    server = await startBellServer({ repoRoot, temp, port });
    log(`server: bell-pr start on 127.0.0.1:${port}, temporary HOME and data dir, stand-in agent CLIs`);
    browser = await chromium.launch({
      executablePath,
      args: [
        `--force-device-scale-factor=${viewport.deviceScaleFactor}`,
        `--window-size=${viewport.width},${viewport.height}`,
        "--hide-scrollbars",
        "--disable-gpu",
        "--num-raster-threads=1",
      ],
    });
    const contextOptions = {
      viewport: null,
      baseURL: server.baseURL,
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
      reducedMotion: "no-preference",
    };
    // Sign in once; every state starts from these cookies in a fresh context.
    const signIn = await browser.newContext(contextOptions);
    const signInPage = await signIn.newPage();
    const signedIn = await signInPage.goto(server.baseURL + server.signInPath);
    if (!signedIn?.ok()) throw new Error(`Signing in answered ${signedIn?.status()}.`);
    const settings = await signInPage.request.put(`${server.baseURL}/api/app-settings`, {
      data: { onboardingCompletedAt: new Date().toISOString(), eulaAcceptedVersion: eulaVersion, locale: "en" },
    });
    if (!settings.ok()) throw new Error(`PUT /api/app-settings answered ${settings.status()}.`);
    log("settings: onboarding done, EULA accepted, locale en");
    const storageState = await signIn.storageState();
    await signIn.close();
    log(`clock: paused page clock from ${timeline.clockStart}; window ${viewport.width}x${viewport.height} at ${viewport.deviceScaleFactor}x`);

    for (const id of ids) {
      const started = Date.now();
      log(`${id}: filming`);
      const context = await browser.newContext({ ...contextOptions, storageState });
      try {
        await context.addInitScript(privacyGuard, privacyGuardArgs());
        const page = await context.newPage();
        await fitWindow(page, viewport);
        await S.pauseClock(page);
        const rec = new ShotRecorder({ page, dir: path.join(footageRoot, id), id, workspace: true, log, viewport });
        await rec.prepare();
        await states[id]({ page, rec });
        await rec.save();
      } finally {
        await context.close();
      }
      log(`${id}: done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
    log(`capture: ${ids.length} state(s); every named state passed the privacy and badge checks (no exemption)`);
  } finally {
    await browser?.close();
    await server?.stop();
    await rm(temp, { recursive: true, force: true });
    await mkdir(path.dirname(logFile), { recursive: true });
    await writeFile(logFile, `${logLines.join("\n")}\n`);
  }
}

main().catch((error) => {
  console.error(`capture: ${error.message}`);
  process.exitCode = 1;
});
