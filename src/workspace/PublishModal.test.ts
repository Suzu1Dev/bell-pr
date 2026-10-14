import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as draftChecks from "../../shared/draft-checks";
import type { DraftCheck } from "../../shared/draft-checks";
import { demoFiles, demoRepo, demoRun } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Run } from "../types";
import { PublishModal } from "./PublishModal";

type Props = Parameters<typeof PublishModal>[0];

const run: Run = {
  ...demoRun,
  id: "run-1",
  status: "approved",
  branch: "bell/retry-backoff",
  baseBranch: "main",
  draft: { title: "Add retry backoff", body: "## Summary\n\nRetries GET requests." },
};

const element = (props: Partial<Props> = {}, draft: Partial<Props["draft"]> = {}) =>
  createElement(PublishModal, {
      run,
      files: demoFiles,
      demo: false,
      currentRepo: demoRepo,
      additions: 12,
      deletions: 3,
      busy: false,
      formError: "",
      draft: {
        draftChecks,
        publishBlocked: undefined,
        publishConfirmations: [],
        acknowledged: [],
        setAcknowledged() {},
        followUp: undefined,
        ...draft,
      },
      publish() {},
      closeModal() {},
      setTab() {},
      ...props,
    });

const render = (props: Partial<Props> = {}, draft: Partial<Props["draft"]> = {}) =>
  renderZh(element(props, draft));

const confirm: DraftCheck = {
  id: "brevity",
  kind: "confirm",
  message: "說明很短",
  details: ["請確認維護者看得懂"],
};

test("the publish dialog summarises the reviewed branch before sending a Draft PR", () => {
  const html = render();
  assert.match(html, /<h2 id="modal-title">將這次貢獻送上 GitHub。<\/h2>/);
  assert.match(html, /這會推送審查過的分支，並在目標 repository 建立 Draft PR。/);
  assert.match(html, /openfetch-sample\/open-fetch/);
  assert.match(html, /<h3>Add retry backoff<\/h3>/);
  assert.match(html, /bell\/retry-backoff<span>→<\/span>main/);
  assert.ok(html.includes(`${demoFiles.length} 個檔案已審閱`));
  assert.match(html, /<b>\+12 −3<\/b>/);
  assert.match(html, /會送到 GitHub 的 PR 說明（約 \d+ 字）/);
  // The Markdown renderer is lazy; server rendering shows its fallback.
  assert.match(html, /正在載入預覽…/);
  assert.match(html, /<button class="button primary">.*送出 Draft PR<\/button>/);
  assert.match(html, />返回編輯草稿<\/button>/);
});

test("a chosen publish branch replaces the run branch in the summary", () => {
  const html = render({
    run: { ...run, draft: { ...run.draft, publishBranch: "retry-backoff" } },
  });
  assert.match(html, /retry-backoff<span>→<\/span>main/);
  assert.doesNotMatch(html, /bell\/retry-backoff/);
});

test("blocking checks and unconfirmed items keep Send disabled", () => {
  const blocked = render(
    {},
    {
      publishBlocked: {
        id: "placeholder",
        kind: "block",
        message: "說明還有待填寫的內容",
        details: ["TODO: 補上測試結果"],
      },
    },
  );
  assert.match(blocked, /<p role="alert" class="inline-error">說明還有待填寫的內容\nTODO: 補上測試結果<\/p>/);
  assert.match(blocked, /<button class="button primary" disabled="">/);

  const unconfirmed = render({}, { publishConfirmations: [confirm] });
  assert.match(unconfirmed, /<legend>送出前請逐項確認<\/legend>/);
  assert.match(unconfirmed, /說明很短<small>請確認維護者看得懂<\/small>/);
  assert.match(unconfirmed, /<button class="button primary" disabled="">/);

  const confirmed = render(
    {},
    { publishConfirmations: [confirm], acknowledged: ["brevity"] },
  );
  assert.match(confirmed, /<input type="checkbox" checked=""\/>/);
  assert.doesNotMatch(confirmed, /<button class="button primary" disabled="">/);

  // Until the checks module loads, nothing can be sent.
  assert.match(render({}, { draftChecks: undefined }), /<button class="button primary" disabled="">/);
});

test("a publish error stays in the dialog", () => {
  assert.match(
    render({ formError: "推送失敗" }),
    /<p role="alert" class="inline-error">推送失敗<\/p>/,
  );
});

