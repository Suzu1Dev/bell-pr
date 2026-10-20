// Learn by hand's writing UI on a spec-local server with seeded runs: the
// person's plan with the outline folded, the guide's panel with its thread
// and Tests card, the Ready dialog and the footer, a diff read when the
// window comes back, a run fitted to a project's rules, the task dialog's
// mode choice on a banning project, and discovery's cards. The guide,
// plan, test and Ready routes are W1A stubs in this build (501), so a
// request shows the server's own message; the real flow through them is
// W3B's real-run e2e. Stand-in codex, claude and gh answer only the setup
// check (e2e/helpers/ready-server.ts), so no agent runs and nothing reaches
// GitHub.
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { changeFingerprint } from "../shared/change-fingerprint";
import type { DiscoveryJob } from "../shared/discovery";
import type { Locale } from "../shared/i18n/locale";
import { readDiff } from "../server/git";
import byHandText from "../src/byhand/write/i18n/en";
import byHandZh from "../src/byhand/write/i18n/zh-TW";
import { getSampleDiscoveryJob } from "../src/demo/discovery";
import discovery from "../src/i18n/en/discovery";
import workspace from "../src/i18n/en/workspace";
import { findOverflow } from "./helpers/overflow";
import { startReadyServer } from "./helpers/ready-server";
import type { LaunchedServer } from "./start-server.mjs";

const repoId = "4b6a1e2f-0c5d-4e8f-9a1b-2c3d4e5f6a7b";
const banRepoId = "5c7b2f30-1d6e-4f90-8b2c-3d4e5f6a7b8c";
const runs = { planning: "e2e-by-hand-plan", writing: "e2e-by-hand-write", fitted: "e2e-by-hand-fitted" } as const;
const source = "src/retry.ts";
const at = "2026-10-20T09:00:00.000Z";
const gentoo =
  "It is expressly forbidden to contribute to Gentoo any content that has been created with the assistance of Natural Language Processing artificial intelligence tools.";
const llvm = 'Using AI tools to fix issues labelled as "good first issues" is forbidden.';
const notYet = "This part of Learn by hand is not available in this build yet.";
const t = byHandText;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();

const retryBase = "export const maxRetries = Infinity;\n\nexport function shouldRetry(attempt: number) {\n  return attempt < maxRetries;\n}\n";
const retryAfter = retryBase.replace("Infinity", "3");

