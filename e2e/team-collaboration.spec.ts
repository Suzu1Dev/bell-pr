// The task board of a team run the service restarted in the middle of.
// The seeded state.json goes through the real start's recovery: the
// running subtask fails, everything after a failed subtask is blocked
// whatever order the plan lists it in, a subtask whose dependencies are
// integrated becomes ready, and one that names a removed subtask keeps
// waiting. The fake CLIs (start-server.mjs) keep any agent from starting;
// nothing leaves the machine and nothing is written through the API.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, request, test } from "@playwright/test";
import serverEn from "../server/i18n/en/run";
import serverZhTW from "../server/i18n/zh-TW/run";
import { locales, type Locale } from "../shared/i18n/locale";
import type { TeamTask, TeamTaskStatus } from "../shared/team";
import { getDemo } from "../src/demo/all";
import type { Run } from "../src/types";
import { e2eApiHeaders } from "./api-token.mjs";
import { messages } from "./helpers/messages";
import { expectNoOverflow } from "./helpers/overflow";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const serverRun = { en: serverEn, "zh-TW": serverZhTW } as const;
const repoId = "e2e-team-recovery-repo";
const runId = (locale: Locale) => `e2e-team-recovery-${locale}`;
/** A title with no space to break at, as an agent may write one. */
const longTitle =
  "NormalizeRetryBackoffAcrossEveryHttpClientAdapterAndQueueConsumerWithoutAnySpaceToBreakAt";
const longPath =
  "src/adapters/http/retry/normalize-backoff-for-every-queue-consumer-and-http-client-adapter.ts";
const failure = "npm test exited with 1: 3 retry tests failed";
const helperTitle = "Add the shared retry helper";
const clientTitle = "Use the helper in the HTTP client";
const logTitle = "Log each retry";

function task(
  id: string,
  title: string,
  status: TeamTaskStatus,
  dependsOn: string[],
  extra: Partial<TeamTask> = {},
): TeamTask {
  return {
    id,
    title,
    description: `${title}.`,
    owner: `teammate-${id.slice(-1)}`,
    files: [`src/${id}.ts`],
    dependsOn,
    status,
    ...extra,
  };
}

/**
 * Dependents come before what blocks them, so one pass is not enough.
 * task-5's description is its title, so it has no space to break at either.
 */
const tasks: TeamTask[] = [
  task("task-6", "Document the retry limits", "pending", ["task-5", "task-4"]),
  task("task-5", longTitle, "pending", ["task-2"]),
  task("task-1", helperTitle, "complete", []),
  task("task-2", clientTitle, "running", ["task-1"]),
  task("task-3", "Cover the queue consumer", "failed", [], { error: failure }),
  task("task-4", logTitle, "pending", ["task-1"]),
  task("task-7", "Retry the webhook sender", "pending", ["task-1", "task-removed"], {
    files: [longPath],
  }),
];

/** What the restart leaves, in the plan's order. */
const recovered: Record<string, TeamTaskStatus> = {
  "task-6": "blocked",
  "task-5": "blocked",
  "task-1": "complete",
  "task-2": "failed",
  "task-3": "failed",
  "task-4": "ready",
  "task-7": "pending",
};

/** One running team run per language, so each explains the restart in its own. */
async function seed(dataDir: string) {
  const runs = locales.map((locale): Run => ({
    ...getDemo(locale).run,
    id: runId(locale),
    repoId,
    locale,
    status: "running",
    baseSha: "a".repeat(40),
    agents: [],
    logs: [],
    reviewedFingerprints: {},
    worktreePath: path.join(dataDir, "worktrees", runId(locale)),
    team: {
      config: {
        maxTeammates: 2,
        requirePlanApproval: true,
        provider: "codex",
        protocol: "bell-shared-tasks",
        messageDelivery: "between-turns",
      },
      phase: "developing",
      planSummary: "Retry failed requests the same way everywhere.",
      tasks: structuredClone(tasks),
      messages: [],
    },
  }));
  await writeFile(
    path.join(dataDir, "state.json"),
    JSON.stringify({
      version: 1,
      repos: [
        { ...getDemo("en").repo, id: repoId, path: path.join(dataDir, "repositories", "sample") },
      ],
      runs,
    }),
  );
}

