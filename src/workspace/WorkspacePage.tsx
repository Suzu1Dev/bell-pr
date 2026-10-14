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
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Globe2,
  Lock,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useT } from "../i18n";
import { ProBadge } from "../license/ProBadge";
import type { DiffFile, Repo, Run } from "../types";
import type { useProjectInsights } from "../mission/useProjectInsights";
import type { ContributionRecommendation } from "../../shared/insights";
import type { Tab } from "../app/AppShell";
import type { DraftEditor } from "../app/hooks/useDraftEditor";
import type { RunActions } from "../app/hooks/useRunActions";
import type { RunRounds } from "../app/hooks/useRunRounds";
import { ActivityTab } from "./ActivityTab";
import { ChangesTab } from "./ChangesTab";
import { DraftTab } from "./DraftTab";
import { OverviewTab } from "./OverviewTab";
import { RunNotices, UnsandboxedBadge } from "./RunNotices";
import "./workspace.css";

interface WorkspacePageProps {
  run: Run;
  files: DiffFile[];
  /** The changed file open in the code view. */
  file: DiffFile | undefined;
  selectedPath: string;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  currentRepo: Repo | undefined;
  demo: boolean;
  /**
   * The changes tab is open. The shell styles the compact heading from it
   * (.is-reading); nothing here is clipped, so nothing else changes.
   */
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
  const t = useT("workspace");
  const statusLabels = useT("common").runStatus;
  const { draftDirty, draftUnfinished, followUp, commitMessageUnfinished } =
    draft;
  const { approve, plan, exporting, exportLearning } = actions;
  // The sample's playback queues for a moment behind nothing.
  const queuedOnFree =
    !demo &&
    run.status === "queued" &&
    plan.entitlements?.maxActiveRuns === 1;
  // The learning record is Pro: on Free the button shows a lock and opens
  // the upgrade dialog without a request; the sample builds its own record
  // and shows the PRO chip.
  const exportLocked = plan.locked("learningExport", { demo });
  const exportButton = (
    <button
      type="button"
      className="export-link export-button"
      disabled={exporting}
      onClick={() => void exportLearning()}
    >
      {exportLocked ? (
        <Lock size={13} aria-hidden="true" />
      ) : (
        <ArrowDownToLine size={13} aria-hidden="true" />
      )}
      {t.exportLearning}
      {(exportLocked || demo) && <ProBadge />}
    </button>
  );
  const reviewedCount = files.filter((f) =>
    run.reviewedFiles.includes(f.path),
  ).length;
  const allReviewed = files.length > 0 && reviewedCount === files.length;
  // Progress strip index: 0 define, 1 build, 2 review, 3 submit;
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
            <span>{t.eyebrow}</span>
            {demo && <span className="demo-pill">{t.demoPill}</span>}
          </div>
          <button
            className="button secondary new-task-button"
            onClick={() => beginContribution()}
          >
            <Plus size={15} /> <span className="new-task-label">{t.newContribution}</span>
          </button>
        </div>
        <div className="title-row">
          <h1 tabIndex={-1}>{run.title}</h1>
          <span
            className={`status-badge ${run.status === "failed" ? "error" : ""}`}
          >
            <span />
            {statusLabels[run.status]}
          </span>
          {run.unsandboxed === true && <UnsandboxedBadge />}
        </div>
        <div className="repo-meta">
          <span>
            <FolderGit2 size={15} />
            {currentRepo?.fullName || t.repositoryFallback}
          </span>
          <i />
          <span className="branch">
            <GitBranch size={14} />
            {run.branch}
          </span>
          <span className="branch-direction">→</span>
          <span>{run.baseBranch}</span>
          {demo && <span className="meta-demo">{t.demoMeta}</span>}
          {exportButton}
        </div>
      </section>
      <RunNotices run={run} queuedOnFree={queuedOnFree} />
      <section className="workflow-strip" aria-label={t.progress}>
        {[
          { n: "01", ...t.steps.define, icon: FileText },
          { n: "02", ...t.steps.build, icon: Bot },
          { n: "03", ...t.steps.review, icon: Code2 },
          { n: "04", ...t.steps.submit, icon: GitPullRequest },
        ].map((step, index) => {
          return (
            <div
              className={`workflow-step ${index === currentStep && !halted ? "current" : ""} ${index < currentStep ? "done" : ""}`}
              aria-current={index === currentStep && !halted ? "step" : undefined}
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
            aria-label={t.tabsLabel}
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
              {t.tabs.overview}
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
              {t.tabs.changes} <span>{files.length}</span>
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
              {t.tabs.activity}{" "}
              {active && <span className="activity-pulse" />}
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
              {t.tabs.draft}
              {draftDirty && <span>•</span>}
            </button>
          </div>
          <div className="review-totals">
            <span className="additions">+{additions}</span>
            <span className="deletions">−{deletions}</span>
            <span className="totals-divider" />
            <ShieldCheck size={15} />
            <span>{demo ? t.sampleReview : t.humanReview}</span>
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
              feedbackLocked={plan.locked("prFeedback", { demo })}
            />
          )}
        </div>
        <footer className="review-footer">
          <div>
            <span className="footer-spark">
              <Sparkles size={15} />
            </span>
            <span>
              {allReviewed ? t.footer.allReviewed : t.footer.learning}
            </span>
            <span className="footer-hint">{t.footer.hint}</span>
          </div>
          <div>
            <span className="footer-reviewed">
              <CheckCheck size={15} />
              {t.footer.reviewed({
                reviewed: reviewedCount,
                total: files.length,
              })}
            </span>
            {/* The sample PR exists nowhere: its button just stays off. */}
            {run.status === "published" && run.prUrl && !demo ? (
              <a
                className="button primary"
                href={run.prUrl}
                target="_blank"
                rel="noreferrer"
              >
                <GitPullRequest size={16} />
                {t.footer.viewPullRequest}
                <ExternalLink size={14} />
              </a>
            ) : (
              <button
                className="button primary"
                disabled={
                  !allReviewed ||
                  active ||
                  busy ||
                  !!run.publishing ||
                  draftDirty ||
                  (!demo &&
                    (followUp ? commitMessageUnfinished : !!draftUnfinished)) ||
                  !["review", "approved"].includes(run.status)
                }
                title={
                  !allReviewed
                    ? t.footer.needsReview
                    : draftDirty
                      ? t.footer.needsSave
                      : followUp && commitMessageUnfinished
                        ? t.footer.needsCommitMessage
                        : !demo && draftUnfinished
                          ? t.footer.needsFacts
                          : followUp
                            ? t.footer.previewPush
                            : t.footer.previewSubmit
                }
                onClick={approve}
              >
                <Check size={16} />
                {followUp ? t.footer.approvePush : t.footer.approvePr}
                <ChevronRight size={15} />
              </button>
            )}
          </div>
        </footer>
      </section>
    </>
  );
}
