/**
 * The linked issue's facts (DESIGN F8: "Still open, still yours?"), read in
 * one GraphQL call through `gh api`: its state, labels and assignees, who
 * claimed it, the pull requests that would close it, the latest maintainer
 * comment and whether the person ever commented. The installed gh (2.46)
 * has no `stateReason` or `closedByPullRequestsReferences` in `--json`, so
 * every read is `gh api`.
 *
 * This module also holds what the respect facts share for reading GitHub:
 * the reader with its per-call timeout and the reasons a read fails for.
 * A failed read is never a pass: the caller records it as unknown.
 */
import { AppError } from "./types.js";
import { command, redact } from "./process.js";
import {
  claimComment,
  maintainerAssociation,
  type IssueFacts,
  type IssuePr,
} from "../shared/contribution.js";

/**
 * Why a GitHub fact could not be read: one of the stored codes that
 * shared/contribution.ts unknownReasonText words in the reader's language.
 */
export type UnknownReason =
  | "gh-missing"
  | "signed-out"
  | "timeout"
  | "rate-limited"
  | "not-found"
  | "forbidden"
  | "github-error"
  | "invalid-answer"
  | "no-github-origin"
  | "not-an-issue";

/** A read that failed for a known reason; `message` keeps gh's own text. */
export class FactError extends Error {
  constructor(
    readonly reason: UnknownReason,
    message: string = reason,
  ) {
    super(message);
    this.name = "FactError";
  }
}

/** The reason any error of a GitHub read stands for. */
export function unknownReason(error: unknown): UnknownReason {
  if (error instanceof FactError) return error.reason;
  if (!(error instanceof AppError)) return "invalid-answer";
  if (error.code === "gh_missing") return "gh-missing";
  if (error.code === "gh_unauthenticated") return "signed-out";
  // command() stops a call that ran too long with 504, an aborted one with 409.
  if (error.statusCode === 504 || error.statusCode === 409) return "timeout";
  const stderr = String(error.details?.stderr ?? error.message);
  if (/rate limit|HTTP 429|RATE_LIMITED/i.test(stderr)) return "rate-limited";
  if (/HTTP 404|Not Found|Could not resolve to|NOT_FOUND/i.test(stderr)) return "not-found";
  if (/HTTP 401|gh auth login/i.test(stderr)) return "signed-out";
  if (/HTTP 403|FORBIDDEN|Resource not accessible/i.test(stderr)) return "forbidden";
  return "github-error";
}

/** `gh api --hostname github.com <args>`, parsed; rejects with a FactError. */
export type GitHubRead = (
  args: string[],
  options?: { maxBytes?: number },
) => Promise<unknown>;

/** How long one gh call may take (DESIGN §5.4). */
export const callTimeoutMs = 8_000;

/**
 * A GitHub reader for one batch of reads that together take `timeoutMs`
 * or less, each gh call 8 s or less. `execute` stands in for command() in
 * tests. GraphQL errors in an answer that gh still printed are failures
 * too, by their type.
 */
export function githubReader(
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    execute?: typeof command;
  } = {},
): GitHubRead {
  const execute = options.execute ?? command;
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  return async (args, { maxBytes = 1_000_000 } = {}) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || options.signal?.aborted) throw new FactError("timeout");
    let stdout: string;
    try {
      stdout = (
        await execute("gh", ["api", "--hostname", "github.com", ...args], {
          timeoutMs: Math.min(callTimeoutMs, remaining),
          signal: options.signal,
          maxBytes,
        })
      ).stdout;
    } catch (error) {
      throw new FactError(
        unknownReason(error),
        error instanceof Error ? error.message : String(error),
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(stdout);
    } catch {
      throw new FactError("invalid-answer");
    }
    const errors = (value as { errors?: { type?: unknown; message?: unknown }[] })
      ?.errors;
    if (Array.isArray(errors) && errors.length) {
      const type = String(errors[0]?.type ?? "");
      throw new FactError(
        type === "NOT_FOUND"
          ? "not-found"
          : type === "RATE_LIMITED"
            ? "rate-limited"
            : type === "FORBIDDEN"
              ? "forbidden"
              : "github-error",
        String(errors[0]?.message ?? type),
      );
    }
    return value;
  };
}

