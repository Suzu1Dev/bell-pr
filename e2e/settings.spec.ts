// The Settings page: every section at its own address, the settings that
// save through the app settings, the data controls, masking while
// presenting, accessibility and text that fits, in both languages.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { e2eApiHeaders } from "./api-token.mjs";
import type { DoctorCheck, DoctorReport } from "../shared/doctor";
import { htmlLang, locales } from "../shared/i18n/locale";
import { providerLabels } from "../shared/models";
import mission from "../src/i18n/en/mission";
import settings from "../src/i18n/en/settings";
import setup from "../src/i18n/en/setup";
import settingsZh from "../src/i18n/zh-TW/settings";
import setupZh from "../src/i18n/zh-TW/setup";
import { settingsSections } from "../src/settings/sections";
import { expectNoOverflow } from "./helpers/overflow";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const panel = (page: Page) => page.locator(".settings-panel");
const sectionTitle = (page: Page) => panel(page).locator("h2");

/** A page on a spec-local server; closed with the server. */
async function openOn(browser: Browser, server: LaunchedServer) {
  const context = await browser.newContext({
    extraHTTPHeaders: e2eApiHeaders,
    baseURL: server.baseURL,
    locale: "en-US",
  });
  return { page: await context.newPage(), close: () => context.close() };
}

/** Runs `fn` with a page on a fresh spec-local server, then stops both. */
async function onServer(
  browser: Browser,
  options: Parameters<typeof launchServer>[0],
  fn: (page: Page, server: LaunchedServer) => Promise<void>,
) {
  const server = await launchServer(options);
  const { page, close } = await openOn(browser, server);
  try {
    await fn(page, server);
  } finally {
    await close();
    await server.stop();
  }
}

/**
 * Serious and critical axe findings in the open dialog, once it has stopped
 * moving: it fades in, and mid-fade axe reads its text lighter than it is.
 * Endless animations (a spinner) are not waited for.
 */
async function dialogProblems(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished),
    ),
  );
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  return results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
}

async function appSettings(page: Page) {
  const response = await page.request.get("/api/app-settings");
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    settings: Record<string, unknown>;
    lockedBy: Record<string, string>;
  };
}

async function modelSettings(page: Page) {
  const response = await page.request.get("/api/model-settings");
  expect(response.ok()).toBe(true);
  return (await response.json()) as { settings: { webAccess?: boolean } };
}

test("each section has its own address; links keep the flags and a reload keeps the section", async ({ page }) => {
  await page.goto("/#/settings");
  await expect(sectionTitle(page)).toHaveText(settings.sections.general);
  await expect(page.locator('.settings-nav a[aria-current="page"]')).toHaveText(
    settings.sections.general,
  );
  await page.goto("/#/settings/no-such-section");
  await expect(sectionTitle(page)).toHaveText(settings.sections.general);

  await page.goto("/#/settings/general?present=1");
  for (const section of settingsSections) {
    await page.locator(`.settings-nav a[data-section="${section}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#/settings/${section}\\?present=1$`));
    await expect(sectionTitle(page)).toHaveText(settings.sections[section]);
    await expect(page.locator(`.settings-nav a[data-section="${section}"]`)).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  await page.reload();
  await expect(sectionTitle(page)).toHaveText(settings.sections.about);
  await expect(page.getByRole("link", { name: settings.about.open })).toHaveAttribute(
    "href",
    "#/about?present=1",
  );
  await page.goBack();
  await expect(sectionTitle(page)).toHaveText(settings.sections.data);
});

