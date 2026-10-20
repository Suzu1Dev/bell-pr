// The linked issue's facts from one GraphQL answer, and the GitHub reader
// they share with the door and pacing reads: its time box, and the reasons
// a read fails for. The answers are canned; nothing runs gh.
import test from "node:test";
import assert from "node:assert/strict";
import { draftPreflight } from "../shared/draft-checks.js";
import {
  FactError,
  githubReader,
  graphqlArgs,
  issueQuery,
  quoteComment,
  readIssueFacts,
  unknownReason,
  type GitHubRead,
} from "./issue-check.js";
import type { command } from "./process.js";
import { AppError } from "./types.js";

const now = Date.parse("2026-10-15T12:00:00Z");
const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
const issue = { owner: "acme", name: "widgets", number: 12, url: "https://github.com/acme/widgets/issues/12" };

const comment = (login: string, association: string, days: number, body: string, typename = "User") => ({
  author: { __typename: typename, login },
  authorAssociation: association,
  createdAt: daysAgo(days),
  body,
  url: `https://github.com/acme/widgets/issues/12#issuecomment-${days}`,
});

function answer(overrides: Record<string, unknown> = {}, viewer = "learner") {
  return {
    data: {
      viewer: { login: viewer },
      repository: {
        issue: {
          number: 12,
          title: "Clarify the retry error",
          url: issue.url,
          state: "OPEN",
          stateReason: null,
          locked: false,
          author: { login: "reporter" },
          labels: { nodes: [{ name: "good first issue", description: "Good for newcomers" }, { name: "needs-triage", description: null }] },
          assignees: { nodes: [{ login: "someone" }] },
          comments: {
            totalCount: 4,
            nodes: [
              comment("old-claimer", "NONE", 40, "I'd like to work on this"),
              comment("claimer", "CONTRIBUTOR", 3, "Can I take this?"),
              comment("maintainer", "MEMBER", 2, "PRs welcome!   <!-- triage note -->\n\nPlease add a test."),
              comment("helper-bot", "NONE", 1, "/assign", "Bot"),
            ],
          },
          closedByPullRequestsReferences: {
            nodes: [{ number: 30, state: "OPEN", isDraft: true, merged: false, url: "https://github.com/acme/widgets/pull/30", closedAt: null, author: { login: "other" } }],
          },
          timelineItems: {
            nodes: [
              { willCloseTarget: false, source: { number: 31, state: "CLOSED", isDraft: false, merged: false, url: "https://github.com/acme/widgets/pull/31", closedAt: daysAgo(10), author: { login: "third" } } },
              { willCloseTarget: true, source: { number: 30, state: "OPEN", isDraft: true, merged: false, url: "https://github.com/acme/widgets/pull/30", closedAt: null, author: { login: "other" } } },
              {},
            ],
          },
          ...overrides,
        },
      },
    },
  };
}

const canned = (value: unknown): GitHubRead => async () => value;

test("one GraphQL call reads the issue with the fields the checks need", async () => {
  const calls: string[][] = [];
  await readIssueFacts(async (args) => {
    calls.push(args);
    return answer();
  }, issue, now);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].filter((arg) => !arg.startsWith("query=")), [
    "graphql",
    "-f",
    "-f",
    "owner=acme",
    "-f",
    "name=widgets",
    "-F",
    "number=12",
  ]);
  for (const field of [
    "state stateReason locked",
    "labels(first: 20) { nodes { name description } }",
    "assignees(first: 10) { nodes { login } }",
    "comments(last: 50)",
    "closedByPullRequestsReferences(first: 20, includeClosedPrs: true)",
    "timelineItems(last: 50, itemTypes: [CROSS_REFERENCED_EVENT])",
    "willCloseTarget",
    "viewer { login }",
  ])
    assert.ok(issueQuery.includes(field), field);
});