/** GraphQL arguments: the query, then string (`-f`) and number (`-F`) variables. */
export function graphqlArgs(
  query: string,
  variables: Record<string, string | number>,
) {
  return [
    "graphql",
    "-f",
    `query=${query}`,
    ...Object.entries(variables).flatMap(([name, value]) => [
      typeof value === "number" ? "-F" : "-f",
      `${name}=${value}`,
    ]),
  ];
}

/** A GitHub login as GitHub writes one (bots excepted). */
export const loginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
const nodes = (value: unknown) => list(record(value)?.nodes).map(record).filter(Boolean) as Record<string, unknown>[];

/** The issue and everything the checks read about it, in one call. */
export const issueQuery = `query BellIssueCheck($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      number title url state stateReason locked
      author { login }
      labels(first: 20) { nodes { name description } }
      assignees(first: 10) { nodes { login } }
      comments(last: 50) {
        totalCount
        nodes { author { __typename login } authorAssociation createdAt body url }
      }
      closedByPullRequestsReferences(first: 20, includeClosedPrs: true) {
        nodes { number state isDraft merged url closedAt author { login } }
      }
      timelineItems(last: 50, itemTypes: [CROSS_REFERENCED_EVENT]) {
        nodes {
          ... on CrossReferencedEvent {
            willCloseTarget
            source {
              ... on PullRequest { number state isDraft merged url closedAt author { login } }
            }
          }
        }
      }
    }
  }
}`;

/** Claims older than this are history, not news. */
const claimDays = 30;
const dayMs = 24 * 60 * 60 * 1000;
const maxQuote = 300;

const sameLogin = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** A bot: GraphQL says so, or the login is an app's ("name[bot]"). */
const isBot = (author: Record<string, unknown> | undefined) =>
  author?.__typename === "Bot" || /\[bot\]$/i.test(text(author?.login) ?? "");

/**
 * A comment as it reads on GitHub, for a short quote: hidden HTML comments
 * out, credentials masked, runs of white space as one, 300 characters or
 * fewer.
 */
