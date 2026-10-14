// The filmable sample story: demo=play plays the sample contribution from
// queued to a published sample PR, on a server that has no agent CLI and
// no GitHub CLI at all. Every step stays in the browser.
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { getDemo } from "../src/demo";
import common from "../src/i18n/en/common";
import review from "../src/i18n/en/review";
import team from "../src/i18n/en/team";
import workspace from "../src/i18n/en/workspace";
import { assertNoHan } from "../src/test-utils/render";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const demo = getDemo("en");
const status = common.runStatus;

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

    // The reader reviews every file of the finished run.
    await page.locator("#workspace-tab-changes").click();
    for (const file of demo.files) {
      await page.locator(`.file-item[title="${file.path}"]`).click();
      const reviewed = page.getByRole("checkbox", { name: review.diff.reviewed });
      await reviewed.check();
      await expect(reviewed).toBeChecked();
    }
    await page.getByRole("button", { name: workspace.footer.approvePr }).click();
    await expect(badge).toHaveText(status.approved);
    const dialog = page.getByRole("dialog", { name: workspace.publish.titleDemo });
    await expect(dialog).toBeVisible();
    // The demo previews the PR body it would send.
    await expect(dialog.locator(".publish-body-preview")).toBeVisible();
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
