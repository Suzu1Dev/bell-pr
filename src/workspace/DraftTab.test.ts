import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as draftChecks from "../../shared/draft-checks";
import type { FollowUpRound } from "../../shared/followups";
import type { PrFeedbackItem } from "../../shared/pr-feedback";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Run } from "../types";
import { DraftTab, SamplePublishedCard } from "./DraftTab";

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

const element = (
  props: Partial<Props> = {},
  draft: Partial<Props["draft"]> = {},
  rounds: Partial<Props["rounds"]> = {},
) =>
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
        async setAiDisclosure() {},
        alwaysDiscloseAi: undefined,
        publishChecks: [],
        async loadPublishChecks() {},
        ...draft,
      },
      actions: { feedbackLoading: false, async fetchPrFeedback() {} },
      rounds: {
        followUpSelection: [],
        setFollowUpSelection() {},
        followUpNote: "",
        setFollowUpNote() {},
        restatements: {},
        setRestatement() {},
        async syncToLatest() {},
        async resolveSyncConflicts() {},
        async undoSync() {},
        async startFollowUp() {},
        async discardFollowUp() {},
        ...rounds,
      },
      ...props,
    });

const render = (
  props: Partial<Props> = {},
  draft: Partial<Props["draft"]> = {},
  rounds: Partial<Props["rounds"]> = {},
) => renderZh(element(props, draft, rounds));

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
  const picked = render(
    {},
    {},
    { followUpSelection: [items[0].url], restatements: { [items[0].url]: "改一個更清楚的名字" } },
  );
  assert.match(picked, /依回饋繼續修正/);
  const first = tag(picked, /aria-label="把 maintainer 在 hello\.ts 第 1 行 的回饋納入下一輪修正"/);
  assert.match(first, /checked=""/);
  assert.match(first, /aria-describedby="pr-feedback-body-1-0"/);
  assert.match(picked, /<p id="pr-feedback-body-1-0">Rename it\.<\/p>/);
  assert.match(picked, /一輪最多 20 則回饋，已選 1 則。/);
  assert.doesNotMatch(tag(picked, /aria-describedby="follow-up-limit"/), /disabled=""/);
  assert.match(picked, /依選取的 1 則回饋修正/);
  // Each picked comment needs the person's own words, 3 or more, first.
  assert.match(picked, /用你的話說：maintainer 要求的是什麼？/);
  assert.match(tag(picked, /id="follow-up-restatement-0"/), /value="改一個更清楚的名字"/);
  for (const words of [undefined, "改名"]) {
    const unstated = render(
      {},
      {},
      { followUpSelection: [items[0].url], restatements: words ? { [items[0].url]: words } : {} },
    );
    assert.match(tag(unstated, /aria-describedby="follow-up-limit"/), /disabled=""/, String(words));
  }
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

test("the target branch panel waits until the run has a checkout to sync", () => {
  const unpublished: Run = {
    ...published,
    prUrl: undefined,
    publishedBranch: undefined,
    followUps: undefined,
    prFeedback: undefined,
  };
  // Queued, or failed before its checkout: no base commit yet.
  for (const status of ["queued", "failed"] as const) {
    const html = render({ run: { ...unpublished, status, baseSha: "" } });
    assert.doesNotMatch(html, /sync-panel/, status);
    assert.doesNotMatch(html, /同步到最新目標分支/, status);
  }
  assert.match(render({ run: { ...unpublished, status: "review" } }), /同步到最新目標分支/);
});