test("changing the runs at the same time persists across a reload", async ({ browser }) => {
  await onServer(browser, {}, async (page) => {
    await page.goto("/#/settings/performance");
    const runs = page.getByLabel(settings.performance.maxActiveRuns.label);
    const save = page.getByRole("button", { name: settings.performance.save });
    await expect(runs).toHaveValue("2");
    await expect(save).toBeDisabled();
    // A value out of range is explained and cannot be saved.
    await runs.fill("9");
    await expect(page.getByText(settings.performance.invalidWhole({ min: 1, max: 8 }))).toBeVisible();
    await expect(save).toBeDisabled();
    await runs.fill("3");
    await save.click();
    await expect(page.getByRole("status").filter({ hasText: settings.performance.saved })).toBeVisible();
    await page.reload();
    await expect(runs).toHaveValue("3");
    // Only the changed limit was saved.
    const saved = await appSettings(page);
    expect(saved.settings.maxActiveRuns).toBe(3);
    expect(saved.settings.maxAgentProcesses).toBeUndefined();
    expect(saved.settings.agentTimeoutScale).toBeUndefined();
  });
});

test("a limit an environment variable sets is disabled with a badge, and the others still save", async ({ browser }) => {
  await onServer(browser, { env: { BELLPR_MAX_ACTIVE_RUNS: "2" } }, async (page) => {
    await page.goto("/#/settings/performance");
    const runs = page.getByLabel(settings.performance.maxActiveRuns.label);
    await expect(runs).toBeDisabled();
    await expect(runs).toHaveValue("2");
    const field = panel(page).locator(".settings-number").filter({ has: runs });
    await expect(field.locator(".settings-lock-badge")).toHaveText(settings.lock.badge);
    await expect(field).toContainText(settings.lock.hint({ variable: "BELLPR_MAX_ACTIVE_RUNS" }));
    // The server refuses any locked setting, so the form leaves it out.
    const processes = page.getByLabel(settings.performance.maxAgentProcesses.label);
    await processes.fill("4");
    await page.getByRole("button", { name: settings.performance.save }).click();
    await expect(page.getByRole("status").filter({ hasText: settings.performance.saved })).toBeVisible();
    const saved = await appSettings(page);
    expect(saved.lockedBy.maxActiveRuns).toBe("BELLPR_MAX_ACTIVE_RUNS");
    expect(saved.settings.maxAgentProcesses).toBe(4);
  });
});

test("turning on unsandboxed agents needs a confirmation that explains the risk", async ({ browser }) => {
  await onServer(browser, {}, async (page) => {
    await page.goto("/#/settings/safety");
    const toggle = page.getByRole("checkbox", { name: settings.safety.unsandboxed.label });
    const dialog = page.getByRole("dialog", { name: settings.safety.unsandboxed.confirmTitle });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(settings.safety.unsandboxed.confirmText);
    await expect(dialog).toContainText(settings.safety.unsandboxed.confirmBadge);
    await expect(toggle).not.toBeChecked();
    expect(await dialogProblems(page)).toEqual([]);

    // Keeping the sandbox changes nothing.
    await dialog.getByRole("button", { name: settings.safety.unsandboxed.cancel }).click();
    await expect(dialog).toHaveCount(0);
    await expect(toggle).not.toBeChecked();
    expect((await appSettings(page)).settings.allowUnsandboxedAgents).toBeUndefined();

    await toggle.click();
    await dialog.getByRole("button", { name: settings.safety.unsandboxed.confirm }).click();
    await expect(dialog).toHaveCount(0);
    await expect(toggle).toBeChecked();
    expect((await appSettings(page)).settings.allowUnsandboxedAgents).toBe(true);

    // Turning it off again needs no confirmation.
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(dialog).toHaveCount(0);
    expect((await appSettings(page)).settings.allowUnsandboxedAgents).toBe(false);

    // The AI-assistance note is a plain opt-in.
    const note = page.getByRole("checkbox", { name: settings.safety.disclose.label });
    await note.click();
    await expect(note).toBeChecked();
    expect((await appSettings(page)).settings.alwaysDiscloseAi).toBe(true);
  });
});

