import {
  lazy,
  Suspense,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ChevronDown,
  CircleCheck,
  Code2,
  Columns2,
  Copy,
  FolderGit2,
  GitBranch,
  ListTree,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  PanelLeftClose,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { useT } from "../i18n";
import type { DiffFile, Repo, Run } from "../types";
import { applyReviewOrder, parseReviewOrder } from "../../shared/review-order";
import { DiffView } from "../review/DiffView";
import { languageBadge } from "../review/diff";
import type { useProjectInsights } from "../mission/useProjectInsights";
import type { Tab } from "../app/AppShell";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { fileStatusLabel } from "../app/labels";
import type { RunActions } from "../app/hooks/useRunActions";

const ExplanationPanel = lazy(() =>
  import("../review/ExplanationPanel").then((module) => ({
    default: module.ExplanationPanel,
  })),
);

interface ChangesTabProps {
  run: Run;
  files: DiffFile[];
  /** The changed file open in the code view. */
  file: DiffFile | undefined;
  selectedPath: string;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  currentRepo: Repo | undefined;
  demo: boolean;
  active: boolean;
  /** The run can still be changed: a real run in review or approved. */
  editable: boolean;
  reviewRerunning: boolean;
  reviewedCount: number;
  allReviewed: boolean;
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
  intelligence: Pick<ReturnType<typeof useProjectInsights>, "insights" | "stale">;
  explanationRequests: Set<string>;
  prepareExplanations: (
    id: string,
    retry?: boolean,
    filePath?: string,
  ) => Promise<void>;
  actions: Pick<
    RunActions,
    | "messages"
    | "chatRequests"
    | "setChatRequests"
    | "chatLoading"
    | "rerunRequests"
    | "refreshRun"
    | "copyWorktreePath"
    | "rerunReview"
    | "reviewFile"
    | "saveNote"
    | "ask"
  >;
}

/** The code review tab: changed files, the diff and the explanation panel. */
export function ChangesTab({
  run,
  files,
  file,
  selectedPath,
  setSelectedPath,
  currentRepo,
  demo,
  active,
  editable,
  reviewRerunning,
  reviewedCount,
  allReviewed,
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
  intelligence,
  explanationRequests,
  prepareExplanations,
  actions,
}: ChangesTabProps) {
  const t = useT("workspace").changes;
  const fileStatus = useT("common").fileStatus;
  const {
    messages,
    chatRequests,
    setChatRequests,
    chatLoading,
    rerunRequests,
    refreshRun,
    copyWorktreePath,
    rerunReview,
    reviewFile,
    saveNote,
    ask,
  } = actions;
  const reviewGridRef = useRef<HTMLDivElement>(null);
  function changeCodeFont(delta: number) {
    const next = Math.max(12, Math.min(20, codeFont + delta));
    setCodeFont(next);
    try {
      localStorage.setItem("bellpr-code-font", String(next));
    } catch {
      // Not remembered after a reload; the current session still works.
    }
  }
  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = event.currentTarget;
    const move = (pointer: PointerEvent) => {
      const right = reviewGridRef.current?.getBoundingClientRect().right;
      if (right)
        setExplanationWidth(
          Math.max(280, Math.min(520, right - pointer.clientX)),
        );
    };
    const stop = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", stop);
      element.removeEventListener("pointercancel", stop);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
  }
  const reviewOrder = parseReviewOrder(run.reports?.implementer ?? "").filter(
    (entry) => files.some((f) => f.path === entry.path),
  );
  const visibleFiles = (
    suggestedOrder ? applyReviewOrder(files, reviewOrder) : files
  ).filter(
    (f) =>
      f.path.toLowerCase().includes(fileSearch.toLowerCase()) &&
      (!onlyUnreviewed || !run.reviewedFiles.includes(f.path)),
  );
  return (
    <div
      ref={reviewGridRef}
      className={`review-grid ${!showFiles ? "files-hidden" : ""} ${!showExplanation ? "explanation-hidden" : ""}`}
    >
      {showFiles && (
        <aside className="file-panel">
          <div className="file-panel-heading">
            <strong>
              {t.files} <span>{files.length}</span>
            </strong>
            <ListTree size={16} />
          </div>
          <label className="file-search">
            <Search size={14} />
            <input
              placeholder={t.searchPlaceholder}
              aria-label={t.searchLabel}
              value={fileSearch}
              onChange={(e) => setFileSearch(e.target.value)}
            />
            <kbd>⌕</kbd>
          </label>
          <button
            className={`filter-toggle ${onlyUnreviewed ? "is-on" : ""}`}
            onClick={() => setOnlyUnreviewed(!onlyUnreviewed)}
          >
            <span className="toggle-track">
              <span />
            </span>
            {t.onlyUnreviewed}
          </button>
          {reviewOrder.length > 0 && (
            <button
              className={`filter-toggle ${suggestedOrder ? "is-on" : ""}`}
              aria-pressed={suggestedOrder}
              title={t.suggestedOrderTitle}
              onClick={() => setSuggestedOrder(!suggestedOrder)}
            >
              <span className="toggle-track">
                <span />
              </span>
              {t.suggestedOrder}
            </button>
          )}
          <div className="file-tree">
            <div className="tree-root">
              <ChevronDown size={13} />
              <FolderGit2 size={15} />
              {currentRepo?.name || t.repositoryFallback}
            </div>
            {visibleFiles.map((f) => (
              <button
                key={f.path}
                title={f.path}
                className={`file-item ${file?.path === f.path ? "selected" : ""}`}
                onClick={() => {
                  if (f.path !== selectedPath)
                    setChatRequests((previous) => ({
                      ...previous,
                      [`${run.id}:${f.path}`]: 0,
                    }));
                  setSelectedPath(f.path);
                }}
              >
                <span
                  className={`file-type ${f.language === "Markdown" ? "markdown" : ""}`}
                  title={f.language}
                >
                  {languageBadge(f.language)}
                </span>
                <span className="file-name">
                  {f.path.split("/").pop()}
                  <small>
                    {f.path.includes("/")
                      ? f.path.slice(0, f.path.lastIndexOf("/"))
                      : "/"}
                  </small>
                </span>
                {run.reviewedFiles.includes(f.path) ? (
                  <CircleCheck
                    className="file-reviewed"
                    size={14}
                  />
                ) : (
                  <span
                    className={`file-modified ${f.status === "deleted" ? "file-deleted" : ""}`}
                    title={fileStatusLabel(fileStatus, f.status).title}
                  >
                    {fileStatusLabel(fileStatus, f.status).badge}
                  </span>
                )}
              </button>
            ))}
            {!visibleFiles.length && (
              <p className="file-empty">
                {active ? t.waitingForChanges : t.noMatches}
              </p>
            )}
          </div>
          <div className="review-progress">
            <div>
              <span>{t.progress}</span>
              <strong>
                {reviewedCount}
                <span> / {files.length}</span>
              </strong>
            </div>
            <div className="progress-track">
              <span
                style={{
                  width: `${files.length ? (reviewedCount / files.length) * 100 : 0}%`,
                }}
              />
            </div>
            <small>
              {allReviewed ? t.allReviewed : t.reviewHint}
            </small>
          </div>
        </aside>
      )}
      <section className="diff-panel">
        <div className="diff-topbar">
          <span>
            <GitBranch size={14} /> {run.baseBranch}{" "}
            <span className="diff-topbar-arrow">←</span>{" "}
            {run.branch}
          </span>
          <div className="diff-toolbar-actions">
            <button
              className="icon-button"
              aria-label={showFiles ? t.hideFiles : t.showFiles}
              title={t.toggleFiles}
              onClick={() => setShowFiles(!showFiles)}
            >
              <PanelLeftClose size={16} />
            </button>
            <div className="code-size-control">
              <button
                aria-label={t.smallerCode}
                disabled={codeFont <= 12}
                onClick={() => changeCodeFont(-1)}
              >
                <Minus size={13} />
              </button>
              <span>{codeFont}</span>
              <button
                aria-label={t.largerCode}
                disabled={codeFont >= 20}
                onClick={() => changeCodeFont(1)}
              >
                <Plus size={13} />
              </button>
            </div>
            <button
              className="icon-button"
              aria-label={
                showExplanation ? t.hideExplanation : t.showExplanation
              }
              title={t.toggleExplanation}
              onClick={() => setShowExplanation(!showExplanation)}
            >
              {showExplanation ? (
                <PanelRightClose size={16} />
              ) : (
                <PanelRightOpen size={16} />
              )}
            </button>
            <button
              className="icon-button"
              aria-label={focusMode ? t.exitFocus : t.enterFocus}
              title={t.focus}
              onClick={() => setFocusMode(!focusMode)}
            >
              {focusMode ? (
                <Minimize2 size={16} />
              ) : (
                <Maximize2 size={16} />
              )}
            </button>
            <button
              className="icon-button"
              aria-label={t.refresh}
              title={t.refresh}
              onClick={refreshRun}
              disabled={active}
            >
              <RefreshCw size={14} />
            </button>
            <div className="view-toggle" aria-label={t.viewMode}>
              <button
                aria-label={t.unified}
                title={t.unified}
                className={diffView === "unified" ? "selected" : ""}
                onClick={() => setDiffView("unified")}
              >
                <ListTree size={15} />
              </button>
              <button
                aria-label={t.split}
                title={t.split}
                className={diffView === "split" ? "selected" : ""}
                onClick={() => setDiffView("split")}
              >
                <Columns2 size={15} />
              </button>
            </div>
          </div>
        </div>
        {editable && run.worktreePath && (
          <div className="worktree-hint">
            <FolderGit2 size={14} />
            <span>{t.worktreeHint}</span>
            <code>{run.worktreePath}</code>
            <button
              type="button"
              className="icon-button"
              aria-label={t.copyWorktree}
              title={t.copyWorktree}
              onClick={copyWorktreePath}
            >
              <Copy size={13} />
            </button>
          </div>
        )}
        {file ? (
          <DiffView
            key={`${run.id}:${file.path}`}
            file={file}
            reviewed={run.reviewedFiles.includes(file.path)}
            onReview={reviewFile}
            onAsk={ask}
            view={diffView}
            hasNote={Boolean(run.notes?.[file.path]?.text)}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-icon">
              {active ? <Loader2 className="spin" /> : <Code2 />}
            </div>
            <h3>{active ? t.preparing : t.noChanges}</h3>
            <p>{run.error || t.noChangesHint}</p>
            <button
              className="button secondary"
              onClick={() => setTab("activity")}
            >
              {t.viewActivity}
            </button>
          </div>
        )}
      </section>
      {showExplanation && (
        <>
          <div
            className="pane-resizer"
            role="separator"
            aria-label={t.resize}
            aria-orientation="vertical"
            aria-valuemin={280}
            aria-valuemax={520}
            aria-valuenow={explanationWidth}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setExplanationWidth((value) =>
                  Math.min(520, value + 20),
                );
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                setExplanationWidth((value) =>
                  Math.max(280, value - 20),
                );
              }
            }}
          />
          <aside className="explanation-wrap">
            {file ? (
              <ErrorBoundary resetKey={`${run.id}:${file.path}`}>
                <Suspense
                  fallback={
                    <div className="empty-state" role="status">
                      <Loader2 className="spin" />
                      <p>{t.loadingPanel}</p>
                    </div>
                  }
                >
                  <ExplanationPanel
                    key={`${run.id}:${file.path}`}
                    file={file}
                    messages={
                      messages[`${run.id}:${file.path}`] || []
                    }
                    loading={chatLoading}
                    onAsk={ask}
                    onRetryExplanation={() =>
                      prepareExplanations(run.id, true, file.path)
                    }
                    chatRequestId={
                      chatRequests[`${run.id}:${file.path}`] || 0
                    }
                    onChatRequestHandled={() =>
                      setChatRequests((previous) => ({
                        ...previous,
                        [`${run.id}:${file.path}`]: 0,
                      }))
                    }
                    explanationBusy={explanationRequests.has(run.id)}
                    demo={demo}
                    reports={run.reports}
                    modules={
                      intelligence.stale
                        ? undefined
                        : intelligence.insights?.modules
                    }
                    note={run.notes?.[file.path]}
                    onSaveNote={saveNote}
                    feedback={run.prFeedback?.items.filter(
                      (item) => item.path === file.path,
                    )}
                    onRerunReview={editable ? rerunReview : undefined}
                    reviewBusy={
                      reviewRerunning || rerunRequests.has(run.id)
                    }
                  />
                </Suspense>
              </ErrorBoundary>
            ) : (
              <div className="empty-state">
                <Sparkles />
                <h3>{t.emptyTitle}</h3>
                <p>{t.emptyText}</p>
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