test("before publishing the draft tab leads with the editor, then the guide, then the sync; a published PR leads with its sync and rounds", () => {
  const unpublished: Run = {
    ...published,
    status: "review",
    prUrl: undefined,
    publishedBranch: undefined,
    followUps: undefined,
    prFeedback: undefined,
  };
  const at = (html: string, marker: string) => {
    const index = html.indexOf(marker);
    assert.ok(index >= 0, marker);
    return index;
  };
  const draft = renderEn(element({ run: unpublished }));
  const editor = at(draft, 'class="draft-layout"');
  assert.ok(editor < at(draft, "Loading the draft guidelines…"));
  assert.ok(at(draft, "Loading the draft guidelines…") < at(draft, 'class="sync-panel"'));
  // Copy that points at the guide or the editor follows the order.
  assert.match(
    renderEn(element({ run: { ...unpublished, draft: { title: "t", body: "" } } }, { draftBody: "" })),
    /Generate and apply a suggested draft below/,
  );
  const sent = renderEn(element());
  assert.ok(at(sent, 'class="sync-panel"') < at(sent, 'class="follow-up-rounds"'));
  assert.ok(at(sent, 'class="follow-up-rounds"') < at(sent, 'class="draft-layout"'));
  assert.equal(sent.match(/class="sync-panel"/g)?.length, 1);
});

