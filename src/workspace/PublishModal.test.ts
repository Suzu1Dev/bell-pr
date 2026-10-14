import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as draftChecks from "../../shared/draft-checks";
import type { DraftCheck } from "../../shared/draft-checks";
import type { DoctorCheck, DoctorReport } from "../../shared/doctor";
import { maskPath } from "../app/presentation";
import type { DoctorState } from "../setup/useDoctor";
import { demoFiles, demoRepo, demoRun } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Run } from "../types";
import {
  maskPersonalText,
  PublishIdentity,
  PublishModal,
  publishIdentity,
} from "./PublishModal";

type Props = Parameters<typeof PublishModal>[0];

const check = (id: DoctorCheck["id"], fields: Partial<DoctorCheck> = {}): DoctorCheck => ({
  id,
  status: "ok",
  required: false,
  ...fields,
});
const report = (checks: DoctorCheck[]): DoctorReport => ({
  checks,
  ready: true,
  checkedAt: "2026-10-12T00:00:00Z",
  platform: "linux",
});
const doctorWith = (value: DoctorReport | null): DoctorState => ({
  report: value,
  checking: false,
  error: "",
  async refresh() {},
});
/** Git knows who commits and the GitHub CLI is signed in. */
const readyDoctor = doctorWith(
  report([
    check("git-identity", { detail: "Ada Lovelace <ada@example.com>" }),
    check("gh"),
    check("gh-auth", { detail: "ada", params: { login: "ada" } }),
    check("gh-scopes"),
  ]),
);

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
      doctor: readyDoctor,
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

test("the demo previews its PR body and opens the sample PR without any check", () => {
  // No environment report at all: the sample needs neither Git nor the GitHub CLI.
  const html = render({ demo: true, doctor: doctorWith(null) });
  assert.match(html, /你的示範貢獻，準備好了。/);
  assert.match(html, /你已完成所有檔案的審查。以下是 PR 的送出預覽。/);
  assert.match(html, /這是互動示範，不會推送任何內容，也不會在 GitHub 建立 PR/);
  assert.match(html, /開啟範例 Draft PR/);
  assert.match(html, /會送到 GitHub 的 PR 說明（約 \d+ 字）/);
  assert.doesNotMatch(html, /readiness-notice/);
  assert.doesNotMatch(html, /Commit 作者/);
  assert.doesNotMatch(html, /disabled=""/);
});

test("publishing waits for Git's identity and the GitHub CLI, and says how to fix them", () => {
  const missing = renderEn(
    element({
      doctor: doctorWith(
        report([
          check("git-identity", { detail: "Ada Lovelace <ada@example.com>" }),
          check("gh", {
            status: "warn",
            detail: "Not installed",
            fixes: [{ label: "Install", command: "brew install gh" }],
          }),
        ]),
      ),
    }),
  );
  assert.match(missing, /class="readiness-notice"/);
  assert.match(missing, /brew install gh/);
  assert.match(missing, /<button class="button primary" disabled="">.*Submit Draft PR<\/button>/);
  assertNoHan(missing);
  // Still checking: nothing can be sent yet.
  const checking = renderEn(element({ doctor: doctorWith(null) }));
  assert.match(checking, /readiness-checking/);
  assert.match(checking, /<button class="button primary" disabled="">/);
  // Ready: no notice, and the dialog says who commits and pushes.
  const ready = renderEn(element());
  assert.doesNotMatch(ready, /readiness-notice/);
  assert.match(
    ready,
    /Commit author: Ada Lovelace &lt;ada@example\.com&gt; · Pushing as @ada/,
  );
  assert.doesNotMatch(ready, /<button class="button primary" disabled="">/);
});

test("who commits and pushes reads from the checks and is masked while presenting", () => {
  assert.deepEqual(publishIdentity(readyDoctor.report), {
    author: "Ada Lovelace <ada@example.com>",
    login: "ada",
  });
  // A guessed address is what the commit carries; a signed-out CLI pushes as nobody.
  assert.deepEqual(
    publishIdentity(
      report([
        check("git-identity", { status: "warn", params: { email: "ada@laptop.local" } }),
        check("gh-auth", { status: "fail" }),
      ]),
    ),
    { author: "ada@laptop.local" },
  );
  assert.deepEqual(publishIdentity(null), {});
  const masked = renderEn(
    createElement(PublishIdentity, {
      author: "Ada Lovelace <ada@example.com>",
      login: "ada",
      maskUser: () => "you",
    }),
  );
  assert.match(masked, /Commit author: you · Pushing as @you/);
  assert.doesNotMatch(masked, /Ada|ada@/);
  assert.match(
    renderEn(createElement(PublishIdentity, { login: "ada", maskUser: (value: string) => value })),
    /Pushing as @ada/,
  );
  assert.equal(
    renderEn(createElement(PublishIdentity, { maskUser: (value: string) => value })),
    "",
  );
  assert.match(
    renderZh(createElement(PublishIdentity, { author: "Ada <a@b.c>", login: "ada", maskUser: (value: string) => value })),
    /Commit 作者：Ada &lt;a@b\.c&gt; · 以 @ada 推送/,
  );
});

test("preflight results lose e-mail addresses and home paths while presenting", () => {
  const presenting = {
    present: true,
    maskUser: () => "you",
    maskPath: (value: string) => maskPath(value, undefined, true),
  };
  assert.equal(
    maskPersonalText("Found: /home/ada/work/notes.md and ada@example.com", presenting),
    "Found: …/notes.md and you",
  );
  assert.equal(
    maskPersonalText("Found: C:\\Users\\ada\\notes.md", presenting),
    "Found: …/notes.md",
  );
  assert.equal(
    maskPersonalText("Found: /home/ada/notes.md", { ...presenting, present: false }),
    "Found: /home/ada/notes.md",
  );
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
  assert.match(demo, /Open the sample Draft PR/);
  assert.match(demo, /PR description sent to GitHub/);
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
