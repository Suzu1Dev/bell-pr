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
import type { DiffFile, Repo, Run } from "../types";
import { applyReviewOrder, parseReviewOrder } from "../../shared/review-order";
import { DiffView } from "../review/DiffView";
import { languageBadge } from "../review/diff";
import type { useProjectInsights } from "../mission/useProjectInsights";
import type { Tab } from "../app/AppShell";
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
    setCodeFont((current) => {
      const next = Math.max(12, Math.min(20, current + delta));
      localStorage.setItem("bellpr-code-font", String(next));
      return next;
    });
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
              變更的檔案 <span>{files.length}</span>
            </strong>
            <ListTree size={16} />
          </div>
          <label className="file-search">
            <Search size={14} />
            <input
              placeholder="搜尋檔案…"
              aria-label="搜尋變更檔案"
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
            只看尚未審查
          </button>
          {reviewOrder.length > 0 && (
            <button
              className={`filter-toggle ${suggestedOrder ? "is-on" : ""}`}
              aria-pressed={suggestedOrder}
              title="依 Lead 整合摘要建議的閱讀順序排列；未提到的檔案維持 git 順序排在後面"
              onClick={() => setSuggestedOrder(!suggestedOrder)}
            >
              <span className="toggle-track">
                <span />
              </span>
              依建議順序
            </button>
          )}
          <div className="file-tree">
            <div className="tree-root">
              <ChevronDown size={13} />
              <FolderGit2 size={15} />
              {currentRepo?.name || "repository"}
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
                    title={fileStatusLabel(f.status).title}
                  >
                    {fileStatusLabel(f.status).badge}
                  </span>
                )}
              </button>
            ))}
            {!visibleFiles.length && (
              <p className="file-empty">
                {active ? "等待 agent 產生變更" : "沒有符合的檔案"}
              </p>
            )}
          </div>
          <div className="review-progress">
            <div>
              <span>審查進度</span>
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
              {allReviewed
                ? "所有變更都已看過，準備好送出！"
                : "看懂了，就勾選「已審閱」。"}
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
              aria-label={
                showFiles ? "收合檔案清單" : "顯示檔案清單"
              }
              title="切換檔案清單"
              onClick={() => setShowFiles(!showFiles)}
            >
              <PanelLeftClose size={16} />
            </button>
            <div className="code-size-control">
              <button
                aria-label="縮小程式碼字體"
                disabled={codeFont <= 12}
                onClick={() => changeCodeFont(-1)}
              >
                <Minus size={13} />
              </button>
              <span>{codeFont}</span>
              <button
                aria-label="放大程式碼字體"
                disabled={codeFont >= 20}
                onClick={() => changeCodeFont(1)}
              >
                <Plus size={13} />
              </button>
            </div>
            <button
              className="icon-button"
              aria-label={
                showExplanation ? "收合解說面板" : "顯示解說面板"
              }
              title="切換解說面板"
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
              aria-label={
                focusMode ? "離開專注模式" : "進入專注模式"
              }
              title="專注閱讀"
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
              aria-label="重新整理差異"
              title="重新整理差異"
              onClick={refreshRun}
              disabled={active}
            >
              <RefreshCw size={14} />
            </button>
            <div className="view-toggle" aria-label="Diff 顯示模式">
              <button
                aria-label="統一檢視"
                title="統一檢視"
                className={diffView === "unified" ? "selected" : ""}
                onClick={() => setDiffView("unified")}
              >
                <ListTree size={15} />
              </button>
              <button
                aria-label="並排檢視"
                title="並排檢視"
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
            <span>
              你可以直接在這個目錄修改，重新整理差異後會重新解說與審閱狀態
            </span>
            <code>{run.worktreePath}</code>
            <button
              type="button"
              className="icon-button"
              aria-label="複製工作目錄路徑"
              title="複製工作目錄路徑"
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
            <h3>
              {active
                ? "Agent team 正在準備你的變更"
                : "尚無程式碼變更"}
            </h3>
            <p>
              {run.error ||
                "在 Agent 動態查看執行過程，完成後即可在這裡審查。"}
            </p>
            <button
              className="button secondary"
              onClick={() => setTab("activity")}
            >
              查看 Agent 動態
            </button>
          </div>
        )}
      </section>
      {showExplanation && (
        <>
          <div
            className="pane-resizer"
            role="separator"
            aria-label="調整解說面板寬度"
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
              <Suspense
                fallback={
                  <div className="empty-state" role="status">
                    <Loader2 className="spin" />
                    <p>正在準備閱讀面板…</p>
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
            ) : (
              <div className="empty-state">
                <Sparkles />
                <h3>理解，從改動開始。</h3>
                <p>選取變更的檔案，就能詢問背後的設計與取捨。</p>
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
