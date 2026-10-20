/**
 * Creating a run: its provider must be ready and the queue must have room,
 * and the plan decides how many teammates it gets. The new run is saved
 * and joins the Workbench queue.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ContributionSettings } from "../shared/insights.js";
import type { AgentProvider, ModelCatalog } from "../shared/models.js";
import {
  clampContributionSettings,
  proEntitlements,
  type Entitlements,
} from "../shared/plans.js";
import { setupError } from "./cli-errors.js";
import type { CliStatus } from "./doctor.js";
import { currentLocale, sm } from "./i18n/index.js";
import { resolveModelExecution } from "./models.js";
import { logRunQueued } from "./run-events.js";
import { enforceAgentSandbox } from "./sandbox.js";
import { AppError, withRunLocale, type Repository, type Run } from "./types.js";
import type { HelpLock } from "../shared/by-hand.js";
import { byHandRulesCase } from "../shared/by-hand-rules.js";
import { byHandBlockClause } from "../shared/contribution.js";
import type { WorkbenchContext } from "./workbench.js";

const now = () => new Date().toISOString();
const newId = () => randomUUID();

/**
 * What createRun() reads through the Workbench, so that a test that
 * replaces one of these Workbench methods also changes what a new run sees.
 */
/**
 * How a new run works, from POST /api/runs (never stored as given):
 * `learnByHand` makes it a Learn-by-hand run, for good; `byHandFit`, only
 * with it, fixes the run's help set to the project's carve-out
 * (`byHand.helpLock`, DESIGN v1.2 F12), with whether the linked issue
 * carries a learning label in the task dialog's facts.
 */
export interface NewRunMode {
  learnByHand?: boolean;
  byHandFit?: { learningIssue: boolean };
}

export interface NewRunSources {
  models(provider?: AgentProvider): Promise<ModelCatalog>;
  /** Which agent CLIs are installed and signed in. */
  status(): Promise<CliStatus>;
  /** What the current plan allows. */
  entitlements(): Entitlements;
}

/**
 * Refuses a new run before it is queued when its provider is not
 * installed or not signed in, or when it is Claude Code and its sandbox
 * cannot start (unless unsandboxed agents are allowed). Each refusal has
 * a code and the commands that fix it.
 */
async function assertProviderReady(
  sources: NewRunSources,
  provider: AgentProvider,
  access: "read" | "write",
) {
  const capability = await sources.status();
  if (provider === "claude") {
    if (!capability.claude)
      throw new AppError((m) => m.run.queue.claudeMissing, 503, {
        code: "claude_missing",
        fixes: setupError("claude_missing").fixes,
      });
    if (!capability.claudeAuthenticated)
      throw new AppError((m) => m.run.queue.claudeSignedOut, 503, {
        code: "claude_unauthenticated",
        fixes: setupError("claude_unauthenticated").fixes,
      });
    // An agent run's teammates edit files; a Learn-by-hand run's agents only read.
    await enforceAgentSandbox("claude", access);
  } else {
    if (!capability.codex)
      throw new AppError((m) => m.run.queue.codexMissing, 503, {
        code: "codex_missing",
        fixes: setupError("codex_missing").fixes,
      });
    if (!capability.codexAuthenticated)
      throw new AppError((m) => m.run.queue.codexSignedOut, 503, {
        code: "codex_unauthenticated",
        fixes: setupError("codex_unauthenticated").fixes,
      });
  }
}

/**
 * The help set of a run fitted to the project's rules, fixed now (DESIGN
 * v1.2 F12 condition e), from the rules BELL stored; 409 when the case is
 * no longer `fitted` (the rules changed since the task dialog read them).
 */
