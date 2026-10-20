// The task dialog on a real project under Free: its direction fields stay
// locked until the project's saved settings arrive, and the team size Free
// lowers on their arrival never takes away what the person typed.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
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

test("a link typed the moment the saved settings unlock the form is kept when Free lowers the team size", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
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
    // The plan is known before the settings arrive.
    await page.waitForLoadState("networkidle");
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
    // Free lowered the team size, and the link and the goal are still there.
    await expect(dialog.getByText(mission.settings.team.clampNotice({ free: 2, pro: 4 }))).toBeVisible();
    await expect(dialog.locator(".task-team-preview")).toContainText(modals.newTask.teammates({ count: 2 }));
    await expect(issue).toHaveValue(issueUrl);
    await expect(dialog.locator("#task-prompt")).toHaveValue("Keep focus on the trigger after the dialog closes.");
  } finally {
    await context.close();
  }
});
