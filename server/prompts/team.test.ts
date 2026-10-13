import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { git } from "../process.js";
import { Store } from "../store.js";
import { Workbench } from "../workbench.js";
import type { TeamAgentInput, TeamAgentRunner } from "../team.js";
import type { ContributionSettings } from "../../shared/insights.js";

/**
 * Fixtures hold each prompt as its lines, so a wording change shows up as a
 * readable line diff. They were recorded from the prompt code before it moved
 * out of workbench.ts; a test failure means the text the agents receive
 * changed.
 */
async function fixture(name: string) {
  const lines = JSON.parse(
    await readFile(path.join(import.meta.dirname, "fixtures", name), "utf8"),
  ) as Record<string, string[]>;
  return Object.fromEntries(
    Object.entries(lines).map(([key, value]) => [key, value.join("\n")]),
  );
}

async function waitUntil(predicate: () => boolean, message: string) {
  const end = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${message}`);
    await delay(10);
  }
}

const settings: ContributionSettings = {
  direction: "feature",
  targetUser: "Command-line users",
  outcome: "Every module prints the same greeting",
  constraints: "Keep the exported names",
  acceptance: "The greeting check passes",
  maxTeammates: 2,
  requirePlanApproval: true,
  // The Ponytail policy belongs to efficiency.ts; keep it out of these prompts.
  ponytailMode: "off",
};

const plan = (
  tasks: { id: string; file: string; dependsOn?: string[] }[],
  revisionNotes: string | null = null,
) =>
  JSON.stringify({
    summary: "Align the greeting in every module.",
    revisionNotes,
    tasks: tasks.map(({ id, file, dependsOn = [] }) => ({
      id,
      title: `Update ${file}`,
      description: `Change the greeting in ${file} and run the greeting check.`,
      files: [file],
      dependsOn,
    })),
  });

const taskFiles: Record<string, string> = {
  alpha: "a.ts",
  beta: "b.ts",
  gamma: "c.ts",
};

/** Writes the task's file the way a member would and returns its report. */
async function implement(input: TeamAgentInput) {
  const file = taskFiles[input.taskId!];
  await writeFile(
    path.join(input.cwd, file),
    `export const greeting = "${file} after";\n`,
  );
  return `${input.taskId} report: updated ${file}; the greeting check passed.`;
}

/**
 * Starts a Workbench on a fresh repository with a.ts, b.ts and c.ts. The
 * commit has a fixed identity and date, so the base commit in the prompts
 * never changes. Explanations and the PR draft, which run after the review,
 * are not team prompts and fail fast.
 */
async function teamRun(
  runner: (input: TeamAgentInput, workbench: Workbench) => Promise<string>,
  scenario: (workbench: Workbench, repoId: string) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-prompts-test-"));
  const repository = path.join(directory, "repo");
  await mkdir(repository);
  await git(repository, ["init", "-b", "main"]);
  for (const file of Object.values(taskFiles))
    await writeFile(
      path.join(repository, file),
      `export const greeting = "${file} before";\n`,
    );
  await git(repository, ["add", "--", ...Object.values(taskFiles)]);
  const identity = {
    GIT_AUTHOR_NAME: "BELL Test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_AUTHOR_DATE: "2025-01-01T00:00:00Z",
    GIT_COMMITTER_NAME: "BELL Test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
    GIT_COMMITTER_DATE: "2025-01-01T00:00:00Z",
  };
  await git(
    repository,
    ["-c", "commit.gpgsign=false", "commit", "-m", "initial"],
    { env: { ...process.env, ...identity } },
  );
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const scripted: TeamAgentRunner = async (input) => {
    if (input.role === "explanations" || input.role === "draft")
      throw new Error(`${input.role} is not scripted`);
    return runner(input, workbench);
  };
  const workbench = new Workbench(store, scripted, {
    getModelCatalog: async () => ({ models: [], source: "codex" }),
  });
  workbench.status = async () => ({
    codex: true,
    codexAuthenticated: true,
    github: false,
    claude: false,
    claudeAuthenticated: false,
  });
  try {
    const repo = await workbench.importRepository(repository);
    await scenario(workbench, repo.id);
  } finally {
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * The lead plan, a revised plan, three dependent members (beta fails once
 * and is retried; gamma is blocked meanwhile), integration, and the
 * independent reviewer and test analyst.
 */
async function recordPlanAndRetryPrompts() {
  const prompts: Record<string, string> = {};
  const leadTurns = ["lead:plan", "lead:revised-plan", "lead:integration"];
  const tasks = [
    { id: "alpha", file: "a.ts" },
    { id: "beta", file: "b.ts", dependsOn: ["alpha"] },
    { id: "gamma", file: "c.ts", dependsOn: ["beta"] },
  ];
  let betaAttempts = 0;
  await teamRun(
    async (input) => {
      if (input.role === "lead") {
        const turn = leadTurns.shift() ?? "lead:unexpected";
        prompts[turn] = input.prompt;
        if (turn === "lead:plan") return plan(tasks);
        if (turn === "lead:revised-plan")
          return plan(tasks, "Each task now names the check it runs.");
        return "Integration report: the three modules print the same greeting.";
      }
      if (input.role === "reviewer" || input.role === "tester") {
        prompts[input.role] = input.prompt;
        return `${input.role} report: no issues found.`;
      }
      if (input.taskId === "beta" && ++betaAttempts === 1) {
        prompts["member:beta"] = input.prompt;
        throw new Error("The greeting check failed in b.ts.");
      }
      prompts[`member:${input.taskId}${input.taskId === "beta" ? ":retry" : ""}`] =
        input.prompt;
      return implement(input);
    },
    async (workbench, repoId) => {
      const run = await workbench.createRun(
        repoId,
        "Make every module print the same greeting.",
        "Align the greeting",
        settings,
      );
      await waitUntil(() => run.status === "awaiting_plan", "the first plan");
      await workbench.revisePlan(run.id, "Name the check each task runs.");
      await waitUntil(
        () => run.status === "awaiting_plan" && !!run.team?.tasks.length,
        "the revised plan",
      );
      await workbench.approvePlan(run.id);
      await waitUntil(() => run.status === "failed", "the failed beta task");
      await workbench.retryTeam(run.id);
      await waitUntil(() => run.status === "review", "the review");
    },
  );
  return prompts;
}

/**
 * Two parallel members: alpha messages beta and the lead, so beta takes a
 * second turn; a message the person sends during the review gives the lead a
 * final coordination turn. Message ids and times are replaced, since only
 * the integration prompt carries them.
 */
async function recordMessagePrompts() {
  const prompts: Record<string, string> = {};
  const leadTurns = ["lead:plan", "lead:integration", "lead:coordination"];
  let betaTurns = 0;
  let betaStarted = false;
  await teamRun(
    async (input, workbench) => {
      const run = workbench.store.data.runs[0];
      if (input.role === "lead") {
        const turn = leadTurns.shift() ?? "lead:unexpected";
        prompts[turn] = input.prompt
          .replace(
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
            "<id>",
          )
          .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<time>");
        if (turn === "lead:plan")
          return plan([
            { id: "alpha", file: "a.ts" },
            { id: "beta", file: "b.ts" },
          ]);
        if (turn === "lead:integration")
          return "Integration report: a.ts and b.ts share one greeting.";
        return "Updated integration report: the wording note is addressed.";
      }
      if (input.role === "reviewer") {
        await workbench.sendTeamMessage(run.id, {
          to: "lead",
          content: "Please confirm the README still matches.",
        });
        return "reviewer report: no issues found.";
      }
      if (input.role === "tester") return "tester report: static review only.";
      if (input.taskId === "alpha") {
        await waitUntil(() => betaStarted, "beta's first turn");
        prompts["member:alpha"] = input.prompt;
        await implement(input);
        return JSON.stringify({
          report: "alpha report: updated a.ts; the greeting check passed.",
          messages: [
            { to: "beta", content: "Use the wording from a.ts." },
            { to: "lead", content: "a.ts and b.ts now share one wording." },
          ],
        });
      }
      betaTurns++;
      if (betaTurns === 1) {
        betaStarted = true;
        await waitUntil(
          () => run.team!.messages.some((message) => message.to === "beta"),
          "alpha's message to beta",
        );
      }
      prompts[`member:beta:turn-${betaTurns}`] = input.prompt;
      return implement(input);
    },
    async (workbench, repoId) => {
      const run = await workbench.createRun(
        repoId,
        "Make a.ts and b.ts print the same greeting.",
        "Share the greeting",
        { ...settings, requirePlanApproval: false },
      );
      await waitUntil(() => run.status === "review", "the review");
    },
  );
  return prompts;
}

test("a team run with a revised plan and a retried task sends exactly the recorded prompts", async () => {
  assert.deepEqual(
    await recordPlanAndRetryPrompts(),
    await fixture("team-run-prompts.json"),
  );
});

test("team messages add the continuation, inbox and coordination prompts exactly as recorded", async () => {
  assert.deepEqual(
    await recordMessagePrompts(),
    await fixture("team-message-prompts.json"),
  );
});
