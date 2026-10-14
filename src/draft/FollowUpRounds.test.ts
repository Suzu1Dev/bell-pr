import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FollowUpRounds } from "./FollowUpRounds";
import type { FollowUpRound } from "../../shared/followups";

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

test("rounds read newest first, link pushed commits, and offer discard only on the round waiting for review", () => {
  const html = renderToStaticMarkup(
    createElement(FollowUpRounds, {
      rounds,
      headRepository: "acme/widgets",
      feedback: [
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
      ],
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
    renderToStaticMarkup(createElement(FollowUpRounds, { rounds })),
    /放棄這輪修改/,
  );
});
