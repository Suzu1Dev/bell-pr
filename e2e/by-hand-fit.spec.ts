// The task dialog's fitted choice against the real server (DESIGN v1.2
// F12, plan W2D merge-step 4): a folder project whose CONTRIBUTING.rst is
// QEMU's verbatim AI policy (server/fixtures/policy/real), its rules read
// by the server's own reader. The dialog shows the case byHandRulesCase
// gives for those stored rules: "Fit the guide to the project's rules"
// preselected with the carve-out's kinds and quote, the by-hand-fitted
// start reason, and a run created with byHandFit and its help set fixed.
// When the rules change on the server between the dialog's read and
// Start, the server's 409 shows as the dialog's own error. Stand-in codex,
// claude and gh answer only the setup check (e2e/helpers/ready-server.ts).
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { e2eApiHeaders } from "./api-token.mjs";
import { byHandRulesCase, type ByHandRulesCase } from "../shared/by-hand-rules";
import { byHandBlockClause, type ContributionRules } from "../shared/contribution";
import serverByHand from "../server/i18n/en/by-hand";
import discovery from "../src/i18n/en/discovery";
import mission from "../src/i18n/en/mission";
import { helpKindList } from "../src/mission/respect";
import { startReadyServer } from "./helpers/ready-server";
import type { LaunchedServer } from "./start-server.mjs";

const repoId = "6d8c3a41-2e7f-4a01-9c3d-4e5f6a7b8c9d";
const mode = discovery.byHand;
const policyFile = path.join(import.meta.dirname, "..", "server", "fixtures", "policy", "real", "qemu-code-provenance.rst");

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();
const commit = (cwd: string, message: string) =>
  git(cwd, "-c", "user.name=Sample Author", "-c", "user.email=author@example.com", "commit", "-q", "-am", message);

let server: LaunchedServer;
test.beforeAll(async () => {
  server = await startReadyServer({
    async seed(dataDir) {
      // A project imported from a folder, without a GitHub origin: its rules are read from the folder only.
      const checkout = path.join(dataDir, "projects", "emulator");
      await mkdir(checkout, { recursive: true });
      git(checkout, "init", "-q", "-b", "main");
      await writeFile(path.join(checkout, "CONTRIBUTING.rst"), await readFile(policyFile, "utf8"));
      await writeFile(path.join(checkout, "README.md"), "# emulator\n");
      git(checkout, "add", ".");
      commit(checkout, "Start");
      await writeFile(
        path.join(dataDir, "state.json"),
        JSON.stringify({
          version: 1,
          repos: [{ id: repoId, name: "emulator", owner: "local", fullName: "emulator", path: checkout, defaultBranch: "main", url: "" }],
          runs: [],
        }),
      );
    },
  });
});
test.afterAll(async () => {
  await server?.stop();
});

/** The server reads the project's rules again ("Check again") and returns what it stored. */
async function readRules(api: APIRequestContext) {
  const response = await api.post(`/api/repos/${repoId}/contribution-rules/refresh`, { data: {} });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { rules: ContributionRules }).rules;
}

