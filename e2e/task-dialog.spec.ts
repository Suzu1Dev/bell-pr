// The task dialog on a real project: its direction fields stay locked until
// the project's saved settings arrive, and what the person typed meanwhile
// is never taken away by their arrival.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { e2eApiHeaders } from "./api-token.mjs";
import mission from "../src/i18n/en/mission";
import modals from "../src/i18n/en/modals";
import repos from "../src/i18n/en/repos";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const repo = {
  id: "e2e-task-dialog-repo",
  name: "widgets",
  owner: "e2e-sample",
  fullName: "e2e-sample/widgets",
  defaultBranch: "main",
  url: "",
};
const issueUrl = "https://github.com/e2e-sample/widgets/issues/7";

let server: LaunchedServer;
test.beforeAll(async () => {
  server = await launchServer({
    seed: (dataDir) =>
      writeFile(
        path.join(dataDir, "state.json"),
        JSON.stringify({
          version: 1,
          repos: [{ ...repo, path: path.join(dataDir, "repos", "widgets") }],
          runs: [],
        }),
      ),
  });
});
test.afterAll(async () => {
  await server?.stop();
});

test("a link typed the moment the saved settings unlock the form is kept when they arrive", async ({ browser }) => {
  const context = await browser.newContext({
    extraHTTPHeaders: e2eApiHeaders,
    baseURL: server.baseURL,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });
  try {
    const page = await context.newPage();
    // The project's saved settings (3 teammates by default) wait until released.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/api/repos/${repo.id}/settings`, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await held;
      await route.fallback();
    });
    await page.goto(`/#/repos/${repo.id}?locale=en`);
    await page.getByRole("button", { name: repos.explore.chooseDirection }).click();
    const dialog = page.getByRole("dialog", { name: modals.newTask.title });
    const issue = dialog.getByLabel(/Related issue link/);
    await expect(dialog.getByText(modals.newTask.loadingSettings)).toBeVisible();
    await expect(issue).toBeDisabled();
    // Text typed outside the direction fields while they load stays.
    await dialog.locator("#task-prompt").fill("Keep focus on the trigger after the dialog closes.");
    // The person types the link in the same task that unlocks the form,
    // before any effect of that commit could run.
    await page.evaluate((url) => {
      const fieldset = document.querySelector<HTMLFieldSetElement>("fieldset.direction-settings-container")!;
      const observer = new MutationObserver(() => {
        if (fieldset.disabled) return;
        observer.disconnect();
        const input = fieldset.querySelector<HTMLInputElement>('input[id$="-issue"]')!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, url);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      observer.observe(fieldset, { attributes: true, attributeFilter: ["disabled"] });
    }, issueUrl);
    release();
    await expect(issue).toBeEnabled();
    // The saved team size shows, and the link and the goal are still there.
    await expect(dialog.locator(".task-team-preview")).toContainText(modals.newTask.teammates({ count: 3 }));
    await expect(issue).toHaveValue(issueUrl);
    await expect(dialog.locator("#task-prompt")).toHaveValue("Keep focus on the trigger after the dialog closes.");
  } finally {
    await context.close();
  }
});

test("the team size is a plain choice of two, three or four teammates", async ({ browser }) => {
  const context = await browser.newContext({
    extraHTTPHeaders: e2eApiHeaders,
    baseURL: server.baseURL,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });
  try {
    const page = await context.newPage();
    await page.goto(`/#/repos/${repo.id}?locale=en`);
    await page.getByRole("button", { name: repos.explore.chooseDirection }).click();
    const dialog = page.getByRole("dialog", { name: modals.newTask.title });
    const choices = dialog.getByRole("group", { name: mission.settings.team.legend }).locator("label.mission-team-choice");
    await expect(choices).toHaveCount(3);
    for (const [index, count] of [2, 3, 4].entries()) {
      await choices.nth(index).click();
      await expect(choices.nth(index)).toHaveClass(/selected/);
      await expect(dialog.locator(".task-team-preview")).toContainText(modals.newTask.teammates({ count }));
    }
  } finally {
    await context.close();
  }
});
