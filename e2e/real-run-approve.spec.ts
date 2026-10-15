// A real (not sample) run approved entirely through the UI: the reviewed
// ticks, a weakened test assertion with its written reason, the
// Explain-it-back check in the closed-book panel, then approval opens the
// publish dialog with no unexpected block. The server is spec-local, with
// fake codex, claude and gh first on PATH (gh fails, so the GitHub facts
// are "Couldn't check", a confirm and never a pass).
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Response } from "@playwright/test";
import type { DraftCheck } from "../shared/draft-checks";
import draft from "../src/i18n/en/draft";
import review from "../src/i18n/en/review";
import workspace from "../src/i18n/en/workspace";
import { launchServer } from "./start-server.mjs";

const runId = "e2e-real-approve-run";
const repoId = "e2e-real-approve-repo";
const source = "src/greeting.ts";
const savedDraft = {
  title: "Greet the whole world",
  body: "## Summary\n\nThe greeting now says hello to the whole world.\n\n## Testing\n\nRan the greeting test.",
};
const testFile = "test/greeting.test.ts";
const testBody = (assertion: string) =>
  [
    'import { expect, test } from "vitest";',
    'import { greeting } from "../src/greeting";',
    "",
    'test("greets", () => {',
    `  ${assertion}`,
    "});",
    "",
  ].join("\n");

/**
 * A checkout whose working tree changes the greeting and loosens its test's
 * assertion (toBe → toBeDefined), and state.json with the run in review on
 * a GitHub project.
 */