export function quoteComment(body: string) {
  const plain = redact(body.replace(/<!--[\s\S]*?-->/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxQuote) return plain;
  const cut = plain.slice(0, maxQuote - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), maxQuote / 2)).trimEnd()}…`;
}

function pullRequest(
  value: Record<string, unknown> | undefined,
  willClose: boolean,
): IssuePr | undefined {
  const number = value?.number;
  const state = text(value?.state);
  if (!Number.isSafeInteger(number) || (number as number) < 1 || !state) return;
  const author = text(record(value?.author)?.login);
  const url = text(value?.url);
  const closedAt = text(value?.closedAt);
  return {
    number: number as number,
    // GitHub's own words: OPEN, CLOSED or MERGED.
    state: value?.merged === true ? "MERGED" : state.toUpperCase(),
    willClose,
    ...(url ? { url } : {}),
    ...(author ? { author } : {}),
    ...(closedAt ? { closedAt } : {}),
  };
}

export interface IssueRead {
  facts: IssueFacts;
  /** The person, as GitHub knows them (`viewer.login`); pacing needs it. */
  login?: string;
}

/**
 * The facts of `issue` (a parsed GitHub issue URL) in one GraphQL call.
 * Derived, with the shared helpers:
 * - claims: other people's claim comments of the last 30 days, bots flagged;
 * - otherPrs: the pull requests GitHub would close it with
 *   (`closedByPullRequestsReferences`, `willCloseTarget`) and the ones
 *   that only mention it (`willClose: false`), so only a closing reference
 *   can raise `issue-has-pr`;
 * - maintainerQuote: the latest OWNER, MEMBER or COLLABORATOR comment by
 *   someone else, quoted in 300 characters or fewer;
 * - viewerCommented: whether the person opened or commented on the issue;
 *   left out when older comments were not read.
 * Rejects with a FactError when GitHub cannot be read or the answer has no
 * such issue.
 */
export async function readIssueFacts(
  read: GitHubRead,
  issue: { owner: string; name: string; number: number; url: string },
  now = Date.now(),
): Promise<IssueRead> {
  const answer = record(
    await read(
      graphqlArgs(issueQuery, {
        owner: issue.owner,
        name: issue.name,
        number: issue.number,
      }),
      { maxBytes: 4_000_000 },
    ),
  );
  const data = record(answer?.data);
  if (!data) throw new FactError("invalid-answer");
  const repository = record(data.repository);
  const found = record(repository?.issue);
  // A pull request's number, or an issue that is gone or hidden from this account.
  if (!found) throw new FactError("not-found");
  const state = text(found.state);
  if (!state) throw new FactError("invalid-answer");
  const viewer = text(record(data.viewer)?.login);
  const login = viewer && loginPattern.test(viewer) ? viewer : undefined;

  const labels = nodes(found.labels)
    .map((label) => text(label.name))
    .filter((name): name is string => !!name)
    .slice(0, 20);
  const assignees = nodes(found.assignees)
    .map((assignee) => text(assignee.login))
    .filter((name): name is string => !!name)
    .slice(0, 10);

  const comments = nodes(found.comments).map((comment) => ({
    author: record(comment.author),
    login: text(record(comment.author)?.login),
    association: text(comment.authorAssociation),
    at: text(comment.createdAt),
    body: text(comment.body) ?? "",
  }));
  const claims = new Map<string, NonNullable<IssueFacts["claims"]>[number]>();
  for (const comment of comments) {
    if (!comment.login || !comment.at || sameLogin(comment.login, login)) continue;
    const at = Date.parse(comment.at);
    if (!Number.isFinite(at) || now - at > claimDays * dayMs) continue;
    if (!claimComment(comment.body)) continue;
    // The latest claim of each person.
    claims.delete(comment.login.toLowerCase());
    claims.set(comment.login.toLowerCase(), {
      author: comment.login,
      at: comment.at,
      ...(isBot(comment.author) ? { bot: true } : {}),
    });
  }
  const maintainer = comments
    .filter(
      (comment) =>
        comment.login &&
        comment.at &&
        !sameLogin(comment.login, login) &&
        !isBot(comment.author) &&
        maintainerAssociation(comment.association) &&
        quoteComment(comment.body),
    )
    .sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!))
    .at(-1);

  const prs = new Map<number, IssuePr>();
  const addPr = (pr: IssuePr | undefined) => {
    if (!pr) return;
    const known = prs.get(pr.number);
    prs.set(pr.number, known ? { ...known, ...pr, willClose: known.willClose || pr.willClose } : pr);
  };
  for (const pr of nodes(found.closedByPullRequestsReferences))
    addPr(pullRequest(pr, true));
  for (const event of nodes(found.timelineItems))
    addPr(pullRequest(record(event.source), event.willCloseTarget === true));

  const commentCount = record(found.comments)?.totalCount;
  const viewerCommented =
    !!login &&
    (sameLogin(text(record(found.author)?.login), login) ||
      comments.some((comment) => sameLogin(comment.login, login)));
  const allRead =
    Number.isSafeInteger(commentCount) && (commentCount as number) <= comments.length;

  const number = found.number;
  const title = text(found.title);
  const stateReason = text(found.stateReason);
  const facts: IssueFacts = {
    url: issue.url,
    ...(Number.isSafeInteger(number) ? { number: number as number } : {}),
    ...(title ? { title } : {}),
    state: state.toUpperCase(),
    ...(stateReason ? { stateReason } : {}),
    ...(typeof found.locked === "boolean" ? { locked: found.locked } : {}),
    labels,
    assignees,
    claims: [...claims.values()].slice(-10),
    otherPrs: [...prs.values()].slice(0, 20),
    ...(maintainer
      ? {
          maintainerQuote: {
            author: maintainer.login!,
            association: maintainer.association!.toUpperCase(),
            quote: quoteComment(maintainer.body),
            at: maintainer.at!,
          },
        }
      : {}),
    // Unknown without the person's login, or when older comments were not read.
    ...(login && (viewerCommented || allRead) ? { viewerCommented } : {}),
  };
  return { facts, ...(login ? { login } : {}) };
}
