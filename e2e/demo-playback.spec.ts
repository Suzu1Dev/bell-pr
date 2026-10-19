// The filmable sample story: demo=play plays the sample contribution from
// queued to a published sample PR, on a server that has no agent CLI and
// no GitHub CLI at all. Every step stays in the browser.
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getDemo } from "../src/demo";
import common from "../src/i18n/en/common";
import review from "../src/i18n/en/review";
import team from "../src/i18n/en/team";
import workspace from "../src/i18n/en/workspace";
import { assertNoHan } from "../src/test-utils/render";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const demo = getDemo("en");
const status = common.runStatus;
const check = workspace.check;

/**
 * Explains the played sample back with its own answers (the "Fill with the
 * sample answer" buttons type them out), graded as the sample grades them,
 * and predicts the maintainer.
 */
async function passCheck(page: Page) {
  const sample = demo.understandingSample!;
  const panel = page.locator(".understanding-check");
  const step = (name: string) => panel.getByRole("region", { name });
  await step(check.explainTitle).getByRole("button", { name: check.fill }).click();
  await expect(step(check.explainTitle).getByRole("textbox")).toHaveValue(sample.summary);
  const answers = step(check.answerTitle).getByRole("listitem");
  for (const [index, id] of ["selfCheck:src/utils/retry.ts", "untested"].entries()) {
    const entry = answers.nth(index);
    await entry.getByRole("button", { name: check.fill }).click();
    await expect(entry.getByRole("textbox")).toHaveValue(sample.answers[id].answer);
    await entry.getByRole("radio", { name: check.confidences[sample.answers[id].confidence] }).check();
  }
  await panel.getByRole("button", { name: check.lock }).click();
  await step(check.gradeTitle).getByRole("radio", { name: check.grades.partly }).check();
  await step(check.correctTitle).getByRole("button", { name: check.fill }).click();
  await expect(step(check.correctTitle).getByRole("textbox")).toHaveValue(
    sample.answers["selfCheck:src/utils/retry.ts"].correction!,
  );
  await panel.getByRole("button", { name: check.saveGrades }).click();
  const forecast = step(check.forecastTitle);
  await forecast.getByRole("radio", { name: check.dimensions[sample.forecast.dimension] }).check();
  await forecast.getByRole("button", { name: check.fill }).click();
  await expect(forecast.getByRole("textbox")).toHaveValue(sample.forecast.question);
  await forecast.getByRole("button", { name: check.saveForecast }).click();
  await expect(panel.getByRole("region", { name: check.resultTitle })).toContainText(
    check.result({ questions: 2, misses: 1 }),
  );
}

let server: LaunchedServer;
let bin: string;

test.beforeAll(async () => {
  test.setTimeout(90_000);
  // A PATH that holds only node and git: codex, claude and gh are missing.
  bin = await mkdtemp(path.join(os.tmpdir(), "bellpr-e2e-path-"));
  await symlink(process.execPath, path.join(bin, "node"));
  const git = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  await symlink(git, path.join(bin, "git"));
  server = await launchServer({ env: { PATH: bin } });
});

test.afterAll(async () => {
  await server?.stop();
  if (bin) await rm(bin, { recursive: true, force: true });
});