test("an open follow-up round's draft tab reads in English with no Chinese left", () => {
  const html = renderEn(
    element({ run: inRound }, { followUp: open, commitMessageUnfinished: true }),
  );
  assert.match(html, /This round adds one new commit to the PR branch/);
  assert.match(html, /This round&#x27;s commit message <span>git commit<\/span>/);
  assert.match(html, /This round&#x27;s commit message is written<small>Write which review comments this round addresses<\/small>/);
  assert.match(html, /Push to the same PR/);
  assert.match(tag(html, /aria-label="PR description"/), /disabled=""/);
  // The run's own branch sits inside the help sentence as code.
  assert.match(html, /Left empty, <code>fix\/run1<\/code> is used\./);
  assert.match(html, /Once pushed to GitHub, the branch can no longer change/);
  assertNoHan(html);

  const sync = renderEn(
    element(
      { run: { ...inRound, followUps: [pushed, { ...open, kind: "sync" }] } },
      { followUp: { ...open, kind: "sync" }, draftCommitMessage: "Merge branch 'main' into fix/run1" },
    ),
  );
  assert.match(sync, /This sync adds one merge commit to the PR branch/);
  assertNoHan(sync);
});

test("maintainer feedback and the next round's form read in English with no Chinese left", () => {
  const picked = renderEn(element({}, {}, { followUpSelection: [items[0].url] }));
  assert.match(picked, /Keep fixing from feedback/);
  assert.match(
    tag(picked, /aria-label="Include maintainer&#x27;s feedback on line 1 of hello\.ts in the next round"/),
    /checked=""/,
  );
  assert.match(tag(picked, /aria-label="Include reviewer&#x27;s feedback in the next round"/), /type="checkbox"/);
  assert.match(picked, /Up to 20 comments per round; 1 selected\./);
  assert.match(picked, /Fix the 1 selected comment</);
  assert.match(picked, /Note <span>Optional<\/span>/);
  assert.match(picked, /<span>Line 1<\/span>/);
  assert.match(picked, /Read at /);
  assertNoHan(picked);
  assert.match(
    renderEn(element({}, {}, { followUpSelection: [items[0].url, items[1].url] })),
    /Fix the 2 selected comments</,
  );

  // A new run's draft: the guide, the checklist and the Draft PR notes.
  const unpublished: Run = {
    ...published,
    status: "review",
    prUrl: undefined,
    publishedBranch: undefined,
    followUps: undefined,
    prFeedback: undefined,
  };
  const draft = renderEn(
    element(
      { run: unpublished, files: [], reviewedCount: 0 },
      { draftBody: "", draftDirty: true },
    ),
  );
  assert.match(draft, /Loading the draft guidelines…/);
  assert.match(draft, /There is no PR description yet\./);
  assert.match(draft, /0 \/ 0 files/);
  assert.match(draft, /There are unsaved edits/);
  assert.match(draft, /Submit as a Draft PR/);
  assertNoHan(draft);
});

test("the feedback summary formats the time, the checks and the labels for the locale", () => {
  const withChecks: Run = {
    ...published,
    prFeedback: {
      ...published.prFeedback!,
      items: [],
      checksState: "FAILURE",
      checks: [
        { name: "build", state: "SUCCESS" },
        { name: "lint", state: "FAILURE", url: "https://ci.example/1" },
      ],
      labels: ["needs: tests", "docs"],
    },
  };
  const english = renderEn(element({ run: withChecks }));
  assert.match(
    english,
    /Read at [^<]*2026[^<]* · CI 2 checks: 1 passed, 0 in progress, 1 failed \(overall FAILURE\) · Labels: needs: tests, docs</,
  );
  assert.match(english, /The PR has a label that starts with “needs:”/);
  assert.match(english, /No reviews or comments yet\./);
  assertNoHan(english);
  const chinese = render({ run: withChecks });
  assert.match(
    chinese,
    /讀取時間 [^<]*2026[^<]* · CI 2 項檢查：1 成功、0 進行中、1 失敗（整體 FAILURE） · 標籤：needs: tests、docs</,
  );
});

test("the description's Edit and Preview buttons say which one is on", () => {
  const html = renderEn(element({ run: { ...published, status: "review" } }));
  assert.match(html, /<div role="group" aria-label="Description view">/);
  assert.match(tag(html, /aria-pressed="true"/), /class="selected"/);
  assert.match(html, /aria-pressed="true"[^>]*>Edit</);
  assert.match(html, /aria-pressed="false"[^>]*>Preview</);
  const previewing = renderEn(
    element({ run: { ...published, status: "review" } }, { draftPreview: true }),
  );
  assert.match(previewing, /aria-pressed="false"[^>]*>Edit</);
  assert.match(previewing, /aria-pressed="true"[^>]*>Preview</);
  assertNoHan(html);
});

test("on Free, reading feedback stays open and only starting an AI round is locked with the PRO badge", () => {
  const html = renderEn(element({ feedbackLocked: true }, {}, { followUpSelection: [items[0].url] }));
  // Reading feedback is Free: the button asks GitHub, with no lock and no PRO mark.
  const read = html.match(/<button class="button primary"[^>]*>(?:(?!<\/button>).)*Read feedback again(?:(?!<\/button>).)*<\/button>/)?.[0] ?? "";
  assert.ok(read, "the read button is there");
  assert.doesNotMatch(read, /disabled=""/);
  assert.doesNotMatch(read, /lucide-lock/);
  assert.doesNotMatch(read, /aria-label="Pro feature"/);
  // Every feedback checkbox and the note are locked; the start button opens the dialog.
  for (const box of html.match(/<input type="checkbox"[^>]*aria-label="Include[^>]*>/g) ?? [])
    assert.match(box, /disabled=""/);
  assert.match(tag(html, /id="follow-up-note"/), /disabled=""/);
  const start = tag(html, /aria-describedby="follow-up-limit"/);
  assert.doesNotMatch(start, /disabled=""/);
  assert.match(html, /Keep fixing from feedback<span class="pro-badge"/);
  // The round history, its push and the PR link stay on every plan.
  assert.match(html, /View pull request/);
  assertNoHan(html);
});

test("the sample shows its fictional feedback with a PRO chip and links to nothing", () => {
  const demo = getDemo("en");
  const html = renderEn(
    element({
      demo: true,
      run: {
        ...demo.run,
        status: "published",
        prUrl: "#demo-pr",
        prFeedback: demo.prFeedback,
      },
    }),
  );
  assert.match(html, /Read feedback again<\/button>/);
  // Only the AI round is Pro, and the sample shows its PRO chip on it.
  assert.match(html, /Keep fixing from feedback<span class="pro-badge"/);
  // The sample's restatement shows on its disabled form.
  const restated = demo.restatementSample![0];
  assert.ok(html.includes(`value="${restated.text.replace(/'/g, "&#x27;")}"`));
  assert.match(tag(html, /id="follow-up-restatement-0"/), /disabled=""/);
  // Its PR exists nowhere, so there is nothing to close on GitHub.
  assert.doesNotMatch(html, /Can&#x27;t continue\?/);
  assert.match(html, /sample_maintainer/);
  // No sample link looks like a page on GitHub.
  assert.doesNotMatch(html, /View pull request/);
  assert.doesNotMatch(html, /Open on GitHub/);
  assert.doesNotMatch(html, /href="#demo-pr/);
  // The sample starts no round: its controls are off, and it says why.
  for (const box of html.match(/<input type="checkbox"[^>]*aria-label="Include[^>]*>/g) ?? [])
    assert.match(box, /disabled=""/);
  assert.match(tag(html, /aria-describedby="follow-up-limit"/), /disabled=""/);
  assert.match(html, /The sample starts no round\./);
  assertNoHan(html);
});

test("the published sample shows its own card, which says nothing reached GitHub", () => {
  const demo = getDemo("en");
  const published = {
    ...demo.run,
    status: "published" as const,
    prUrl: "#demo-pr",
    publishedBranch: "retry-backoff",
  };
  const html = renderEn(element({ demo: true, run: published }));
  assert.match(html, /<section class="sample-published" role="status" aria-labelledby="sample-published-title">/);
  assert.ok(html.includes(`<h2 id="sample-published-title">${demo.publishedCard!.title}</h2>`));
  assert.ok(html.includes(demo.publishedCard!.note));
  assert.match(html, /<code>retry-backoff<\/code> → <code>main<\/code>/);
  assertNoHan(html);
  // While the playback pushes, it says so instead.
  const pushing = renderEn(
    createElement(SamplePublishedCard, {
      run: { ...demo.run, status: "approved", publishing: true },
    }),
  );
  assert.match(pushing, /Opening the sample Draft PR…/);
  assert.doesNotMatch(pushing, /sample-published-title/);
  // Before it is published, and for a real run, there is no card.
  assert.equal(renderEn(createElement(SamplePublishedCard, { run: demo.run })), "");
  assert.doesNotMatch(renderEn(element()), /sample-published/);
  assert.match(
    renderZh(createElement(SamplePublishedCard, { run: { ...published, ...getDemo("zh-TW").run, status: "published" } })),
    new RegExp(getDemo("zh-TW").publishedCard!.title),
  );
});

test("the checklist says where the understanding check stands, and offers the forecast while it is off", () => {
  const draftRun: Run = { ...published, status: "review", prUrl: undefined, prFeedback: undefined, followUps: undefined };
  const row = (understanding: Props["understanding"]) =>
    renderEn(element({ run: draftRun, understanding }));
  const required = row({ view: undefined, required: true, passed: false, off: false });
  assert.match(required, /Understanding check<small>Required: explain the change back before approval<\/small>/);
  assert.doesNotMatch(required, /Predict the maintainer/);
  assertNoHan(required);
  assert.match(
    row({ view: undefined, required: true, passed: true, off: false }),
    /<div class="checklist-item checked">.*?Understanding check<small>Passed: you explained the change back<\/small>/,
  );
  const off = row({ view: undefined, required: false, passed: false, off: true });
  assert.match(off, /Understanding check<small>Off: approval needs your reviewed ticks only<\/small>/);
  assert.match(off, /<button type="button" class="run-notice-link">Predict the maintainer<\/button>/);
  assertNoHan(off);
  assert.match(renderZh(element({ run: draftRun, understanding: { view: undefined, required: true, passed: false, off: false } })), /理解檢查/);
  // A published PR keeps the row only for a pass or its "Check off" mark.
  const after = (run: Run) =>
    renderEn(element({ run, understanding: { view: undefined, required: true, passed: false, off: false } }));
  assert.doesNotMatch(after(published), /Understanding check/);
  const marked = after({ ...published, understandingCheckOff: true });
  assert.match(marked, /Understanding check<small>Off: approval needs your reviewed ticks only<\/small>/);
  assert.doesNotMatch(marked, /Predict the maintainer/);
});

test("a real published PR offers to close it yourself; the sample, which has none, does not", () => {
  const html = renderEn(element());
  assert.match(
    html,
    /<p class="pr-feedback-cant"><a href="https:\/\/github\.com\/acme\/widgets\/pull\/3" target="_blank" rel="noreferrer">Can&#x27;t continue\? Close the pull request yourself on GitHub, with a short note in your own words\.<\/a><\/p>/,
  );
  assertNoHan(html);
});