test("claims, linked pull requests, the maintainer's word and the person's comments are derived", async () => {
  const { facts, login } = await readIssueFacts(canned(answer()), issue, now);
  assert.equal(login, "learner");
  assert.equal(facts.state, "OPEN");
  assert.equal(facts.title, "Clarify the retry error");
  assert.deepEqual(facts.labels, ["good first issue", "needs-triage"]);
  assert.deepEqual(facts.assignees, ["someone"]);
  // Within 30 days only; a bot is flagged.
  assert.deepEqual(facts.claims, [
    { author: "claimer", at: daysAgo(3) },
    { author: "helper-bot", at: daysAgo(1), bot: true },
  ]);
  // One entry per pull request: a closing reference, and a mention that would not close it.
  assert.deepEqual(facts.otherPrs, [
    { number: 30, state: "OPEN", willClose: true, url: "https://github.com/acme/widgets/pull/30", author: "other" },
    { number: 31, state: "CLOSED", willClose: false, url: "https://github.com/acme/widgets/pull/31", author: "third", closedAt: daysAgo(10) },
  ]);
  assert.deepEqual(facts.maintainerQuote, {
    author: "maintainer",
    association: "MEMBER",
    quote: "PRs welcome! Please add a test.",
    at: daysAgo(2),
  });
  assert.equal(facts.viewerCommented, false);
});

test("the person's own claim and comment are theirs, and older unread comments leave it unknown", async () => {
  const own = await readIssueFacts(
    canned(answer({ comments: { totalCount: 80, nodes: [comment("Learner", "NONE", 1, "I'm working on this")] } })),
    issue,
    now,
  );
  assert.deepEqual(own.facts.claims, []);
  assert.equal(own.facts.viewerCommented, true);
  const unread = await readIssueFacts(
    canned(answer({ comments: { totalCount: 80, nodes: [comment("someone", "NONE", 1, "Same here.")] } })),
    issue,
    now,
  );
  assert.equal("viewerCommented" in unread.facts, false);
  // Opening the issue counts as saying hello.
  const author = await readIssueFacts(canned(answer({ author: { login: "learner" }, comments: { totalCount: 0, nodes: [] } })), issue, now);
  assert.equal(author.facts.viewerCommented, true);
});

test("a closed issue gives issue-closed; another author's closing PR gives issue-has-pr until a reason lifts it", async () => {
  const closed = await readIssueFacts(canned(answer({ state: "CLOSED", stateReason: "NOT_PLANNED" })), issue, now);
  const closedChecks = draftPreflight({ body: "Fixes it.", facts: { checkedAt: daysAgo(0), issue: closed.facts } });
  const block = closedChecks.find((check) => check.id === "issue-closed");
  assert.equal(block?.kind, "block");
  assert.ok(block?.details.includes("GitHub state: CLOSED (NOT_PLANNED)"));

  const open = await readIssueFacts(canned(answer()), issue, now);
  const facts = { checkedAt: daysAgo(0), door: { login: "learner" }, issue: open.facts };
  const hasPr = draftPreflight({ body: "Fixes it.", facts }).find((check) => check.id === "issue-has-pr");
  assert.equal(hasPr?.kind, "block");
  assert.deepEqual(hasPr?.details.slice(1), ["GitHub closedByPullRequestsReferences: #30 by @other"]);
  // A typed reason of 20 to 200 characters lifts it.
  assert.equal(
    draftPreflight({
      body: "Fixes it.",
      facts,
      overrides: [{ id: "issue-has-pr", reason: "Their PR has been idle since June.", at: daysAgo(0) }],
    }).some((check) => check.id === "issue-has-pr"),
    false,
  );
  // Only a closing reference by someone else counts: a mention or the person's own PR does not.
  const mention = await readIssueFacts(
    canned(
      answer({
        closedByPullRequestsReferences: { nodes: [{ number: 40, state: "OPEN", merged: false, author: { login: "learner" } }] },
        timelineItems: { nodes: [{ willCloseTarget: false, source: { number: 41, state: "OPEN", merged: false, author: { login: "other" } } }] },
      }),
    ),
    issue,
    now,
  );
  assert.equal(
    draftPreflight({ body: "Fixes it.", facts: { ...facts, issue: mention.facts } }).some((check) => check.id === "issue-has-pr"),
    false,
  );
});

test("a missing issue or an unreadable answer is a failure, never facts", async () => {
  const missing = answer();
  missing.data.repository.issue = null as never;
  await assert.rejects(readIssueFacts(canned(missing), issue, now), (error: FactError) => error.reason === "not-found");
  await assert.rejects(readIssueFacts(canned({ data: null }), issue, now), (error: FactError) => error.reason === "invalid-answer");
  await assert.rejects(readIssueFacts(canned(answer({ state: 3 })), issue, now), (error: FactError) => error.reason === "invalid-answer");
});

