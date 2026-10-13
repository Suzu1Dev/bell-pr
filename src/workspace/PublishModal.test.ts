import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as draftChecks from "../../shared/draft-checks";
import type { DraftCheck } from "../../shared/draft-checks";
import { demoFiles, demoRepo, demoRun } from "../demo";
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

const render = (props: Partial<Props> = {}, draft: Partial<Props["draft"]> = {}) =>
  renderToStaticMarkup(
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
        ...draft,
      },
      publish() {},
      closeModal() {},
      setTab() {},
      ...props,
    }),
  );

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
  assert.match(html, /acme-labs\/open-fetch/);
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
