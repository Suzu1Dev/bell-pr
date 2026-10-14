import { Suspense, type Dispatch, type SetStateAction } from "react";
import {
  BookOpen,
  CircleCheck,
  GitBranch,
  Github,
  GitPullRequest,
  Loader2,
} from "lucide-react";
import type { DiffFile, Repo, Run } from "../types";
import type { Tab } from "../app/AppShell";
import { ErrorBoundary } from "../app/ErrorBoundary";
import type { DraftEditor } from "../app/hooks/useDraftEditor";
import { Modal } from "../modals/Modal";
import { MarkdownContent } from "./DraftTab";

interface PublishModalProps {
  run: Run;
  files: DiffFile[];
  demo: boolean;
  currentRepo: Repo | undefined;
  additions: number;
  deletions: number;
  busy: boolean;
  formError: string;
  draft: Pick<
    DraftEditor,
    | "draftChecks"
    | "publishBlocked"
    | "publishConfirmations"
    | "acknowledged"
    | "setAcknowledged"
    | "followUp"
  >;
  publish: () => void;
  closeModal: () => void;
  setTab: Dispatch<SetStateAction<Tab>>;
}

/**
 * The last look before the approved branch is pushed as a Draft PR, or a
 * follow-up round as one more commit on the PR's branch.
 */
export function PublishModal({
  run,
  files,
  demo,
  currentRepo,
  additions,
  deletions,
  busy,
  formError,
  draft,
  publish,
  closeModal,
  setTab,
}: PublishModalProps) {
  const {
    draftChecks,
    publishBlocked,
    publishConfirmations,
    acknowledged,
    setAcknowledged,
    followUp,
  } = draft;
  return (
    <Modal
      title={
        demo
          ? "你的示範貢獻，準備好了。"
          : followUp?.kind === "sync"
            ? "把同步結果推到 PR。"
            : followUp
              ? "把這輪修正推到 PR。"
              : "將這次貢獻送上 GitHub。"
      }
      subtitle={
        demo
          ? "你已完成所有檔案的審查。以下是 PR 的送出預覽。"
          : followUp?.kind === "sync"
            ? "這會在 PR 分支加上一個合併 commit，把目標分支的最新版本帶進 PR；PR 標題與說明不變，也不會 force push。"
            : followUp
              ? "這會在 PR 分支加上一個新的 commit，PR 標題與說明不變，也不會覆蓋 GitHub 上的其他提交。"
              : "這會推送審查過的分支，並在目標 repository 建立 Draft PR。"
      }
      onClose={closeModal}
    >
      <div className="publish-summary">
        <span>
          <Github size={16} />
          {currentRepo?.fullName}
        </span>
        <h3>{run.draft.title}</h3>
        <div>
          <GitBranch size={14} />
          {followUp
            ? (run.publishedBranch ?? run.branch)
            : run.draft.publishBranch || run.branch}
          <span>→</span>
          {run.baseBranch}
        </div>
        <p>
          <CircleCheck size={15} />
          {files.length} 個檔案已審閱{" "}
          <b>
            +{additions} −{deletions}
          </b>
        </p>
      </div>
      {demo && (
        <div className="callout">
          <BookOpen size={18} />
          <p>
            這是互動示範，按下完成不會建立 GitHub
            PR。匯入你自己的專案，就能開始真正的貢獻。
          </p>
        </div>
      )}
      {!demo && followUp && (
        <div className="publish-commit-preview">
          <strong>這輪的提交訊息</strong>
          <pre>{run.draft.commitMessage}</pre>
        </div>
      )}
      {!demo && !followUp && (
        <details className="publish-body-preview" open>
          <summary>
            會送到 GitHub 的 PR 說明
            {draftChecks &&
              `（約 ${draftChecks.draftProseWords(run.draft.body)} 字）`}
          </summary>
          <div className="markdown-preview">
            <ErrorBoundary>
              <Suspense fallback={<p>正在載入預覽…</p>}>
                <MarkdownContent>{run.draft.body}</MarkdownContent>
              </Suspense>
            </ErrorBoundary>
          </div>
        </details>
      )}
      {!demo && publishBlocked && (
        <p role="alert" className="inline-error">
          {[publishBlocked.message, ...publishBlocked.details].join("\n")}
        </p>
      )}
      {!demo && publishConfirmations.length > 0 && (
        <fieldset className="publish-confirmations">
          <legend>送出前請逐項確認</legend>
          {publishConfirmations.map((check) => (
            <label key={check.id}>
              <input
                type="checkbox"
                checked={acknowledged.includes(check.id)}
                onChange={(event) =>
                  setAcknowledged((previous) =>
                    event.target.checked
                      ? [...previous, check.id]
                      : previous.filter((id) => id !== check.id),
                  )
                }
              />
              <span>
                {check.message}
                {check.details.map((detail) => (
                  <small key={detail}>{detail}</small>
                ))}
              </span>
            </label>
          ))}
          <p>
            勾選只代表你知道這些項目還沒處理、願意照目前的說明送出。BELL
            不會因此改動說明或替你勾選任何項目，這些確認也不會寫進
            PR。想先修改，請按「返回編輯草稿」。
          </p>
        </fieldset>
      )}
      {formError && (
        <p role="alert" className="inline-error">
          {formError}
        </p>
      )}
      <div className="modal-actions">
        <button
          className="button secondary"
          onClick={() => {
            closeModal();
            setTab("draft");
          }}
        >
          返回編輯草稿
        </button>
        <button
          className="button primary"
          disabled={
            busy ||
            (!demo &&
              (!draftChecks ||
                !!publishBlocked ||
                publishConfirmations.some(
                  (check) => !acknowledged.includes(check.id),
                )))
          }
          onClick={publish}
        >
          {busy ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <GitPullRequest size={16} />
          )}{" "}
          {demo
            ? "完成示範審查"
            : busy
              ? "正在送出…"
              : followUp
                ? "推送這輪修正"
                : "送出 Draft PR"}
        </button>
      </div>
    </Modal>
  );
}