test("maintainer quotes read as on GitHub and stay within 300 characters", () => {
  assert.equal(quoteComment("Go ahead.  <!-- hidden -->\n\n\nThanks!"), "Go ahead. Thanks!");
  // A pasted credential is masked before it is stored.
  const token = `ghp_${"a".repeat(36)}`;
  assert.ok(!quoteComment(`Use ${token} to test it.`).includes(token));
  const long = quoteComment(`${"word ".repeat(100)}end`);
  assert.ok(long.length <= 300);
  assert.ok(long.endsWith("…"));
});

/** A command() stand-in answering one gh call. */
const execute = (result: (args: string[], options: Parameters<typeof command>[2]) => Promise<{ stdout: string }>) =>
  (async (_executable: string, args: string[], options: Parameters<typeof command>[2]) => ({
    ...(await result(args, options)),
    stderr: "",
    code: 0,
  })) as typeof command;

test("the reader runs gh api on github.com, 8 seconds a call at most, within the whole time box", async () => {
  const seen: { args: string[]; timeoutMs?: number }[] = [];
  const read = githubReader({
    timeoutMs: 20_000,
    execute: execute(async (args, options) => {
      seen.push({ args, timeoutMs: options?.timeoutMs });
      return { stdout: '{"ok":true}' };
    }),
  });
  assert.deepEqual(await read(graphqlArgs("query { viewer { login } }", {})), { ok: true });
  assert.deepEqual(seen[0].args.slice(0, 4), ["api", "--hostname", "github.com", "graphql"]);
  assert.equal(seen[0].timeoutMs, 8_000);
  const short = githubReader({
    timeoutMs: 300,
    execute: execute(async (_args, options) => {
      seen.push({ args: [], timeoutMs: options?.timeoutMs });
      return { stdout: "{}" };
    }),
  });
  await short(["user"]);
  assert.ok(seen[1].timeoutMs! <= 300);
  const spent = githubReader({ timeoutMs: 0, execute: execute(async () => ({ stdout: "{}" })) });
  await assert.rejects(spent(["user"]), (error: FactError) => error.reason === "timeout");
});

test("every way a read fails has its reason", async () => {
  const failing = (error: unknown) =>
    githubReader({
      execute: (async () => {
        throw error;
      }) as typeof command,
    });
  const appError = (stderr: string, status = 422, code?: string) =>
    new AppError("gh failed", status, { details: { stderr }, ...(code ? { code: code as never } : {}) });
  for (const [error, reason] of [
    [appError("", 503, "gh_missing"), "gh-missing"],
    [appError("gh auth login", 422, "gh_unauthenticated"), "signed-out"],
    [new AppError("timed out", 504), "timeout"],
    [new AppError("cancelled", 409), "timeout"],
    [appError("gh: API rate limit exceeded for user. (HTTP 403)"), "rate-limited"],
    [appError("gh: Not Found (HTTP 404)"), "not-found"],
    [appError("gh: Could not resolve to a Repository with the name 'acme/gone'."), "not-found"],
    [appError("gh: Resource not accessible by integration (HTTP 403)"), "forbidden"],
    [appError("gh: Bad Gateway (HTTP 502)"), "github-error"],
  ] as const)
    await assert.rejects(failing(error)(["user"]), (thrown: FactError) => thrown.reason === reason, reason);
  assert.equal(unknownReason(new TypeError("x")), "invalid-answer");
  const answering = (stdout: string) => githubReader({ execute: execute(async () => ({ stdout })) });
  await assert.rejects(answering("<html>")(["user"]), (error: FactError) => error.reason === "invalid-answer");
  await assert.rejects(
    answering('{"errors":[{"type":"NOT_FOUND","message":"Could not resolve"}]}')(["graphql"]),
    (error: FactError) => error.reason === "not-found",
  );
  await assert.rejects(
    answering('{"errors":[{"type":"RATE_LIMITED"}]}')(["graphql"]),
    (error: FactError) => error.reason === "rate-limited",
  );
  // gh's own words stay in the message, so a 404 can still be told apart.
  await assert.rejects(failing(appError("gh: Not Found (HTTP 404)"))(["user"]), /gh failed/);
});
