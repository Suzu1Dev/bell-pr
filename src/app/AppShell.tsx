import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  FolderGit2,
  Github,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Terminal,
  Workflow,
  X,
} from "lucide-react";
// Stylesheets enter the bundle in import order and later rules win ties.
// These keep the order the single App component produced, before the
// modules below pull the same files in a different order.
import "../review/review.css";
import "../learning/learning.css";
import "../navigation/command-palette.css";
import "../efficiency/efficiency.css";
import "../models/models.css";
import "../mission/mission.css";
import "../team/team.css";
import { demoRepo, demoRun, demoFiles } from "../demo";
import type { Run, DiffFile } from "../types";
import { CommandPalette } from "../navigation/CommandPalette";
import { useProjectInsights } from "../mission/useProjectInsights";
import { HelpModal } from "../modals/HelpModal";
import { NewTaskModal } from "../modals/NewTaskModal";
import { RunsModal } from "../modals/RunsModal";
import { DiscoveryPage } from "../pages/DiscoveryPage";
import { LearningPage } from "../pages/LearningPage";
import { TeamPage } from "../pages/TeamPage";
import { ExplorePage } from "../repos/ExplorePage";
import { ImportRepoModal } from "../repos/ImportRepoModal";
import { ReposPage } from "../repos/ReposPage";
import { ModelSettingsModal } from "../settings/ModelSettingsModal";
import { SettingsPage } from "../settings/SettingsPage";
import { PublishModal } from "../workspace/PublishModal";
import { WorkspacePage } from "../workspace/WorkspacePage";
import { statusLabels } from "./labels";
import { useAppData } from "./hooks/useAppData";
import { useDraftEditor } from "./hooks/useDraftEditor";
import { useExplanations } from "./hooks/useExplanations";
import { loadDemo, useRunActions } from "./hooks/useRunActions";
import { useRunPolling } from "./hooks/useRunPolling";
import { useTaskSetup } from "./hooks/useTaskSetup";

export type Page =
  | "workspace"
  | "repos"
  | "explore"
  | "discovery"
  | "team"
  | "learning"
  | "settings";
export type Tab = "overview" | "changes" | "activity" | "draft";
export type ModalName =
  | "import"
  | "task"
  | "models"
  | "publish"
  | "help"
  | "runs"
  | null;
export type Notify = (message: string, tone?: "success" | "error") => void;