/** Opens the task dialog on the project with Learn by hand chosen and a task written. */
async function openDialog(page: Page) {
  await page.goto("/#/home?locale=en");
  await page.getByRole("button", { name: "New task" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#task-repo").selectOption(repoId);
  await dialog.getByText(mode.hand).click();
  await dialog.locator("#task-prompt").fill("Explain the timer's drift in the device model's comments.");
  return dialog;
}

test("on a QEMU-like project the dialog offers the fitted guide, starts a fitted run, and shows the server's refusal when the rules changed", async ({ browser }) => {
  const context = await browser.newContext({
    extraHTTPHeaders: e2eApiHeaders,
    baseURL: server.baseURL,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  try {
    const rules = await readRules(page.request);
    const rulesCase: ByHandRulesCase = byHandRulesCase(rules, { learningIssue: false, now: new Date().toISOString() });
    // QEMU's rule declines AI-generated content and says research and debugging are fine.
    expect(rulesCase.case).toBe("fitted");
    if (rulesCase.case !== "fitted") return;
    expect(rulesCase.kinds).toEqual(["explain", "answer", "test"]);
    const quote = rulesCase.lock.rules[0].allows[0].quote;
    expect(quote).toContain("researching APIs");
    const fittedLine = mode.fitted({ kinds: helpKindList(rulesCase.kinds, "en"), quote });

    let dialog = await openDialog(page);
    // The fitted choice, preselected, with the case byHandRulesCase gives.
    const fit = dialog.getByRole("radio", { name: mode.fit });
    await expect(fit).toBeChecked();
    await expect(dialog.getByRole("radio", { name: mode.full })).not.toBeChecked();
    await expect(dialog.locator(".mode-fit")).toContainText(fittedLine);
    await dialog.getByRole("button", { name: mode.start }).click();
    // Start asks once with the by-hand-fitted reason.
    const confirm = dialog.locator(".start-confirm");
    await expect(confirm.getByRole("heading", { name: mode.title })).toBeVisible();
    await expect(confirm).toContainText(fittedLine);
    const created = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/runs" && response.request().method() === "POST",
    );
    await confirm.getByRole("button", { name: mission.startConfirm.startAnyway }).click();
    const response = await created;
    expect(response.request().postDataJSON()).toMatchObject({ learnByHand: true, byHandFit: { learningIssue: false } });
    expect(response.status()).toBe(202);
    // The server fixed the same help set when the run started.
    const { run } = (await response.json()) as { run: { id: string; byHand?: { helpLock?: { kinds: string[]; rules: { quote: string }[] } } } };
    expect(run.byHand?.helpLock?.kinds).toEqual(rulesCase.kinds);
    expect(run.byHand?.helpLock?.rules.map((rule) => rule.quote)).toEqual(rulesCase.lock.rules.map((rule) => rule.quote));

    // The dialog reads the rules while they still allow the fitted guide...
    dialog = await openDialog(page);
    await expect(dialog.getByRole("radio", { name: mode.fit })).toBeChecked();
    await dialog.getByRole("button", { name: mode.start }).click();
    await expect(dialog.locator(".start-confirm")).toContainText(fittedLine);
    // ...and the project drops its carve-out before Start (in the copy the server keeps of the
    // folder): the server reads its rules again.
    // The run started above moves this in-place project into that copy in the background
    // (adoptLegacyCheckout); edit the copy only once it is there.
    const repoPath = async () => {
      const { repos } = (await (await page.request.get("/api/repos")).json()) as { repos: { id: string; path: string }[] };
      return repos.find((repo) => repo.id === repoId)!.path;
    };
    await expect.poll(repoPath).toContain(`${path.sep}repositories${path.sep}`);
    const checkout = await repoPath();
    const text = await readFile(path.join(checkout, "CONTRIBUTING.rst"), "utf8");
    await writeFile(
      path.join(checkout, "CONTRIBUTING.rst"),
      text.replace(/\*\*This policy does not apply to other uses of AI[\s\S]*?in contributions\.\*\*/, ""),
    );
    commit(checkout, "Drop the carve-out");
    const changed = await readRules(page.request);
    expect(byHandRulesCase(changed, { learningIssue: false, now: new Date().toISOString() })).toMatchObject({
      case: "blocked",
      reason: "no-carve-out",
    });
    const refused = page.waitForResponse(
      (answer) => new URL(answer.url()).pathname === "/api/runs" && answer.request().method() === "POST",
    );
    await dialog.locator(".start-confirm").getByRole("button", { name: mission.startConfirm.startAnyway }).click();
    expect((await refused).status()).toBe(409);
    // The server's own words show as the dialog's error, and the dialog stays open.
    await expect(dialog.getByRole("alert")).toHaveText(
      serverByHand.fitUnavailable({ reason: byHandBlockClause("no-carve-out", "en") }),
    );
    await expect(dialog.locator("#task-prompt")).toHaveValue("Explain the timer's drift in the device model's comments.");
  } finally {
    await context.close();
  }
});