test("turning the understanding check off needs a confirmation that keeps the check by default", async ({ browser }) => {
  await onServer(browser, {}, async (page) => {
    const t = settings.learning.check;
    await page.goto("/#/settings/learning");
    await expect(sectionTitle(page)).toHaveText(settings.sections.learning);
    const toggle = page.getByRole("checkbox", { name: t.label });
    const dialog = page.getByRole("dialog", { name: t.confirmTitle });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeChecked();
    await expect(panel(page).locator(".settings-lock-badge")).toHaveCount(0);

    await toggle.click();
    await expect(dialog).toBeVisible();
    for (const sentence of [t.confirmLost, t.confirmKept, t.confirmRecorded, t.confirmBack])
      await expect(dialog).toContainText(sentence);
    // Keeping the check is the default: its button has the focus.
    const keep = dialog.getByRole("button", { name: t.keep });
    await expect(keep).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(t.keep);
    expect(await dialogProblems(page)).toEqual([]);

    // Escape keeps the check and saves nothing.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeFocused();
    expect((await appSettings(page)).settings.skipUnderstandingCheck).toBeUndefined();

    // So does Keep the check.
    await toggle.click();
    await keep.click();
    await expect(dialog).toHaveCount(0);
    await expect(toggle).toBeChecked();
    expect((await appSettings(page)).settings.skipUnderstandingCheck).toBeUndefined();

    // Turn it off saves it.
    await toggle.click();
    await dialog.getByRole("button", { name: t.turnOff }).click();
    await expect(dialog).toHaveCount(0);
    await expect(toggle).not.toBeChecked();
    expect((await appSettings(page)).settings.skipUnderstandingCheck).toBe(true);
    await page.reload();
    await expect(toggle).not.toBeChecked();

    // Turning it back on needs no confirmation.
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(dialog).toHaveCount(0);
    expect((await appSettings(page)).settings.skipUnderstandingCheck).toBe(false);

    // The try-first prompts are a plain switch, on by default.
    const tryFirst = page.getByRole("checkbox", { name: settings.learning.tryFirst.label });
    await expect(tryFirst).toBeChecked();
    await tryFirst.click();
    await expect(tryFirst).not.toBeChecked();
    await expect(dialog).toHaveCount(0);
    expect((await appSettings(page)).settings.hideTryFirst).toBe(true);
    await tryFirst.click();
    await expect(tryFirst).toBeChecked();
    expect((await appSettings(page)).settings.hideTryFirst).toBe(false);
  });
});

test("BELLPR_REQUIRE_UNDERSTANDING_CHECK=1 keeps the check on and read-only, and names the variable", async ({ browser }) => {
  const variable = "BELLPR_REQUIRE_UNDERSTANDING_CHECK";
  await onServer(browser, { env: { [variable]: "1" } }, async (page) => {
    await page.goto("/#/settings/learning");
    const toggle = page.getByRole("checkbox", { name: settings.learning.check.label });
    await expect(toggle).toBeDisabled();
    await expect(toggle).toBeChecked();
    const field = panel(page).locator(".settings-switch").filter({ has: toggle });
    await expect(field.locator(".settings-lock-badge")).toHaveText(settings.lock.badge);
    await expect(field).toContainText(settings.learning.check.lockedBy({ variable }));
    await toggle.click({ force: true });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(toggle).toBeChecked();
    const saved = await appSettings(page);
    expect(saved.lockedBy.skipUnderstandingCheck).toBe(variable);
    expect(saved.settings.skipUnderstandingCheck).not.toBe(true);
    // The try-first prompts stay the person's choice.
    await expect(page.getByRole("checkbox", { name: settings.learning.tryFirst.label })).toBeEnabled();
  });
});

test("BELLPR_REQUIRE_UNDERSTANDING_CHECK=0 locks nothing", async ({ browser }) => {
  await onServer(browser, { env: { BELLPR_REQUIRE_UNDERSTANDING_CHECK: "0" } }, async (page) => {
    await page.goto("/#/settings/learning");
    const toggle = page.getByRole("checkbox", { name: settings.learning.check.label });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeChecked();
    await expect(panel(page).locator(".settings-lock-badge")).toHaveCount(0);
    expect((await appSettings(page)).lockedBy.skipUnderstandingCheck).toBeUndefined();
    // The off-switch works as without the variable.
    await toggle.click();
    await page
      .getByRole("dialog", { name: settings.learning.check.confirmTitle })
      .getByRole("button", { name: settings.learning.check.turnOff })
      .click();
    await expect(toggle).not.toBeChecked();
    expect((await appSettings(page)).settings.skipUnderstandingCheck).toBe(true);
  });
});

