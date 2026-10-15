/**
 * The respect facts on the server: the project's quoted rules
 * (`Repository.contributionRules`), the run's GitHub facts
 * (`run.contributionFacts`) and the person's test reasons. Reads are
 * local (`git ls-tree`, `git show`) or read-only `gh api` calls, time-boxed,
 * never polled, and never for a repository without a GitHub origin. A
 * fact that could not be read is listed in `unknown`, never a pass.
 *
 * When GitHub is read (DESIGN §2 rule 7): at a GitHub import and at Update
 * project (the rules and door), on "Check again", once per issue link in
 * the task dialog (`check`), when the publish dialog opens (`refreshRun`)
 * and live inside publish(). `GET /api/runs/:id/preflight` uses what is
 * stored and never calls GitHub.
 */
import type {
  ContributionFacts,
  ContributionRules,
  DoorFacts,
  MergedPrSize,
} from "../shared/contribution.js";
import { draftProseWords } from "../shared/draft-checks.js";
import { weakenedTests } from "../shared/reviewability.js";
import {
  policyFindings,
  policyLimits,
  readAccountPolicy,
  readLocalPolicy,
  type PolicyDocument,
} from "./contribution-policy.js";
import type { DocumentKind } from "./draft-sources.js";
import { parseGitHubIssueUrl, parseGitHubSource } from "./git.js";
import { sm, type ServerMessages } from "./i18n/index.js";
import {
  FactError,
  githubReader,
  graphqlArgs,
  loginPattern,
  readIssueFacts,
  unknownReason,
  type GitHubRead,
  type UnknownReason,
} from "./issue-check.js";
import { log } from "./log.js";
import { readPacing, readViewerLogin } from "./pacing.js";
import { AppError, type Repository, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

const now = () => new Date().toISOString();

/** How long reading a run's facts may take in all (DESIGN §5.4). */
const runFactsTimeoutMs = 10_000;
/** How long reading a project's door and account defaults may take in all. */
const rulesTimeoutMs = 30_000;

/** The limits of a weakened-test reason (DESIGN F9): a line a maintainer can check. */
export const testReasonLimits = { words: 3, chars: 300 } as const;

const reasonKeys = {
  "gh-missing": "ghMissing",
  "signed-out": "signedOut",
  timeout: "timeout",
  "rate-limited": "rateLimited",
  "not-found": "notFound",
  forbidden: "forbidden",
  "github-error": "githubError",
  "invalid-answer": "invalidAnswer",
  "no-github-origin": "noGithubOrigin",
  "not-an-issue": "notAnIssue",
} as const satisfies Record<
  UnknownReason,
  keyof ServerMessages["contribution"]["unknown"]
>;

/** `<part>: <reason>` in the request's language, as ContributionFacts.unknown stores it. */
const unknownEntry = (part: string, reason: UnknownReason) =>
  `${part}: ${sm().contribution.unknown[reasonKeys[reason]]}`;

const reader = (timeoutMs: number) => githubReader({ timeoutMs });

/** The door and the size reference in one GraphQL call (DESIGN §5.1). */
export const doorQuery = `query BellDoor($owner: String!, $name: String!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    viewerPermission
    pullRequests(first: 3, states: MERGED, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { number additions deletions changedFiles }
    }
  }
}`;

const count = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined;

interface DoorRead {
  door: DoorFacts;
  mergedSizes?: MergedPrSize[];
  /** Why one of the two reads failed, when the other one answered. */
  partial?: UnknownReason;
}

/**
 * Whether the repository takes pull requests from the person: REST
 * `repos/{o}/{r}` (`has_pull_requests`, `pull_request_creation_policy`,
 * `archived`, `disabled`) and GraphQL (`viewerPermission`, `viewer.login`
 * and the last 3 merged pull requests' sizes), read side by side. When
 * only one answers, the door holds what it said and `partial` why the
 * other failed; a collaborators-only policy without the person's
 * permission is left out rather than guessed. Rejects with a FactError
 * when neither answers.
 */
export async function readDoor(
  read: GitHubRead,
  repository: { owner: string; name: string; fullName: string },
): Promise<DoorRead> {
  const [rest, graph] = await Promise.allSettled([
    read(["--method", "GET", `repos/${repository.fullName}`]),
    read(graphqlArgs(doorQuery, { owner: repository.owner, name: repository.name })),
  ]);
  const door: DoorFacts = {};
  let mergedSizes: MergedPrSize[] | undefined;
  let partial: UnknownReason | undefined;
  if (graph.status === "fulfilled") {
    const data = (
      graph.value as {
        data?: {
          viewer?: { login?: unknown };
          repository?: {
            viewerPermission?: unknown;
            pullRequests?: { nodes?: unknown };
          } | null;
        };
      }
    )?.data;
    const login = data?.viewer?.login;
    const repo = data?.repository;
    if (!repo || typeof login !== "string" || !loginPattern.test(login))
      partial = "invalid-answer";
    else {
      door.login = login;
      // null for an account without any access; GitHub's words otherwise.
      door.viewerPermission =
        typeof repo.viewerPermission === "string" ? repo.viewerPermission : "NONE";
      const nodes = repo.pullRequests?.nodes;
      const sizes = (Array.isArray(nodes) ? (nodes as Record<string, unknown>[]) : [])
        .map((node) => ({
          number: count(node?.number),
          additions: count(node?.additions),
          deletions: count(node?.deletions),
          changedFiles: count(node?.changedFiles),
        }))
        .filter((size): size is MergedPrSize =>
          [size.number, size.additions, size.deletions, size.changedFiles].every(
            (value) => value !== undefined,
          ),
        )
        .slice(0, 3);
      if (sizes.length) mergedSizes = sizes;
    }
  } else partial = unknownReason(graph.reason);
  if (rest.status === "fulfilled") {
    const value = rest.value as Record<string, unknown>;
    if (!value || typeof value !== "object" || typeof value.full_name !== "string")
      partial ??= "invalid-answer";
    else {
      if (typeof value.has_pull_requests === "boolean")
        door.hasPullRequests = value.has_pull_requests;
      if (typeof value.archived === "boolean") door.archived = value.archived;
      if (typeof value.disabled === "boolean") door.disabled = value.disabled;
      const policy = value.pull_request_creation_policy;
      if (
        typeof policy === "string" &&
        (door.viewerPermission || policy !== "collaborators_only")
      )
        door.pullRequestCreationPolicy = policy;
    }
  } else partial ??= unknownReason(rest.reason);
  if (!Object.keys(door).length)
    throw new FactError(partial ?? "invalid-answer");
  return { door, ...(mergedSizes ? { mergedSizes } : {}), ...(partial ? { partial } : {}) };
}

/**
 * The GitHub facts for publishing to `repo`, each part read on its own:
 * the door (when `door`), the linked issue (when `issueUrl` is set) and
 * the person's pace. A part that fails goes to `unknown` with its reason;
 * nothing here throws for a GitHub failure. Pacing is not read for people
 * with write access, whom it does not apply to.
 */
async function readFacts(
  repo: Repository,
  options: { issueUrl?: string; door: boolean; timeoutMs: number },
): Promise<ContributionFacts> {
  const facts: ContributionFacts = { checkedAt: now() };
  const unknown: string[] = [];
  const remote = parseGitHubSource(repo.url);
  const issueUrl = options.issueUrl?.trim();
  if (!remote) {
    // No gh at all for a project without a GitHub origin.
    for (const part of [
      ...(options.door ? ["door"] : []),
      ...(issueUrl ? ["issue"] : []),
      "pacing",
    ])
      unknown.push(unknownEntry(part, "no-github-origin"));
    return { ...facts, unknown };
  }
  const read = reader(options.timeoutMs);
  const issue = issueUrl ? parseGitHubIssueUrl(issueUrl) : null;
  const [door, linked] = await Promise.allSettled([
    options.door ? readDoor(read, remote) : Promise.resolve(undefined),
    issue ? readIssueFacts(read, issue) : Promise.resolve(undefined),
  ]);
  let login: string | undefined;
  if (options.door) {
    if (door.status === "fulfilled" && door.value) {
      facts.door = door.value.door;
      login = door.value.door.login;
      if (door.value.partial) unknown.push(unknownEntry("door", door.value.partial));
    } else if (door.status === "rejected")
      unknown.push(unknownEntry("door", unknownReason(door.reason)));
  }
  if (issueUrl) {
    if (!issue) unknown.push(unknownEntry("issue", "not-an-issue"));
    else if (linked.status === "fulfilled" && linked.value) {
      facts.issue = linked.value.facts;
      login ??= linked.value.login;
    } else if (linked.status === "rejected")
      unknown.push(unknownEntry("issue", unknownReason(linked.reason)));
  }
  const permission = facts.door?.viewerPermission;
  if (["WRITE", "MAINTAIN", "ADMIN"].includes(permission ?? ""))
    facts.pacing = { viewerPermission: permission };
  else
    try {
      login ??= await readViewerLogin(read);
      facts.pacing = (await readPacing(read, remote, login)).facts;
    } catch (error) {
      unknown.push(unknownEntry("pacing", unknownReason(error)));
    }
  if (unknown.length) {
    facts.unknown = unknown;
    log.info("contribution.facts_unknown", {
      repoId: repo.id,
      parts: unknown.map((entry) => entry.split(":")[0]),
    });
  }
  return facts;
}

/**
 * Reads the run's GitHub facts again (door, issue, pacing) within
 * `timeoutMs` in total, 8 s per call. publish() calls it before its checks
 * and keeps the stored snapshot only when it returns undefined, which it
 * does for a run whose project is gone. A failed read is in `unknown`.
 */
export async function refreshRunFacts(
  ctx: WorkbenchContext,
  run: Run,
  options: { timeoutMs?: number } = {},
): Promise<ContributionFacts | undefined> {
  const repo = ctx.store.data.repos.find((value) => value.id === run.repoId);
  if (!repo) return undefined;
  try {
    return await readFacts(repo, {
      issueUrl: run.contributionSettings?.issueUrl,
      door: true,
      timeoutMs: options.timeoutMs ?? runFactsTimeoutMs,
    });
  } catch (error) {
    // Not a GitHub failure (those are in `unknown`): still never a pass.
    log.warn("contribution.facts_failed", { runId: run.id, error });
    return {
      checkedAt: now(),
      unknown: ["door", "pacing", ...(run.contributionSettings?.issueUrl?.trim() ? ["issue"] : [])].map(
        (part) => unknownEntry(part, "invalid-answer"),
      ),
    };
  }
}

/**
 * Reads the project's rules and door again, at import, Update project or
 * "Check again". The rule files are read locally for every repository;
 * GitHub (the door, the size reference and the account's default files)
 * only for a GitHub origin and unless `network` is false, as for a project
 * imported from a local folder, which records `unknown: ["door"]` and runs
 * no gh. A failure never rejects: it is recorded in `unknown` and logged.
 */
export async function refreshRepositoryRules(
  _ctx: WorkbenchContext,
  repo: Repository,
  options: { network?: boolean } = {},
): Promise<ContributionRules | undefined> {
  const rules: ContributionRules = { checkedAt: now(), findings: [], filesRead: [] };
  const unknown: string[] = [];
  const remote = parseGitHubSource(repo.url);
  let documents: PolicyDocument[] = [];
  let own = new Set<DocumentKind>();
  try {
    const local = await readLocalPolicy(repo.path, { repository: remote?.fullName });
    rules.baseSha = local.baseSha;
    documents = local.documents;
    own = local.kinds;
    if (local.generated.length) rules.generated = local.generated;
  } catch (error) {
    unknown.push(`rules: ${sm().contribution.unknown.filesUnreadable}`);
    log.warn("contribution.rules_unreadable", { repoId: repo.id, error });
  }
  if (!remote || options.network === false) unknown.push("door");
  else {
    const read = reader(rulesTimeoutMs);
    const lacking = !own.has("contributing") || !own.has("template");
    const [door, account] = await Promise.allSettled([
      readDoor(read, remote),
      lacking && documents.length < policyLimits.filesRead
        ? readAccountPolicy(
            remote.owner,
            (kind) => !own.has(kind),
            (args, maxBytes) => read(args, { maxBytes }),
            policyLimits.filesRead - documents.length,
          )
        : Promise.resolve(undefined),
    ]);
    if (door.status === "fulfilled") {
      rules.door = door.value.door;
      if (door.value.mergedSizes) rules.mergedSizes = door.value.mergedSizes;
      if (door.value.partial) unknown.push(unknownEntry("door", door.value.partial));
    } else unknown.push(unknownEntry("door", unknownReason(door.reason)));
    if (account.status === "fulfilled" && account.value?.documents.length) {
      rules.orgDefaults = account.value.repository;
      documents = [...documents, ...account.value.documents];
    } else if (account.status === "rejected")
      unknown.push(unknownEntry("orgDefaults", unknownReason(account.reason)));
  }
  rules.findings = policyFindings(documents);
  rules.filesRead = documents.map((document) => document.path).slice(0, policyLimits.filesRead);
  if (unknown.length) rules.unknown = unknown;
  if (rules.unknown?.some((entry) => entry !== "door"))
    log.info("contribution.rules_unknown", {
      repoId: repo.id,
      parts: rules.unknown.map((entry) => entry.split(":")[0]),
    });
  return rules;
}

/**
 * GitHub's refusal of a pull request because the person already has as
 * many open as the repository allows (GitHub's per-user cap, 2026). Its
 * exact wording is not documented, so the match is loose: "open pull
 * request(s)" within a few words of limit, cap, maximum, exceeded or
 * reached, either way round. Anything else keeps its own error.
 */
const prCapPattern =
  /\b(?:limit|cap|maximum|max|too many|exceeded|reached)\b[^.\n]{0,80}\bopen\s+pull\s+requests?\b|\bopen\s+pull\s+requests?\b[^.\n]{0,80}\b(?:limit|cap|maximum|exceeded|reached)\b/i;

/**
 * A plain-words explanation of a failed `gh pr create` (GitHub's own
 * limit on open pull requests), or undefined to keep the error as it is.
 */
export function explainPrCreateFailure(error: unknown): AppError | undefined {
  if (!(error instanceof AppError)) return undefined;
  const output = `${String(error.details?.stderr ?? "")}\n${error.message}`;
  if (!prCapPattern.test(output)) return undefined;
  return new AppError((m) => m.contribution.prCap, 422, { cause: error });
}

/** What the contribution routes do; Workbench.contribution. */
export interface ContributionFacade {
  /** GET /api/repos/:id/contribution-rules: the stored rules, never refreshed. */
  rules(repoId: string): Promise<ContributionRules | undefined>;
  /** POST /api/repos/:id/contribution-rules/refresh ("Check again"). */
  refreshRules(repoId: string): Promise<ContributionRules | undefined>;
  /** GET /api/repos/:id/contribution-check?issue=: the task dialog's issue and pacing facts, time-boxed, never cached across runs. */
  check(repoId: string, issueUrl?: string): Promise<ContributionFacts>;
  /** POST /api/runs/:id/contribution-facts/refresh: stores `run.contributionFacts`. */
  refreshRun(runId: string): Promise<{ run: Run }>;
  /** PUT /api/runs/:id/test-reasons: one line per weakened-test item. */
  saveTestReasons(
    runId: string,
    reasons: Record<string, string>,
  ): Promise<{ run: Run }>;
}

export function contributionFacade(ctx: WorkbenchContext): ContributionFacade {
  return {
    async rules(repoId) {
      return ctx.repo(repoId).contributionRules;
    },
    async refreshRules(repoId) {
      const repo = ctx.repo(repoId);
      // Its own lock: reading GitHub must not hold up runs of the project.
      return ctx.lock(`contribution-rules:${repo.id}`, async () => {
        const rules = await refreshRepositoryRules(ctx, repo);
        if (rules && ctx.store.data.repos.includes(repo)) {
          repo.contributionRules = rules;
          await ctx.store.save();
        }
        return rules;
      });
    },
    async check(repoId, issueUrl) {
      return readFacts(ctx.repo(repoId), {
        issueUrl,
        door: false,
        timeoutMs: runFactsTimeoutMs,
      });
    },
    async refreshRun(runId) {
      const facts = await refreshRunFacts(ctx, ctx.run(runId), {
        timeoutMs: runFactsTimeoutMs,
      });
      return ctx.lock(runId, async () => {
        const run = ctx.run(runId);
        if (facts) run.contributionFacts = facts;
        await ctx.store.save();
        return { run };
      });
    },
    async saveTestReasons(runId, reasons) {
      return ctx.lock(runId, async () => {
        const run = ctx.run(runId);
        if (!["review", "approved"].includes(run.status) || run.publishing)
          throw new AppError((m) => m.run.publish.notEditable, 409);
        const current = new Set(
          weakenedTests(await ctx.diff(runId)).map((item) => item.id),
        );
        // Reasons for items the change no longer has are dropped.
        const kept = new Map(
          Object.entries(run.reviewability?.testReasons ?? {}).filter(([id]) =>
            current.has(id),
          ),
        );
        for (const [id, value] of Object.entries(reasons)) {
          if (!current.has(id)) continue;
          const reason = value.trim();
          if (!reason) kept.delete(id);
          // The route caps the length (testReasonLimits.chars).
          else if (draftProseWords(reason) < testReasonLimits.words)
            throw new AppError((m) => m.contribution.testReasonShort, 422);
          else kept.set(id, reason);
        }
        const { testReasons: _previous, ...rest } = run.reviewability ?? {};
        if (kept.size) run.reviewability = { ...rest, testReasons: Object.fromEntries(kept) };
        else if (Object.keys(rest).length) run.reviewability = rest;
        else delete run.reviewability;
        await ctx.store.save();
        return { run };
      });
    },
  };
}