function fitHelpLock(
  repo: Repository,
  fit: { learningIssue: boolean },
  at: string,
): HelpLock {
  const fitted = byHandRulesCase(repo.contributionRules, { learningIssue: fit.learningIssue, now: at });
  if (fitted.case === "fitted") return { ...fitted.lock, at };
  throw new AppError(
    (m) =>
      m.byHand.fitUnavailable({
        reason:
          fitted.case === "blocked"
            ? byHandBlockClause(fitted.reason, currentLocale(), { checkedOn: fitted.finding.source?.checkedOn })
            : m.byHand.fitNothing,
      }),
    409,
  );
}

export async function createRun(
  ctx: WorkbenchContext,
  sources: NewRunSources,
  repoId: string,
  prompt: string,
  title?: string,
  settings?: ContributionSettings,
  mode: NewRunMode = {},
) {
  const repo = ctx.repo(repoId);
  const byHand = mode.learnByHand === true;
  const modelExecution = resolveModelExecution(
    settings ?? {},
    await sources.models(settings?.provider),
  );
  await assertProviderReady(
    sources,
    modelExecution.provider ?? "codex",
    byHand ? "read" : "write",
  );
  ctx.assertQueueCapacity();
  const createdAt = now();
  const helpLock = byHand && mode.byHandFit ? fitHelpLock(repo, mode.byHandFit, createdAt) : undefined;
  // The plan decides how many teammates a new run gets; runs created
  // before keep their recorded team.
  const requested = {
    ...settings,
    maxTeammates: settings?.maxTeammates ?? (3 as const),
  };
  const { settings: allowed, clamped } = clampContributionSettings(
    requested,
    sources.entitlements(),
  );
  const id = newId();
  const agents = sm().run.agents;
  const run: Run = {
    id,
    repoId,
    title: title || prompt.slice(0, 72),
    prompt,
    status: "queued",
    // Every run branch uses the fix/ prefix; the GitHub branch field can override it per run.
    branch: `fix/${id.slice(0, 8)}`,
    baseBranch: repo.defaultBranch,
    baseSha: "",
    worktreePath: path.join(ctx.store.directory, "worktrees", id),
    createdAt,
    // The request's locale; the run's background work and agents use it.
    locale: currentLocale(),
    agents: [
      {
        id: "lead",
        name: "Atlas",
        role: "Team lead",
        status: "waiting",
        detail: agents.lead,
      },
      {
        id: "reviewer",
        name: "Lens",
        role: "Reviewer",
        status: "waiting",
        detail: agents.reviewer,
      },
      {
        id: "tester",
        name: "Scout",
        role: "Test analyst",
        status: "waiting",
        detail: agents.tester,
      },
    ],
    logs: [],
    // Learn by hand (DESIGN v1.2 F11): the PR text is the person's, so the
    // title doesn't start from the task's (often an AI recommendation's).
    draft: { title: byHand ? "" : title || prompt.slice(0, 72), body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
    contributionSettings: settings
      ? { ...settings, maxTeammates: allowed.maxTeammates }
      : undefined,
    modelExecution,
    ...(byHand ? { learnByHand: true as const } : {}),
    ...(helpLock ? { byHand: { helpLock } } : {}),
    team: {
      config: {
        maxTeammates: allowed.maxTeammates,
        // The person's own plan comes first in Learn by hand: always on.
        requirePlanApproval: byHand || (settings?.requirePlanApproval ?? true),
        provider: modelExecution.provider ?? "codex",
        protocol: "bell-shared-tasks",
        messageDelivery: "between-turns",
      },
      phase: "planning",
      planSummary: "",
      tasks: [],
      messages: [],
    },
  };
  if (clamped)
    withRunLocale(run, () =>
      ctx.log(
        run,
        "system",
        sm().setup.plan.teamClamped({
          max: allowed.maxTeammates,
          pro: proEntitlements(1).maxTeammates,
        }),
        { kind: "notice" },
      ),
    );
  ctx.store.data.runs.unshift(run);
  await ctx.store.save();
  logRunQueued(run, "created");
  ctx.enqueue(id);
  return run;
}
