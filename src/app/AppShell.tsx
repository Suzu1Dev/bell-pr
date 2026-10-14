import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type SetStateAction,
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
import { ApiError } from "../api";
import { getDemo } from "../demo";
import { useLocale, useT } from "../i18n";
import type { Run, DiffFile } from "../types";
import { CommandPalette } from "../navigation/CommandPalette";
import {
  currentRoute,
  navigate as navigateTo,
  useHashRoute,
  type Route,
} from "../navigation/route";
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
import { Sidebar } from "./Sidebar";
import { Toasts, type Toast } from "./Toasts";
import { Topbar } from "./Topbar";
import { useAppData } from "./hooks/useAppData";
import { loadDemo } from "./hooks/demoStorage";
import { useDraftEditor } from "./hooks/useDraftEditor";
import { useExplanations } from "./hooks/useExplanations";
import { useRepoUpdate } from "./hooks/useRepoUpdate";
import { useRunActions } from "./hooks/useRunActions";
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

// The address (src/navigation/route.ts) is the source of the page, the open
// run, its tab and its file. An empty hash keeps the start view: the sample
// workspace, which #/home, #/demo and #/about show as well for now.

/** The page a route shows; a repository that is not listed shows the list. */
function pageFor(route: Route | null, knownRepo: boolean): Page {
  switch (route?.name) {
    case "repos":
      return "repos";
    case "repo":
      return knownRepo ? "explore" : "repos";
    case "discover":
      return "discovery";
    case "team":
      return "team";
    case "learning":
      return "learning";
    case "settings":
      return "settings";
    default:
      return "workspace";
  }
}

/** The route of each page that takes no parameters. */
const pageRoutes = {
  repos: "repos",
  discovery: "discover",
  team: "team",
  learning: "learning",
  settings: "settings",
} as const satisfies Record<
  Exclude<Page, "workspace" | "explore">,
  Route["name"]
>;

/** The run the address shows in the workspace; undefined on other pages. */
function addressedRunId(route: Route | null, demoRunId: string) {
  if (route?.name === "run") return route.runId;
  if (!route || ["home", "demo", "about"].includes(route.name)) return demoRunId;
  return undefined;
}

/** What the workspace shows of a run: its tab and, when chosen, its file. */
interface WorkspaceView {
  runId: string;
  tab: Tab;
  file?: string;
}

