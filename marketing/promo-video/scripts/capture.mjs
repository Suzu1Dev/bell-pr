#!/usr/bin/env node
/**
 * Captures the promo footage from the real product: the sample project's
 * scripted playback in presentation mode, filmed by Playwright and Chrome.
 *
 *   npm run capture                      every shot (builds the product first)
 *   npm run capture -- --skip-build      reuse the existing build
 *   npm run capture -- --only=s7-explain,s8-review
 *
 * Steps:
 * 1. Checks the licensed music copy in public/music/ (MD5); copies it from
 *    PROMO_MUSIC_FILE first when it is missing.
 * 2. Builds the product (the repository's `npm run build`).
 * 3. Starts `bell-pr start --no-open --port 4573` with a temporary HOME and
 *    data dir and stand-in agent CLIs (scripts/lib/bell-server.mjs), signs
 *    in, and marks onboarding done and the EULA accepted through
 *    PUT /api/app-settings, so neither Welcome nor the EULA prompt shows.
 * 4. Films every shot that src/timeline.json gives a `capture` block, with
 *    the method it names there: PNG stills, CDP screencast clips or
 *    frame-stepped clips (page clock). Footage goes to public/footage/<shot>/
 *    (gitignored), with the cursor targets in targets.json.
 * 5. Fails on any privacy finding at any captured state (scripts/lib/privacy.mjs)
 *    and when a workspace shot does not show the "Sample project" badge.
 * 6. Stops the server and removes the temporary directories, whatever
 *    happened.
 *
 * The capture log goes to out/capture.log. It holds no path, token or
 * matched text, so it can be quoted in a commit message.
 *
 * The browser is the local Chrome named by PLAYWRIGHT_CHROMIUM_EXECUTABLE.
 * It runs with a forced device scale factor of 2 and a 1440x810 window
 * instead of Playwright's viewport emulation: Chrome's screencast sends
 * frames at the emulated CSS size (1440x810), but with a real 2x display it
 * sends 2880x1620 frames, the same size as the stills.
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

const music = {
  file: path.join(packageRoot, "public", "music", "mixkit-ramp-it-up-69.mp3"),
  md5: "eea11c69fe4b634318f2a2d8d393d589",
};

const timeline = JSON.parse(
  await readFile(path.join(packageRoot, "src", "timeline.json"), "utf8"),
);
const { viewport } = timeline;

const logLines = [];
function log(line) {
  logLines.push(line);
  console.log(line);
}

const md5 = async (file) => createHash("md5").update(await readFile(file)).digest("hex");

/** The music copy must exist and be the owner's licensed file. */
async function ensureMusic() {
  if (!existsSync(music.file)) {
    const source = process.env.PROMO_MUSIC_FILE;
    if (!source)
      throw new Error(
        "The music is missing: put mixkit-ramp-it-up-69.mp3 in public/music/ or set PROMO_MUSIC_FILE (see MUSIC-LICENSE.md).",
      );
    if (!existsSync(source)) throw new Error("PROMO_MUSIC_FILE names no file.");
    if ((await md5(source)) !== music.md5)
      throw new Error("PROMO_MUSIC_FILE is not the licensed track (MD5 differs).");
    await mkdir(path.dirname(music.file), { recursive: true });
    await copyFile(source, music.file);
  }
  if ((await md5(music.file)) !== music.md5)
    throw new Error("public/music/mixkit-ramp-it-up-69.mp3 is not the licensed track (MD5 differs).");
  log(`music: public/music/mixkit-ramp-it-up-69.mp3, MD5 ${music.md5} (ok)`);
}

/** The product's brand SVGs, for the title and end cards. */
async function copyBrandAssets() {
  const target = path.join(packageRoot, "public", "brand-assets");
  await rm(target, { recursive: true, force: true });
  await cp(path.join(repoRoot, "public", "brand"), target, {
    recursive: true,
    filter: (source) => !/\.png$/i.test(source),
  });
}

/** The address of a shot's route with its flags and the presentation flags. */
function routeUrl(baseURL, route, flags = {}) {
  const [hashPath, query = ""] = route.split("?");
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries({ ...flags, ...timeline.baseFlags }))
    params.set(key, value);
  return `${baseURL}/${hashPath}?${params.toString().replace(/%2F/gi, "/")}`;
}

