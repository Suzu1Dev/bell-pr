/**
 * The person's pace of publishing in one repository (DESIGN F10, "Close
 * the loop before the next one"), read in one aliased GraphQL call: their
 * permission there and three search counts, their open pull requests
 * (drafts included, since BELL opens drafts), their merged ones, and the
 * open ones a maintainer asked to change more than 7 days ago. GitHub's
 * search allows 30 requests a minute, so the counts share that one call.
 *
 * The budget is a BELL default (shared/contribution.ts `openPrBudget`) and
 * the same on every plan; people with write access are exempt. Local runs
 * are never limited: only publishing is paced.
 */
import {
  openPrBudget,
  pacingExempt,
  type PacingFacts,
} from "../shared/contribution.js";
import {
  FactError,
  graphqlArgs,
  loginPattern,
  type GitHubRead,
} from "./issue-check.js";

/** How long a requested change may wait before it is "waiting on you". */
const waitingDays = 7;
const dayMs = 24 * 60 * 60 * 1000;

export const pacingQuery = `query BellPacing($owner: String!, $name: String!, $open: String!, $merged: String!, $waiting: String!) {
  repository(owner: $owner, name: $name) { viewerPermission }
  open: search(query: $open, type: ISSUE, first: 1) { issueCount }
  merged: search(query: $merged, type: ISSUE, first: 1) { issueCount }
  waiting: search(query: $waiting, type: ISSUE, first: 10) {
    issueCount
    nodes { ... on PullRequest { url } }
  }
}`;

export const viewerQuery = "query BellViewer { viewer { login } }";

/** The three searches, for `fullName` (owner/name) and the person's login. */
export function pacingSearches(fullName: string, login: string, now = Date.now()) {
  const before = new Date(now - waitingDays * dayMs).toISOString().slice(0, 10);
  const mine = `repo:${fullName} is:pr author:${login}`;
  return {
    open: `${mine} is:open`,
    merged: `${mine} is:merged`,
    waiting: `${mine} is:open review:changes_requested updated:<${before}`,
  };
}

export interface PacingRead {
  facts: PacingFacts;
  /** 1 before the first merged pull request here, 2 after. */
  budget: 1 | 2;
  /** WRITE, MAINTAIN or ADMIN: pacing does not apply. */
  writeAccess: boolean;
  /** Up to 10 of the pull requests a maintainer has waited on for more than 7 days. */
  waiting: string[];
}

const count = (value: unknown) => {
  const issueCount = (value as { issueCount?: unknown } | undefined)?.issueCount;
  if (!Number.isSafeInteger(issueCount) || (issueCount as number) < 0)
    throw new FactError("invalid-answer");
  return issueCount as number;
};

/** The person's GitHub login, when no other read of this batch gave it. */
export async function readViewerLogin(read: GitHubRead) {
  const answer = (await read(graphqlArgs(viewerQuery, {}))) as {
    data?: { viewer?: { login?: unknown } };
  };
  const login = answer?.data?.viewer?.login;
  if (typeof login !== "string" || !loginPattern.test(login))
    throw new FactError("invalid-answer");
  return login;
}

/**
 * Reads the person's pace in `repository`; `login` is theirs (from another
 * read of the same batch, or `readViewerLogin`). Rejects with a FactError
 * when GitHub cannot be read.
 */
export async function readPacing(
  read: GitHubRead,
  repository: { owner: string; name: string; fullName: string },
  login: string,
  now = Date.now(),
): Promise<PacingRead> {
  if (!loginPattern.test(login)) throw new FactError("invalid-answer");
  const answer = (await read(
    graphqlArgs(pacingQuery, {
      owner: repository.owner,
      name: repository.name,
      ...pacingSearches(repository.fullName, login, now),
    }),
  )) as { data?: Record<string, unknown> };
  const data = answer?.data;
  if (!data || typeof data !== "object") throw new FactError("invalid-answer");
  const openPrs = count(data.open);
  const mergedPrs = count(data.merged);
  const waitingPrs = count(data.waiting);
  const permission = (data.repository as { viewerPermission?: unknown } | null)
    ?.viewerPermission;
  const viewerPermission = typeof permission === "string" ? permission : undefined;
  const waiting = (
    ((data.waiting as { nodes?: unknown }).nodes ?? []) as { url?: unknown }[]
  )
    .map((node) => node?.url)
    .filter(
      (url): url is string =>
        typeof url === "string" &&
        url.toLowerCase().startsWith(`https://github.com/${repository.fullName.toLowerCase()}/pull/`),
    )
    .slice(0, 10);
  return {
    facts: {
      openPrs,
      mergedPrs,
      waitingPrs,
      ...(viewerPermission ? { viewerPermission } : {}),
    },
    budget: openPrBudget(mergedPrs),
    writeAccess: pacingExempt(viewerPermission),
    waiting,
  };
}