export default function App() {
  const [page, setPage] = useState<Page>("workspace");
  const [tab, setTab] = useState<Tab>("overview");
  const {
    repos,
    setRepos,
    runs,
    setRuns,
    status,
    setStatus,
    apiError,
    setApiError,
  } = useAppData();
  const [run, setRun] = useState<Run>(loadDemo);
  const [files, setFiles] = useState<DiffFile[]>(demoFiles);
  const [selectedPath, setSelectedPath] = useState(demoFiles[0]?.path || "");
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const mainContent = useRef<HTMLElement>(null);
  const commandShortcut = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
  const [modal, setModal] = useState<ModalName>(null);
  const [exploreRepoId, setExploreRepoId] = useState("demo-repo");
  const settingsRequest = useRef(0);
  const [showFiles, setShowFiles] = useState(true);
  const [showExplanation, setShowExplanation] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [codeFont, setCodeFont] = useState(
    () => Number(localStorage.getItem("bellpr-code-font")) || 14,
  );
  const [explanationWidth, setExplanationWidth] = useState(340);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [fileSearch, setFileSearch] = useState("");
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  // Activity-log filter by agent id; falls back to all when the open run has no such agent.
  const [logFilter, setLogFilter] = useState("all");
  // Display order only: review fingerprints and the server's diff are untouched.
  const [suggestedOrder, setSuggestedOrder] = useState(false);
  const [diffView, setDiffView] = useState<"unified" | "split">("unified");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("bellpr-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const runIdRef = useRef(run.id);
  runIdRef.current = run.id;
  const selectionSequence = useRef(0);
  const navigationIntent = useRef(0);
  const demo = run.id === demoRun.id;
  const currentRepo = demo ? demoRepo : repos.find((r) => r.id === run.repoId);
  const exploreRepo =
    exploreRepoId === "demo-repo"
      ? demoRepo
      : repos.find((repo) => repo.id === exploreRepoId);
  const insightRepo = page === "explore" ? exploreRepo : currentRepo;
  const intelligence = useProjectInsights(insightRepo?.id);
  const reading = page === "workspace" && tab === "changes";
  const file = files.find((f) => f.path === selectedPath) || files[0];
  const additions = files.reduce((sum, f) => sum + f.additions, 0);
  const deletions = files.reduce((sum, f) => sum + f.deletions, 0);
  const active = ["running", "queued", "awaiting_plan"].includes(run.status);
  const editable = !demo && ["review", "approved"].includes(run.status);
  // A learner-requested re-review keeps the run in review/approved; only the
  // two reviewer agents report running, so poll and offer 停止 on that signal.
  const reviewRerunning =
    editable &&
    run.agents.some(
      (agent) =>
        (agent.id === "reviewer" || agent.id === "tester") &&
        agent.status === "running",
    );
  const preparingDraft = run.draftPreparation?.status === "generating";
  const closeModal = useCallback(() => {
    settingsRequest.current++;
    setModal(null);
    setFormError("");
  }, []);
  const notify = useCallback(
    (message: string, tone: "success" | "error" = "success") =>
      setToast({ message, tone }),
    [],
  );
  const closeCommandPalette = useCallback(() => {
    selectionSequence.current++;
    navigationIntent.current++;
    setCommandOpen(false);
  }, []);
  const toggleCommandPalette = useCallback(() => {
    if (busy) {
      notify("正在完成目前操作，稍後即可切換。");
      return;
    }
    if (commandOpen) closeCommandPalette();
    else {
      selectionSequence.current++;
      navigationIntent.current++;
      setCommandOpen(true);
    }
  }, [busy, commandOpen, closeCommandPalette, notify]);
  const draft = useDraftEditor({
    run,
    setRun,
    demo,
    runIdRef,
    notify,
    setBusy,
  });
  const { draftMutationEpoch } = draft;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggleCommandPalette();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleCommandPalette]);

  useEffect(() => {
    if (reading) window.scrollTo({ top: 0, behavior: "instant" });
  }, [reading, focusMode]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "bellpr-sidebar-collapsed",
        String(sidebarCollapsed),
      );
    } catch {
      // The current session still works if browser storage is unavailable.
    }
  }, [sidebarCollapsed]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || modal || commandOpen) return;
      if (event.key === "Escape") setFocusMode(false);
      // "?" opens the guide unless the reader is typing in a field.
      const typing = (event.target as Element | null)?.closest(
        "input, textarea, select, [contenteditable]",
      );
      if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing) {
        event.preventDefault();
        // openModal only touches refs and state setters, so this closure never goes stale.
        openModal("help");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [modal, commandOpen]);
  useEffect(() => {
    // Errors stay until the reader closes them; success notices fade out.
    if (!toast || toast.tone === "error") return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (demo) localStorage.setItem("bellpr-demo-run", JSON.stringify(run));
  }, [demo, run]);
  useRunPolling({
    run,
    demo,
    active,
    preparingDraft,
    reviewRerunning,
    draftMutationEpoch,
    setRun,
    setRuns,
    setFiles,
    setSelectedPath,
    setTab,
    setApiError,
  });
  const { explanationRequests, prepareExplanations } = useExplanations({
    run,
    demo,
    active,
    files,
    runIdRef,
    draftMutationEpoch,
    setFiles,
    setRun,
  });
  function openModal(value: typeof modal) {
    navigationIntent.current++;
    setModal(value);
    setFormError("");
  }
  function navigate(value: Page) {
    navigationIntent.current++;
    setPage(value);
    setSidebarOpen(false);
  }
  const setup = useTaskSetup({
    repos,
    setRepos,
    insightRepo,
    intelligence,
    busy,
    setBusy,
    setFormError,
    notify,
    openModal,
    navigate,
    setExploreRepoId,
    navigationIntent,
    settingsRequest,
  });
  const {
    source,
    setSource,
    beginContribution,
    configureContributionModels,
    chooseRecommendation,
    chooseOpportunity,
  } = setup;
  const actions = useRunActions({
    run,
    setRun,
    runIdRef,
    file,
    setFiles,
    setSelectedPath,
    demo,
    reviewRerunning,
    setBusy,
    setFormError,
    notify,
    openModal,
    closeModal,
    navigate,
    setTab,
    setShowExplanation,
    setFocusMode,
    setRepos,
    setRuns,
    setExploreRepoId,
    navigationIntent,
    selectionSequence,
    draft,
    setup,
  });
  const { chooseRun, importRepo, startTask, publish } = actions;

  function focusDestination() {
    window.requestAnimationFrame(() => {
      const heading = mainContent.current?.querySelector<HTMLElement>("h1");
      (heading ?? mainContent.current)?.focus();
    });
  }

  async function openPaletteRun(id: string) {
    const opened = await chooseRun(id, false);
    if (opened) {
      closeModal();
      focusDestination();
    }
    return opened;
  }

  function openPaletteRepo(id: string) {
    setExploreRepoId(id);
    closeModal();
    navigate("explore");
    focusDestination();
  }

  return (
    <div
      className={`app-shell ${reading ? "is-reading" : ""} ${reading && focusMode ? "is-focused" : ""} ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}
      style={
        {
          "--code-size": `${codeFont}px`,
          "--explanation-width": `${explanationWidth}px`,
        } as CSSProperties
      }
    >
      <a className="skip-to-content" href="#main-content" onClick={(event) => {
        event.preventDefault();
        focusDestination();
      }}>跳至主要內容</a>
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="關閉導覽"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        id="workspace-sidebar"
        className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}
      >
        <a
          href="#"
          className="brand"
          aria-label="BELL PR 首頁"
          onClick={(e) => {
            e.preventDefault();
            navigate("workspace");
          }}
        >
          <span className="brand-symbol">
            b<span />
          </span>
          <span>
            BELL<span className="brand-pr">PR</span>
          </span>
          <span className="beta-label">BETA</span>
        </a>
        <button className="workspace-switch" onClick={() => navigate("repos")}>
          <span className="workspace-avatar">M</span>
          <span>
            <strong>我的工作空間</strong>
            <small>Personal workspace</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="主要導覽">
          <button
            className={page === "workspace" ? "nav-item active" : "nav-item"}
            title="貢獻工作台"
            onClick={() => navigate("workspace")}
          >
            <LayoutDashboard size={18} />
            <span>貢獻工作台</span>
            <span className="nav-count">{runs.length + 1}</span>
          </button>
          <button
            className={page === "repos" ? "nav-item active" : "nav-item"}
            title="Repositories"
            onClick={() => navigate("repos")}
          >
            <FolderGit2 size={18} />
            <span>Repositories</span>
          </button>
          <button
            className={page === "discovery" ? "nav-item active" : "nav-item"}
            title="探索貢獻"
            onClick={() => navigate("discovery")}
          >
            <Search size={18} />
            <span>探索貢獻</span>
          </button>
          <button
            className={page === "team" ? "nav-item active" : "nav-item"}
            title="Agent team"
            onClick={() => navigate("team")}
          >
            <Workflow size={18} />
            <span>Agent team</span>
          </button>
          <button
            className={page === "learning" ? "nav-item active" : "nav-item"}
            title="學習筆記"
            onClick={() => navigate("learning")}
          >
            <BookOpen size={18} />
            <span>學習筆記</span>
            <span className="tiny-new">NEW</span>
          </button>
        </nav>
        <div className="nav-label recent-label">
          最近的貢獻{" "}
          <button aria-label="新增任務" onClick={() => beginContribution()}>
            <Plus size={14} />
          </button>
        </div>
        <div className="recent-list">
          {[...runs.slice(0, 4), demoRun].map((r) => (
            <button
              key={r.id}
              className={`recent-item ${run.id === r.id ? "selected" : ""}`}
              onClick={() => chooseRun(r.id)}
            >
              <span
                className={`small-status ${r.status === "running" ? "running" : ""}`}
              />
              <span>{r.id === demoRun.id ? "SDK 智慧重試機制" : r.title}</span>
              {r.id === demoRun.id && <span className="demo-small">範例</span>}
            </button>
          ))}
          <button className="all-runs-link" onClick={() => openModal("runs")}>
            查看全部貢獻 <ChevronRight size={12} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="learning-card">
            <div className="learning-card-icon">
              <Sparkles size={17} />
            </div>
            <strong>每一次貢獻，都有所收穫。</strong>
            <p>
              理解改動背後的思考，
              <br />
              累積屬於你的開發經驗。
            </p>
            <button onClick={() => navigate("learning")}>
              探索學習筆記 <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className="nav-item"
            title="連線與設定"
            onClick={() => navigate("settings")}
          >
            <Settings2 size={17} />
            <span>連線與設定</span>
          </button>
          <button
            className="nav-item"
            title="使用指南"
            aria-keyshortcuts="?"
            onClick={() => openModal("help")}
          >
            <CircleHelp size={17} />
            <span>使用指南</span>
            <span className="shortcut">?</span>
          </button>
          <div className="profile">
            <span className="profile-avatar">MC</span>
            <span>
              <strong>{status?.githubUser || "My workspace"}</strong>
              <small>
                <span className="connection-dot" /> 本機工作空間
              </small>
            </span>
            <button
              className="icon-button"
              aria-label="工作空間設定"
              onClick={() => navigate("settings")}
            >
              <Settings2 size={15} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main-shell" id="main-content" ref={mainContent} tabIndex={-1}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="開啟導覽"
              aria-controls="workspace-sidebar"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={18} />
            </button>
            <button
              className="icon-button sidebar-toggle"
              aria-label={sidebarCollapsed ? "展開左側選單" : "收合左側選單"}
              title={sidebarCollapsed ? "展開左側選單" : "收合左側選單"}
              aria-controls="workspace-sidebar"
              aria-expanded={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </button>
            <span className="breadcrumb-root">工作空間</span>
            <ChevronRight size={13} />
            <span>
              {
                {
                  workspace: "貢獻工作台",
                  repos: "Repositories",
                  explore: "專案全貌",
                  discovery: "探索貢獻",
                  team: "Agent team",
                  learning: "學習筆記",
                  settings: "連線與設定",
                }[page]
              }
            </span>
          </div>
          <div className="topbar-right">
            <button
              className="workspace-command"
              onClick={toggleCommandPalette}
              disabled={busy}
              aria-label="快速切換專案與貢獻"
              aria-keyshortcuts="Meta+K Control+K"
              aria-haspopup="dialog"
              title={`快速切換專案與貢獻 (${commandShortcut})`}
            >
              <Search size={15} aria-hidden="true" />
              <span>快速切換</span>
              <kbd>{commandShortcut}</kbd>
            </button>
            <span className="local-badge">
              <span className="connection-dot" /> Local-first
            </span>
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="icon-button"
              aria-label="開啟 GitHub"
            >
              <Github size={18} />
            </a>
            <button
              className="top-avatar"
              onClick={() => navigate("settings")}
              aria-label="個人設定"
            >
              M
            </button>
          </div>
        </header>
        {apiError && (
          <div role="alert" className="connection-banner">
            <Terminal size={16} />
            <span>{apiError}</span>
            <button onClick={() => setApiError("")} aria-label="關閉連線提示">
              <X size={15} />
            </button>
          </div>
        )}
        {page === "workspace" ? (
          <WorkspacePage
            run={run}
            files={files}
            file={file}
            selectedPath={selectedPath}
            setSelectedPath={setSelectedPath}
            currentRepo={currentRepo}
            demo={demo}
            reading={reading}
            active={active}
            busy={busy}
            editable={editable}
            reviewRerunning={reviewRerunning}
            preparingDraft={preparingDraft}
            additions={additions}
            deletions={deletions}
            tab={tab}
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
            logFilter={logFilter}
            setLogFilter={setLogFilter}
            intelligence={intelligence}
            explanationRequests={explanationRequests}
            prepareExplanations={prepareExplanations}
            beginContribution={beginContribution}
            chooseRecommendation={chooseRecommendation}
            draft={draft}
            actions={actions}
          />
        ) : page === "explore" && exploreRepo ? (
          <ExplorePage
            exploreRepo={exploreRepo}
            intelligence={intelligence}
            beginContribution={beginContribution}
            chooseRecommendation={chooseRecommendation}
            setTab={setTab}
          />
        ) : page === "discovery" ? (
          <DiscoveryPage chooseOpportunity={chooseOpportunity} />
        ) : page === "repos" ? (
          <ReposPage
            repos={repos}
            openModal={openModal}
            navigate={navigate}
            chooseRun={chooseRun}
            setExploreRepoId={setExploreRepoId}
          />
        ) : page === "team" ? (
          <TeamPage beginContribution={beginContribution} />
        ) : page === "learning" ? (
          <LearningPage
            runs={runs}
            repos={repos}
            chooseRun={chooseRun}
            setSelectedPath={setSelectedPath}
            setTab={setTab}
          />
        ) : (
          <SettingsPage
            status={status}
            setStatus={setStatus}
            setApiError={setApiError}
            notify={notify}
            configureContributionModels={configureContributionModels}
            setTab={setTab}
            navigate={navigate}
          />
        )}
      </main>
      {commandOpen && (
        <CommandPalette
          repos={[...repos, demoRepo]}
          runs={[...runs, { ...demoRun, status: demo ? run.status : demoRun.status }]}
          currentRepoId={insightRepo?.id}
          currentRunId={run.id}
          statusLabels={statusLabels}
          onClose={closeCommandPalette}
          onSelectRun={openPaletteRun}
          onSelectRepo={openPaletteRepo}
        />
      )}
      {toast && (
        // role="alert" is announced immediately (assertive); role="status"
        // waits for the screen reader to finish what it is saying (polite).
        <div
          className={`toast ${toast.tone === "error" ? "toast-error" : ""}`}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          {toast.tone === "error" ? (
            <AlertCircle size={18} />
          ) : (
            <CircleCheck size={18} />
          )}
          {toast.message}
          <button aria-label="關閉通知" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {modal === "import" && (
        <ImportRepoModal
          source={source}
          setSource={setSource}
          busy={busy}
          formError={formError}
          importRepo={importRepo}
          closeModal={closeModal}
        />
      )}
      {modal === "models" && (
        <ModelSettingsModal
          setup={setup}
          busy={busy}
          formError={formError}
          setFormError={setFormError}
          closeModal={closeModal}
        />
      )}
      {modal === "task" && (
        <NewTaskModal
          setup={setup}
          repos={repos}
          busy={busy}
          formError={formError}
          startTask={startTask}
          closeModal={closeModal}
          openModal={openModal}
          navigate={navigate}
          setExploreRepoId={setExploreRepoId}
        />
      )}
      {modal === "publish" && (
        <PublishModal
          run={run}
          files={files}
          demo={demo}
          currentRepo={currentRepo}
          additions={additions}
          deletions={deletions}
          busy={busy}
          formError={formError}
          draft={draft}
          publish={publish}
          closeModal={closeModal}
          setTab={setTab}
        />
      )}
      {modal === "runs" && (
        <RunsModal
          runs={runs}
          repos={repos}
          chooseRun={chooseRun}
          beginContribution={beginContribution}
          closeModal={closeModal}
        />
      )}
      {modal === "help" && <HelpModal closeModal={closeModal} />}
    </div>
  );
}