/** A project, three Learn-by-hand runs (planning, writing, fitted), and a project whose rules ban AI help. */
async function seed(dataDir: string) {
  const checkout = path.join(dataDir, "projects", "widgets");
  await mkdir(path.join(checkout, "src"), { recursive: true });
  git(checkout, "init", "-q", "-b", "main");
  await writeFile(path.join(checkout, source), retryBase);
  git(checkout, "add", ".");
  git(checkout, "-c", "user.name=Sample Author", "-c", "user.email=author@example.com", "commit", "-q", "-m", "Retry requests");
  const baseSha = git(checkout, "rev-parse", "HEAD");
  const worktree = async (id: string) => {
    const worktreePath = path.join(dataDir, "worktrees", id);
    git(checkout, "worktree", "add", "-q", "-b", `by-hand/${id}`, worktreePath, baseSha);
    await writeFile(path.join(worktreePath, source), retryAfter);
    const files = await readDiff({ worktreePath, baseSha, locale: "en" });
    return { worktreePath, fingerprint: changeFingerprint(files.map((file) => ({ path: file.path, fingerprint: file.fingerprint }))) };
  };
  const writing = await worktree(runs.writing);
  const fitted = await worktree(runs.fitted);
  const banCheckout = path.join(dataDir, "projects", "tools");
  await mkdir(banCheckout, { recursive: true });
  git(banCheckout, "init", "-q", "-b", "main");
  await writeFile(path.join(banCheckout, "README.md"), "# tools\n");
  git(banCheckout, "add", ".");
  git(banCheckout, "-c", "user.name=Sample Author", "-c", "user.email=author@example.com", "commit", "-q", "-m", "Start");

  const steps = [
    { id: "s1", title: "Find where retries are counted", doneAt: at },
    // R3 was given on this step: marking it done asks why the change works.
    { id: "s2", title: "Cap the retries at three", files: [source], maxRung: 3 },
  ];
  const testRun = (fingerprint: string) => ({
    at,
    command: "npm test",
    changeFingerprint: fingerprint,
    outcome: "failed",
    exitCode: 1,
    ms: 1200,
    prediction: "fail",
    outputTail: "1 failing: retries forever",
  });
  const run = (id: string, status: string, phase: string, extra: Record<string, unknown>) => ({
    id,
    repoId,
    title: "Cap the retries",
    prompt: "Cap the retries at three so a timeout can't loop forever.",
    status,
    branch: `by-hand/${id}`,
    baseBranch: "main",
    baseSha,
    worktreePath: checkout,
    createdAt: at,
    locale: "en",
    agents: [{ id: "lead", name: "Lead", role: "lead", status: "complete", detail: "" }],
    logs: [],
    draft: { title: "", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
    contributionSettings: {
      direction: "bugfix",
      targetUser: "",
      outcome: "",
      constraints: "",
      acceptance: "",
      maxTeammates: 2,
      requirePlanApproval: true,
      ponytailMode: "lite",
      model: "",
      reasoningEffort: "",
    },
    team: {
      config: { maxTeammates: 2, requirePlanApproval: true, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
      phase,
      planSummary: "Requests retry forever after a timeout.",
      tasks: [],
      messages: [],
    },
    learnByHand: true,
    ...extra,
  });
  const guidePlan = {
    summary: "Requests retry forever after a timeout, so one slow server stalls every caller.",
    steps: [{ title: "Read the retry loop", files: [source] }, { title: "Bound the attempts", files: [source] }],
    readFirst: [{ path: source, startLine: 3, endLine: 5, why: "Where the attempt is compared with the limit." }],
    at,
  };
  const lock = {
    kinds: ["explain", "answer", "test"],
    at,
    rulesCheckedAt: at,
    rules: [
      {
        kind: "ban",
        path: "docs/devel/code-provenance.rst",
        line: 12,
        quote: "Current project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.",
        allows: [{ line: 20, quote: "This policy does not apply to other uses of AI, such as researching APIs or algorithms, or debugging.", kinds: ["explain", "answer", "test"] }],
      },
    ],
  };
  await writeFile(
    path.join(dataDir, "state.json"),
    JSON.stringify({
      version: 1,
      repos: [
        { id: repoId, name: "widgets", owner: "e2e-sample", fullName: "e2e-sample/widgets", path: checkout, defaultBranch: "main", url: "https://github.com/e2e-sample/widgets" },
        {
          id: banRepoId,
          name: "tools",
          owner: "e2e-gentoo",
          fullName: "e2e-gentoo/tools",
          path: banCheckout,
          defaultBranch: "main",
          url: "https://github.com/e2e-gentoo/tools",
          contributionRules: {
            checkedAt: at,
            findings: [{ kind: "ban", path: "CONTRIBUTING.md", line: 3, quote: gentoo, contribution: true }],
            filesRead: ["CONTRIBUTING.md"],
          },
        },
      ],
      runs: [
        run(runs.planning, "awaiting_plan", "awaiting_approval", { byHand: { guidePlan } }),
        run(runs.writing, "review", "complete", {
          worktreePath: writing.worktreePath,
          byHand: {
            guidePlan,
            plan: { steps, savedAt: at, confirmedAt: at, outlineAt: at },
            hints: { s2: { rung: 1, at, fingerprint: writing.fingerprint } },
            thread: [
              { id: "e1", at, kind: "hint", stepId: "s2", rung: 1, text: "Look where the attempt is compared with the limit.", refs: [{ path: source, line: 4 }] },
              {
                id: "e2",
                at: "2026-10-20T09:05:00.000Z",
                kind: "ask",
                entry: "project",
                question: "Where is the limit read?",
                text: "It is a constant at the top of the file.",
                quotes: [{ path: source, startLine: 1, endLine: 1, from: "base", text: "export const maxRetries = Infinity;" }],
                removed: 1,
              },
            ],
            tests: [testRun(writing.fingerprint)],
            // Marked ready at an earlier version: the person changed the code since.
            ready: { at, changeFingerprint: "0000000000000000", review: false },
            events: [{ at, kind: "answer", source: "hint", rung: 1 }],
          },
        }),
        run(runs.fitted, "review", "developing", {
          worktreePath: fitted.worktreePath,
          byHand: {
            guidePlan,
            plan: { steps, savedAt: at, confirmedAt: at },
            hints: { s2: { rung: 2, at: "2026-10-20T08:00:00.000Z", fingerprint: "older" } },
            tests: [testRun(fitted.fingerprint)],
            helpLock: lock,
          },
        }),
      ],
    }),
  );
}

let server: LaunchedServer;
test.beforeAll(async () => {
  server = await startReadyServer({ seed });
});
test.afterAll(async () => {
  await server?.stop();
});

async function open(browser: Browser, hash: string, { locale = "en", width = 1440 }: { locale?: Locale; width?: number } = {}) {
  const context = await browser.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
    viewport: { width, height: width < 760 ? 844 : 900 },
    locale: locale === "en" ? "en-US" : locale,
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  await page.goto(`/${hash}${hash.includes("?") ? "&" : "?"}locale=${locale}`);
  return { page, close: () => context.close() };
}

/** No serious or critical axe issue, color contrast included, within `selector`. */
async function expectAccessible(page: Page, selector: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page })
    .options({ rules: { "color-contrast": { enabled: true } } })
    .include(selector)
    .analyze();
  const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("the person plans first: their steps, read-first ranges and the guide's outline folded", async ({ browser }) => {
  const { page, close } = await open(browser, `#/runs/${runs.planning}/activity`);
  try {
    const plan = page.getByRole("region", { name: t.plan.title });
    await expect(plan).toBeVisible();
    await expect(plan).toContainText(t.plan.intro);
    await expect(plan.locator("code", { hasText: `${source}:3-5` })).toBeVisible();
    await expect(plan).toContainText(t.plan.folded);
    await expect(plan).not.toContainText("Read the retry loop");
    await expect(plan.getByRole("button", { name: t.plan.noIdea })).toBeVisible();
    const confirm = plan.getByRole("button", { name: t.plan.confirm });
    await expect(confirm).toBeDisabled();
    // No team approval or "send back" for a learn-by-hand run.
    await expect(page.getByRole("button", { name: "Approve the plan and start development" })).toHaveCount(0);
    await expectAccessible(page, ".by-hand");
    // A written step enables the confirmation; leaving the field saves it,
    // and the stub route's refusal shows as the server words it.
    const saved = page.waitForRequest((request) => request.url().endsWith(`/api/runs/${runs.planning}/by-hand/plan`) && request.method() === "PUT");
    await plan.getByRole("textbox", { name: t.plan.step({ number: 1 }) }).fill("Find where retries are counted");
    await expect(confirm).toBeEnabled();
    await plan.getByRole("textbox", { name: t.plan.tests }).click();
    expect((await saved).postDataJSON()).toEqual({ steps: [{ title: "Find where retries are counted", files: [] }], tests: "", unsure: "", prediction: "" });
    await expect(plan.getByRole("alert")).toHaveText(notYet);
  } finally {
    await close();
  }
});

test("while the person writes, the guide's panel, its thread, the Tests card and Ready for review show", async ({ browser }) => {
  const { page, close } = await open(browser, `#/runs/${runs.writing}/changes`);
  try {
    await expect(page.locator(".workspace-heading .status-badge", { hasText: workspace.byHand.badge })).toBeVisible();
    await expect(page.getByText(workspace.byHand.changed)).toBeVisible();
    const guide = page.locator(".guide-panel");
    await expect(guide.getByRole("heading", { name: t.guide.title, exact: true })).toBeVisible();
    await expect(guide).toContainText(t.guide.clean);
    // The thread, newest first: the quote BELL cut under its header, and the filter's note.
    await expect(guide.locator("figcaption", { hasText: t.thread.base })).toContainText(`${source}:1-1`);
    await expect(guide).toContainText(t.thread.removed);
    await expect(guide.getByRole("button", { name: t.guide.next({ rung: t.guide.rungs[2] }) })).toBeDisabled();
    await expect(guide).toContainText(t.guide.tryFirst);
    // The Tests card: the last run at this version, with the prediction.
    const tests = guide.getByRole("region", { name: t.tests.title });
    await expect(tests).toContainText(t.tests.result({ predicted: "Fail", outcome: "failed" }));
    await expect(tests.getByRole("button", { name: t.tests.explain })).toBeVisible();
    await expectAccessible(page, ".guide-panel");

    // The footer asks for Ready for review; its dialog states the facts.
    await page.locator(".review-footer").getByRole("button", { name: workspace.byHand.ready }).click();
    const dialog = page.getByRole("dialog", { name: t.ready.title });
    await expect(dialog).toContainText(/1 file changed, \+1 −1\./);
    await expect(dialog).toContainText(/Your tests failed .+; you predicted Fail\./);
    await expect(dialog.getByRole("checkbox", { name: new RegExp(t.ready.review) })).toBeChecked();
    await expect(dialog).toContainText(t.ready.cost);
    await expectAccessible(page, "[role=dialog]");
    await dialog.getByRole("button", { name: t.ready.confirm }).click();
    await expect(dialog.getByRole("alert")).toHaveText(notYet);
  } finally {
    await close();
  }
});

test("the Tests card runs only the confirmed command, and a refused command shows the server's own words", async ({ browser }) => {
  const { page, close } = await open(browser, `#/runs/${runs.writing}/changes`);
  try {
    await page.route(`**/api/runs/${runs.writing}/by-hand/test-command`, (route) =>
      route.fulfill({ json: { suggestion: "npm test", confirmed: { command: "npm test", confirmedAt: at } } }),
    );
    await page.reload();
    const tests = page.locator(".guide-panel").getByRole("region", { name: t.tests.title });
    await expect(tests.locator("strong", { hasText: t.tests.confirmed({ command: "npm test" }) })).toBeVisible();
    const run = tests.getByRole("button", { name: t.tests.run });
    await expect(run).toBeEnabled();
    // An edited, unconfirmed command next to Run: Run waits for the confirmation.
    const field = tests.getByRole("textbox", { name: t.tests.command });
    await field.fill("npm test -- retry");
    await expect(run).toBeDisabled();
    await expect(tests).toContainText(t.tests.edited);
    await tests.getByRole("button", { name: t.tests.use }).click();
    await expect(page.locator(".guide-panel").getByRole("alert")).toHaveText(notYet);
    await field.fill("npm test");
    await expect(run).toBeEnabled();
    await expect(tests).not.toContainText(t.tests.edited);
  } finally {
    await close();
  }
});

test("the person can ask, mark a step done with its why and mark the change ready from the keyboard alone", async ({ browser }) => {
  const { page, close } = await open(browser, `#/runs/${runs.writing}/changes`);
  try {
    const guide = page.locator(".guide-panel");
    const sent = (route: string, method = "POST") =>
      page.waitForRequest((request) => new URL(request.url()).pathname === `/api/runs/${runs.writing}/by-hand/${route}` && request.method() === method);
    // Done on a step that had Options: the why field takes the focus, and Enter sends it.
    await guide.locator("li", { hasText: "Cap the retries at three" }).getByRole("button", { name: t.guide.done }).focus();
    await page.keyboard.press("Enter");
    const why = guide.getByRole("textbox", { name: t.guide.why });
    await expect(why).toBeFocused();
    await page.keyboard.type("The cap stops the loop after three tries.");
    const step = sent("steps/s2", "PATCH");
    await page.keyboard.press("Enter");
    expect((await step).postDataJSON()).toEqual({ done: true, why: "The cap stops the loop after three tries." });
    // A question, sent with Tab and Enter.
    await guide.getByRole("textbox", { name: t.guide.question }).focus();
    await page.keyboard.type("Where is the limit read?");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(guide.getByRole("button", { name: t.guide.ask, exact: true })).toBeFocused();
    const asked = sent("guide");
    await page.keyboard.press("Enter");
    expect((await asked).postDataJSON()).toMatchObject({ kind: "ask", entry: "project", question: "Where is the limit read?", stepId: "s2" });
    await expect(guide.getByRole("alert")).toHaveText(notYet);
    // Ready for review: the dialog takes the focus, and Escape gives it back to the footer.
    const ready = page.locator(".review-footer").getByRole("button", { name: workspace.byHand.ready });
    await ready.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: t.ready.title });
    await expect(dialog.getByRole("textbox", { name: t.ready.leastSure })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(ready).toBeFocused();
  } finally {
    await close();
  }
});