/** Waits until the page rendered its data and its fonts. */
async function settled(page) {
  await page.locator("html[lang='en']").waitFor({ state: "attached" });
  await page.locator("#main-content").waitFor();
  await page.locator(".app-starting").waitFor({ state: "detached" });
  await page.evaluate(() => document.fonts.ready);
  await sleep(400);
}

/** The window must give a 1440x810 CSS viewport at 2x. */
async function fitWindow(page) {
  const measure = () =>
    page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio }));
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
  if (
    size.width !== viewport.width ||
    size.height !== viewport.height ||
    size.scale !== viewport.deviceScaleFactor
  )
    throw new Error(
      `The browser page is ${size.width}x${size.height} at ${size.scale}x, not ${viewport.width}x${viewport.height} at ${viewport.deviceScaleFactor}x.`,
    );
}

// The product's own English copy, so the capture follows copy changes.
const t = {
  common: (await tsImport("../../../src/i18n/en/common.ts", import.meta.url)).default,
  repos: (await tsImport("../../../src/i18n/en/repos.ts", import.meta.url)).default,
  mission: (await tsImport("../../../src/i18n/en/mission.ts", import.meta.url)).default,
  modals: (await tsImport("../../../src/i18n/en/modals.ts", import.meta.url)).default,
  team: (await tsImport("../../../src/i18n/en/team.ts", import.meta.url)).default,
  review: (await tsImport("../../../src/i18n/en/review.ts", import.meta.url)).default,
  workspace: (await tsImport("../../../src/i18n/en/workspace.ts", import.meta.url)).default,
  draft: (await tsImport("../../../src/i18n/en/draft.ts", import.meta.url)).default,
};
const { eulaVersion } = await tsImport("../../../shared/product.ts", import.meta.url);
const sampleFiles = ["src/utils/retry.ts", "src/client.ts", "src/types.ts", "tests/retry.test.ts", "README.md"];

// Shared steps ---------------------------------------------------------------

const statusBadge = (page) => page.locator(".workspace-heading .status-badge");

/** Changes the address inside the running app, as a link would. */
async function goHash(page, baseURL, route, flags) {
  const url = new URL(routeUrl(baseURL, route, flags));
  await page.evaluate((hash) => {
    location.hash = hash;
  }, url.hash);
  await sleep(300);
}

/**
 * Plays the sample run from the activity tab until it waits for the
 * person's review, with every explanation ready.
 */
async function playToReview(page, baseURL, flags) {
  await page.goto(routeUrl(baseURL, "#/runs/demo-run/activity", flags));
  await settled(page);
  await statusBadge(page)
    .filter({ hasText: t.common.runStatus.awaiting_plan })
    .waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: t.team.approval.approve }).click();
  await statusBadge(page)
    .filter({ hasText: t.common.runStatus.review })
    .waitFor({ timeout: 60_000 });
  // The explanations become ready one file after another.
  await sleep(4000 / Number(flags.speed ?? 1) + 600);
}

const fileItem = (page, file) => page.locator(`.file-item[title="${file}"]`);
const reviewedBox = (page) => page.getByRole("checkbox", { name: t.review.diff.reviewed });

/** Opens the changes tab on `file`. */
async function openChanges(page, baseURL, flags, file) {
  await goHash(page, baseURL, `#/runs/demo-run/changes?file=${file}`, flags);
  await fileItem(page, file).waitFor();
}

/** Marks `files` reviewed, one after another, through the UI. */
async function markReviewed(page, files) {
  for (const file of files) {
    await fileItem(page, file).click();
    await reviewedBox(page).check();
  }
}

