import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ChevronDown,
  CircleCheck,
  Code2,
  Columns2,
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
  SquarePen,
  X,
} from "lucide-react";
import { api } from "../api";
import { useT } from "../i18n";
import type { DiffFile, Repo, Run } from "../types";
import { applyReviewOrder, parseReviewOrder } from "../../shared/review-order";
import { DiffView } from "../review/DiffView";
import { languageBadge } from "../review/diff";
import type { useProjectInsights } from "../mission/useProjectInsights";
import type { Tab } from "../app/AppShell";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { useRovingList } from "../a11y/useRovingList";
import { fileStatusLabel } from "../app/labels";
import { usePresentation } from "../app/presentation";
import { FailureText } from "../FailureText";
import { PremiseNotice } from "../team/PremiseNotice";
import type { RunActions } from "../app/hooks/useRunActions";
import { focusWhenShown, type ByHand } from "../app/hooks/useByHand";
import type { Walkthroughs } from "../app/hooks/useWalkthroughs";
import type { PanelTab } from "../review/ExplanationPanel";
import type { LineRange } from "../review/WalkthroughCards";
import {
  closeCheckPanel,
  openCheckPanel,
  useCheckPanel,
  type Understanding,
} from "../app/hooks/useUnderstanding";
import { WorktreeHint } from "./WorktreeHint";

const ExplanationPanel = lazy(() =>
  import("../review/ExplanationPanel").then((module) => ({
    default: module.ExplanationPanel,
  })),
);
/** The Explain-it-back check, loaded the same way. */
const UnderstandingCheck = lazy(() => import("./UnderstandingCheck"));
// Learn by hand: the writing views, from the one lazy byhand chunk.
const YourTurn = lazy(() => import("../byhand/lazy").then((module) => ({ default: module.YourTurn })));
const GuidePanel = lazy(() => import("../byhand/lazy").then((module) => ({ default: module.GuidePanel })));

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
  /** The code walkthroughs of the run's files (useWalkthroughs). */
  walkthroughs?: Walkthroughs;
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
  /** The Explain-it-back check of the run (useUnderstanding). */
  understanding?: Understanding;
  /** A Learn-by-hand run's state and requests (useByHand). */
  byHand?: ByHand;
}

/**
 * The file at the run's base commit, for the unchanged code around its
 * changes. The fingerprint and the base tie the answer to the diff shown.
 */