test("General shows the sample project and resets its progress", async ({ page }) => {
  await page.goto("/#/settings/general");
  // Progress in the sample: every file reviewed and the draft approved.
  await page.evaluate(() => {
    localStorage.setItem(
      "bellpr-demo-run:en",
      JSON.stringify({ id: "demo-run", reviewedFiles: ["src/client.ts"], status: "approved" }),
    );
    localStorage.setItem("bellpr-demo-settings:zh-TW", JSON.stringify({ maxTeammates: 2 }));
    localStorage.setItem("bellpr-sidebar-collapsed", "false");
  });
  const reset = page.getByRole("button", { name: settings.general.sample.reset });
  await reset.click();
  await expect(reset).toHaveAttribute("aria-expanded", "true");
  await expect(panel(page)).toContainText(settings.general.sample.resetConfirm);
  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: settings.general.sample.resetYes }).click();
  await reloaded;
  await expect(sectionTitle(page)).toHaveText(settings.sections.general);
  // The app may store the sample again as it opens, but from the start.
  const [run, directions, sidebar] = await page.evaluate(() => [
    localStorage.getItem("bellpr-demo-run:en"),
    localStorage.getItem("bellpr-demo-settings:zh-TW"),
    localStorage.getItem("bellpr-sidebar-collapsed"),
  ]);
  if (run) {
    const saved = JSON.parse(run) as { reviewedFiles?: string[]; status?: string };
    expect(saved.reviewedFiles ?? []).toEqual([]);
    expect(saved.status).not.toBe("approved");
  }
  expect(directions).toBeNull();
  expect(sidebar).toBe("false");
});

test("the sample project switch saves showSampleProject", async ({ browser }) => {
  await onServer(browser, {}, async (page) => {
    await page.goto("/#/settings/general");
    const show = page.getByRole("checkbox", { name: settings.general.sample.show });
    await expect(show).toBeEnabled();
    await expect(show).not.toBeChecked();
    await show.click();
    await expect(show).toBeChecked();
    expect((await appSettings(page)).settings.showSampleProject).toBe(true);
    await page.reload();
    await expect(show).toBeChecked();
  });
});

test("the retention period saves and survives a reload", async ({ browser }) => {
  await onServer(browser, {}, async (page) => {
    await page.goto("/#/settings/data");
    const days = page.getByLabel(settings.data.retention.label);
    await expect(days).toHaveValue("14");
    await days.fill("30");
    await panel(page).getByRole("button", { name: settings.data.retention.save, exact: true }).click();
    await expect(panel(page).getByRole("status").filter({ hasText: settings.state.saved })).toBeVisible();
    await page.reload();
    await expect(days).toHaveValue("30");
    expect((await appSettings(page)).settings.retentionDays).toBe(30);
  });
});