async function seed(dataDir: string) {
  const checkout = path.join(dataDir, "checkouts", "widgets");
  await mkdir(path.join(checkout, "src"), { recursive: true });
  await mkdir(path.join(checkout, "test"), { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: checkout,
      encoding: "utf8",
      // The person's own Git settings (signing, hooks) stay out of it.
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Sample Author");
  git("config", "user.email", "author@example.com");
  await writeFile(path.join(checkout, source), 'export const greeting = "hello";\n');
  await writeFile(path.join(checkout, testFile), testBody('expect(greeting).toBe("hello");'));
  git("add", ".");
  git("commit", "-q", "-m", "Add the greeting and its test");
  const baseSha = git("rev-parse", "HEAD");
  await writeFile(path.join(checkout, source), 'export const greeting = "Hello, world";\n');
  await writeFile(path.join(checkout, testFile), testBody("expect(greeting).toBeDefined();"));
  const now = new Date().toISOString();
  await writeFile(
    path.join(dataDir, "state.json"),
    JSON.stringify({
      version: 1,
      repos: [
        {
          id: repoId,
          name: "widgets",
          owner: "e2e-sample",
          fullName: "e2e-sample/widgets",
          path: checkout,
          defaultBranch: "main",
          url: "https://github.com/e2e-sample/widgets",
        },
      ],
      runs: [
        {
          id: runId,
          repoId,
          title: "Greet the whole world",
          prompt: "Make the greeting friendlier.",
          status: "review",
          branch: "fix/greet",
          baseBranch: "main",
          baseSha,
          worktreePath: checkout,
          createdAt: now,
          agents: [],
          logs: [],
          draft: savedDraft,
          reviewedFiles: [],
          reviewedFingerprints: {},
          reports: {},
        },
      ],
    }),
  );
}

test("a seeded real run is approved through the UI and the publish dialog opens with no unexpected block", async ({ browser }) => {
  const server = await launchServer({ seed });
  const context = await browser.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  try {
    await page.goto(`/#/runs/${runId}/changes?locale=en`);
    await expect(page.locator(".workspace-heading h1")).toHaveText("Greet the whole world");

    // 1. Every file reviewed; the server records each tick.
    for (const file of [source, testFile]) {
      await page.locator(`.file-item[title="${file}"]`).click();
      const reviewed = page.getByRole("checkbox", { name: review.diff.reviewed });
      await reviewed.click();
      await expect(reviewed).toBeChecked();
    }
    await expect(page.locator(".file-item .file-reviewed")).toHaveCount(2);
    // Every file is reviewed, yet the server refuses approval until the
    // change is explained back.
    const early = await page.request.post(`/api/runs/${runId}/approve`, { data: { draft: savedDraft } });
    expect(early.status()).toBe(409);
    expect(((await early.json()) as { code?: string }).code).toBe("understanding_check_required");

    // 2. The loosened assertion is a weakened test, which blocks publishing
    // until its reason is written in the Draft tab's reviewability snapshot
    // and saved on the run.
    const before = (await (await page.request.get(`/api/runs/${runId}/preflight`)).json()) as {
      checks: DraftCheck[];
    };
    expect(before.checks.filter((item) => item.kind === "block").map((item) => item.id)).toEqual([
      "tests-weakened",
    ]);
    await page.locator("#workspace-tab-draft").click();
    const weakened = page.locator(".reviewability-weakened");
    await expect(weakened.locator(".reviewability-weakened-text")).toHaveText(
      'expect(greeting).toBe("hello");',
    );
    await weakened
      .getByRole("textbox", { name: draft.reviewability.reason })
      .fill("The greeting text is product copy that changes often, so the test only checks it exists.");
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/runs/${runId}/test-reasons`) &&
        response.request().method() === "PUT",
    );
    await weakened.getByRole("button", { name: draft.reviewability.save }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.locator(".reviewability-saved")).toBeVisible();

    // 3. Explain it back in the closed-book panel: four changed lines ask
    // no file question, only what was not tested.
    await page.locator("#workspace-tab-changes").click();
    const check = workspace.check;
    await page.getByRole("button", { name: workspace.footer.explainBack }).click();
    const panel = page.locator(".understanding-check");
    await expect(page.locator(".explain-panel")).toHaveCount(0);
    await panel
      .getByRole("textbox", { name: check.explainPrompt })
      .fill(
        "The greeting was a bare hello, so it now greets the whole world. The test only checks that a greeting exists, so new wording cannot break it, but a missing greeting would.",
      );
    const answers = panel.getByRole("region", { name: check.answerTitle }).getByRole("listitem");
    await expect(answers).toHaveCount(1);
    await answers.getByRole("textbox").fill("I did not run the greeting in a terminal.");
    await panel.getByRole("radio", { name: check.confidences.sure }).check();
    await panel.getByRole("button", { name: check.lock }).click();
    await expect(panel.getByRole("region", { name: check.resultTitle })).toContainText(
      check.result({ questions: 1, misses: 0 }),
    );
    const footer = page.locator(".review-footer");
    await expect(footer).toContainText(workspace.footer.passed);

    // 4. Approve: the publish dialog opens and reads the GitHub facts (the
    // fake gh fails), then the server's checks, which the preflight route
    // answers from the stored facts without calling GitHub again.
    const factsRead = page.waitForResponse(
      (response: Response) =>
        new URL(response.url()).pathname === `/api/runs/${runId}/contribution-facts/refresh`,
    );
    await footer.getByRole("button", { name: workspace.footer.approvePr }).click();
    const dialog = page.getByRole("dialog", { name: workspace.publish.title });
    await expect(dialog).toBeVisible();
    expect((await factsRead).status()).toBe(200);
    await expect(dialog.getByText(workspace.publish.factsLoading)).toHaveCount(0);
    const { checks } = (await (await page.request.get(`/api/runs/${runId}/preflight`)).json()) as {
      checks: DraftCheck[];
    };
    // No block: the weakened test has its reason, and the check passed.
    expect(checks.filter((item) => item.kind === "block").map((item) => item.id)).toEqual([]);
    // What is left is the unread facts, a confirm and never a pass.
    expect(checks.map((item) => item.id)).toEqual(["facts-unknown"]);
    await expect(dialog.locator(".publish-block")).toHaveCount(0);
    await expect(dialog.getByText(workspace.publish.allClear)).toHaveCount(0);
    await expect(dialog.locator("legend", { hasText: workspace.publish.groups.unknown })).toBeVisible();

    // The run is approved with a passed check and its reason kept.
    const stored = await page.request.get(`/api/runs/${runId}`);
    const { run } = (await stored.json()) as {
      run: {
        status: string;
        understandingCheckOff?: boolean;
        reviewability?: { testReasons?: Record<string, string> };
      };
    };
    expect(run.status).toBe("approved");
    expect(run.understandingCheckOff).not.toBe(true);
    expect(Object.keys(run.reviewability?.testReasons ?? {})).toEqual([`${testFile}#-5`]);
  } finally {
    await context.close();
    await server.stop();
  }
});