test("demo=play plays the sample from queued to a published sample PR, with no tool and no write request", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
  });
  try {
    const page = await context.newPage();
    // The environment is not ready: the sample must not need it.
    const doctor = await (await page.request.get("/api/doctor")).json();
    expect(doctor.ready).toBe(false);
    for (const id of ["codex", "claude", "gh"])
      expect(doctor.checks.find((check: { id: string }) => check.id === id)?.status).not.toBe("ok");

    const writes: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        (request.method() !== "GET" && url.pathname.startsWith("/api/runs")) ||
        /\/(publish|approve)\b/.test(url.pathname)
      )
        writes.push(`${request.method()} ${url.pathname}`);
    });
    // Every status and task count the workspace shows, even for a moment.
    await page.addInitScript(() => {
      const seen = { status: [] as string[], progress: [] as string[] };
      (window as unknown as { seen: typeof seen }).seen = seen;
      const note = (list: string[], text: string | null | undefined) => {
        const value = text?.trim();
        if (value && list[list.length - 1] !== value) list.push(value);
      };
      new MutationObserver(() => {
        note(seen.status, document.querySelector(".workspace-heading .status-badge")?.textContent);
        note(seen.progress, document.querySelector(".team-plan-heading > span")?.textContent);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });

    const started = Date.now();
    await page.goto("/#/runs/demo-run/activity?demo=play&speed=4&present=1&locale=en");
    const badge = page.locator(".workspace-heading .status-badge");

    await expect(badge).toHaveText(status.awaiting_plan, { timeout: 20_000 });
    await page.getByRole("button", { name: team.approval.approve }).click();
    await expect(badge).toHaveText(status.review, { timeout: 30_000 });

    // An answer in the playback waits a moment, then types out.
    await page.locator("#workspace-tab-changes").click();
    await page.getByRole("button", { name: review.panel.askAboutChange }).click();
    await page.evaluate(() => {
      const typed: number[] = [];
      (window as unknown as { typed: number[] }).typed = typed;
      new MutationObserver(() => {
        const answers = document.querySelectorAll(
          ".explain-message-assistant .explain-message-body",
        );
        const length = answers[answers.length - 1]?.textContent?.length;
        if (length && typed[typed.length - 1] !== length) typed.push(length);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const question = page.getByRole("textbox", { name: review.chat.inputLabel });
    await question.fill("Why full jitter?");
    await question.press("Enter");
    await expect(page.locator(".explain-message-assistant")).toHaveCount(1);
    await expect(page.locator(".explain-loading")).toHaveCount(0);
    const typed = await page.evaluate(
      () => (window as unknown as { typed: number[] }).typed,
    );
    // Markdown still open part way (a lone backtick) may shift a length by a
    // character, so only the growth from the first slice to the whole is checked.
    expect(typed.length, `answer lengths seen: ${typed.join(", ")}`).toBeGreaterThan(2);
    expect(typed[0]).toBeLessThan(typed[typed.length - 1] / 2);

    // The reader reviews every file of the finished run.
    for (const file of demo.files) {
      await page.locator(`.file-item[title="${file.path}"]`).click();
      const reviewed = page.getByRole("checkbox", { name: review.diff.reviewed });
      await reviewed.check();
      await expect(reviewed).toBeChecked();
    }
    // Approval waits for the understanding check, as on a real run.
    await page.getByRole("button", { name: workspace.footer.explainBack }).click();
    await expect(page.locator(".explain-panel")).toHaveCount(0);
    await passCheck(page);
    await page.getByRole("button", { name: workspace.footer.approvePr }).click();
    await expect(badge).toHaveText(status.approved);
    const dialog = page.getByRole("dialog", { name: workspace.publish.titleDemo });
    await expect(dialog).toBeVisible();
    // The demo previews the PR body it would send, and its checks all pass.
    await expect(dialog.locator(".publish-body-preview")).toBeVisible();
    await expect(dialog).toContainText(workspace.publish.allClear);
    await expect(dialog).toContainText(workspace.publish.pacing({ open: 0, budget: 1, first: true }));
    await dialog.getByRole("button", { name: workspace.publish.finishDemo }).click();

    const card = page.locator(".sample-published");
    await expect(card).toContainText(demo.publishedCard!.title);
    await expect(card).toContainText(demo.publishedCard!.note);
    await expect(badge).toHaveText(status.published);
    await expect(page.locator("#workspace-tab-draft")).toHaveAttribute("aria-selected", "true");
    // Once published, the approve button stays off.
    await expect(
      page.getByRole("button", { name: workspace.footer.approvePr }),
    ).toBeDisabled();
    expect(Date.now() - started).toBeLessThan(60_000);

    const seen = await page.evaluate(
      () => (window as unknown as { seen: { status: string[]; progress: string[] } }).seen,
    );
    // Each state in turn, the short-lived ones included.
    let at = -1;
    for (const label of [
      status.queued,
      status.awaiting_plan,
      status.running,
      status.review,
      status.approved,
      status.published,
    ]) {
      at = seen.status.indexOf(label, at + 1);
      expect(at, `"${label}" after the states before it in: ${seen.status.join(" → ")}`).toBeGreaterThan(-1);
    }
    const tasks = demo.team.tasks.length;
    expect(seen.progress).toContain(team.progress({ done: tasks, total: tasks }));

    const content = await page.content();
    expect(content).not.toContain("Invalid Date");
    // The language switcher names Traditional Chinese in its own script (an autonym,
    // the one exception check-i18n allows); nothing else may be Chinese.
    assertNoHan(
      content.replace(/<option[^>]*\slang="zh[^"]*"[^>]*>[^<]*<\/option>/g, ""),
    );
    expect(writes).toEqual([]);
  } finally {
    await context.close();
  }
});

test("while capturing, a played answer starts on the same tick every time and the chat jumps to it", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
  });
  try {
    const page = await context.newPage();
    // How each scroll into view was asked for.
    await page.addInitScript(() => {
      const behaviors: string[] = [];
      (window as unknown as { behaviors: string[] }).behaviors = behaviors;
      const scroll = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
        if (typeof options === "object" && options.behavior) behaviors.push(options.behavior);
        return scroll.call(this, options);
      };
    });
    await page.goto("/#/runs/demo-run/activity?demo=play&speed=4&capture=1&locale=en");
    const badge = page.locator(".workspace-heading .status-badge");
    await expect(badge).toHaveText(status.awaiting_plan, { timeout: 20_000 });
    await page.getByRole("button", { name: team.approval.approve }).click();
    await expect(badge).toHaveText(status.review, { timeout: 30_000 });

    await page.locator("#workspace-tab-changes").click();
    await page.getByRole("button", { name: review.panel.askAboutChange }).click();
    // From here the page's clock stands still until the test moves it.
    await page.clock.install({ time: new Date("2026-10-19T09:00:00Z") });
    await page.clock.pauseAt(new Date("2026-10-19T09:00:01Z"));
    const question = page.getByRole("textbox", { name: review.chat.inputLabel });
    await question.fill("Why full jitter?");
    await question.press("Enter");
    const answer = page.locator(".explain-message-assistant");
    // Capturing waits the middle of the pause range, 600 ms, every time.
    await page.clock.runFor(599);
    await expect(answer).toHaveCount(0);
    await page.clock.runFor(1);
    await expect(answer).toHaveCount(1);
    await page.clock.runFor(10_000);
    await expect(page.locator(".explain-loading")).toHaveCount(0);
    const behaviors = await page.evaluate(
      () => (window as unknown as { behaviors: string[] }).behaviors,
    );
    expect(behaviors.length).toBeGreaterThan(0);
    expect(new Set(behaviors)).toEqual(new Set(["instant"]));
  } finally {
    await context.close();
  }
});

