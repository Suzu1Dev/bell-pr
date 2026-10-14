import type { Dispatch, SetStateAction } from "react";
import {
  Activity,
  ArrowDownToLine,
  Bot,
  Check,
  CheckCheck,
  ChevronRight,
  Code2,
  ExternalLink,
  FileText,
  GitBranch,
  Github,
  GitPullRequest,
  Globe2,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { DiffFile, Repo, Run } from "../types";
import type { useProjectInsights } from "../mission/useProjectInsights";
import type { ContributionRecommendation } from "../../shared/insights";
import type { Tab } from "../app/AppShell";
import { statusLabels } from "../app/labels";
import type { DraftEditor } from "../app/hooks/useDraftEditor";
import type { RunActions } from "../app/hooks/useRunActions";
import type { RunRounds } from "../app/hooks/useRunRounds";
import { ActivityTab } from "./ActivityTab";
import { ChangesTab } from "./ChangesTab";
import { DraftTab } from "./DraftTab";
import { OverviewTab } from "./OverviewTab";

interface WorkspacePageProps {
  run: Run;
  files: DiffFile[];
  /** The changed file open in the code view. */
  file: DiffFile | undefined;
  selectedPath: string;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  currentRepo: Repo | undefined;
  demo: boolean;
  /** The changes tab is open: the heading collapses to one row. */
  reading: boolean;
  active: boolean;
  busy: boolean;
  /** The run can still be changed: a real run in review or approved. */
  editable: boolean;
  reviewRerunning: boolean;
  preparingDraft: boolean;
  additions: number;
  deletions: number;
  tab: Tab;
  setTab: Dispatch<SetStateAction<Tab>>;
  focusMode: boolean;
  setFocusMode: Dispatch<SetStateAction<boolean>>;
  showFiles: boolean;
  setShowFiles: Dispatch<SetStateAction<boolean>>;
  showExplanation: boolean;
  setShowExplanation: Dispatch<SetStateAction<boolean>>;
  codeFont: number;
  setCodeFont: Dispatch<SetStateAction<number>>;
  explanationWidth: number;
  setExplanationWidth: Dispatch<SetStateAction<number>>;
  fileSearch: string;
  setFileSearch: Dispatch<SetStateAction<string>>;
  onlyUnreviewed: boolean;
  setOnlyUnreviewed: Dispatch<SetStateAction<boolean>>;
  suggestedOrder: boolean;
  setSuggestedOrder: Dispatch<SetStateAction<boolean>>;
  diffView: "unified" | "split";
  setDiffView: Dispatch<SetStateAction<"unified" | "split">>;
  /** Agent id the run log is filtered by, or "all". */
  logFilter: string;
  setLogFilter: Dispatch<SetStateAction<string>>;
  intelligence: ReturnType<typeof useProjectInsights>;
  explanationRequests: Set<string>;
  prepareExplanations: (
    id: string,
    retry?: boolean,
    filePath?: string,
  ) => Promise<void>;
  beginContribution: () => void;
  chooseRecommendation: (idea: ContributionRecommendation) => void;
  draft: DraftEditor;
  actions: RunActions;
  rounds: RunRounds;
  /** Updates BELL's clone to the latest default branch; absent for local imports and the demo. */
  onUpdateRepo?: () => void;
  updatingRepo: boolean;
}

/**
 * The contribution workspace: the run's heading, the progress strip, the
 * four tabs and the review footer with the approve button.
 */
export function WorkspacePage({
  run,
  files,
  file,
  selectedPath,
  setSelectedPath,
  currentRepo,
  demo,
  reading,
  active,
  busy,
  editable,
  reviewRerunning,
  preparingDraft,
  additions,
  deletions,
  tab,
  setTab,
  focusMode,
  setFocusMode,
  showFiles,
  setShowFiles,
  showExplanation,
  setShowExplanation,
  codeFont,
  setCodeFont,
  explanationWidth,
  setExplanationWidth,
  fileSearch,
  setFileSearch,
  onlyUnreviewed,
  setOnlyUnreviewed,
  suggestedOrder,
  setSuggestedOrder,
  diffView,
  setDiffView,
  logFilter,
  setLogFilter,
  intelligence,
  explanationRequests,
  prepareExplanations,
  beginContribution,
  chooseRecommendation,
  draft,
  actions,
  rounds,
  onUpdateRepo,
  updatingRepo,
}: WorkspacePageProps) {
  const { draftDirty, draftUnfinished, followUp, commitMessageUnfinished } =
    draft;
  const { approve } = actions;
  // In reading mode the one-row heading clips the repo/branch text, so the
  // export link moves up next to 新增貢獻 where it stays visible and reachable.
  const exportLink = !demo && (
    <a
      className="export-link"
      href={`/api/runs/${run.id}/export.md`}
      download={`bell-learning-${run.id}.md`}
    >
      <ArrowDownToLine size={13} />
      匯出學習紀錄（Markdown）
    </a>
  );
  const reviewedCount = files.filter((f) =>
    run.reviewedFiles.includes(f.path),
  ).length;
  const allReviewed = files.length > 0 && reviewedCount === files.length;
  // Progress strip index: 0 定義任務, 1 Agent 開發, 2 理解與審查, 3 送出貢獻;
  // 4 marks every step done. Failed and cancelled runs stay on step 02.
  const currentStep: number = (
    {
      queued: 1,
      awaiting_plan: 1,
      running: 1,
      failed: 1,
      cancelled: 1,
      review: 2,
      approved: 3,
      published: 4,
    } satisfies Record<Run["status"], number>
  )[run.status];
  const halted = ["failed", "cancelled"].includes(run.status);
  return (
    <>
      <section className="workspace-heading">
        <div className="heading-top">
          <div className="eyebrow">
            <GitPullRequest size={15} />
            <span>CONTRIBUTION WORKSPACE</span>
            {demo && <span className="demo-pill">互動示範</span>}
          </div>
          {reading && exportLink}
          <button
            className="button secondary new-task-button"
            onClick={() => beginContribution()}
          >
            <Plus size={15} /> 新增貢獻
          </button>
        </div>
        <div className="title-row">
          <h1 tabIndex={-1} title={reading ? run.title : undefined}>
            {run.title}
          </h1>
          <span
            className={`status-badge ${run.status === "failed" ? "error" : ""}`}
          >
            <span />
            {statusLabels[run.status]}
          </span>
        </div>
        <div
          className="repo-meta"
          title={
            reading
              ? `${currentRepo?.fullName || "Repository"} · ${run.branch} → ${run.baseBranch}`
              : undefined
          }
        >
          <span>
            <Github size={15} />
            {currentRepo?.fullName || "Repository"}
          </span>
          <i />
          <span className="branch">
            <GitBranch size={14} />
            {run.branch}
          </span>
          <span className="branch-direction">→</span>
          <span>{run.baseBranch}</span>
          {demo ? (
            <span className="meta-demo">
              範例資料 · 不會送出至 GitHub
            </span>
          ) : (
            !reading && exportLink
          )}
        </div>
      </section>
      <section className="workflow-strip" aria-label="貢獻進度">
        {[
          {
            n: "01",
            title: "定義任務",
            description: "設定你的貢獻目標",
            icon: FileText,
          },
          {
            n: "02",
            title: "協作開發",
            description: "Agent team 分工完成",
            icon: Bot,
          },
          {
            n: "03",
            title: "理解與審查",
            description: "讀懂每一段程式碼",
            icon: Code2,
          },
          {
            n: "04",
            title: "送出貢獻",
            description: "你的下一個 Pull Request",
            icon: GitPullRequest,
          },
        ].map((step, index) => {
          return (
            <div
              className={`workflow-step ${index === currentStep && !halted ? "current" : ""} ${index < currentStep ? "done" : ""}`}
              key={step.n}
            >
              <span className="step-icon">
                {index < currentStep ? (
                  <Check size={17} />
                ) : (
                  <step.icon size={18} />
                )}
              </span>
              <div>
                <span className="step-number">{step.n}</span>
                <strong>{step.title}</strong>
                <small>
                  {index === 1 && currentStep === 1
                    ? statusLabels[run.status]
                    : step.description}
                </small>
              </div>
              {index < 3 && (
                <ChevronRight className="step-chevron" size={16} />
              )}
            </div>
          );
        })}
      </section>
      <section className="review-area">
        <div className="review-toolbar">
          <div
            className="review-tabs"
            role="tablist"
            aria-label="任務內容"
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
              const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
              const index = tabs.indexOf(event.target as HTMLButtonElement);
              if (index < 0) return;
              const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
                : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
                  : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
              if (next < 0) return;
              event.preventDefault();
              tabs[next].focus();
              tabs[next].click();
            }}
          >
            <button
              role="tab"
              id="workspace-tab-overview"
              aria-controls="workspace-panel"
              tabIndex={tab === "overview" ? 0 : -1}
              aria-selected={tab === "overview"}
              className={tab === "overview" ? "selected" : ""}
              onClick={() => {
                setFocusMode(false);
                setTab("overview");
              }}
            >
              <Globe2 size={16} />
              全貌與動機
            </button>
            <button
              role="tab"
              id="workspace-tab-changes"
              aria-controls="workspace-panel"
              tabIndex={tab === "changes" ? 0 : -1}
              aria-selected={tab === "changes"}
              className={tab === "changes" ? "selected" : ""}
              onClick={() => setTab("changes")}
            >
              <Code2 size={16} />
              程式碼變更 <span>{files.length}</span>
            </button>
            <button
              role="tab"
              id="workspace-tab-activity"
              aria-controls="workspace-panel"
              tabIndex={tab === "activity" ? 0 : -1}
              aria-selected={tab === "activity"}
              className={tab === "activity" ? "selected" : ""}
              onClick={() => setTab("activity")}
            >
              <Activity size={16} />
              Agent 動態 {active && <span className="activity-pulse" />}
            </button>
            <button
              role="tab"
              id="workspace-tab-draft"
              aria-controls="workspace-panel"
              tabIndex={tab === "draft" ? 0 : -1}
              aria-selected={tab === "draft"}
              className={tab === "draft" ? "selected" : ""}
              onClick={() => setTab("draft")}
            >
              <FileText size={16} />
              PR 草稿{draftDirty && <span>•</span>}
            </button>
          </div>
          <div className="review-totals">
            <span className="additions">+{additions}</span>
            <span className="deletions">−{deletions}</span>
            <span className="totals-divider" />
            <ShieldCheck size={15} />
            <span>{demo ? "範例審查" : "人工審查"}</span>
          </div>
        </div>
        <div
          role="tabpanel"
          id="workspace-panel"
          aria-labelledby={`workspace-tab-${tab}`}
        >
          {tab === "overview" && currentRepo && (
            <OverviewTab
              currentRepo={currentRepo}
              run={run}
              demo={demo}
              intelligence={intelligence}
              chooseRecommendation={chooseRecommendation}
              setTab={setTab}
              onUpdateRepo={onUpdateRepo}
              updatingRepo={updatingRepo}
            />
          )}
          {tab === "changes" && (
            <ChangesTab
              run={run}
              files={files}
              file={file}
              selectedPath={selectedPath}
              setSelectedPath={setSelectedPath}
              currentRepo={currentRepo}
              demo={demo}
              active={active}
              editable={editable}
              reviewRerunning={reviewRerunning}
              reviewedCount={reviewedCount}
              allReviewed={allReviewed}
              setTab={setTab}
              focusMode={focusMode}
              setFocusMode={setFocusMode}
              showFiles={showFiles}
              setShowFiles={setShowFiles}
              showExplanation={showExplanation}
              setShowExplanation={setShowExplanation}
              codeFont={codeFont}
              setCodeFont={setCodeFont}
              explanationWidth={explanationWidth}
              setExplanationWidth={setExplanationWidth}
              fileSearch={fileSearch}
              setFileSearch={setFileSearch}
              onlyUnreviewed={onlyUnreviewed}
              setOnlyUnreviewed={setOnlyUnreviewed}
              suggestedOrder={suggestedOrder}
              setSuggestedOrder={setSuggestedOrder}
              diffView={diffView}
              setDiffView={setDiffView}
              intelligence={intelligence}
              explanationRequests={explanationRequests}
              prepareExplanations={prepareExplanations}
              actions={actions}
            />
          )}
          {tab === "activity" && (
            <ActivityTab
              run={run}
              demo={demo}
              busy={busy}
              active={active}
              reviewRerunning={reviewRerunning}
              logFilter={logFilter}
              setLogFilter={setLogFilter}
              actions={actions}
            />
          )}
          {tab === "draft" && (
            <DraftTab
              run={run}
              files={files}
              demo={demo}
              busy={busy}
              active={active}
              preparingDraft={preparingDraft}
              reviewedCount={reviewedCount}
              allReviewed={allReviewed}
              setSelectedPath={setSelectedPath}
              setTab={setTab}
              draft={draft}
              actions={actions}
              rounds={rounds}
            />
          )}
        </div>
        <footer className="review-footer">
          <div>
            <span className="footer-spark">
              <Sparkles size={15} />
            </span>
            <span>
              {allReviewed
                ? "每一段改動，都經過你的理解。"
                : "不只是 review，也是一次 code learning。"}
            </span>
            <span className="footer-hint">
              選取程式碼，就能向 agent 追問。
            </span>
          </div>
          <div>
            <span className="footer-reviewed">
              <CheckCheck size={15} />
              {reviewedCount} / {files.length} 已審閱
            </span>
            {run.status === "published" && run.prUrl ? (
              <a
                className="button primary"
                href={run.prUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Github size={16} />
                查看 Pull Request
                <ExternalLink size={14} />
              </a>
            ) : (
              <button
                className="button primary"
                disabled={
                  !allReviewed ||
                  active ||
                  busy ||
                  draftDirty ||
                  (!demo &&
                    (followUp ? commitMessageUnfinished : !!draftUnfinished)) ||
                  !["review", "approved"].includes(run.status)
                }
                title={
                  !allReviewed
                    ? "請先逐一勾選所有檔案的「已審閱」"
                    : draftDirty
                      ? "請先儲存 PR 草稿"
                      : followUp && commitMessageUnfinished
                        ? "請先填好這輪修正的提交訊息"
                        : !demo && draftUnfinished
                          ? "PR 說明還有待填寫的內容，請先改成事實或刪除"
                          : followUp
                            ? "確認這輪修正並預覽推送"
                            : "確認變更並預覽送出"
                }
                onClick={approve}
              >
                <Check size={16} />
                {followUp ? "確認並準備推送" : "確認並準備 PR"}
                <ChevronRight size={15} />
              </button>
            )}
          </div>
        </footer>
      </section>
    </>
  );
}