const statuses = (run: Run) =>
  Object.fromEntries((run.team?.tasks ?? []).map((entry) => [entry.id, entry.status]));

test("the restart's recovery is saved, and the next restart changes nothing", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "bellpr-e2e-team-"));
  try {
    for (const start of [1, 2]) {
      const server = await launchServer({ dataDir, seed: start === 1 ? seed : undefined });
      try {
        const api = await request.newContext({
          baseURL: server.baseURL,
          extraHTTPHeaders: e2eApiHeaders,
        });
        try {
          for (const locale of locales) {
            const response = await api.get(`/api/runs/${runId(locale)}`);
            expect(response.ok()).toBe(true);
            const { run } = (await response.json()) as { run: Run };
            expect(run.status).toBe("failed");
            expect(run.team?.phase).toBe("failed");
            expect(statuses(run)).toEqual(recovered);
            const restarted = run.team?.tasks.find((entry) => entry.id === "task-2");
            expect(restarted?.error).toBe(serverRun[locale].recovery.task);
          }
        } finally {
          await api.dispose();
        }
      } finally {
        await server.stop();
      }
      const saved = JSON.parse(await readFile(path.join(dataDir, "state.json"), "utf8")) as {
        runs: Run[];
      };
      for (const run of saved.runs) expect(statuses(run)).toEqual(recovered);
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test.describe("the board after the restart", () => {
  let server: LaunchedServer;
  test.beforeAll(async () => {
    server = await launchServer({ seed });
  });
  test.afterAll(async () => {
    await server?.stop();
  });

  const viewports = [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ];
  for (const locale of locales)
    for (const viewport of viewports)
      test(`failed, blocked and unknown dependencies read clearly (${locale}, ${viewport.width} px)`, async ({
        browser,
      }) => {
        const t = messages[locale].team;
        const label = messages[locale].common.teamTaskStatus;
        const context = await browser.newContext({
          baseURL: server.baseURL,
          viewport,
          extraHTTPHeaders: e2eApiHeaders,
        });
        const page = await context.newPage();
        try {
          // The seeded worktree is no Git checkout, so the server cannot diff
          // it; the run itself still comes from the server.
          await page.route(`**/api/runs/${runId(locale)}/diff`, (route) =>
            route.fulfill({ json: { files: [] } }),
          );
          await page.goto(`/#/runs/${runId(locale)}/activity?locale=${locale}`);
          const board = page.locator(".team-board");
          await expect(board.locator(".team-kanban")).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({
            path: test.info().outputPath(`board-${locale}-${viewport.width}.png`),
            fullPage: true,
          });

          // The run stopped: nothing turns and the board offers a retry.
          await expect(board).toContainText(t.phase.failed);
          await expect(board.locator(".spin")).toHaveCount(0);
          await expect(board.getByRole("button", { name: t.retry.action })).toBeVisible();
          await expect(board).toContainText(t.retry.partial({ kept: 1, retried: 4 }));
          await expect(board).toContainText(t.progress({ done: 1, total: tasks.length }));

          // Done holds integrated work only; failed work waits in To do.
          const lanes = board.locator(".team-kanban > .team-lane");
          const [todo, running, done] = [lanes.nth(0), lanes.nth(1), lanes.nth(2)];
          // The label shows the status. The id is in the card's details.
          const ids = (lane: typeof todo) =>
            lane.locator("article.team-task code").allTextContents();
          expect(await ids(todo)).toEqual(["task-6", "task-5", "task-2", "task-3", "task-4", "task-7"]);
          expect(await ids(running)).toEqual([]);
          expect(await ids(done)).toEqual(["task-1"]);
          await expect(todo.locator("h3")).toContainText(t.lanes.todo);
          await expect(todo.locator("h3 > span")).toHaveText("6");
          await expect(running.locator("h3 > span")).toHaveText("0");
          await expect(done.locator("h3 > span")).toHaveText("1");
          await expect(done).toBeVisible();
          // Phones hide an empty lane; a desktop says why it is empty.
          if (viewport.width < 600) await expect(running).toBeHidden();
          else await expect(running.locator(".team-lane-empty")).toHaveText(t.laneEmpty.running);

          const card = (id: string) =>
            board
              .locator("article.team-task")
              .filter({ has: page.locator("code", { hasText: new RegExp(`^${id}$`) }) });
          // Nothing starts a ready subtask of a stopped run until a retry,
          // and its label says so instead of offering it to claim.
          const shown = (status: TeamTaskStatus) =>
            status === "ready" ? t.task.readyAfterRetry : label[status];
          for (const [id, status] of Object.entries(recovered))
            await expect(card(id).locator(".team-task-label > span")).toHaveText(shown(status));
          await expect(board).not.toContainText(label.ready);

          // Why each subtask failed shows without a click.
          await expect(card("task-2").locator("pre.team-task-report")).toHaveText(
            serverRun[locale].recovery.task,
          );
          await expect(card("task-3").locator("pre.team-task-report")).toHaveText(failure);

          // Dependencies by title and status; a removed one keeps its id.
          const dependencies = (id: string) =>
            card(id)
              .locator(".team-task-deps li")
              .evaluateAll((items) =>
                items.map((item) => [...item.children].map((part) => part.textContent?.trim())),
              );
          await expect(card("task-6").locator(".team-task-deps > span")).toHaveText(t.task.dependsOn);
          expect(await dependencies("task-2")).toEqual([[helperTitle, label.complete]]);
          expect(await dependencies("task-5")).toEqual([[clientTitle, label.failed]]);
          expect(await dependencies("task-6")).toEqual([
            [longTitle, label.blocked],
            [logTitle, t.task.readyAfterRetry],
          ]);
          expect(await dependencies("task-7")).toEqual([
            [helperTitle, label.complete],
            ["task-removed", t.task.dependencyUnknown],
          ]);
          // A screen reader hears the list by the same name.
          const dependencyList = card("task-7").getByRole("list", { name: t.task.dependsOn });
          await expect(dependencyList).toBeVisible();
          await expect(dependencyList.getByRole("listitem")).toHaveCount(2);

          // A stopped run takes no messages; of its members, finished, failed
          // and blocked ones are marked closed, and the ones a retry restarts are not.
          const recipients = board.getByRole("combobox", { name: t.mailbox.recipientLabel });
          await expect(recipients).toBeDisabled();
          for (const id of ["task-1", "task-2", "task-3", "task-5", "task-6"])
            await expect(recipients.locator(`option[value="${id}"]`)).toHaveAttribute("disabled", "");
          for (const id of ["task-4", "task-7"])
            await expect(recipients.locator(`option[value="${id}"]`)).not.toHaveAttribute("disabled");
          await expect(recipients.locator('option[value="task-2"]')).toHaveText(
            t.mailbox.closedRecipient({ name: `teammate-2 · ${clientTitle}` }),
          );

          // Long titles, descriptions and paths wrap instead of widening the page.
          for (const id of ["task-2", "task-5", "task-6", "task-7"])
            await card(id).screenshot({
              path: test.info().outputPath(`card-${id}-${locale}-${viewport.width}.png`),
            });
          const description = card("task-5").locator("h4 + p");
          await expect(description).toHaveText(`${longTitle}.`);
          const fit = await description.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const cardBox = element.closest("article")!.getBoundingClientRect();
            return {
              hidden: element.scrollWidth - element.clientWidth,
              past: box.right - cardBox.right,
              lines: Math.round(box.height / parseFloat(getComputedStyle(element).lineHeight)),
            };
          });
          expect(fit.hidden).toBeLessThanOrEqual(0);
          expect(fit.past).toBeLessThanOrEqual(0);
          expect(fit.lines).toBeGreaterThan(1);
          await expectNoOverflow(page, [".team-board"]);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            ),
          ).toBeLessThanOrEqual(0);

          const results = await new AxeBuilder({ page })
            .include(".team-board")
            .options({ rules: { "color-contrast": { enabled: true } } })
            .analyze();
          const problems = results.violations
            .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
            .flatMap((violation) =>
              violation.nodes.map((node) => `${violation.id} (${violation.impact}) at ${node.target.join(" ")}`),
            );
          expect(problems).toEqual([]);
        } finally {
          await context.close();
        }
      });
});