test("back from the editor, the diff is read again once", async ({ browser }) => {
  const { page, close } = await open(browser, `#/runs/${runs.writing}/changes`);
  try {
    await expect(page.locator(".guide-panel")).toBeVisible();
    const reads: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === `/api/runs/${runs.writing}/diff`) reads.push(request.url());
    });
    await appendFile(path.join(server.dataDir, "worktrees", runs.writing, source), "\nexport const backoffMs = 100;\n");
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByText("export const backoffMs = 100;")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2500);
    expect(reads).toHaveLength(1);
  } finally {
    await close();
  }
});

test("a fitted run names its help set and offers no planning help or review", async ({ browser }) => {
  const { page, close } = await open(browser, `#/runs/${runs.fitted}/changes`);
  try {
    const guide = page.locator(".guide-panel");
    await expect(guide).toContainText(t.guide.fitted({ kinds: "explanations, answers, and test help" }));
    await expect(guide).toContainText(t.guide.notOffered({ kinds: "planning help and reviews" }));
    await expect(guide.getByRole("button", { name: /Next hint/ })).toHaveCount(0);
    await expect(guide).toContainText(t.guide.noRung);
    await page.locator(".review-footer").getByRole("button", { name: workspace.byHand.ready }).click();
    const dialog = page.getByRole("dialog", { name: t.ready.title });
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await expect(dialog).toContainText(t.ready.noReview);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    // The plan: no outline reveal, plan questions or comparison.
    await page.locator("#workspace-tab-activity").click();
    const plan = page.getByRole("region", { name: t.plan.title });
    await expect(plan).toContainText(t.plan.closed);
    // Literal names: the last two belong to cuts K2 and K4, which may be reverted alone.
    for (const name of [t.plan.noIdea, t.plan.names, "Questions on my plan", "Compare with the guide's steps"])
      await expect(plan.getByRole("button", { name })).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the task dialog says why BELL won't publish a learn-by-hand run on a banning project, and sends the mode", async ({ browser }) => {
  const { page, close } = await open(browser, `#/runs/${runs.writing}/overview`);
  try {
    const mode = discovery.byHand;
    await page.getByRole("button", { name: workspace.newContribution }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#task-repo").selectOption(banRepoId);
    // A banning project is never a reason to preselect Learn by hand.
    await expect(dialog.getByRole("radio", { name: mode.agents })).toBeChecked();
    await dialog.getByText(mode.hand).click();
    const reason = "BELL PR won't publish a learn-by-hand run here: the project's rules restrict AI help itself, not only AI-written code.";
    await expect(dialog.locator(".mode-case")).toHaveText(`${reason} ${mode.practice}`);
    await expectAccessible(page, ".mode-choice");
    await dialog.locator("#task-prompt").fill("Cap the retries at three so a timeout can't loop forever.");
    await dialog.getByRole("button", { name: mode.start }).click();
    const confirm = dialog.locator(".start-confirm");
    await expect(confirm.getByRole("heading", { name: mode.title })).toBeVisible();
    await expect(confirm).toContainText(reason);
    await expect(confirm.getByRole("button", { name: mode.practise })).toBeVisible();
    await confirm.getByRole("button", { name: "Back" }).click();

    // On a project without such rules the run is created as a learn-by-hand run.
    await dialog.locator("#task-repo").selectOption(repoId);
    await dialog.getByText(mode.hand).click();
    await expect(dialog.locator(".mode-case")).toHaveCount(0);
    const created = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/runs" && request.method() === "POST");
    await dialog.getByRole("button", { name: mode.start }).click();
    const body = (await created).postDataJSON() as Record<string, unknown>;
    expect(body.learnByHand).toBe(true);
    expect(body).not.toHaveProperty("byHandFit");
  } finally {
    await close();
  }
});

test("discovery never offers to start by hand on an issue kept for people learning without AI tools", async ({ browser }) => {
  const sample = getSampleDiscoveryJob("en");
  const base = sample.opportunities.find((item) => item.learnByHand) ?? sample.opportunities[0];
  const quote = (text: string) => ({ ...base.evidence[0], quote: text });
  const job: DiscoveryJob = {
    ...sample,
    sample: false,
    opportunities: [
      { ...base, id: "plain", title: "A newcomer issue", learnByHand: true },
      { ...base, id: "use", title: "An issue kept for people learning", learnByHand: true, byHandReserved: true, evidence: [quote(llvm)] },
      { ...base, id: "output", title: "An issue that closes AI pull requests", learnByHand: true, byHandReserved: true, byHandReservedOutput: true },
    ],
  };
  const { page, close } = await open(browser, "#/discover");
  await page.route("**/api/discovery", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { job } }) : route.continue(),
  );
  try {
    await page.reload();
    const card = (title: string) => page.locator(".discovery-opportunity", { has: page.getByRole("heading", { name: title }) });
    await expect(card("A newcomer issue").getByRole("button", { name: discovery.card.startByHand })).toBeVisible();
    const kept = card("An issue kept for people learning");
    await expect(kept.getByRole("button", { name: discovery.card.startByHand })).toHaveCount(0);
    await expect(kept.locator(".by-hand-note")).toHaveText(discovery.card.reservedUse);
    await expect(kept.locator("footer blockquote")).toHaveText(llvm);
    const output = card("An issue that closes AI pull requests");
    await expect(output.getByRole("button", { name: discovery.card.startByHand })).toBeVisible();
    await expect(output.locator(".by-hand-note")).toHaveText(discovery.card.reservedOutput);
    await expectAccessible(page, ".discovery-opportunity footer");
  } finally {
    await close();
  }
});