test("the chat scrolls smoothly unless the person prefers reduced motion", async ({ browser }) => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    const context = await browser.newContext({
      baseURL: server.baseURL,
      storageState: server.storageState,
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      reducedMotion,
    });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const behaviors: string[] = [];
        (window as unknown as { behaviors: string[] }).behaviors = behaviors;
        const scroll = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
          if (typeof options === "object" && options.behavior) behaviors.push(options.behavior);
          return scroll.call(this, options);
        };
      });
      await page.goto("/#/runs/demo-run/changes?locale=en");
      await page.getByRole("button", { name: review.panel.askAboutChange }).click();
      const question = page.getByRole("textbox", { name: review.chat.inputLabel });
      await question.fill("Why full jitter?");
      await question.press("Enter");
      await expect(page.locator(".explain-message-assistant")).toHaveCount(1);
      const behaviors = await page.evaluate(
        () => (window as unknown as { behaviors: string[] }).behaviors,
      );
      expect(behaviors.length).toBeGreaterThan(0);
      expect(new Set(behaviors)).toEqual(
        new Set([reducedMotion === "reduce" ? "instant" : "smooth"]),
      );
    } finally {
      await context.close();
    }
  }
});

test("stopping the sample's team sends nothing and leaves it stopped", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
  });
  try {
    const page = await context.newPage();
    const writes: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() !== "GET" && url.pathname.startsWith("/api/runs"))
        writes.push(`${request.method()} ${url.pathname}`);
    });
    await page.goto("/#/runs/demo-run/activity?demo=play&speed=4&locale=en");
    const badge = page.locator(".workspace-heading .status-badge");
    await expect(badge).toHaveText(status.awaiting_plan, { timeout: 20_000 });
    await page.getByRole("button", { name: workspace.activity.stopTask }).click();
    await expect(badge).toHaveText(status.cancelled);
    // The toast shows the notice; a live region outside it reads it out.
    await expect(page.locator(".toast", { hasText: workspace.notices.demoStopped })).toBeVisible();
    await expect(page.getByRole("button", { name: workspace.activity.stopTask })).toHaveCount(0);
    // Nothing plays on after the stop.
    await page.waitForTimeout(1_500);
    await expect(badge).toHaveText(status.cancelled);
    expect(writes).toEqual([]);
  } finally {
    await context.close();
  }
});