test("the shared models are edited in place in the AI provider section", async ({ browser }) => {
  await onServer(browser, {}, async (page) => {
    // Only the Codex CLI works; the environment check reads the saved
    // provider, as the server's does.
    let chosen = "codex";
    const notReady = "Claude Code is chosen in the model settings but is not ready.";
    page.on("request", (request) => {
      if (request.method() === "PUT" && new URL(request.url()).pathname === "/api/model-settings")
        chosen = (request.postDataJSON() as { provider: string }).provider;
    });
    await page.route("**/api/doctor**", (route) => {
      const report = stubbedReport();
      report.checks = report.checks.map((value) =>
        value.id === "claude"
          ? { id: "claude", status: "skip", reason: "missing", required: false }
          : value.id === "claude-auth"
            ? { id: "claude-auth", status: "skip", required: false }
            : value.id === "provider-ready" && chosen === "claude"
              ? { ...value, status: "fail", reason: "chosen-not-ready", detail: notReady }
              : value,
      );
      return route.fulfill({ json: report });
    });
    await page.goto("/#/settings/provider");
    await expect(panel(page)).toContainText(settings.provider.readyWith({ providers: [providerLabels.codex] }));
    const agent = panel(page).getByLabel(mission.settings.model.agent, { exact: true });
    await expect(agent).toHaveValue("codex");
    await agent.selectOption("claude");
    await panel(page).getByRole("button", { name: settings.provider.models.save }).click();
    await expect(
      panel(page).getByRole("status").filter({ hasText: settings.provider.models.saved }),
    ).toBeVisible();
    // The readiness line follows the saved provider at once.
    await expect(panel(page).locator(".settings-readiness")).toHaveText(notReady);
    await page.reload();
    await expect(agent).toHaveValue("claude");
    const saved = await (await page.request.get("/api/model-settings")).json();
    expect(saved.settings.provider).toBe("claude");
    // No dialog is involved.
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test("web access for agents is off until the person turns it on in the AI provider section", async ({ browser }) => {
  await onServer(browser, {}, async (page) => {
    await page.goto("/#/settings/provider");
    const web = panel(page).getByRole("checkbox", { name: mission.settings.model.webAccess });
    await expect(web).toBeEnabled();
    await expect(web).not.toBeChecked();
    expect((await modelSettings(page)).settings.webAccess).not.toBe(true);
    await web.check();
    await panel(page).getByRole("button", { name: settings.provider.models.save }).click();
    await expect(
      panel(page).getByRole("status").filter({ hasText: settings.provider.models.saved }),
    ).toBeVisible();
    await page.reload();
    await expect(web).toBeChecked();
    expect((await modelSettings(page)).settings.webAccess).toBe(true);
  });
});

test("Re-check probes the environment again", async ({ page }) => {
  await page.goto("/#/settings/environment");
  const recheck = panel(page).getByRole("button", { name: setup.checklist.recheck });
  await expect(recheck).toBeEnabled();
  const probe = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/doctor" && url.searchParams.get("refresh") === "1";
  });
  await recheck.click();
  await probe;
  await expect(recheck).toBeEnabled();
});

test("only the environment section probes again, and its Re-check updates the readiness pill", async ({ page }) => {
  await page.clock.install();
  // No AI provider is ready until `fixed`; then every check passes.
  let fixed = false;
  let forced = 0;
  await page.route("**/api/doctor**", (route) => {
    if (new URL(route.request().url()).searchParams.get("refresh") === "1") forced++;
    const report = stubbedReport();
    if (!fixed)
      report.checks = report.checks.map((value) =>
        value.id === "provider-ready" ? { ...value, status: "fail" } : value,
      );
    return route.fulfill({ json: report });
  });
  /** Every request the page sent so far has been seen once this answers. */
  const answered = () => page.evaluate(() => fetch("/api/health").then(() => undefined));

  await page.goto("/#/settings/general");
  await expect(page.locator(".readiness-not-ready")).toBeVisible();
  await page.clock.runFor(16_000);
  await answered();
  expect(forced).toBe(0);

  await page.locator('.settings-nav a[data-section="environment"]').click();
  await expect(sectionTitle(page)).toHaveText(settings.sections.environment);
  await page.clock.runFor(6_000);
  await expect.poll(() => forced).toBeGreaterThan(0);
  fixed = true;
  await panel(page).getByRole("button", { name: setup.checklist.recheck }).click();
  await expect(page.locator(".readiness-ready")).toBeVisible();
  await expect(page.locator(".readiness-not-ready")).toHaveCount(0);
});

test("Measure again walks the data directory again instead of reading the cached report", async ({ page }) => {
  await page.goto("/#/settings/data");
  const again = panel(page).getByRole("button", { name: settings.data.storage.refresh });
  await expect(again).toBeEnabled();
  const measured = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/storage" && url.searchParams.get("refresh") === "1";
  });
  await again.click();
  expect((await measured).ok()).toBe(true);
  await expect(again).toBeEnabled();
});

