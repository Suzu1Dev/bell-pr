import {
  prFeedbackBodyLimit,
  prFeedbackItemLimit,
  type PrCheck,
  type PrFeedback,
  type PrFeedbackItem,
} from "../shared/pr-feedback.js";
import { validPrUrl } from "./draft-sources.js";
import { redact } from "./process.js";
import { AppError } from "./types.js";

/** Newest reviews, comments and threads read per fetch; totalCount reveals what was left out. */
const pageSize = 50;

export const prFeedbackQuery = `query BellPrFeedback($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      url
      reviews(last: ${pageSize}) {
        totalCount
        nodes { author { login } authorAssociation body state url createdAt }
      }
      comments(last: ${pageSize}) {
        totalCount
        nodes { author { login } authorAssociation body url createdAt }
      }
      reviewThreads(last: ${pageSize}) {
        totalCount
        nodes {
          isResolved path line
          comments(first: 10) {
            totalCount
            nodes { author { login } authorAssociation body url createdAt }
          }
        }
      }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              state
              contexts(first: 50) {
                totalCount
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion detailsUrl }
                  ... on StatusContext { context state targetUrl }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

/** PR number of a run's prUrl when it belongs to the repository; undefined otherwise. */
export function prNumberOf(prUrl: unknown, repositoryUrl: string) {
  const number = Number(
    typeof prUrl === "string" ? /\/pull\/(\d+)$/.exec(prUrl)?.[1] : undefined,
  );
  return Number.isSafeInteger(number) &&
    number > 0 &&
    validPrUrl(prUrl, repositoryUrl, number)
    ? number
    : undefined;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const nodes = (connection: any): any[] =>
  Array.isArray(connection?.nodes) ? connection.nodes : [];

function httpsUrl(value: unknown) {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return;
  }
}

/**
 * Turns the GraphQL response into a bounded, redacted feedback record.
 * Bodies are data from other people: masked like logs and cut to 4,000
 * characters, never interpreted. Items whose URL is not an anchor on this
 * PR are dropped rather than trusted.
 */
export function parsePrFeedback(
  response: any,
  options: { repositoryUrl: string; prNumber: number; fetchedAt: string },
): PrFeedback {
  if (Array.isArray(response?.errors) && response.errors.length)
    throw new AppError(
      `GitHub 回傳錯誤：${redact(text(response.errors[0]?.message) || "unknown error").slice(0, 300)}`,
      502,
    );
  const pr = response?.data?.repository?.pullRequest;
  if (!pr) throw new AppError("在 GitHub 找不到這個 PR。", 404);
  if (!validPrUrl(pr.url, options.repositoryUrl, options.prNumber))
    throw new AppError("GitHub 回傳的 PR 網址與工作紀錄不一致。", 422);

  const warnings: string[] = [];
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const items: PrFeedbackItem[] = [];
  let dropped = 0;
  const add = (
    node: any,
    kind: PrFeedbackItem["kind"],
    extra: Pick<PrFeedbackItem, "state" | "path" | "line" | "isResolved"> = {},
  ) => {
    if (!validPrUrl(node?.url, options.repositoryUrl, options.prNumber, true)) {
      dropped++;
      return;
    }
    const body = redact(text(node.body)).slice(0, prFeedbackBodyLimit);
    // GitHub adds an empty COMMENTED review for every batch of inline comments.
    if (!body.trim() && kind === "review" && extra.state === "COMMENTED") return;
    if (items.length >= prFeedbackItemLimit) {
      dropped++;
      return;
    }
    items.push({
      kind,
      author: text(node.author?.login) || "ghost",
      authorAssociation: text(node.authorAssociation) || "NONE",
      body,
      ...(extra.state ? { state: extra.state } : {}),
      ...(extra.path ? { path: extra.path } : {}),
      ...(Number.isSafeInteger(extra.line) ? { line: extra.line } : {}),
      ...(typeof extra.isResolved === "boolean"
        ? { isResolved: extra.isResolved }
        : {}),
      url: node.url,
      createdAt: text(node.createdAt),
    });
  };
  const partial = (connection: any, label: string) => {
    const total = connection?.totalCount;
    if (Number.isSafeInteger(total) && total > nodes(connection).length)
      warn(`${label}只讀取最近 ${nodes(connection).length} 則，共 ${total} 則。`);
  };

  for (const review of nodes(pr.reviews))
    add(review, "review", { state: text(review?.state) || undefined });
  partial(pr.reviews, "Review ");
  for (const comment of nodes(pr.comments)) add(comment, "comment");
  partial(pr.comments, "對話留言");
  for (const thread of nodes(pr.reviewThreads)) {
    const path = text(thread?.path) || undefined;
    for (const comment of nodes(thread?.comments))
      add(comment, "thread", {
        path,
        line: typeof thread?.line === "number" ? thread.line : undefined,
        isResolved:
          typeof thread?.isResolved === "boolean" ? thread.isResolved : undefined,
      });
    partial(thread?.comments, `${path ?? "討論串"} 的回覆`);
  }
  partial(pr.reviewThreads, "程式碼討論串");
  if (dropped)
    warn(
      `${dropped} 則留言未納入：超過 ${prFeedbackItemLimit} 則上限，或連結不屬於這個 PR。`,
    );

  const rollup = nodes(pr.commits)[0]?.commit?.statusCheckRollup;
  const checks: PrCheck[] = nodes(rollup?.contexts).flatMap((context: any) => {
    if (context?.__typename === "CheckRun") {
      const name = text(context.name);
      return name
        ? [
            {
              name,
              state: text(context.conclusion) || text(context.status) || "UNKNOWN",
              ...(httpsUrl(context.detailsUrl) ? { url: httpsUrl(context.detailsUrl) } : {}),
            },
          ]
        : [];
    }
    if (context?.__typename === "StatusContext") {
      const name = text(context.context);
      return name
        ? [
            {
              name,
              state: text(context.state) || "UNKNOWN",
              ...(httpsUrl(context.targetUrl) ? { url: httpsUrl(context.targetUrl) } : {}),
            },
          ]
        : [];
    }
    return [];
  });
  partial(rollup?.contexts, "CI 檢查");

  return {
    fetchedAt: options.fetchedAt,
    prNumber: options.prNumber,
    items,
    ...(text(rollup?.state) ? { checksState: rollup.state } : {}),
    ...(rollup ? { checks } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}