for (const locale of ["en", "zh-TW"] as const)
  for (const width of [390, 1440])
    test(`the plan, the guide and the Ready dialog fit at ${width} px in ${locale}, in one language`, async ({ browser }) => {
      const text = locale === "en" ? byHandText : byHandZh;
      // Every sentence of the other language's dictionary that could show here.
      const other = Object.values((locale === "en" ? byHandZh : byHandText).guide).filter((value): value is string => typeof value === "string" && value.length > 12);
      const fits = async (page: Page, root: string) => {
        await expect(page.locator(root).first()).toBeVisible();
        expect(await findOverflow(page, [root])).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const shown = await page.locator(root).first().innerText();
        for (const sentence of other) expect(shown).not.toContain(sentence);
      };
      const plan = await open(browser, `#/runs/${runs.planning}/activity`, { locale, width });
      try {
        await expect(plan.page.getByRole("region", { name: text.plan.title })).toBeVisible();
        await fits(plan.page, ".team-plan .by-hand");
      } finally {
        await plan.close();
      }
      const { page, close } = await open(browser, `#/runs/${runs.writing}/changes`, { locale, width });
      try {
        await expect(page.getByRole("heading", { name: text.guide.title, exact: true })).toBeVisible();
        await fits(page, ".guide-panel");
        await page.locator(".review-footer button.button.primary").click();
        await expect(page.getByRole("dialog", { name: text.ready.title })).toBeVisible();
        await fits(page, "[role=dialog]");
      } finally {
        await close();
      }
    });
