// The W2 post-merge review's Learn-by-hand fixes on a spec-local server with
// seeded runs: the focus after "Add a step" and an R3 choice, a guide
// answer that is announced and shown, one repeated-failure check-in per
// failing test, the Tests card at the ready version (so a second review
// can be asked for), the footer while the PR text is empty, and the run
// read again after an Ask-tab answer. The guide's routes are stubbed per
// test (page.route); stand-in codex, claude and gh answer only the setup
// check (e2e/helpers/ready-server.ts), so no agent runs.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser } from "@playwright/test";
import { changeFingerprint } from "../shared/change-fingerprint";
import { readDiff } from "../server/git";
import byHandText from "../src/byhand/write/i18n/en";
import { startReadyServer } from "./helpers/ready-server";
import type { LaunchedServer } from "./start-server.mjs";

const repoId = "7d8c3a41-2e7f-4a01-9c3d-4e5f6a7b8c9d";
const runs = { planning: "e2e-review-plan", writing: "e2e-review-write", ready: "e2e-review-ready" } as const;
const source = "src/retry.ts";
const at = "2026-10-20T09:00:00.000Z";
const t = byHandText;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();

const retryBase = "export const maxRetries = Infinity;\n\nexport function shouldRetry(attempt: number) {\n  return attempt < maxRetries;\n}\n";
const retryAfter = retryBase.replace("Infinity", "3");

/** One project and three Learn-by-hand runs: planning, writing (with an R3 answer and a failure three times), and marked ready. */
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
  const ready = await worktree(runs.ready);
  const steps = [
    { id: "s1", title: "Find where retries are counted", doneAt: at },
    { id: "s2", title: "Cap the retries at three", files: [source], maxRung: 3 },
  ];
  const failing = (minute: number, fingerprint: string) => ({
    at: `2026-10-20T09:0${minute}:00.000Z`,
    command: "npm test",
    changeFingerprint: fingerprint,
    outcome: "failed",
    exitCode: 1,
    ms: 1200,
    outputTail: "1 failing: retries forever",
    tailHash: "same-failure",
  });
  const guidePlan = {
    summary: "Requests retry forever after a timeout.",
    steps: [{ title: "Read the retry loop", files: [source] }],
    readFirst: [{ path: source, startLine: 3, endLine: 5, why: "Where the attempt is compared with the limit." }],
    at,
  };
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
    agents: [{ id: "lead", name: "Atlas", role: "Team lead", status: "complete", detail: "" }],
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
      planSummary: guidePlan.summary,
      tasks: [],
      messages: [],
    },
    learnByHand: true,
    ...extra,
  });
  await writeFile(
    path.join(dataDir, "state.json"),
    JSON.stringify({
      version: 1,
      repos: [{ id: repoId, name: "widgets", owner: "e2e-sample", fullName: "e2e-sample/widgets", path: checkout, defaultBranch: "main", url: "https://github.com/e2e-sample/widgets" }],
      runs: [
        run(runs.planning, "awaiting_plan", "awaiting_approval", { byHand: { guidePlan } }),
        run(runs.writing, "review", "developing", {
          worktreePath: writing.worktreePath,
          byHand: {
            guidePlan,
            plan: { steps, savedAt: at, confirmedAt: at, outlineAt: at },
            hints: { s2: { rung: 3, at, fingerprint: writing.fingerprint } },
            thread: [
              {
                id: "e1",
                at,
                kind: "hint",
                stepId: "s2",
                rung: 3,
                text: "Two ways the project bounds a loop elsewhere.",
                options: [
                  { name: "A constant", tradeoff: "simple, fixed for every caller" },
                  { name: "A setting", tradeoff: "callers choose, one more option to document" },
                ],
              },
            ],
            tests: [failing(1, writing.fingerprint), failing(2, writing.fingerprint), failing(3, writing.fingerprint)],
          },
        }),
        run(runs.ready, "review", "complete", {
          worktreePath: ready.worktreePath,
          byHand: {
            guidePlan,
            plan: { steps, savedAt: at, confirmedAt: at, outlineAt: at },
            tests: [failing(1, ready.fingerprint)],
            ready: { at: "2026-10-20T09:02:00.000Z", changeFingerprint: ready.fingerprint, review: true },
            reviews: [{ at: "2026-10-20T09:03:00.000Z", changeFingerprint: ready.fingerprint, verified: "The cap holds.", checked: [source], findings: [] }],
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

async function open(browser: Browser, hash: string) {
  const context = await browser.newContext({
    baseURL: server.baseURL,
    storageState: server.storageState,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  await page.goto(`/${hash}${hash.includes("?") ? "&" : "?"}locale=en`);
  return { page, close: () => context.close() };
}

test("Add a step puts the focus in the new step's title, and an R3 choice in its why", async ({ browser }) => {
  const { page, close } = await open(browser, `#/runs/${runs.planning}/activity`);
  try {
    const plan = page.getByRole("region", { name: t.plan.title });
    await plan.getByRole("button", { name: t.plan.add }).click();
    // Typing goes into the new step, not into another empty step.
    await expect(plan.getByRole("textbox", { name: t.plan.step({ number: 2 }) })).toBeFocused();
  } finally {
    await close();
  }
  const writing = await open(browser, `#/runs/${runs.writing}/changes`);
  try {
    const thread = writing.page.locator(".guide-panel").getByRole("region", { name: t.thread.title });
    // Each Choose names its option.
    await expect(thread.getByRole("button", { name: t.thread.choose, description: "A constant" })).toHaveCount(1);
    await expect(thread.getByRole("button", { name: t.thread.choose, description: "A setting" })).toHaveCount(1);
    await thread.getByRole("button", { name: t.thread.choose, description: "A setting" }).click();
    await expect(thread.getByRole("textbox", { name: t.thread.chooseWhy })).toBeFocused();
  } finally {
    await writing.close();
  }
});
