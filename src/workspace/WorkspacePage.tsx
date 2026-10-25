import { lazy, Suspense, type Dispatch, type SetStateAction } from "react";
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
  Hand,
  GitPullRequest,
  Globe2,
  History,
  Plus,
  ShieldCheck,
  Split,
  Sparkles,
} from "lucide-react";
import { useT, withMessages } from "../i18n";
import type { DiffFile, Repo, Run } from "../types";
import type { useProjectInsights } from "../mission/useProjectInsights";
import type { ContributionRecommendation } from "../../shared/insights";
import type { Tab } from "../app/AppShell";
import type { DraftEditor } from "../app/hooks/useDraftEditor";
import type { RunActions } from "../app/hooks/useRunActions";
import type { RunRounds } from "../app/hooks/useRunRounds";
import type { Walkthroughs } from "../app/hooks/useWalkthroughs";
import { useRunRecords } from "../app/hooks/useRunRecords";
import { useByHand } from "../app/hooks/useByHand";
import { premiseCheckable, usePremiseCheck } from "../app/hooks/usePremiseCheck";
import { openCheckPanel, useUnderstanding } from "../app/hooks/useUnderstanding";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { ChangesTab } from "./ChangesTab";
import { checkFooter } from "./checkFooter";
import { DraftTab } from "./DraftTab";
import { OverviewTab } from "./OverviewTab";
import { RunNotices, showsCheckOff, UnderstandingOffBadge, UnsandboxedBadge } from "./RunNotices";
import "./workspace.css";

