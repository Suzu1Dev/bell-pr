import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as draftChecks from "../../shared/draft-checks";
import type { FollowUpRound } from "../../shared/followups";
import type { PrFeedbackItem } from "../../shared/pr-feedback";
import { renderZh } from "../test-utils/render";
import type { Run } from "../types";
import { DraftTab } from "./DraftTab";

type Props = Parameters<typeof DraftTab>[0];

const prUrl = "https://github.com/acme/widgets/pull/3";
const pushed: FollowUpRound = {
  id: "r1",
  requestedAt: "2026-10-10T01:00:00Z",
  feedbackUrls: [],
  note: "Rename it.",
  status: "published",
  parentCommit: "a".repeat(40),
  commit: "b".repeat(40),
  publishedAt: "2026-10-10T02:00:00Z",
};
const open: FollowUpRound = {
  id: "r2",
  requestedAt: "2026-10-11T01:00:00Z",
  feedbackUrls: [],
  note: "Only the greeting.",
  status: "review",
  parentCommit: "b".repeat(40),
};
const items: PrFeedbackItem[] = [
  {
    kind: "thread",
    author: "maintainer",
    authorAssociation: "MEMBER",
    body: "Rename it.",
    path: "hello.ts",
    line: 1,
    url: `${prUrl}#discussion_r1`,
    createdAt: "2026-10-10T00:00:00Z",
  },
  {
    kind: "comment",
    author: "reviewer",
    authorAssociation: "CONTRIBUTOR",
    body: "Looks fine otherwise.",
    url: `${prUrl}#issuecomment-2`,
    createdAt: "2026-10-10T00:10:00Z",
  },
];
const published: Run = {
  id: "run-1",
  repoId: "repo-1",
  title: "Greet the world",
  prompt: "Greet the world",
  status: "published",
  branch: "fix/run1",
  baseBranch: "main",
  baseSha: "c".repeat(40),
  createdAt: "2026-10-10T00:00:00Z",
  agents: [],
  logs: [],
  draft: { title: "fix: greet the world", body: "Greets the world." },
  reviewedFiles: [],
  prUrl,
  publishedBranch: "fix/run1",
  headRepository: "acme/widgets",
  followUps: [pushed],
  prFeedback: { fetchedAt: "2026-10-12T00:00:00Z", prNumber: 3, items },
};
const inRound: Run = {
  ...published,
  status: "review",
  followUps: [pushed, open],
};

const render = (
  props: Partial<Props> = {},
  draft: Partial<Props["draft"]> = {},
  rounds: Partial<Props["rounds"]> = {},
) =>
  renderZh(
    createElement(DraftTab, {
      run: published,
      files: [],
      demo: false,
      busy: false,
      active: false,
      preparingDraft: false,
      reviewedCount: 0,
      allReviewed: false,
      setSelectedPath() {},
      setTab() {},
      draft: {
        draftTitle: published.draft.title,
        setDraftTitle() {},
        draftBody: published.draft.body,
        setDraftBody() {},
        draftCommitMessage: "",
        setDraftCommitMessage() {},
        draftPublishBranch: "",
        setDraftPublishBranch() {},
        draftChecks,
        draftPreview: false,
        setDraftPreview() {},
        draftRequests: new Set<string>(),
        draftDirty: false,
        draftUnfinished: undefined,
        draftTaskGroups: [],
        draftIsProposal: false,
        publishBranchError: "",
        publishBranchInvalid: false,
        followUp: undefined,
        commitMessageUnfinished: false,
        commitMessageSuggestion: undefined,
        async prepareDraft() {},
        applyDraftProposal() {},
        applyCommitMessageSuggestion() {},
        async saveDraft() {},
        ...draft,
      },
      actions: { feedbackLoading: false, async fetchPrFeedback() {} },
      rounds: {
        followUpSelection: [],
        setFollowUpSelection() {},
        followUpNote: "",
        setFollowUpNote() {},
        async syncToLatest() {},
        async resolveSyncConflicts() {},
        async undoSync() {},
        async startFollowUp() {},
        async discardFollowUp() {},
        ...rounds,
      },
      ...props,
    }),
  );