function AppShell() {
  const t = useT("app");
  const [locale] = useLocale();
  // The sample project in the UI language; its ids are the same in every locale.
  const sample = getDemo(locale);
  const route = useHashRoute();
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
  const [run, setRunState] = useState<Run>(() => loadDemo(locale));
  // The run the latest action opened, ahead of the next render; the setters
  // below write it into the address.
  const openRunId = useRef(run.id);
  const setRun = useCallback((value: SetStateAction<Run>) => {
    if (typeof value !== "function") openRunId.current = value.id;
    setRunState(value);
  }, []);
  const [files, setFiles] = useState<DiffFile[]>(() => sample.files);
  // The workspace's tab and file while another page is shown, and the
  // repository the overview page shows next.
  const workspaceMemory = useRef<WorkspaceView>({
    runId: run.id,
    tab: "overview",
  });
  const exploreMemory = useRef(sample.repo.id);
  // Above 0 while a run the address names loads; its own tab and file
  // changes then stay out of the address.
  const followingAddress = useRef(0);
  /** The workspace's tab and file now, and whether the address shows it. */
  const workspaceView = useCallback((): WorkspaceView & {
    shown: boolean;
  } => {
    const runId = openRunId.current;
    const now = currentRoute();
    if (now?.name === "run")
      return {
        shown: true,
        runId,
        tab: now.tab ?? "overview",
        // A file of the run shown before belongs to that run only.
        ...(now.file && now.runId === runId ? { file: now.file } : {}),
      };
    if (pageFor(now, false) === "workspace")
      return { shown: true, runId, tab: "overview" };
    const memory = workspaceMemory.current;
    return {
      shown: false,
      runId,
      tab: memory.tab,
      ...(memory.file && memory.runId === runId ? { file: memory.file } : {}),
    };
  }, []);
  const showWorkspace = useCallback((view: WorkspaceView) => {
    workspaceMemory.current = view;
    navigateTo({ name: "run", ...view });
  }, []);
  const setTab = useCallback(
    (value: SetStateAction<Tab>) => {
      if (followingAddress.current) return;
      const { shown, ...view } = workspaceView();
      const tab = typeof value === "function" ? value(view.tab) : value;
      if (shown) showWorkspace({ ...view, tab });
      else workspaceMemory.current = { ...view, tab };
    },
    [workspaceView, showWorkspace],
  );
  const setSelectedPath = useCallback(
    (value: SetStateAction<string>) => {
      if (followingAddress.current) return;
      const { shown, file: previous, ...view } = workspaceView();
      const file =
        (typeof value === "function" ? value(previous ?? "") : value) ||
        undefined;
      const next = file ? { ...view, file } : view;
      if (shown) showWorkspace(next);
      else workspaceMemory.current = next;
    },
    [workspaceView, showWorkspace],
  );
  const setExploreRepoId = useCallback((value: SetStateAction<string>) => {
    const now = currentRoute();
    const previous =
      now?.name === "repo" ? now.repoId : exploreMemory.current;
    const repoId = typeof value === "function" ? value(previous) : value;
    exploreMemory.current = repoId;
    if (now?.name === "repo") navigateTo({ name: "repo", repoId });
  }, []);
  const [toast, setToast] = useState<Toast | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const mainContent = useRef<HTMLElement>(null);
  const [modal, setModal] = useState<ModalName>(null);
  const exploreRepoId = route?.name === "repo" ? route.repoId : undefined;
  const settingsRequest = useRef(0);
  const [showFiles, setShowFiles] = useState(true);
  const [showExplanation, setShowExplanation] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [codeFont, setCodeFont] = useState(() => {
    try {
      return Number(localStorage.getItem("bellpr-code-font")) || 14;
    } catch {
      return 14;
    }
  });
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
  const demo = run.id === sample.run.id;
  const currentRepo = demo
    ? sample.repo
    : repos.find((r) => r.id === run.repoId);
  const exploreRepo =
    exploreRepoId === sample.repo.id
      ? sample.repo
      : repos.find((repo) => repo.id === exploreRepoId);
  const page = pageFor(route, Boolean(exploreRepo));
  const insightRepo = page === "explore" ? exploreRepo : currentRepo;
  const intelligence = useProjectInsights(insightRepo?.id);
  const tab: Tab = (route?.name === "run" && route.tab) || "overview";
  const reading = page === "workspace" && tab === "changes";
  // ?file= selects a file of the run when it has one, else the first file.
  const routeFile = route?.name === "run" ? route.file : undefined;
  const selectedPath =
    routeFile && files.some((f) => f.path === routeFile)
      ? routeFile
      : files[0]?.path || "";
  const file = files.find((f) => f.path === selectedPath) || files[0];
  const additions = files.reduce((sum, f) => sum + f.additions, 0);
  const deletions = files.reduce((sum, f) => sum + f.deletions, 0);
  const active = ["running", "queued", "awaiting_plan"].includes(run.status);
  const editable = !demo && ["review", "approved"].includes(run.status);
  // A learner-requested re-review keeps the run in review/approved; only the
  // two reviewer agents report running, so poll and offer to stop on that signal.
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
      notify(t.busySwitching);
      return;
    }
    if (commandOpen) closeCommandPalette();
    else {
      selectionSequence.current++;
      navigationIntent.current++;
      setCommandOpen(true);
    }
  }, [busy, commandOpen, closeCommandPalette, notify, t]);
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
    if (value === "workspace") {
      // Opening a run the address names already shows the workspace.
      if (!followingAddress.current) {
        const { shown: _shown, ...view } = workspaceView();
        showWorkspace(view);
      }
    } else if (value === "explore")
      navigateTo({ name: "repo", repoId: exploreMemory.current });
    else navigateTo({ name: pageRoutes[value] });
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

  // The workspace and the overview page come back as they were left.
  useEffect(() => {
    if (route?.name === "run")
      workspaceMemory.current = {
        runId: route.runId,
        tab: route.tab ?? "overview",
        ...(route.file ? { file: route.file } : {}),
      };
    if (route?.name === "repo") exploreMemory.current = route.repoId;
  }, [route]);

  // A link, Back, Forward or a reload names a run: open it. An unknown run
  // opens the sample instead; a run that cannot open now (the reader keeps
  // an unsaved draft, or the server fails) leaves the address on the run
  // shown.
  const addressRunId = addressedRunId(route, sample.run.id);
  const shownRunId = useRef(run.id);
  const loadingRunId = useRef<string | undefined>(undefined);
  const addressLoads = useRef(0);
  const openRun = useRef(chooseRun);
  openRun.current = chooseRun;
  useEffect(() => {
    const previous = shownRunId.current;
    shownRunId.current = run.id;
    if (!addressRunId || addressRunId === run.id) return;
    /** Puts `runId` in the address in place of the run it names. */
    const showInstead = (runId: string) => {
      const { shown: _shown, ...view } = workspaceView();
      navigateTo({ ...view, name: "run", runId }, { replace: true });
    };
    if (previous !== run.id && addressRunId === previous) {
      // An action opened another run without naming it in the address.
      showInstead(run.id);
      return;
    }
    if (loadingRunId.current === addressRunId) return;
    const load = ++addressLoads.current;
    loadingRunId.current = addressRunId;
    followingAddress.current++;
    let missing = false;
    openRun
      .current(addressRunId, false)
      .catch((error: unknown) => {
        missing = error instanceof ApiError && error.status === 404;
        if (!missing) notify((error as Error).message, "error");
        return false;
      })
      .then((opened) => {
        followingAddress.current--;
        if (load === addressLoads.current) loadingRunId.current = undefined;
        const asked = addressedRunId(currentRoute(), sample.run.id);
        if (opened || asked !== addressRunId) return;
        showInstead(missing ? sample.run.id : openRunId.current);
      });
  }, [addressRunId, run.id, sample.run.id, notify, workspaceView]);
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
      }}>{t.skipToContent}</a>
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
            <button
              onClick={() => setApiError("")}
              aria-label={t.dismissConnectionNotice}
            >
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
          repos={[...repos, sample.repo]}
          runs={[...runs, { ...sample.run, status: demo ? run.status : sample.run.status }]}
          currentRepoId={insightRepo?.id}
          currentRunId={run.id}
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