test("the storage lists a published run apart and frees it after a confirmation; Delete all data needs ERASE", async ({ browser }) => {
  const runId = "e2e-published-run";
  const seed = async (dataDir: string) => {
    const worktree = path.join(dataDir, "worktrees", runId);
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(worktree, "README.md"), "x".repeat(64 * 1024));
    await writeFile(
      path.join(dataDir, "state.json"),
      JSON.stringify({
        version: 1,
        repos: [
          {
            id: "e2e-repo",
            name: "seeded",
            owner: "e2e-sample",
            fullName: "e2e-sample/seeded",
            path: path.join(dataDir, "repositories", "seeded"),
            defaultBranch: "main",
            url: "",
          },
        ],
        runs: [
          {
            id: runId,
            repoId: "e2e-repo",
            title: "Published contribution",
            prompt: "A published run with its checkout kept.",
            status: "published",
            branch: "fix/e2e-published",
            baseBranch: "main",
            baseSha: "",
            createdAt: "2026-10-01T08:00:00.000Z",
            agents: [],
            logs: [],
            draft: { title: "Published contribution", body: "" },
            reviewedFiles: [],
            reviewedFingerprints: {},
            reports: {},
            worktreePath: worktree,
          },
        ],
      }),
    );
  };
  await onServer(browser, { seed }, async (page) => {
    await page.goto("/#/settings/data");
    const storage = panel(page).locator(".settings-storage");
    await expect(storage.getByRole("heading", { name: settings.data.storage.published })).toBeVisible();
    await expect(storage).toContainText(settings.data.storage.publishedHelp);
    const row = storage.locator(`[data-run="${runId}"]`);
    await expect(row).toContainText("Published contribution");
    await row.getByRole("button", { name: settings.data.storage.freeLabel({ title: "Published contribution" }) }).click();
    await expect(row).toContainText(settings.data.storage.confirmPublished);
    await row.getByRole("button", { name: settings.data.storage.free, exact: true }).click();
    await expect(storage.getByRole("status").filter({ hasText: /^Freed / })).toBeVisible();
    await expect(storage.locator(`[data-run="${runId}"]`)).toHaveCount(0);
    await expect(storage).toContainText(settings.data.storage.noRuns);

    // Deleting everything waits for the exact word.
    await panel(page).getByRole("button", { name: settings.data.erase.open }).click();
    const erase = panel(page).getByRole("button", { name: settings.data.erase.button, exact: true });
    const confirm = panel(page).getByLabel(settings.data.erase.label);
    await expect(erase).toBeDisabled();
    await confirm.fill("erase");
    await expect(erase).toBeDisabled();
    await confirm.fill("ERAS");
    await expect(erase).toBeDisabled();
    await confirm.fill("ERASE");
    await expect(erase).toBeEnabled();
    const reloaded = page.waitForEvent("load");
    await erase.click();
    await expect(page.getByRole("status").filter({ hasText: settings.data.erase.done })).toBeVisible();
    await reloaded;
    const runs = await (await page.request.get("/api/runs")).json();
    const repos = await (await page.request.get("/api/repos")).json();
    expect(runs.runs).toEqual([]);
    expect(repos.repos).toEqual([]);
  });
});

// Presentation masking: the server's answers carry a real-looking login,
// account and data directory; none of them may reach the screen.
const secrets = {
  login: "real-user",
  email: "real.person@example.com",
};
const forbidden = [...Object.values(secrets), "/home/", "/Users/", "/tmp/"];

