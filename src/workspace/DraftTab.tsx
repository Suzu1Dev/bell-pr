import { lazy, Suspense, type Dispatch, type SetStateAction } from "react";
import {
  AlertCircle,
  Check,
  Circle,
  CircleCheck,
  ExternalLink,
  Github,
  GitPullRequest,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { DiffFile, Run } from "../types";
import { groupPrFeedback, summarizeChecks } from "../../shared/pr-feedback";
import type { Tab } from "../app/AppShell";
import type { DraftEditor } from "../app/hooks/useDraftEditor";
import type { RunActions } from "../app/hooks/useRunActions";

const DraftGuidancePanel = lazy(() =>
  import("../draft/DraftGuidancePanel").then((module) => ({
    default: module.DraftGuidancePanel,
  })),
);
/** Shared with the publish dialog, so the Markdown renderer loads once. */
export const MarkdownContent = lazy(() =>
  import("../review/MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);

interface DraftTabProps {
  run: Run;
  files: DiffFile[];
  demo: boolean;
  busy: boolean;
  active: boolean;
  preparingDraft: boolean;
  reviewedCount: number;
  allReviewed: boolean;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  setTab: Dispatch<SetStateAction<Tab>>;
  draft: Pick<
    DraftEditor,
    | "draftTitle"
    | "setDraftTitle"
    | "draftBody"
    | "setDraftBody"
    | "draftCommitMessage"
    | "setDraftCommitMessage"
    | "draftPublishBranch"
    | "setDraftPublishBranch"
    | "draftChecks"
    | "draftPreview"
    | "setDraftPreview"
    | "draftRequests"
    | "draftDirty"
    | "draftUnfinished"
    | "draftTaskGroups"
    | "draftIsProposal"
    | "publishBranchError"
    | "publishBranchInvalid"
    | "commitMessageSuggestion"
    | "prepareDraft"
    | "applyDraftProposal"
    | "applyCommitMessageSuggestion"
    | "saveDraft"
  >;
  actions: Pick<RunActions, "feedbackLoading" | "fetchPrFeedback">;
}

/** The PR draft tab: contribution guide, draft editor, checklist and feedback. */
export function DraftTab({
  run,
  files,
  demo,
  busy,
  active,
  preparingDraft,
  reviewedCount,
  allReviewed,
  setSelectedPath,
  setTab,
  draft,
  actions,
}: DraftTabProps) {
  const {
    draftTitle,
    setDraftTitle,
    draftBody,
    setDraftBody,
    draftCommitMessage,
    setDraftCommitMessage,
    draftPublishBranch,
    setDraftPublishBranch,
    draftChecks,
    draftPreview,
    setDraftPreview,
    draftRequests,
    draftDirty,
    draftUnfinished,
    draftTaskGroups,
    draftIsProposal,
    publishBranchError,
    publishBranchInvalid,
    commitMessageSuggestion,
    prepareDraft,
    applyDraftProposal,
    applyCommitMessageSuggestion,
    saveDraft,
  } = draft;
  const { feedbackLoading, fetchPrFeedback } = actions;
  return (
    <div className="draft-workspace">
      <Suspense
        fallback={<p className="muted">正在載入草稿規範…</p>}
      >
        <DraftGuidancePanel
          preparation={run.draftPreparation}
          busy={draftRequests.has(run.id)}
          disabled={
            active ||
            busy ||
            !["review", "approved"].includes(run.status)
          }
          demo={demo}
          issueUrl={run.contributionSettings?.issueUrl}
          onGenerate={prepareDraft}
          onApply={applyDraftProposal}
          applied={
            !!run.draftPreparation?.proposal &&
            draftTitle === run.draftPreparation.proposal.title &&
            !!draftChecks?.sameDraftProse(
              draftBody,
              run.draftPreparation.proposal.body,
            )
          }
        />
      </Suspense>
      <div className="draft-layout">
        <div className="draft-editor">
          <div className="section-heading">
            <div>
              <h2>讓好的改動，也有好的說明。</h2>
              <p>調整草稿，讓維護者輕鬆理解你的貢獻。</p>
            </div>
            <span className="draft-label">DRAFT PR</span>
          </div>
          {!demo && run.status !== "published" && draftIsProposal && (
            <div className="draft-origin-notice" role="status">
              <AlertCircle size={16} />
              <p>
                下方說明是 BELL
                依專案規範產生的建議原文，你還沒有修改。這段文字會原樣送到
                GitHub：送出前請用自己的話確認內容，待辦事項留在上方的核對清單，不要寫進說明。
              </p>
            </div>
          )}
          {!demo &&
            run.status !== "published" &&
            !draftBody.trim() &&
            !preparingDraft && (
              <div className="draft-origin-notice" role="status">
                <AlertCircle size={16} />
                <p>
                  還沒有 PR
                  說明。可以在上方產生並套用建議草稿，或用自己的話寫下改了什麼、為什麼，以及實際執行過哪些檢查。Agent
                  的完整報告在「審查者怎麼看」。
                </p>
              </div>
            )}
          <label className="field-label" htmlFor="pr-title">
            Pull Request 標題
          </label>
          <input
            id="pr-title"
            className="text-input draft-title"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            disabled={run.status === "published"}
          />
          <div className="editor-toolbar">
            <div>
              <button
                className={!draftPreview ? "selected" : ""}
                onClick={() => setDraftPreview(false)}
              >
                編輯
              </button>
              <button
                className={draftPreview ? "selected" : ""}
                onClick={() => setDraftPreview(true)}
              >
                預覽
              </button>
            </div>
            <span>Markdown</span>
          </div>
          {draftPreview ? (
            <div className="markdown-preview">
              <Suspense fallback={<p>正在載入預覽…</p>}>
                <MarkdownContent>{draftBody}</MarkdownContent>
              </Suspense>
            </div>
          ) : (
            <textarea
              className="draft-textarea"
              aria-label="PR 說明"
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              disabled={run.status === "published"}
            />
          )}
          <label
            className="field-label"
            htmlFor="pr-commit-message"
          >
            提交訊息 <span>git commit</span>
          </label>
          <textarea
            id="pr-commit-message"
            className="draft-textarea draft-commit-message"
            aria-describedby="pr-commit-message-help"
            value={draftCommitMessage || draftTitle}
            onChange={(e) =>
              setDraftCommitMessage(e.target.value)
            }
            disabled={run.status === "published"}
          />
          <p id="pr-commit-message-help" className="field-help">
            第一行是主旨，空一行後寫說明，最後放
            trailers。留空時以 PR
            標題作為單行提交訊息。Signed-off-by
            等簽署由你本人輸入，BELL 與模型不會代填。
          </p>
          <label
            className="field-label"
            htmlFor="pr-publish-branch"
          >
            GitHub 分支 <span>git push</span>
          </label>
          <input
            id="pr-publish-branch"
            className="text-input"
            value={draftPublishBranch}
            placeholder={run.branch}
            spellCheck={false}
            aria-describedby="pr-publish-branch-help"
            aria-invalid={publishBranchInvalid}
            onChange={(e) => setDraftPublishBranch(e.target.value)}
            disabled={
              run.status === "published" || !!run.publishedBranch
            }
          />
          <p id="pr-publish-branch-help" className="field-help">
            推送到 GitHub 時使用的分支名稱，留空時使用{" "}
            <code>{run.branch}</code>
            。有些專案規定分支命名，例如不能有斜線或 feat/
            前綴，請依核對清單調整。本機工作分支不會改名。
            {run.publishedBranch &&
              " 已推送到 GitHub 後不能再改分支，以免重複建立 PR。"}
          </p>
          {publishBranchInvalid && (
            <p role="alert" className="inline-error">
              {publishBranchError}
            </p>
          )}
          {commitMessageSuggestion && (
            <div className="commit-suggestion">
              <div>
                <strong>依專案規範建議的提交訊息</strong>
                <p>{commitMessageSuggestion.rationale}</p>
              </div>
              <pre>{commitMessageSuggestion.message}</pre>
              <div className="commit-suggestion-actions">
                <span>只會填入欄位，簽署仍由你補上。</span>
                <button
                  type="button"
                  className="button secondary"
                  disabled={run.status === "published"}
                  onClick={applyCommitMessageSuggestion}
                >
                  採用建議
                </button>
              </div>
            </div>
          )}
          <div className="draft-save-row">
            <span>
              {demo
                ? "示範草稿儲存在此瀏覽器"
                : "草稿儲存在本機工作空間"}
            </span>
            <button
              className="button primary"
              disabled={
                busy || !draftDirty || run.status === "published"
              }
              onClick={saveDraft}
            >
              {busy ? (
                <Loader2 className="spin" size={15} />
              ) : (
                <Check size={15} />
              )}
              儲存草稿
            </button>
          </div>
        </div>
        <aside className="publish-checklist">
          <div className="checklist-icon">
            <GitPullRequest size={24} />
          </div>
          <h3>送出前，最後看一眼。</h3>
          <p>一份清楚的 PR，是一次好合作的開始。</p>
          <div
            className={
              allReviewed
                ? "checklist-item checked"
                : "checklist-item"
            }
          >
            {allReviewed ? (
              <CircleCheck size={18} />
            ) : (
              <Circle size={18} />
            )}
            <span>
              已審閱所有檔案
              <small>
                {reviewedCount} / {files.length} 個檔案
              </small>
            </span>
          </div>
          <div
            className={
              !draftDirty
                ? "checklist-item checked"
                : "checklist-item"
            }
          >
            {!draftDirty ? (
              <CircleCheck size={18} />
            ) : (
              <Circle size={18} />
            )}
            <span>
              PR 草稿已儲存
              <small>
                {draftDirty
                  ? "有尚未儲存的編輯"
                  : "可隨時返回調整內容"}
              </small>
            </span>
          </div>
          <div
            className={
              draftBody.trim() && !draftUnfinished
                ? "checklist-item checked"
                : "checklist-item"
            }
          >
            {draftBody.trim() && !draftUnfinished ? (
              <CircleCheck size={18} />
            ) : (
              <Circle size={18} />
            )}
            <span>
              說明沒有待填寫的內容
              <small>
                {!draftBody.trim()
                  ? "還沒有說明"
                  : draftUnfinished
                    ? draftUnfinished.details.join("\n")
                    : "TODO 與待填空格不會送到 GitHub"}
              </small>
            </span>
          </div>
          {draftTaskGroups.length > 0 && (
            <fieldset
              className="draft-task-items"
              disabled={run.status === "published" || busy}
            >
              <legend>說明中的勾選項目</legend>
              <p>
                只勾你真正完成或確認的項目。BELL
                和模型不會替你勾；勾選會直接改寫左側說明，記得儲存。
              </p>
              {draftTaskGroups.map(([heading, items]) => (
                <div key={`${heading}:${items[0].line}`}>
                  <strong>{heading || "未分段"}</strong>
                  {items.map((item) => (
                    <label key={item.line}>
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setDraftBody((body) =>
                            draftChecks
                              ? draftChecks.setDraftTaskItem(
                                  body,
                                  item.line,
                                  checked,
                                )
                              : body,
                          );
                        }}
                      />
                      <span>{item.text}</span>
                    </label>
                  ))}
                </div>
              ))}
            </fieldset>
          )}
          <div className="checklist-item">
            <ShieldCheck size={18} />
            <span>
              以 Draft PR 送出
              <small>
                送出後仍可在 GitHub
                繼續編輯；專案的自動檢查對 Draft PR 一樣會執行。
              </small>
            </span>
          </div>
        </aside>
      </div>
      {run.status === "published" && run.prUrl && (
        <section
          className="pr-feedback"
          aria-labelledby="pr-feedback-title"
        >
          <div className="section-heading">
            <div>
              <h2 id="pr-feedback-title">維護者回饋</h2>
              <p>
                按下按鈕才會讀取 PR 上的 review、留言與 CI
                結果；BELL 只讀不回，回覆請到 GitHub。
              </p>
            </div>
            <div className="pr-feedback-actions">
              <a
                className="button secondary"
                href={run.prUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Github size={15} />
                查看 Pull Request
                <ExternalLink size={13} />
              </a>
              <button
                className="button primary"
                disabled={feedbackLoading}
                onClick={fetchPrFeedback}
              >
                {feedbackLoading ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  <RefreshCw size={15} />
                )}
                {run.prFeedback ? "重新讀取回饋" : "讀取回饋"}
              </button>
            </div>
          </div>
          {run.prFeedback ? (
            <>
              <p className="pr-feedback-meta">
                讀取時間{" "}
                {new Date(run.prFeedback.fetchedAt).toLocaleString(
                  "zh-TW",
                )}
                {run.prFeedback.checks && (
                  <>
                    {" · CI "}
                    {(() => {
                      const checks = summarizeChecks(
                        run.prFeedback.checks,
                      );
                      return checks.total
                        ? `${checks.total} 項檢查：${checks.success} 成功、${checks.pending} 進行中、${checks.failed} 失敗`
                        : "尚無檢查";
                    })()}
                    {run.prFeedback.checksState &&
                      `（整體 ${run.prFeedback.checksState}）`}
                  </>
                )}
                {!!run.prFeedback.labels?.length &&
                  ` · 標籤：${run.prFeedback.labels.join("、")}`}
              </p>
              {run.prFeedback.labels?.some((label) =>
                label.startsWith("needs:"),
              ) && (
                <p className="pr-feedback-warning">
                  PR 被加上「needs:」開頭的標籤，通常代表專案的自動檢查認為還有項目沒完成；即使
                  CI 顯示成功也一樣。請看下方機器人的留言，並在 GitHub 上修改說明。
                </p>
              )}
              {run.prFeedback.checks?.some(
                (check) =>
                  !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(
                    check.state.toUpperCase(),
                  ),
              ) && (
                <ul className="pr-feedback-checks">
                  {run.prFeedback.checks
                    .filter(
                      (check) =>
                        !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(
                          check.state.toUpperCase(),
                        ),
                    )
                    .map((check) => (
                      <li key={`${check.name}:${check.url ?? ""}`}>
                        <span>{check.name}</span>
                        <b>{check.state}</b>
                        {check.url && (
                          <a
                            href={check.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            詳情
                          </a>
                        )}
                      </li>
                    ))}
                </ul>
              )}
              {run.prFeedback.warnings?.map((warning) => (
                <p className="pr-feedback-warning" key={warning}>
                  {warning}
                </p>
              ))}
              {run.prFeedback.items.length === 0 && (
                <p className="muted">
                  目前還沒有 review 或留言。維護者回應通常需要幾天到幾週；可以先準備回覆思路。
                </p>
              )}
              {groupPrFeedback(run.prFeedback.items).map(
                (group) => (
                  <div
                    className="pr-feedback-group"
                    key={group.path ?? "general"}
                  >
                    <div className="pr-feedback-group-head">
                      <strong>
                        {group.path ?? "整體 review 與對話"}
                      </strong>
                      {group.path &&
                        files.some(
                          (f) => f.path === group.path,
                        ) && (
                          <button
                            className="button secondary"
                            onClick={() => {
                              setSelectedPath(group.path!);
                              setTab("changes");
                            }}
                          >
                            在程式碼變更開啟
                          </button>
                        )}
                    </div>
                    <ul>
                      {group.items.map((item) => (
                        <li key={item.url}>
                          <div className="pr-feedback-item-head">
                            <strong>{item.author}</strong>
                            <span>{item.authorAssociation}</span>
                            {item.state && <span>{item.state}</span>}
                            {typeof item.line === "number" && (
                              <span>第 {item.line} 行</span>
                            )}
                            {item.isResolved && <span>已解決</span>}
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              在 GitHub 開啟
                            </a>
                          </div>
                          <p>{item.body}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              )}
            </>
          ) : (
            <p className="muted">
              尚未讀取。按「讀取回饋」會向 GitHub 查詢一次，不會自動更新。
            </p>
          )}
        </section>
      )}
    </div>
  );
}