async function loadBaseLines(run: Run, target: DiffFile) {
  const query = new URLSearchParams({
    path: target.path,
    fingerprint: target.fingerprint ?? "",
    base: run.baseSha ?? "",
  });
  const { lines } = await api<{ lines: string[] }>(
    `/runs/${encodeURIComponent(run.id)}/context?${query}`,
  );
  return lines;
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
  walkthroughs,
  actions,
  understanding,
  byHand,
}: ChangesTabProps) {
  const workspace = useT("workspace");
  const t = workspace.changes;
  const notices = workspace.runNotices;
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
  const { present, maskPath } = usePresentation();
  const showWorktree =
    editable && !!run.worktreePath && !run.workspaceRemovedAt;
  // Closed book: while the check is open it takes the explanation's place,
  // and questions to the agent wait until it closes.
  const checkMode = useCheckPanel(run.id);
  const checking = !!understanding && !!checkMode;
  // The check is taken while the run waits for review or approval.
  const checkOpen = ["review", "approved"].includes(run.status) && !run.publishing;
  const [askWaiting, setAskWaiting] = useState(false);
  // Learn by hand: while the person writes, the guide takes the explanation's place.
  const writing = !!byHand?.writing;
  useEffect(() => {
    if (writing) setShowExplanation(true);
  }, [run.id, writing, setShowExplanation]);
  const loading = (<div className="empty-state" role="status"><Loader2 className="spin" /><p>{t.loadingPanel}</p></div>);
  // The check replaces the reader view whose button opens it, so the focus moves into the check (its close button).
  const checkWrap = useRef<HTMLDivElement>(null);
  const openCheck = () => (openCheckPanel(run.id), focusWhenShown(() => checkWrap.current?.querySelector<HTMLElement>(".check-header button")));
  // At the ready version: "Run the review again" opens the Ready dialog, the reader view's check, and a review that failed (W2E ByHandReader).
  const byHandReview = run.learnByHand && byHand
    ? { onReviewAgain: byHand.openReady, check: understanding?.view, checkError: understanding?.error, onOpenCheck: openCheck, onRetryCheck: () => understanding?.refresh(), run }
    : undefined;
  useEffect(() => {
    if (!checking) {
      setAskWaiting(false);
      return;
    }
    setShowExplanation(true);
    setFocusMode(false);
  }, [checking, setShowExplanation, setFocusMode]);
  /**
   * The current-file lines a walkthrough part marks in the diff, with the
   * diff version its line numbers belong to.
   */
  const [highlight, setHighlight] = useState<
    (LineRange & { runId: string; path: string; fingerprint?: string }) | null
  >(null);
  // The panel remounts per file; it opens on the tab the reader chose last.
  const [panelTab, setPanelTab] = useState<PanelTab>("explain");
  const shownHighlight =
    file &&
    highlight?.runId === run.id &&
    highlight.path === file.path &&
    highlight.fingerprint === file.fingerprint
      ? { startLine: highlight.startLine, endLine: highlight.endLine }
      : undefined;
  const reviewGridRef = useRef<HTMLDivElement>(null);
  // On a phone the file search hides behind an icon button; a query keeps it open.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchShown = searchOpen || fileSearch !== "";
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  // The diff toolbar is one tab stop; the arrow keys move between its eight
  // buttons and skip the disabled ones.
  const toolbarDisabled = [
    false,
    codeFont <= 12,
    codeFont >= 20,
    false,
    false,
    active,
    false,
    false,
  ];
  const toolbar = useRovingList(toolbarDisabled.length, {
    orientation: "horizontal",
    disabled: (index) => toolbarDisabled[index],
  });
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
    <>
    {/* The lead's premise check, folded (the diff is read file after file),
        and the worktree share one row above the code. It comes before the
        file list, so the way from the files to the explanation stays short. */}
    {(run.team?.premise || showWorktree) && (
      <div className="diff-context-bar">
        <PremiseNotice premise={run.team?.premise} compact guide={run.learnByHand} />
        {showWorktree && (
          <WorktreeHint
            path={run.worktreePath!}
            presenting={present}
            maskPath={maskPath}
            onCopy={copyWorktreePath}
          />
        )}
      </div>
    )}
    {/* There before the change, so a screen reader announces the notice when it comes (DESIGN v1.2 F5). */}
    {run.learnByHand && <p className={run.byHand?.ready && writing ? "by-hand-note" : "visually-hidden"} role="status">{run.byHand?.ready && writing ? workspace.byHand.changed : ""}</p>}
    <div
      ref={reviewGridRef}
      className={`review-grid ${!showFiles ? "files-hidden" : ""} ${!showExplanation ? "explanation-hidden" : ""}`}
    >
      {showFiles && (
        <aside
          className={`file-panel ${searchShown ? "is-search-open" : ""}`}
        >
          <div className="file-panel-heading">
            <strong>
              {t.files} <span>{files.length}</span>
            </strong>
            <ListTree size={16} />
            <button
              type="button"
              className="icon-button file-search-toggle"
              aria-label={searchShown ? t.closeSearch : t.openSearch}
              title={searchShown ? t.closeSearch : t.openSearch}
              aria-expanded={searchShown}
              aria-controls="workspace-file-search"
              onClick={() => {
                // Closing also clears the query, so no hidden filter stays on.
                if (searchShown) setFileSearch("");
                setSearchOpen(!searchShown);
              }}
            >
              {searchShown ? <X size={15} /> : <Search size={15} />}
            </button>
          </div>
          {/* Test out: the check before every file is ticked (the ticks stay required); Learn by hand: after Ready. */}
          {understanding && !checking && checkOpen && !writing && (
            <button type="button" className="check-link" onClick={() => openCheckPanel(run.id)}>
              <SquarePen size={14} aria-hidden="true" />
              {understanding.passed ? t.openCheck : t.takeCheck}
            </button>
          )}
          <label className="file-search">
            <Search size={14} />
            <input
              id="workspace-file-search"
              ref={searchInput}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchLabel}
              value={fileSearch}
              onChange={(e) => setFileSearch(e.target.value)}
            />
            <kbd aria-hidden="true">⌕</kbd>
          </label>
          <div className="file-filters">
            <button
              className={`filter-toggle ${onlyUnreviewed ? "is-on" : ""}`}
              aria-pressed={onlyUnreviewed}
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
          </div>
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
          {/* Review chrome waits until the person's change is ready (Learn by hand). */}
          {!writing && <div className="review-progress">
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
              {!allReviewed
                ? t.reviewHint
                : checkOpen && understanding?.required && !understanding.passed
                  ? t.allReviewed
                  : t.allReviewedDone}
            </small>
          </div>}
        </aside>
      )}
      <section className="diff-panel">
        <div className="diff-topbar">
          <span>
            <GitBranch size={14} /> {run.baseBranch}{" "}
            <span className="diff-topbar-arrow">←</span>{" "}
            {run.branch}
          </span>
          <div
            className="diff-toolbar-actions"
            role="toolbar"
            aria-label={t.toolbar}
            onKeyDown={(event) => toolbar.handleKeyDown(event)}
          >
            <button
              {...toolbar.itemProps(0)}
              className="icon-button"
              aria-label={showFiles ? t.hideFiles : t.showFiles}
              title={t.toggleFiles}
              onClick={() => setShowFiles(!showFiles)}
            >
              <PanelLeftClose size={16} />
            </button>
            <div className="code-size-control">
              <button
                {...toolbar.itemProps(1)}
                aria-label={t.smallerCode}
                disabled={codeFont <= 12}
                onClick={() => changeCodeFont(-1)}
              >
                <Minus size={13} />
              </button>
              <span>{codeFont}</span>
              <button
                {...toolbar.itemProps(2)}
                aria-label={t.largerCode}
                disabled={codeFont >= 20}
                onClick={() => changeCodeFont(1)}
              >
                <Plus size={13} />
              </button>
            </div>
            <button
              {...toolbar.itemProps(3)}
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
              {...toolbar.itemProps(4)}
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
              {...toolbar.itemProps(5)}
              className="icon-button"
              aria-label={t.refresh}
              title={t.refresh}
              onClick={refreshRun}
              disabled={active}
            >
              <RefreshCw size={14} />
            </button>
            <div className="view-toggle" role="group" aria-label={t.viewMode}>
              <button
                {...toolbar.itemProps(6)}
                aria-label={t.unified}
                title={t.unified}
                aria-pressed={diffView === "unified"}
                className={diffView === "unified" ? "selected" : ""}
                onClick={() => setDiffView("unified")}
              >
                <ListTree size={15} />
              </button>
              <button
                {...toolbar.itemProps(7)}
                aria-label={t.split}
                title={t.split}
                aria-pressed={diffView === "split"}
                className={diffView === "split" ? "selected" : ""}
                onClick={() => setDiffView("split")}
              >
                <Columns2 size={15} />
              </button>
            </div>
          </div>
        </div>
        {file ? (
          <DiffView
            key={`${run.id}:${file.path}:${run.baseSha ?? ""}`}
            file={file}
            reviewed={run.reviewedFiles.includes(file.path)}
            onReview={writing ? undefined : reviewFile}
            onAsk={checking ? () => setAskWaiting(true) : writing ? (question) => byHand?.ask(file, question) : ask}
            view={diffView}
            hasNote={Boolean(run.notes?.[file.path]?.text)}
            onLoadBase={
              !demo && file.fingerprint && run.baseSha
                ? () => loadBaseLines(run, file)
                : undefined
            }
            highlight={shownHighlight}
            guide={!!run.learnByHand && !demo}
          />
        ) : writing && run.worktreePath ? (
          <ErrorBoundary resetKey={`${run.id}:turn`}>
            <Suspense fallback={loading}><YourTurn run={run} worktreePath={run.worktreePath} presenting={present} /></Suspense>
          </ErrorBoundary>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">
              {active ? <Loader2 className="spin" /> : <Code2 />}
            </div>
            <h3>
              {active
                ? run.learnByHand ? workspace.byHand.reading : t.preparing
                : run.workspaceRemovedAt
                  ? t.filesRemoved
                  : t.noChanges}
            </h3>
            <p>
              {run.error ? (
                <FailureText text={run.error} />
              ) : run.workspaceRemovedAt ? (
                notices.workspaceRemoved
              ) : (
                run.learnByHand ? workspace.byHand.planFirst : t.noChangesHint
              )}
            </p>
            <button
              className="button secondary"
              onClick={() => setTab("activity")}
            >
              {t.viewActivity}
            </button>
          </div>
        )}
      </section>
      {(showExplanation || checking) && (
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
            {checking && understanding ? (
              <div className="check-wrap" ref={checkWrap}>
                {askWaiting && <p className="check-ask-waiting" role="status">{t.closedBookAsk}</p>}
                <ErrorBoundary resetKey={`${run.id}:check`}>
                  <Suspense
                    fallback={
                      <div className="empty-state" role="status">
                        <Loader2 className="spin" />
                        <p>{t.loadingPanel}</p>
                      </div>
                    }
                  >
                    <UnderstandingCheck
                      run={run}
                      files={files}
                      view={understanding.view}
                      demo={demo}
                      check={understanding}
                      mode={checkMode}
                      repo={currentRepo}
                      onClose={closeCheckPanel}
                      onPassed={() => {
                        if (checkMode === "forecast") closeCheckPanel();
                      }}
                      onOpenFile={(path) => {
                        closeCheckPanel();
                        setSelectedPath(path);
                      }}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            ) : writing && byHand ? (
              <ErrorBoundary resetKey={`${run.id}:guide`}>
                <Suspense fallback={loading}><GuidePanel run={run} files={files} {...byHand.guide} /></Suspense>
              </ErrorBoundary>
            ) : file ? (
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
                      reviewRerunning || rerunRequests.has(run.id) || (!!run.learnByHand && run.byHand?.busy?.kind === "review")
                    }
                    runLocale={run.locale}
                    attempt={run.attempts?.[file.path]}
                    onAttempt={
                      understanding && !run.publishing && (editable || (demo && ["review", "approved"].includes(run.status)))
                        ? (input) => understanding.saveAttempt(file, input)
                        : undefined
                    }
                    tryFirst={understanding?.tryFirst ?? true}
                    generated={currentRepo?.contributionRules?.generated}
                    highlight={shownHighlight}
                    onHighlight={(range) =>
                      setHighlight(
                        range
                          ? {
                              runId: run.id,
                              path: file.path,
                              fingerprint: file.fingerprint,
                              ...range,
                            }
                          : null,
                      )
                    }
                    onRetryWalkthrough={
                      demo || !walkthroughs
                        ? undefined
                        : () =>
                            void walkthroughs.requestWalkthrough(
                              run.id,
                              file.path,
                              true,
                            )
                    }
                    walkthroughBusy={walkthroughs?.walkthroughBusy}
                    initialTab={panelTab === "chat" ? "explain" : panelTab}
                    onTabChange={setPanelTab}
                    byHandReview={byHandReview}
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
    </>
  );
}