// The activity tab carries the team board, which most reviews never open;
// it loads with its first visit.
const ActivityTab = lazy(() =>
  withMessages(import("./ActivityTab")).then((module) => ({
    default: module.ActivityTab,
  })),
);
// Learn by hand's Ready dialog, from the one lazy byhand chunk.
const ReadyDialog = lazy(() => import("../byhand/lazy").then((module) => ({ default: module.ReadyDialog })));
// The commit history matters once a PR is published; it loads on its own too.
const CommitHistory = lazy(() =>
  import("../review/CommitHistory").then((module) => ({
    default: module.CommitHistory,
  })),
);

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
  /** The code walkthroughs of the run's files (useWalkthroughs); without it, nothing is prepared or retried. */
  walkthroughs?: Walkthroughs;
  /** Opens the task dialog; with a run, prefilled with its task for the agent team. */
  beginContribution: (repoId?: string, from?: Run) => void;
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
  walkthroughs,
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
  // Learn by hand: the PR title and description are the person's own, and approval needs both (DESIGN v1.2 F11).
  const prTextMissing = !!run.learnByHand && !demo && !followUp && (!draft.draftTitle?.trim() || !draft.draftBody?.trim());
  const { approve, exporting, exportLearning } = actions;
  // The Explain-it-back check and the person's other records on this run.
  const understanding = useUnderstanding(run, files, { demo, setRun: actions.setRun });
  const premise = usePremiseCheck(run, actions);
  const handBack = () => beginContribution(run.repoId, run);
  const requesting = explanationRequests.has(run.id) || !!walkthroughs?.walkthroughBusy;
  const byHand = useByHand(run, files, { demo, repo: currentRepo, actions, handBack, draftMutationEpoch: draft.draftMutationEpoch, requesting });
  const reviewing = !!run.learnByHand && run.byHand?.busy?.kind === "review";
  const records = useRunRecords(run, files, { demo, setRun: actions.setRun, notify: actions.notify, file, ask: actions.ask, setSelectedPath, setTab });
  // The sample's playback queues for a moment behind nothing.
  const queued = !demo && run.status === "queued";
  const exportButton = (
    <button
      type="button"
      className="export-link export-button"
      title={t.exportLearning}
      disabled={exporting}
      onClick={() => void exportLearning()}
    >
      <ArrowDownToLine size={13} aria-hidden="true" />
      <span className="export-label">{t.exportLearning}</span>
    </button>
  );
  const reviewedCount = files.filter((f) =>
    run.reviewedFiles.includes(f.path),
  ).length;
  const allReviewed = files.length > 0 && reviewedCount === files.length;
  const footer = checkFooter(run, allReviewed, understanding);
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
            {byHand.writing || (run.learnByHand && run.status === "awaiting_plan") ? t.byHand.turn : statusLabels[run.status]}
          </span>
          {run.unsandboxed === true && <UnsandboxedBadge />}
          {run.learnByHand && <span className="status-badge"><Hand size={13} aria-hidden="true" />{t.byHand.badge}</span>}
          {/* The setting's badge leaves a run whose check passed: approving it marks nothing. */}
          {showsCheckOff(run, understanding.off && !understanding.passed) && (
            <UnderstandingOffBadge approved={run.understandingCheckOff === true} />
          )}
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
      <RunNotices run={run} queued={queued} />
      <SplitNotices run={run} onOpen={actions.chooseRun} />
      <section className="workflow-strip" aria-label={t.progress}>
        {[
          { n: "01", ...t.steps.define, icon: FileText },
          { n: "02", ...(run.learnByHand ? t.steps.buildByHand : t.steps.build), icon: run.learnByHand ? Hand : Bot },
          { n: "03", ...t.steps.review, icon: Code2 },
          { n: "04", ...t.steps.submit, icon: GitPullRequest },
        ].map((step, index) => {
          const current = index === currentStep && !halted;
          // One row of small steps: the description moves to the tooltip.
          return (
            <div
              className={`workflow-step ${current ? "current" : ""} ${index < currentStep ? "done" : ""}`}
              aria-current={current ? "step" : undefined}
              title={t.stepTooltip(step)}
              key={step.n}
            >
              <span className="step-icon">
                {index < currentStep ? (
                  <Check size={13} />
                ) : (
                  <step.icon size={13} />
                )}
              </span>
              <strong>{step.title}</strong>
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
            <button
              role="tab"
              id="workspace-tab-commits"
              aria-controls="workspace-panel"
              tabIndex={tab === "commits" ? 0 : -1}
              aria-selected={tab === "commits"}
              className={tab === "commits" ? "selected" : ""}
              onClick={() => setTab("commits")}
            >
              <History size={16} />
              {t.tabs.commits}
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
              onCheckPremise={
                premiseCheckable(run, demo, active, byHand.writing)
                  ? () => void premise.checkPremise()
                  : undefined
              }
              checkingPremise={premise.checkingPremise}
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
              walkthroughs={walkthroughs}
              actions={actions}
              understanding={understanding}
              byHand={byHand}
            />
          )}
          {tab === "activity" && (
            // A chunk that fails to load stops at this tab; the draft and
            // the review keep what the person typed.
            <ErrorBoundary resetKey={run.id}>
              <Suspense fallback={null}>
                <ActivityTab
                  run={run}
                  demo={demo}
                  busy={busy}
                  active={active}
                  reviewRerunning={reviewRerunning}
                  logFilter={logFilter}
                  setLogFilter={setLogFilter}
                  actions={actions}
                  byHand={byHand.plan}
                />
              </Suspense>
            </ErrorBoundary>
          )}
          {tab === "commits" && (
            <ErrorBoundary resetKey={run.id}>
              <Suspense fallback={null}>
                <CommitHistory run={run} demo={demo} />
              </Suspense>
            </ErrorBoundary>
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
              currentRepo={currentRepo}
              understanding={understanding}
              records={records}
            />
          )}
        </div>
        <footer className="review-footer">
          <div>
            <span className="footer-spark">
              <Sparkles size={15} />
            </span>
            <span>{t.footer[footer.status]}</span>
            {prTextMissing && !byHand.writing && !reviewing && run.status !== "published" ? (
              <button type="button" className="mission-text-button" onClick={() => setTab("draft")}>{t.byHand.writePr}</button>
            ) : <span className="footer-hint">{run.learnByHand ? t.footer.hintByHand : t.footer.hint}</span>}
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
            ) : byHand.writing || reviewing ? (
              // Learn by hand: the person says when the change is ready (DESIGN v1.2 F5).
              <button className="button primary" disabled={busy || reviewing || !files.length} title={files.length ? undefined : t.byHand.writeFirst}
                onClick={byHand.openReady}>
                <CheckCheck size={16} />
                {reviewing ? t.byHand.reviewing : files.length ? t.byHand.ready : t.byHand.writeFirst}
                <ChevronRight size={15} />
              </button>
            ) : (
              <button
                className="button primary"
                disabled={
                  !footer.explainFirst && (!allReviewed ||
                  active ||
                  busy ||
                  !!run.publishing ||
                  draftDirty ||
                  prTextMissing ||
                  (!demo &&
                    (followUp ? commitMessageUnfinished : !!draftUnfinished)) ||
                  !["review", "approved"].includes(run.status))
                }
                title={
                  !allReviewed
                    ? t.footer[footer.needsReview]
                    : footer.explainFirst
                      ? t.footer.needsCheck
                      : draftDirty
                      ? t.footer.needsSave
                      : prTextMissing
                      ? t.byHand.writePr
                      : followUp && commitMessageUnfinished
                        ? t.footer.needsCommitMessage
                        : !demo && draftUnfinished
                          ? t.footer.needsFacts
                          : followUp
                            ? t.footer.previewPush
                            : t.footer.previewSubmit
                }
                onClick={footer.explainFirst ? () => openCheckPanel(run.id) : approve}
              >
                <Check size={16} />
                {footer.explainFirst
                  ? t.footer.explainBack
                  : followUp ? t.footer.approvePush : t.footer.approvePr}
                <ChevronRight size={15} />
              </button>
            )}
          </div>
        </footer>
      </section>
      {byHand.readyOpen && (
        <ErrorBoundary resetKey={`${run.id}:ready`}>
          <Suspense fallback={null}>
            <ReadyDialog run={run} files={files} open onClose={byHand.closeReady} {...byHand.readyDialog} />
          </Suspense>
        </ErrorBoundary>
      )}
    </>
  );
}

/** The split banners: the contribution a run was split from, or the contributions it was split into. */
function SplitNotices({ run, onOpen }: { run: Run; onOpen(runId: string): void }) {
  const t = useT("workspace").splitNotice;
  const from = run.splitFrom;
  const into = run.splitInto ?? [];
  if (!from && !into.length) return null;
  return (
    <div className="run-notices">
      {from && (
        <p className="run-notice" role="status">
          <Split size={15} aria-hidden="true" />
          <span>{t.from({ title: from.title })}</span>
          <button type="button" className="run-notice-link" onClick={() => onOpen(from.runId)}>
            {t.openOriginal}
          </button>
        </p>
      )}
      {into.length > 0 && (
        <div className="run-notice" role="status">
          <Split size={15} aria-hidden="true" />
          <div className="run-notice-body">
            <p>{t.into({ count: into.length })}</p>
            <ul className="run-notice-list">
              {into.map((part) => (
                <li key={part.runId}>
                  <button type="button" className="run-notice-link" onClick={() => onOpen(part.runId)}>
                    {part.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
