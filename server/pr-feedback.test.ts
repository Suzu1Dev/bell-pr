import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePrFeedback,
  prFeedbackQuery,
  prNumberOf,
} from "./pr-feedback.js";
import { AppError } from "./types.js";
import { withLocale } from "./i18n/index.js";
import { assertNoHan } from "../src/test-utils/render.js";
import {
  groupPrFeedback,
  summarizeChecks,
} from "../shared/pr-feedback.js";

const repositoryUrl = "https://github.com/test-owner/example";
const prUrl = `${repositoryUrl}/pull/7`;
const options = {
  repositoryUrl,
  prNumber: 7,
  fetchedAt: "2026-10-08T00:00:00.000Z",
};

/** The shape `gh api graphql` returns for the query, in the order GitHub lists nodes. */
export function graphqlPayload() {
  const person = (login: string, association: string) => ({
    author: { login },
    authorAssociation: association,
  });
  return {
    data: {
      repository: {
        pullRequest: {
          url: prUrl,
          reviews: {
            totalCount: 3,
            nodes: [
              {
                ...person("maintainer", "MEMBER"),
                body: "",
                state: "COMMENTED",
                url: `${prUrl}#pullrequestreview-1`,
                createdAt: "2026-10-07T01:00:00Z",
              },
              {
                ...person("maintainer", "MEMBER"),
                body: "Please split the helper and add a test. Token ghp_abcdefghijklmnopqrstuvwxyz0123 must not leak.",
                state: "CHANGES_REQUESTED",
                url: `${prUrl}#pullrequestreview-2`,
                createdAt: "2026-10-07T02:00:00Z",
              },
              {
                ...person("owner", "OWNER"),
                body: "",
                state: "APPROVED",
                url: `${prUrl}#pullrequestreview-3`,
                createdAt: "2026-10-07T03:00:00Z",
              },
            ],
          },
          comments: {
            totalCount: 2,
            nodes: [
              {
                ...person("bot", "NONE"),
                body: "Thanks for the PR!",
                url: `${prUrl}#issuecomment-10`,
                createdAt: "2026-10-07T00:30:00Z",
              },
              {
                ...person("someone", "CONTRIBUTOR"),
                body: "Spoofed",
                url: "https://github.com/other/repo/pull/7#issuecomment-11",
                createdAt: "2026-10-07T00:40:00Z",
              },
            ],
          },
          reviewThreads: {
            totalCount: 1,
            nodes: [
              {
                isResolved: false,
                path: "hello.ts",
                line: 1,
                comments: {
                  totalCount: 2,
                  nodes: [
                    {
                      ...person("maintainer", "MEMBER"),
                      body: 'Prefer a named export over `"after"` here.',
                      url: `${prUrl}#discussion_r100`,
                      createdAt: "2026-10-07T02:00:10Z",
                    },
                    {
                      ...person("test-owner", "CONTRIBUTOR"),
                      body: "Good point, will change.",
                      url: `${prUrl}#discussion_r101`,
                      createdAt: "2026-10-07T02:05:00Z",
                    },
                  ],
                },
              },
            ],
          },
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    state: "FAILURE",
                    contexts: {
                      totalCount: 3,
                      nodes: [
                        {
                          __typename: "CheckRun",
                          name: "build",
                          status: "COMPLETED",
                          conclusion: "SUCCESS",
                          detailsUrl: "https://github.com/test-owner/example/actions/runs/1",
                        },
                        {
                          __typename: "CheckRun",
                          name: "test",
                          status: "IN_PROGRESS",
                          conclusion: null,
                          detailsUrl: "javascript:alert(1)",
                        },
                        {
                          __typename: "StatusContext",
                          context: "ci/lint",
                          state: "FAILURE",
                          targetUrl: "https://ci.example/lint/1",
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
}

test("the query asks for reviews, comments, threads with path/line/resolution and both check shapes", () => {
  assert.match(prFeedbackQuery, /pullRequest\(number: \$number\)/);
  assert.match(prFeedbackQuery, /reviewThreads\(last: 50\)[\s\S]*isResolved path line/);
  assert.match(prFeedbackQuery, /\.\.\. on CheckRun \{ name status conclusion detailsUrl \}/);
  assert.match(prFeedbackQuery, /\.\.\. on StatusContext \{ context state targetUrl \}/);
  assert.match(prFeedbackQuery, /statusCheckRollup/);
});

test("prNumberOf accepts only this repository's PR URL", () => {
  assert.equal(prNumberOf(prUrl, repositoryUrl), 7);
  assert.equal(prNumberOf(`${repositoryUrl}/pull/7?x=1`, repositoryUrl), undefined);
  assert.equal(prNumberOf("https://github.com/other/example/pull/7", repositoryUrl), undefined);
  assert.equal(prNumberOf(undefined, repositoryUrl), undefined);
  assert.equal(prNumberOf(`${repositoryUrl}/pull/0`, repositoryUrl), undefined);
});

test("a realistic payload becomes reviews first, then comments, then thread comments with path, line and resolution", () => {
  const feedback = parsePrFeedback(graphqlPayload(), options);
  assert.equal(feedback.prNumber, 7);
  assert.equal(feedback.fetchedAt, options.fetchedAt);
  assert.deepEqual(
    feedback.items.map((item) => [item.kind, item.author, item.state ?? item.path]),
    [
      ["review", "maintainer", "CHANGES_REQUESTED"],
      ["review", "owner", "APPROVED"],
      ["comment", "bot", undefined],
      ["thread", "maintainer", "hello.ts"],
      ["thread", "test-owner", "hello.ts"],
    ],
  );
  // The empty COMMENTED review GitHub adds for inline batches is noise; an empty APPROVED review is a decision.
  assert.ok(!feedback.items.some((item) => item.state === "COMMENTED"));
  // Bodies are masked like logs and never carry a token.
  assert.match(feedback.items[0].body, /Token \[REDACTED\] must not leak/);
  assert.doesNotMatch(JSON.stringify(feedback), /ghp_/);
  const thread = feedback.items[3];
  assert.deepEqual(
    { path: thread.path, line: thread.line, isResolved: thread.isResolved, association: thread.authorAssociation },
    { path: "hello.ts", line: 1, isResolved: false, association: "MEMBER" },
  );
  assert.equal(thread.url, `${prUrl}#discussion_r100`);
  // The comment whose URL points at another PR was dropped and reported.
  assert.ok(!feedback.items.some((item) => item.body === "Spoofed"));
  assert.ok(feedback.warnings?.some((warning) => /1 則留言未納入/.test(warning)));
  // Checks keep both shapes; a non-https details URL is dropped, not rendered.
  assert.equal(feedback.checksState, "FAILURE");
  assert.deepEqual(feedback.checks, [
    { name: "build", state: "SUCCESS", url: "https://github.com/test-owner/example/actions/runs/1" },
    { name: "test", state: "IN_PROGRESS" },
    { name: "ci/lint", state: "FAILURE", url: "https://ci.example/lint/1" },
  ]);
  assert.deepEqual(summarizeChecks(feedback.checks), {
    total: 3,
    success: 1,
    pending: 1,
    failed: 1,
  });
  const groups = groupPrFeedback(feedback.items);
  assert.deepEqual(
    groups.map((group) => [group.path, group.items.length]),
    [
      [undefined, 3],
      ["hello.ts", 2],
    ],
  );
});

test("items are capped at 100, bodies at 4,000 characters, and partial pages are reported", () => {
  const payload = graphqlPayload();
  const pr = payload.data.repository.pullRequest;
  pr.comments = {
    totalCount: 400,
    nodes: Array.from({ length: 120 }, (_, index) => ({
      author: { login: `user${index}` },
      authorAssociation: "NONE",
      body: "x".repeat(5_000),
      url: `${prUrl}#issuecomment-${index + 100}`,
      createdAt: "2026-10-07T00:00:00Z",
    })),
  };
  const feedback = parsePrFeedback(payload, options);
  assert.equal(feedback.items.length, 100);
  assert.ok(feedback.items.every((item) => item.body.length <= 4_000));
  // Reviews come first and the review threads after the cap are counted as dropped.
  assert.equal(feedback.items[0].kind, "review");
  assert.ok(feedback.warnings?.some((warning) => /對話留言只讀取最近 120 則，共 400 則/.test(warning)));
  assert.ok(feedback.warnings?.some((warning) => /超過 100 則上限/.test(warning)));
});

test("in English, partial pages, dropped comments and GitHub errors are reported without Han", () => {
  const pr = graphqlPayload().data.repository.pullRequest;
  pr.reviewThreads.nodes[0].comments.totalCount = 12;
  const payload = {
    data: {
      repository: {
        pullRequest: {
          ...pr,
          comments: {
            totalCount: 400,
            nodes: Array.from({ length: 120 }, (_, index) => ({
              author: { login: `user${index}` },
              authorAssociation: "NONE",
              body: "Thanks.",
              url: `${prUrl}#issuecomment-${index + 100}`,
              createdAt: "2026-10-07T00:00:00Z",
            })),
          },
          labels: { totalCount: 101, nodes: [{ name: "bug" }] },
        },
      },
    },
  };
  const feedback = withLocale("en", () => parsePrFeedback(payload, options));
  const warnings = feedback.warnings ?? [];
  assert.ok(
    warnings.includes("Only the latest 120 of 400 conversation comments were read."),
    warnings.join("\n"),
  );
  assert.ok(
    warnings.some((warning) =>
      /^Only the first \d+ of 12 replies on hello\.ts were read\.$/.test(warning),
    ),
    warnings.join("\n"),
  );
  assert.ok(
    warnings.some((warning) =>
      /^\d+ comments were left out: they are over the limit of 100/.test(warning),
    ),
  );
  assert.ok(warnings.includes("Only 1 of 101 PR labels were read; the labels left out may include ones that start with needs:."));
  for (const warning of warnings) assertNoHan(warning);
  assert.throws(
    () =>
      withLocale("en", () =>
        parsePrFeedback({ errors: [{ message: "Bad credentials" }] }, options),
      ),
    { message: "GitHub returned an error: Bad credentials" },
  );
});

test("missing or mismatched PRs and GraphQL errors are reported as application errors", () => {
  assert.throws(
    () => parsePrFeedback({ data: { repository: { pullRequest: null } } }, options),
    (error: unknown) => error instanceof AppError && error.statusCode === 404,
  );
  assert.throws(
    () =>
      parsePrFeedback(
        { errors: [{ message: "Could not resolve to a PullRequest with the number of 7." }] },
        options,
      ),
    (error: unknown) =>
      error instanceof AppError && error.statusCode === 502 && /Could not resolve/.test(error.message),
  );
  const payload = graphqlPayload();
  payload.data.repository.pullRequest.url = "https://github.com/other/example/pull/7";
  assert.throws(
    () => parsePrFeedback(payload, options),
    (error: unknown) => error instanceof AppError && error.statusCode === 422,
  );
  // A PR with no rollup (no CI configured) still parses; checks stay undefined rather than empty.
  const quiet = graphqlPayload();
  quiet.data.repository.pullRequest.commits = { nodes: [{ commit: { statusCheckRollup: null } }] } as any;
  const feedback = parsePrFeedback(quiet, options);
  assert.equal(feedback.checks, undefined);
  assert.equal(feedback.checksState, undefined);
});

test("PR labels are kept, so a compliance label shows even when its check run succeeded", () => {
  assert.match(
    prFeedbackQuery,
    /labels\(first: 100\) \{ totalCount nodes \{ name \} \}/,
  );
  const payload = graphqlPayload();
  (payload.data.repository.pullRequest as Record<string, unknown>).labels = {
    totalCount: 3,
    nodes: [{ name: "needs:compliance" }, { name: "" }, {}],
  };
  const feedback = parsePrFeedback(payload, options);
  assert.deepEqual(feedback.labels, ["needs:compliance"]);
  assert.ok(!feedback.warnings?.some((warning) => warning.includes("標籤")));
  // A cut-off label list says so, since the missing one may be a needs: label.
  const many = graphqlPayload();
  (many.data.repository.pullRequest as Record<string, unknown>).labels = {
    totalCount: 120,
    nodes: Array.from({ length: 100 }, (_, index) => ({ name: `area:${index}` })),
  };
  assert.ok(
    parsePrFeedback(many, options).warnings?.some((warning) =>
      warning.includes("PR 標籤只讀取 100 個，共 120 個"),
    ),
  );
  // Reads without labels keep the earlier shape.
  assert.equal("labels" in parsePrFeedback(graphqlPayload(), options), false);
});