/** The opening tag of the first element whose attributes match `marker`. */
const tag = (html: string, marker: RegExp) =>
  html.match(new RegExp(`<[a-z]+[^>]*${marker.source}[^>]*>`))?.[0] ?? "";

test("an open follow-up round keeps the PR text as published and asks for this round's commit message", () => {
  const html = render(
    { run: inRound },
    { followUp: open, commitMessageUnfinished: true },
  );
  // The target branch panel and the round history lead the tab; the draft
  // guide is not offered, since the round never changes the description.
  assert.match(html, /目標分支/);
  assert.match(html, /依 review 修正的紀錄/);
  assert.match(html, /放棄這輪修改/);
  assert.doesNotMatch(html, /正在載入草稿規範/);
  assert.match(html, /這輪修正只會在 PR 分支加上一個新的 commit/);
  assert.match(tag(html, /id="pr-title"/), /disabled=""/);
  assert.match(tag(html, /aria-label="PR 說明"/), /disabled=""/);
  assert.match(tag(html, /id="pr-publish-branch"/), /disabled=""/);
  // The field shows this round's own message, never the title as a fallback.
  assert.match(html, /這輪修正的提交訊息/);
  const message = tag(html, /id="pr-commit-message"/);
  assert.match(message, /maxLength="4000"/);
  assert.doesNotMatch(message, /disabled=""/);
  assert.match(html, /id="pr-commit-message"[^>]*><\/textarea>/);
  assert.match(html, /這輪的提交訊息已填好<small>請寫下這輪處理了哪些 review 意見<\/small>/);
  assert.match(html, /推送到同一個 PR/);
  assert.doesNotMatch(html, /以 Draft PR 送出/);
  assert.doesNotMatch(html, /說明沒有待填寫的內容/);

  const sync = render(
    { run: { ...inRound, followUps: [pushed, { ...open, kind: "sync" }] } },
    {
      followUp: { ...open, kind: "sync" },
      draftCommitMessage: "Merge branch 'main' into fix/run1",
    },
  );
  assert.match(sync, /這次同步會在 PR 分支加上一個合併 commit/);
  assert.match(sync, /checklist-item checked[^>]*>.*?這輪的提交訊息已填好<small>推送時會成為 PR 分支上的新 commit/);
});

test("maintainer feedback on a published PR can be picked for the next round, up to the limit", () => {
  const picked = render({}, {}, { followUpSelection: [items[0].url] });
  assert.match(picked, /依回饋繼續修正/);
  const first = tag(picked, /aria-label="把 maintainer 在 hello\.ts 第 1 行 的回饋納入下一輪修正"/);
  assert.match(first, /checked=""/);
  assert.match(first, /aria-describedby="pr-feedback-body-1-0"/);
  assert.match(picked, /<p id="pr-feedback-body-1-0">Rename it\.<\/p>/);
  assert.match(picked, /一輪最多 20 則回饋，已選 1 則。/);
  assert.doesNotMatch(tag(picked, /aria-describedby="follow-up-limit"/), /disabled=""/);
  assert.match(picked, /依選取的 1 則回饋修正/);
  // Nothing picked and no note: the start button waits.
  const empty = render();
  assert.match(tag(empty, /aria-describedby="follow-up-limit"/), /disabled=""/);
  assert.match(empty, /依補充說明修正/);
  // At the limit only the selected items stay changeable.
  const full = render(
    {},
    {},
    {
      followUpSelection: [
        items[0].url,
        ...Array.from({ length: 19 }, (_, index) => `${prUrl}#discussion_r${index + 10}`),
      ],
    },
  );
  assert.doesNotMatch(tag(full, /aria-label="把 maintainer/), /disabled=""/);
  assert.match(tag(full, /aria-label="把 reviewer/), /disabled=""/);
  // The demo has no target branch to sync with.
  assert.doesNotMatch(render({ demo: true }), /同步到最新目標分支/);
});
