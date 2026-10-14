import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Terminal, X } from "lucide-react";
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
import { ErrorBoundary, listenForPreloadErrors } from "./ErrorBoundary";
import { statusLabels } from "./labels";
import { Sidebar } from "./Sidebar";
import { Toasts, type Toast } from "./Toasts";
import { Topbar } from "./Topbar";
import { useAppData } from "./hooks/useAppData";
import { useDraftEditor } from "./hooks/useDraftEditor";
import { useExplanations } from "./hooks/useExplanations";
import { useRepoUpdate } from "./hooks/useRepoUpdate";
import { loadDemo, useRunActions } from "./hooks/useRunActions";
import { useRunPolling } from "./hooks/useRunPolling";
import { useRunRounds } from "./hooks/useRunRounds";
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

// Registered on load, before the first render can request a lazy chunk.
listenForPreloadErrors();

export default function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}

function AppShell() {
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
  const [toast, setToast] = useState<Toast | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const mainContent = useRef<HTMLElement>(null);
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
  const rounds = useRunRounds({
    run,
    setRun,
    runIdRef,
    setFiles,
    setBusy,
    notify,
    setTab,
  });
  const { updatingRepo, updateRepo } = useRepoUpdate({
    setRepos,
    reloadInsights: intelligence.reload,
    notify,
  });

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
      <Sidebar
        page={page}
        runs={runs}
        run={run}
        status={status}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        navigate={navigate}
        openModal={openModal}
        beginContribution={beginContribution}
        chooseRun={chooseRun}
      />
      <main className="main-shell" id="main-content" ref={mainContent} tabIndex={-1}>
        <Topbar
          page={page}
          busy={busy}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
          toggleCommandPalette={toggleCommandPalette}
          navigate={navigate}
        />
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
            rounds={rounds}
            onUpdateRepo={
              !demo && currentRepo?.updatable
                ? () => void updateRepo(currentRepo)
                : undefined
            }
            updatingRepo={updatingRepo}
          />
        ) : page === "explore" && exploreRepo ? (
          <ExplorePage
            exploreRepo={exploreRepo}
            intelligence={intelligence}
            beginContribution={beginContribution}
            chooseRecommendation={chooseRecommendation}
            setTab={setTab}
            onUpdateRepo={
              exploreRepo.updatable
                ? () => void updateRepo(exploreRepo)
                : undefined
            }
            updatingRepo={updatingRepo}
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
      {toast && <Toasts toast={toast} setToast={setToast} />}
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