test("the demo shows a preview and a completion button instead of sending", () => {
  const html = render({ demo: true });
  assert.match(html, /你的示範貢獻，準備好了。/);
  assert.match(html, /你已完成所有檔案的審查。以下是 PR 的送出預覽。/);
  assert.match(html, /這是互動示範，按下完成不會建立 GitHub/);
  assert.match(html, /完成示範審查/);
  assert.doesNotMatch(html, /會送到 GitHub 的 PR 說明/);
  assert.doesNotMatch(html, /disabled=""/);
});

test("a follow-up round previews its commit and pushes to the PR branch instead of opening a PR", () => {
  const round = {
    id: "r2",
    requestedAt: "2026-10-11T01:00:00Z",
    feedbackUrls: [],
    status: "review" as const,
    parentCommit: "b".repeat(40),
  };
  const roundRun: Run = {
    ...run,
    prUrl: "https://github.com/openfetch-sample/open-fetch/pull/3",
    publishedBranch: "retry-backoff",
    draft: {
      ...run.draft,
      publishBranch: "ignored-branch",
      commitMessage: "Rename the option\n\nAddress the review on retry.ts.",
    },
    followUps: [round],
  };
  const html = render({ run: roundRun }, { followUp: round });
  assert.match(html, /<h2 id="modal-title">把這輪修正推到 PR。<\/h2>/);
  assert.match(html, /PR 標題與說明不變，也不會覆蓋 GitHub 上的其他提交/);
  // The pushed branch is fixed once the PR exists.
  assert.match(html, /retry-backoff<span>→<\/span>main/);
  assert.doesNotMatch(html, /ignored-branch/);
  assert.match(
    html,
    /<strong>這輪的提交訊息<\/strong><pre>Rename the option\n\nAddress the review on retry\.ts\.<\/pre>/,
  );
  assert.doesNotMatch(html, /會送到 GitHub 的 PR 說明/);
  assert.match(html, /<button class="button primary">.*推送這輪修正<\/button>/);

  const sync = render(
    { run: roundRun },
    { followUp: { ...round, kind: "sync" } },
  );
  assert.match(sync, /<h2 id="modal-title">把同步結果推到 PR。<\/h2>/);
  assert.match(sync, /這會在 PR 分支加上一個合併 commit/);
});

const round = {
  id: "r2",
  requestedAt: "2026-10-11T01:00:00Z",
  feedbackUrls: [],
  status: "review" as const,
  parentCommit: "b".repeat(40),
};
const roundRun: Run = {
  ...run,
  prUrl: "https://github.com/openfetch-sample/open-fetch/pull/3",
  publishedBranch: "retry-backoff",
  draft: { ...run.draft, commitMessage: "Rename the option" },
  followUps: [round],
};

test("the publish dialog reads in English with no Chinese left", () => {
  const html = renderEn(element());
  assert.match(html, /<h2 id="modal-title">Send this contribution to GitHub\.<\/h2>/);
  assert.ok(html.includes(`${demoFiles.length} files reviewed`));
  assert.match(html, /PR description sent to GitHub \(about \d+ words?\)/);
  assert.match(html, /Loading the preview…/);
  assert.match(html, /<button class="button primary">.*Submit Draft PR<\/button>/);
  assert.match(html, />Back to the draft<\/button>/);
  assert.match(html, /aria-label="Close dialog"/);
  assertNoHan(html);

  const confirmations = renderEn(
    element(
      { formError: "Push failed" },
      {
        publishConfirmations: [
          { ...confirm, message: "The description is short", details: ["Make sure maintainers can follow it"] },
        ],
      },
    ),
  );
  assert.match(confirmations, /<legend>Confirm each item before submitting<\/legend>/);
  assertNoHan(confirmations);

  const demo = renderEn(element({ demo: true }));
  assert.match(demo, /Your demo contribution is ready\./);
  assert.match(demo, /Finish the demo review/);
  assertNoHan(demo);
});

test("an open round's publish dialog reads in English with no Chinese left", () => {
  const html = renderEn(element({ run: roundRun }, { followUp: round }));
  assert.match(html, /<h2 id="modal-title">Push this round to the PR\.<\/h2>/);
  assert.match(html, /<strong>This round&#x27;s commit message<\/strong><pre>Rename the option<\/pre>/);
  assert.match(html, /<button class="button primary">.*Push this round<\/button>/);
  assertNoHan(html);

  const sync = renderEn(element({ run: roundRun }, { followUp: { ...round, kind: "sync" } }));
  assert.match(sync, /<h2 id="modal-title">Push the sync to the PR\.<\/h2>/);
  assertNoHan(sync);
  assert.match(renderEn(element({ busy: true })), /Submitting…/);
});