function stubbedReport(): DoctorReport {
  const check = (value: Partial<DoctorCheck> & Pick<DoctorCheck, "id">): DoctorCheck => ({
    status: "ok",
    required: false,
    ...value,
  });
  return {
    checkedAt: new Date().toISOString(),
    platform: "linux",
    ready: true,
    checks: [
      check({ id: "node", required: true, version: "v22.22.1" }),
      check({ id: "git", required: true, version: "2.45.1" }),
      check({ id: "git-identity", detail: `Real Person <${secrets.email}>` }),
      check({ id: "gh", version: "2.46.0" }),
      check({ id: "gh-auth", detail: secrets.login, params: { login: secrets.login } }),
      check({ id: "gh-scopes", detail: "repo, workflow" }),
      check({ id: "codex", version: "0.159.0" }),
      check({ id: "codex-auth", detail: `Signed in as ${secrets.email}` }),
      check({ id: "claude", version: "2.1.292" }),
      check({ id: "claude-auth", detail: `${secrets.email} (Claude Max)` }),
      check({ id: "claude-sandbox", detail: "Available." }),
      check({
        id: "provider-ready",
        required: true,
        detail: "Ready: Codex, Claude Code.",
        params: { providers: "codex,claude" },
      }),
      check({
        id: "data-dir",
        required: true,
        detail: "Writable.",
        params: { path: `/tmp/bellpr-${secrets.login}/data`, freeBytes: 20 * 1024 ** 3 },
      }),
      check({ id: "app", version: "1.0.0" }),
      check({ id: "platform", detail: "linux x64" }),
    ],
  };
}

async function stubPersonalAnswers(page: Page) {
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, github: true, githubUser: secrets.login },
    });
  });
  await page.route("**/api/doctor**", (route) => route.fulfill({ json: stubbedReport() }));
}

/** What a section says while something still loads, in both languages. */
const loadingTexts = [settings, settingsZh].flatMap((t) => [
  t.state.loading,
  t.status.checking,
  t.provider.models.loading,
  t.data.storage.loading,
]);
const checkingTexts = [setup, setupZh].map((t) => t.checklist.checking);

/** Waits until the section shows what it loads. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  for (const text of [...loadingTexts, ...checkingTexts])
    await expect(
      panel(page).locator('[role="status"]').filter({ hasText: text }),
    ).toHaveCount(0);
}

test("while presenting, no section shows the login, an account or a full path", async ({ page }) => {
  await stubPersonalAnswers(page);
  // Without present=1 the stubbed values do show, so the stubs are in use.
  await page.goto("/#/settings/environment");
  await settle(page);
  await expect(panel(page)).toContainText(settings.environment.github.connectedAs({ user: secrets.login }));

  for (const section of settingsSections) {
    await page.goto(`/#/settings/${section}?present=1`);
    await expect(sectionTitle(page)).toHaveText(settings.sections[section]);
    await settle(page);
    const text = await page.locator(".settings-page").innerText();
    for (const value of forbidden)
      expect(text, `${section} shows ${value}`).not.toContain(value);
  }
  await page.goto("/#/settings/environment?present=1");
  await settle(page);
  await expect(panel(page)).toContainText(settings.environment.github.connectedAs({ user: "you" }));
  await page.goto("/#/settings/data?present=1");
  await settle(page);
  await expect(panel(page).locator(".settings-data-dir code")).toHaveText("…/data");
});

for (const locale of locales)
  for (const width of [1440, 390])
    for (const section of settingsSections)
      test(`${section} has no serious or critical issue and its text fits (${locale}, ${width} px)`, async ({ page }) => {
        await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
        await page.goto(`/#/settings/${section}?locale=${locale}`);
        await expect(page.locator("html")).toHaveAttribute("lang", htmlLang(locale));
        await settle(page);
        await page.evaluate(() => document.fonts.ready);
        // Let transitions settle before colors are read.
        await page.waitForTimeout(300);
        const results = await new AxeBuilder({ page })
          .options({ rules: { "color-contrast": { enabled: true } } })
          .analyze();
        const problems = results.violations
          .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
          .flatMap((violation) =>
            violation.nodes.map(
              (node) => `${violation.id} (${violation.impact}) at ${node.target.join(" ")}\n  ${node.html}\n  ${node.failureSummary ?? ""}`,
            ),
          );
        expect(problems, `axe found ${problems.length} issue(s):\n${problems.join("\n")}`).toEqual([]);
        await expectNoOverflow(page, [".settings-page"]);
        // No horizontal scrolling of the page itself.
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
      });