/** Reviews every file, approves, and goes back to the draft tab. */
async function approveToDraft(page, baseURL, flags) {
  await playToReview(page, baseURL, flags);
  await openChanges(page, baseURL, flags, sampleFiles[0]);
  await markReviewed(page, sampleFiles);
  await page.getByRole("button", { name: t.workspace.footer.approvePr }).click();
  await statusBadge(page)
    .filter({ hasText: t.common.runStatus.approved })
    .waitFor();
  await page.getByRole("button", { name: t.workspace.publish.back }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.locator("#workspace-tab-draft[aria-selected='true']").waitFor();
  await sleep(400);
}

/** Scrolls the window at once so `locator` starts `offset` CSS pixels from the top. */
async function scrollToTop(page, locator, offset = 0) {
  await page.evaluate(
    (y) => window.scrollTo({ top: y, behavior: "instant" }),
    await windowTop(page, locator, offset),
  );
  await sleep(250);
}

/** The window scroll position that puts `locator` `offset` pixels from the top. */
function windowTop(page, locator, offset = 0) {
  return locator.evaluate(
    (element, gap) => Math.max(0, element.getBoundingClientRect().top + window.scrollY - gap),
    offset,
  );
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

/** The scrollTop of `scroller` that puts `locator` `offset` pixels below its top. */
function scrollerTop(scroller, locator, offset = 0) {
  return locator.evaluate(
    (element, [box, gap]) =>
      box.scrollTop + element.getBoundingClientRect().top - box.getBoundingClientRect().top - gap,
    [scroller, offset],
  );
}

/**
 * The directions view that S4 ends on and S5 starts from: the first
 * recommendation card with its "Start with this direction" button near the
 * bottom of the window.
 */
const directionsTop = (page) =>
  windowTop(page, page.getByRole("button", { name: t.mission.ideas.choose }).first(), 640);

// The shots ------------------------------------------------------------------
//
// Each function films one shot of src/timeline.json. `rec.at(t)` waits until
// `t` seconds into the clip, so the clip's pacing is the same on every run;
// the Remotion cursor replays the recorded moves and clicks.

const shots = {
  /** S1: the home page, blurred behind the opening title cards. */
  async "s1-problem"({ rec, open }) {
    await open();
    await rec.still("home");
  },

  /** S3: import the sample repository by name and watch it arrive. */
  async "s3-import"({ rec, open, page }) {
    await open();
    await rec.park(1000, 560);
    await rec.startFrames();
    await rec.check("repositories");
    await rec.at(0.3);
    await rec.moveTo("import", page.getByRole("button", { name: t.repos.list.import }).first(), { duration: 0.6 });
    await rec.click("import");
    const source = page.locator("#repo-source");
    await rec.until(() => source.isVisible(), 3);
    await rec.at(1.35);
    await source.focus();
    await rec.type("openfetch-sample/open-fetch", { cps: 24 });
    await rec.check("import dialog");
    await rec.at(rec.elapsed() + 0.15);
    await rec.moveTo("import-submit", page.locator(".modal form button[type=submit]"), { duration: 0.45 });
    // The repository page loads its overview over the network after the
    // import; the clip holds its frame until it has, so it never shows a
    // half-loaded page.
    const overview = page.getByText(t.mission.overview.title).first();
    rec.onFrame(async () => {
      if (!/#\/repos\/demo-repo/.test(page.url())) return false;
      await rec.skipUntil(() => overview.isVisible());
      rec.mark("repository-page");
      return true;
    });
    await rec.click("import-submit");
    await rec.until(() => page.locator(".import-progress li").nth(3).isVisible(), 5);
    await rec.check("import progress");
    await rec.until(async () => /#\/repos\/demo-repo/.test(page.url()), 5);
    await rec.at(rec.elapsed() + 0.5);
    await rec.check("repository overview");
    await rec.at(6.6);
    await rec.stopFrames();
  },

  /** S4: the sample analysis plays, the overview appears, then the directions. */
  async "s4-overview"({ rec, page, open }) {
    // Paused before the page loads, the analysis waits at its first line.
    await rec.pauseClock(new Date(Date.parse(timeline.clockStart) + 1000));
    await open();
    const loading = page.locator(".mission-overview-empty");
    await loading.waitFor();
    await scrollToTop(page, loading, 150);
    await rec.startFrames();
    await rec.check("analysis loading");
    const ideas = page.getByRole("heading", { name: t.mission.ideas.title });
    await rec.until(() => ideas.isVisible(), 10);
    const revealed = rec.elapsed();
    await rec.check("project overview");
    await rec.at(revealed + 1.5);
    await rec.scrollTo(await directionsTop(page), { duration: 1.2 });
    await rec.at(revealed + 2.9);
    await rec.check("directions");
    await rec.at(10.4);
    await rec.stopFrames();
  },

  /** S5: choose a direction; the task dialog keeps plan approval on. */
  async "s5-direction"({ rec, open, page }) {
    await open();
    await page.getByRole("heading", { name: t.mission.ideas.title }).waitFor({ timeout: 20_000 });
    await sleep(500);
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), await directionsTop(page));
    await sleep(400);
    const choose = page.getByRole("button", { name: t.mission.ideas.choose }).first();
    await rec.target("choose", choose);
    await rec.still("directions");
    await choose.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await sleep(700);
    await rec.target("direction", dialog.locator(".mission-direction-selected").first());
    await rec.still("task-dialog");
    const submit = dialog.getByRole("button", { name: t.modals.newTask.saveDemo });
    await submit.evaluate((element) => element.scrollIntoView({ block: "end", behavior: "instant" }));
    await sleep(400);
    await rec.target("play-team", submit);
    await rec.target("approve-plan", dialog.getByText(t.mission.settings.planApproval.label));
    await rec.still("task-dialog-submit");
  },

  /** S6: approve the Lead's plan; frame by frame, the tasks move and the team talks. */
  async "s6-team"({ rec, open, page }) {
    await open();
    await statusBadge(page)
      .filter({ hasText: t.common.runStatus.awaiting_plan })
      .waitFor({ timeout: 30_000 });
    await sleep(300);
    await rec.park(1180, 470);
    await rec.startFrames();
    await rec.check("plan awaiting approval");
    await rec.at(0.7);
    const panel = page.getByText(t.team.phase.awaiting_approval).first();
    await rec.scrollTo(await windowTop(page, panel, 110), { duration: 1.1 });
    await rec.at(2.0);
    await rec.moveTo("approve-plan", page.getByRole("button", { name: t.team.approval.approve }), { duration: 0.55 });
    await rec.at(2.7);
    await rec.click("approve-plan");
    await rec.at(4.5);
    await rec.check("tasks running");
    await rec.at(11.2);
    await rec.check("team work done");
    await rec.stopFrames();
  },

  /** S7: plain-language explanation, a question about selected lines, the reviews. */
  async "s7-explain"({ rec, page, baseURL, shot }) {
    const { flags } = shot.capture;
    await playToReview(page, baseURL, flags);
    await openChanges(page, baseURL, flags, "src/utils/retry.ts");
    await sleep(800);
    const line = (label) => page.locator(`[role=option][aria-label^="${label}"]`).first();
    // The changed lines sit low in the diff: scroll it up by five lines, so
    // the selection stays clear of the captions in the lower third.
    const fifth = line(t.review.diff.lineLabel.context({ line: 5, text: "" }));
    const diff = await scrollerOf(fifth);
    await diff.evaluate(
      (element, top) => element.scrollTo({ top, behavior: "instant" }),
      await scrollerTop(diff, fifth, 0),
    );
    await sleep(300);
    const example = page.getByText(t.review.explain.cards.example).first();
    const panel = await scrollerOf(example);
    await rec.park(1250, 690);
    await rec.startScreencast();
    await rec.check("explanation");
    await rec.at(1.0);
    await rec.scrollTo(await scrollerTop(panel, page.getByText(t.review.explain.exampleScenario).first(), 8), { scroller: panel });
    const first = line(t.review.diff.lineLabel.removed({ line: 10, text: "" }));
    const last = line(t.review.diff.lineLabel.added({ line: 15, text: "" }));
    await rec.at(3.4);
    await rec.moveTo("first-line", first, { duration: 0.55, dx: -120 });
    await rec.click("first-line");
    await rec.at(4.35);
    await rec.moveTo("last-line", last, { duration: 0.5, dx: -120 });
    await rec.click("last-line", { shift: true });
    await rec.check("lines selected");
    await rec.at(5.15);
    await rec.moveTo("explain", page.getByRole("button", { name: t.review.diff.askSelection }), { duration: 0.5 });
    await rec.click("explain");
    await page.locator(".explain-message-assistant").first().waitFor();
    await page.locator(".explain-loading").waitFor({ state: "detached" });
    await sleep(1200);
    await rec.check("answer typed");
    await rec.at(9.2);
    await rec.moveTo("reviews", page.getByRole("tab", { name: t.review.panel.tabs.reports }), { duration: 0.5 });
    await rec.click("reviews");
    await rec.at(10.2);
    const report = page.locator(".explain-card-report h3", { hasText: t.review.reports.sections.reviewer.author }).first();
    const reports = await scrollerOf(report);
    await rec.scrollTo(await scrollerTop(reports, report, 8), { scroller: reports });
    await sleep(1200);
    await rec.check("code review report");
    await rec.at(14.8);
    await rec.stopScreencast();
  },

  /** S8: the last files are marked reviewed; the PR is approved. */
  async "s8-review"({ rec, page, baseURL, shot }) {
    const { flags } = shot.capture;
    await playToReview(page, baseURL, flags);
    await openChanges(page, baseURL, flags, sampleFiles[0]);
    await markReviewed(page, sampleFiles.slice(0, 3));
    await fileItem(page, "tests/retry.test.ts").click();
    await sleep(700);
    await rec.park(900, 470);
    await rec.startFrames();
    await rec.check("three of five reviewed");
    await rec.at(0.3);
    await rec.moveTo("reviewed-1", reviewedBox(page), { duration: 0.55 });
    await rec.click("reviewed-1");
    await rec.at(1.25);
    await rec.moveTo("readme", fileItem(page, "README.md"), { duration: 0.5 });
    await rec.click("readme");
    await rec.at(2.15);
    await rec.moveTo("reviewed-2", reviewedBox(page), { duration: 0.5 });
    await rec.click("reviewed-2");
    await rec.at(rec.elapsed() + 0.1);
    await rec.check("every file reviewed");
    await rec.at(3.05);
    await rec.moveTo("approve", page.getByRole("button", { name: t.workspace.footer.approvePr }), { duration: 0.55 });
    await rec.click("approve");
    await rec.until(() => page.getByRole("dialog").isVisible(), 3);
    await rec.at(rec.elapsed() + 0.6);
    await rec.check("publish preview");
    await rec.at(5.6);
    await rec.stopFrames();
  },

  /** S9: the rule-aware draft guidance and the final checklist. */
  async "s9-draft"({ rec, page, baseURL, shot }) {
    await approveToDraft(page, baseURL, shot.capture.flags);
    await scrollToTop(page, page.getByText(t.draft.guidance.eyebrow).first(), 355);
    await rec.still("guidance");
    await scrollToTop(page, page.getByRole("heading", { name: t.workspace.checklist.title }), 130);
    await rec.still("checklist");
  },

  /** S10: the publish preview, then the sample Draft PR opens. */
  async "s10-publish"({ rec, page, baseURL, shot }) {
    await approveToDraft(page, baseURL, shot.capture.flags);
    // The footer with the approve button closes the long draft tab.
    await page.evaluate(() =>
      window.scrollTo({ top: document.scrollingElement.scrollHeight, behavior: "instant" }),
    );
    await sleep(500);
    await rec.park(1000, 560);
    await rec.startFrames();
    await rec.check("draft footer");
    await rec.at(0.3);
    await rec.moveTo("approve", page.getByRole("button", { name: t.workspace.footer.approvePr }), { duration: 0.55 });
    await rec.click("approve");
    // Opened a second time, the dialog scrolls its focused button into view;
    // it starts at its title instead, as it did the first time.
    rec.onFrame(() =>
      page.evaluate(() => {
        const modal = document.querySelector("[role=dialog]");
        if (!modal) return false;
        let box = modal;
        while (box && !(box.scrollHeight > box.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(box).overflowY)))
          box = box.parentElement;
        if (box) box.scrollTop = 0;
        return true;
      }),
    );
    const dialog = page.getByRole("dialog");
    await rec.until(() => dialog.isVisible(), 3);
    await rec.at(1.6);
    const preview = dialog.locator(".publish-body-preview").first();
    const scroller = await scrollerOf(preview);
    const bottom = await scroller.evaluate((element) => element.scrollHeight - element.clientHeight);
    await rec.scrollTo(bottom, { scroller, duration: 1.0 });
    await rec.at(2.8);
    await rec.check("publish preview");
    await rec.moveTo("open-pr", dialog.getByRole("button", { name: t.workspace.publish.finishDemo }), { duration: 0.55 });
    // The sample card opens at the top of the long draft tab: the clip cuts
    // there as the dialog closes, instead of scrolling past the whole draft.
    rec.onFrame(async () => {
      if (await dialog.isVisible()) return false;
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      rec.mark("draft-top");
      rec.hideCursor();
      return true;
    });
    await rec.click("open-pr");
    await rec.until(() => page.locator(".sample-published").isVisible(), 5);
    await rec.at(rec.elapsed() + 0.4);
    await rec.check("published sample card");
    await rec.at(7.4);
    await rec.stopFrames();
  },
};

// Main -------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { build: true, only: undefined };
  for (const arg of argv) {
    if (arg === "--skip-build") options.build = false;
    else if (arg.startsWith("--only=")) options.only = arg.slice(7).split(",").filter(Boolean);
    else throw new Error(`Unknown option ${arg}. Use --skip-build and --only=<shot,...>.`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (!executablePath)
    throw new Error("Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to a local Chrome or Chrome headless shell (see README.md).");
  const capture = timeline.shots.filter(
    (shot) => shot.capture && (!options.only || options.only.includes(shot.id)),
  );
  if (options.only)
    for (const id of options.only)
      if (!capture.some((shot) => shot.id === id)) throw new Error(`No shot "${id}" to capture.`);

  await ensureMusic();
  if (options.build) {
    log("build: npm run build (repository root)");
    execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });
  }
  await copyBrandAssets();
  await mkdir(footageRoot, { recursive: true });

  const port = Number(process.env.PROMO_CAPTURE_PORT || 4573);
  // The temporary HOME and data dir go under /tmp/claude-1000 unless TMPDIR
  // names another place.
  const tempRoot = process.env.TMPDIR ? os.tmpdir() : "/tmp/claude-1000";
  await mkdir(tempRoot, { recursive: true });
  const temp = await mkdtemp(path.join(tempRoot, "bellpr-7C-"));
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
      ],
    });
    const contextOptions = {
      viewport: null,
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
      reducedMotion: "no-preference",
    };
    // Sign in once; every shot starts from these cookies in a fresh context.
    const signIn = await browser.newContext(contextOptions);
    const signInPage = await signIn.newPage();
    const signedIn = await signInPage.goto(server.baseURL + server.signInPath);
    if (!signedIn?.ok()) throw new Error(`Signing in answered ${signedIn?.status()}.`);
    const settings = await signInPage.request.put(`${server.baseURL}/api/app-settings`, {
      data: {
        onboardingCompletedAt: new Date().toISOString(),
        eulaAcceptedVersion: eulaVersion,
        locale: "en",
      },
    });
    if (!settings.ok()) throw new Error(`PUT /api/app-settings answered ${settings.status()}.`);
    log("settings: onboarding done, EULA accepted, locale en");
    const storageState = await signIn.storageState();
    await signIn.close();

    for (const shot of capture) {
      const started = Date.now();
      log(`${shot.id}: ${shot.capture.method} of ${shot.capture.route}`);
      const context = await browser.newContext({ ...contextOptions, storageState });
      try {
        await context.clock.install({ time: new Date(timeline.clockStart) });
        await context.addInitScript(privacyGuard, privacyGuardArgs());
        const page = await context.newPage();
        await fitWindow(page);
        const rec = new ShotRecorder({
          page,
          dir: path.join(footageRoot, shot.id),
          id: shot.id,
          workspace: Boolean(shot.workspace),
          log,
        });
        await rec.prepare();
        const open = async () => {
          await page.goto(routeUrl(server.baseURL, shot.capture.route, shot.capture.flags));
          await settled(page);
        };
        await shots[shot.id]({ rec, open, page, baseURL: server.baseURL, shot });
        await rec.save();
      } finally {
        await context.close();
      }
      log(`${shot.id}: done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
    log(`capture: ${capture.length} shot(s); every captured state passed the privacy and badge checks`);
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
