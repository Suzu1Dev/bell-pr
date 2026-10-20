import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { FollowUpRounds } from "./FollowUpRounds";
import type { FollowUpRound } from "../../shared/followups";
import type { PrFeedbackItem } from "../../shared/pr-feedback";

const url = "https://github.com/acme/widgets/pull/3#discussion_r7";
const rounds: FollowUpRound[] = [
  {
    id: "r1",
    requestedAt: "2026-10-10T01:00:00Z",
    feedbackUrls: [url],
    status: "published",
    parentCommit: "a".repeat(40),
    report: "把問候語改成 world。",
    addressed: [{ url, change: "改了問候語。" }],
    commit: "b".repeat(40),
    publishedAt: "2026-10-10T02:00:00Z",
  },
  {
    id: "r2",
    requestedAt: "2026-10-11T01:00:00Z",
    feedbackUrls: [],
    note: "測試另外回覆",
    status: "review",
    parentCommit: "b".repeat(40),
    notAddressed: [{ url: "", reason: "需要維護者決定測試範圍。" }],
  },
];

const feedback: PrFeedbackItem[] = [
  {
    kind: "thread",
    author: "maintainer",
    authorAssociation: "MEMBER",
    body: "Rename it.",
    path: "hello.ts",
    line: 1,
    url,
    createdAt: "2026-10-10T00:00:00Z",
  },
];

test("rounds read newest first, link pushed commits, and offer discard only on the round waiting for review", () => {
  const html = renderZh(
    createElement(FollowUpRounds, {
      rounds,
      headRepository: "acme/widgets",
      feedback,
      onDiscard: () => {},
    }),
  );
  assert.ok(html.indexOf("第 2 輪") < html.indexOf("第 1 輪"));
  assert.match(html, /等待審閱與推送/);
  assert.match(html, /已推送/);
  assert.match(html, /maintainer · hello\.ts:1/);
  assert.match(html, /href="https:\/\/github\.com\/acme\/widgets\/commit\/b{40}"/);
  assert.match(html, /你的補充說明<\/span>需要維護者決定測試範圍/);
  assert.equal(html.match(/放棄這輪修改/g)?.length, 1);
  // Without a discard handler, for example while the agent is still running, no button is shown.
  assert.doesNotMatch(
    renderZh(createElement(FollowUpRounds, { rounds })),
    /放棄這輪修改/,
  );
});

test("English rounds show every status, section and commit state without Han", () => {
  const english: FollowUpRound[] = [
    {
      ...rounds[0],
      report: "Changed the greeting to world.",
      addressed: [{ url, change: "Renamed the greeting." }],
    },
    {
      id: "r2",
      kind: "sync",
      requestedAt: "2026-10-11T01:00:00Z",
      feedbackUrls: [],
      status: "failed",
      parentCommit: "b".repeat(40),
      error: "The merge could not be pushed.",
      conflicts: ["src/a.ts"],
      resolutions: [{ path: "src/a.ts", resolution: "kept both sides" }],
      commit: "c".repeat(40),
    },
    {
      id: "r3",
      adopted: true,
      requestedAt: "2026-10-12T01:00:00Z",
      feedbackUrls: ["https://github.com/acme/widgets/pull/3#issuecomment-9"],
      status: "cancelled",
      parentCommit: "c".repeat(40),
    },
    {
      id: "r4",
      requestedAt: "2026-10-12T02:00:00Z",
      feedbackUrls: [],
      status: "discarded",
      parentCommit: "c".repeat(40),
    },
    {
      id: "r5",
      requestedAt: "2026-10-12T03:00:00Z",
      feedbackUrls: [url],
      note: "Reply to the test question separately.",
      status: "running",
      parentCommit: "c".repeat(40),
      notAddressed: [{ url: "", reason: "The maintainers should choose the test scope." }],
      checks: [{ command: "npm test", outcome: "exit 0" }],
    },
    {
      id: "r6",
      requestedAt: "2026-10-12T04:00:00Z",
      feedbackUrls: [],
      status: "review",
      parentCommit: "c".repeat(40),
    },
  ];
  const html = renderEn(
    createElement(FollowUpRounds, {
      rounds: english,
      headRepository: "acme/widgets",
      feedback,
      onDiscard: () => {},
    }),
  );
  assertNoHan(html);
  assert.match(html, /Changes made after review/);
  // Each chip says its status in words beside the icon, not by color alone.
  for (const [id, status] of [
    ["published", "Pushed"],
    ["failed", "Not completed"],
    ["cancelled", "Stopped"],
    ["discarded", "Discarded"],
    ["running", "Making changes"],
    ["review", "Waiting for review and push"],
  ])
    assert.match(
      html,
      new RegExp(`class="follow-up-status is-${id}"><svg[^>]*aria-hidden="true"[^>]*>[\\s\\S]*?</svg>${status}<`),
      status,
    );
  assert.match(html, /<svg[^>]*class="[^"]*spin[^"]*"[^>]*>[\s\S]*?<\/svg>Making changes</);
  assert.match(html, /<h3>Round 2 · Target branch sync<\/h3>/);
  assert.ok(html.indexOf("Round 6") < html.indexOf("Round 1"));
  assert.match(html, /Round 2 · Target branch sync/);
  assert.match(html, /Round 3 · Picked up from GitHub/);
  assert.match(html, /maintainer · hello\.ts:1/);
  assert.match(html, />Feedback <svg/);
  assert.match(html, /Your note: Reply to the test question separately\./);
  assert.match(html, /Your note<\/span>The maintainers should choose/);
  assert.match(html, /Merge conflicts/);
  assert.match(html, /Commands that actually ran/);
  assert.match(
    html,
    /<a href="https:\/\/github\.com\/acme\/widgets\/commit\/b{40}"[^>]*>bbbbbbb<\/a> pushed /,
  );
  assert.match(html, /<a [^>]*>ccccccc<\/a> created; the push is not confirmed yet/);
  assert.equal(html.match(/Discard this round/g)?.length, 1);
  // Without the owner/name of the PR branch, the commit is shown as code.
  assert.match(
    renderEn(createElement(FollowUpRounds, { rounds: english })),
    /<code>ccccccc<\/code> created/,
  );
});
