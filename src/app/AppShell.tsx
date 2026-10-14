import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
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
import type { AppSettingsView } from "../../shared/app-settings";
import { eulaVersion } from "../../shared/product";
import type { ApiErrorBody } from "../../shared/errors";
import { summarizeRun } from "../../shared/runs";
import { api, ApiError, authRequiredEvent, send } from "../api";
import { Logo } from "../brand/Logo";
import { getDemo } from "../demo";
import { HomePage } from "../home/HomePage";
import { useLocale, useT } from "../i18n";
import { UpgradeDialog } from "../license/UpgradeDialog";
import { useEntitlements } from "../license/useEntitlements";
import type { Run, DiffFile, Repo } from "../types";
import {
  currentRoute,
  navigate as navigateTo,
  titleFor,
  useHashRoute,
  type Route,
} from "../navigation/route";
import { useProjectInsights } from "../mission/useProjectInsights";
import { HelpModal } from "../modals/HelpModal";
import { needsEulaPrompt, startView, type StartView } from "../onboarding/startView";
import type { WelcomeChoice } from "../onboarding/Welcome";
import { RunsModal } from "../modals/RunsModal";
import { DiscoveryPage } from "../pages/DiscoveryPage";
import { TeamPage } from "../pages/TeamPage";
import { ExplorePage } from "../repos/ExplorePage";
import { ImportRepoModal } from "../repos/ImportRepoModal";
import { ReposPage } from "../repos/ReposPage";
import { CopyCommand } from "../setup/CopyCommand";
import { useDoctor, type DoctorState } from "../setup/useDoctor";
import { PublishModal } from "../workspace/PublishModal";
import { WorkspacePage } from "../workspace/WorkspacePage";
import { ErrorBoundary, listenForPreloadErrors } from "./ErrorBoundary";
import { Sidebar } from "./Sidebar";
import { Toasts, type Toast } from "./Toasts";
import { Topbar } from "./Topbar";
import { usePresentation } from "./presentation";
import { useAppData, type AppData } from "./hooks/useAppData";
import { loadDemo } from "./hooks/demoStorage";
import { useDraftEditor } from "./hooks/useDraftEditor";
import { useExplanations } from "./hooks/useExplanations";
import { useRepoUpdate } from "./hooks/useRepoUpdate";
import { useRunActions } from "./hooks/useRunActions";
import { useRunPolling } from "./hooks/useRunPolling";
import { useRunRounds } from "./hooks/useRunRounds";
import { useTaskSetup } from "./hooks/useTaskSetup";

export type Page =
  | "home"
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
  | "about"
  | null;
export type Notify = (message: string, tone?: "success" | "error") => void;

// Registered on load, before the first render can request a lazy chunk.
listenForPreloadErrors();

// Shown once (the first start), on request (About) or rarely (a new
// license agreement), so they load on their own instead of with the app.
const Welcome = lazy(() =>
  import("../onboarding/Welcome").then((module) => ({ default: module.Welcome })),
);
const AboutDialog = lazy(() =>
  import("../about/AboutDialog").then((module) => ({ default: module.AboutDialog })),
);
const EulaPrompt = lazy(() =>
  import("../onboarding/EulaPrompt").then((module) => ({ default: module.EulaPrompt })),
);
// Settings are a page most visits never open; it loads on its own too.
const SettingsPage = lazy(() =>
  import("../settings/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
// Opened on request (Ctrl+K, the learning page), so each loads on its own.
const CommandPalette = lazy(() =>
  import("../navigation/CommandPalette").then((module) => ({
    default: module.CommandPalette,
  })),
);
const LearningPage = lazy(() =>
  import("../pages/LearningPage").then((module) => ({ default: module.LearningPage })),
);
// The task and model dialogs carry the direction and model pickers, which
// load with the dialog that needs them.
const NewTaskModal = lazy(() =>
  import("../modals/NewTaskModal").then((module) => ({ default: module.NewTaskModal })),
);
const ModelSettingsModal = lazy(() =>
  import("../settings/ModelSettingsModal").then((module) => ({
    default: module.ModelSettingsModal,
  })),
);

export default function App() {
  return (
    <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>
  );
}

/** A status without a license: useEntitlements then asks /api/license. */
const statusPending = {};

/** localStorage key of the run the workbench showed last. */
export const lastRunKey = "bellpr-last-run";

/** The run the workbench showed last, if the browser kept it. */
export function readLastRun(): string | undefined {
  try {
    return localStorage.getItem(lastRunKey) || undefined;
  } catch {
    return undefined;
  }
}

function rememberLastRun(id: string) {
  try {
    localStorage.setItem(lastRunKey, id);
  } catch {
    // The current session still works if browser storage is unavailable.
  }
}

/**
 * Loads the app's data and the environment report once for every page,
 * sends an address that names no route (an empty hash, an unknown path) to
 * Home, keeping its flags, and shows the welcome flow on a first start.
 */
function AppRoot() {
  // First, so it listens before the first request is sent.
  const [sessionEnded, setSessionEnded] = useSessionEnded();
  const data = useAppData();
  // Decided once: settings that change later never bring Welcome back.
  const [view, setView] = useState<StartView>("pending");
  // Every page uses the environment report (the readiness pill, About's
  // data directory). useDoctor probes again every 5 s while a required
  // check fails, which runs the CLI probes (`gh api user` among them), so
  // that only goes on while a view that helps fix the environment shows:
  // Welcome, and Home's summary or the new-task dialog (see AppShell).
  const [doctorLive, setDoctorLive] = useState(false);
  const [doctorSettled, setDoctorSettled] = useState(false);
  const doctor = useDoctor({
    enabled: !doctorSettled || doctorLive || view === "welcome",
  });
  useEffect(() => {
    if (doctor.report || doctor.error) setDoctorSettled(true);
  }, [doctor.report, doctor.error]);
  const presentation = usePresentation();
  const route = useHashRoute();
  useEffect(() => {
    if (!route) navigateTo({ name: "home" }, { replace: true });
  }, [route]);
  const appTitle = useT("app").title;
  // AppShell names each page; until it shows (the start, Welcome), the
  // document carries the app's title in the active language.
  useEffect(() => {
    if (view !== "shell") document.title = appTitle;
  }, [view, appTitle]);
  const next = startView(data);
  if (view === "pending" && next !== "pending") setView(next);
  const [initialModal, setInitialModal] = useState<ModalName>(null);
  const { setAppSettings } = data;

  const finishWelcome = (choice: WelcomeChoice) => {
    // Welcome saved both; the settings are read again to be sure.
    setAppSettings((settings) => ({
      ...settings,
      eulaAcceptedVersion: eulaVersion,
      onboardingCompletedAt: new Date().toISOString(),
    }));
    api<AppSettingsView>("/app-settings").then(
      (saved) => setAppSettings(saved.settings),
      () => {
        // The values set above stand.
      },
    );
    if (choice === "tour") navigateTo({ name: "demo" });
    else if (choice === "discover") navigateTo({ name: "discover" });
    else {
      navigateTo({ name: "home" });
      setInitialModal("import");
    }
    setView("shell");
  };

  const starting = <div className="app-starting" aria-busy="true" />;
  if (view === "pending") return starting;
  const sessionNotice = sessionEnded && (
    <SessionEndedNotice onDismiss={() => setSessionEnded(false)} />
  );
  if (view === "welcome")
    return (
      <main className="welcome-screen" id="main-content">
        {sessionNotice}
        <div className="welcome-screen-logo">
          <Logo variant="wordmark" size={34} title="" />
        </div>
        {/* A chunk that fails to load stops here; the logo and notice stay. */}
        <ErrorBoundary>
          <Suspense fallback={starting}>
            <Welcome
              onFinish={finishWelcome}
              settings={data.appSettings}
              doctor={doctor}
              status={data.status}
              maskUser={presentation.maskUser}
              maskPath={presentation.maskPath}
            />
          </Suspense>
        </ErrorBoundary>
      </main>
    );
  return (
    <AppShell
      data={data}
      doctor={doctor}
      onDoctorLive={setDoctorLive}
      initialModal={initialModal}
      sessionNotice={sessionNotice}
    />
  );
}

/**
 * Whether the sign-in session ended (BELL PR restarted, or the cookie
 * expired). The API client would reload into the sign-in page, which loses
 * what the person typed; the app cancels that and says how to sign in
 * again instead.
 */
function useSessionEnded() {
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    const handle = (event: CustomEvent<ApiErrorBody>) => {
      event.preventDefault();
      setEnded(true);
    };
    window.addEventListener(authRequiredEvent, handle);
    return () => window.removeEventListener(authRequiredEvent, handle);
  }, []);
  return [ended, setEnded] as const;
}

/**
 * cursor=1: a ring that follows the mouse, so a recording or a screen share
 * shows where the presenter points. It never takes a click.
 */
export function PresentationCursor() {
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const node = ring.current;
      if (!node) return;
      node.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
      node.classList.add("is-visible");
    };
    const press = () => ring.current?.classList.add("is-pressed");
    const release = () => ring.current?.classList.remove("is-pressed");
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", press);
    window.addEventListener("pointerup", release);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
    };
  }, []);
  return <div ref={ring} className="presentation-cursor" aria-hidden="true" />;
}

/** The ended session: the command that prints a new sign-in link. */
export function SessionEndedNotice({ onDismiss }: { onDismiss: () => void }) {
  const t = useT("app");
  return (
    <div role="alert" className="session-banner">
      <div className="session-banner-text">
        <strong>{t.sessionEnded.title}</strong>
        <span>{t.sessionEnded.text}</span>
        <CopyCommand command={t.sessionEnded.command} />
      </div>
      <button
        type="button"
        className="icon-button"
        onClick={onDismiss}
        aria-label={t.dismissNotice}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

// The address (src/navigation/route.ts) is the source of the page, the open
// run, its tab and its file. Home is the start view; #/demo shows the
// sample workspace and #/about opens the About dialog over Home.

/** The page a route shows; a repository that is not listed shows the list. */
function pageFor(route: Route | null, knownRepo: boolean): Page {
  switch (route?.name) {
    case "run":
    case "demo":
      return "workspace";
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
      return "home";
  }
}

/** The route of each page that takes no parameters. */
const pageRoutes = {
  home: "home",
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
  if (route?.name === "demo") return demoRunId;
  return undefined;
}

/**
 * Whether a run id from the address can name a run: ids are plain names
 * (UUIDs, `demo-run`), so one that a URL path would have to escape, or a
 * dot segment, is never sent to the API.
 */
function isRunId(id: string) {
  return id === encodeURIComponent(id) && !/^\.+$/.test(id);
}

/** What the workspace shows of a run: its tab and, when chosen, its file. */
interface WorkspaceView {
  runId: string;
  tab: Tab;
  file?: string;
}

function AppShell({
  data,
  doctor,
  onDoctorLive,
  initialModal = null,
  sessionNotice,
}: {
  data: AppData;
  doctor: DoctorState;
  /** Told whether a view that helps fix the environment shows (see AppRoot). */
  onDoctorLive?: (live: boolean) => void;
  /** A dialog to open at once, such as the import the welcome flow chose. */
  initialModal?: ModalName;
  /** Shown above the page while the sign-in session has ended. */
  sessionNotice?: ReactNode;
}) {
  const t = useT("app");
  const workspaceMessages = useT("workspace");
  const repoMessages = useT("repos");
  const runMessages = useT("modals").runs;
  const [locale] = useLocale();
  // The sample project in the UI language; its ids are the same in every locale.
  const sample = getDemo(locale);
  const route = useHashRoute();
  const presentation = usePresentation();
  const {
    repos,
    setRepos,
    runs,
    setRuns,
    status,
    setStatus,
    appSettings,
    setAppSettings,
    loaded,
    apiError,
    setApiError,
  } = data;
  // The app stays unusable until this build's license agreement is accepted.
  const blocked = needsEulaPrompt(appSettings, loaded.appSettings);
  // Until the status answers (its environment probes take a moment), the
  // plan comes from /api/license, so the plan chip and PRO marks show at once.
  const entitlements = useEntitlements(status ?? statusPending);
  const discoveryLocked = entitlements.locked("discovery");
  const [lastRunId, setLastRunId] = useState(readLastRun);
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
  const [modal, setModal] = useState<ModalName>(initialModal);
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
    alwaysDiscloseAi: appSettings?.alwaysDiscloseAi,
  });
  const { draftMutationEpoch } = draft;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || blocked) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggleCommandPalette();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleCommandPalette, blocked]);

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
      if (event.defaultPrevented || event.isComposing || modal || commandOpen || blocked) return;
      // #/about shows its dialog without setting `modal`; it is open all the same.
      if (currentRoute()?.name === "about") return;
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
  }, [modal, commandOpen, blocked]);
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
    if (!isRunId(addressRunId)) {
      showInstead(sample.run.id);
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

  // Home's environment summary, the new-task dialog and the environment
  // settings follow the environment while the person fixes it; elsewhere
  // the report stays.
  const doctorLive =
    (page === "home" && !presentation.present) ||
    modal === "task" ||
    (route?.name === "settings" && route.section === "environment");
  useEffect(() => onDoctorLive?.(doctorLive), [doctorLive, onDoctorLive]);

  // The workbench remembers the run it showed last, for Home and the next visit.
  useEffect(() => {
    if (page !== "workspace" || addressRunId !== run.id) return;
    rememberLastRun(run.id);
    setLastRunId(run.id);
  }, [page, addressRunId, run.id]);

  /**
   * The Workbench item: the run open now, or the run shown last when the
   * workbench still holds the sample it starts with (after a reload).
   */
  function openWorkbench() {
    const last = readLastRun();
    if (
      demo &&
      last &&
      last !== run.id &&
      runs.some((item) => item.id === last)
    ) {
      navigationIntent.current++;
      showWorkspace({ runId: last, tab: "overview" });
      setSidebarOpen(false);
    } else navigate("workspace");
  }

  // The tab title names the page and, on a run or a project, its repository.
  const titleRepo =
    page === "workspace" ? currentRepo : page === "explore" ? exploreRepo : undefined;
  const documentTitle = titleFor(
    route,
    { app: t, workspace: workspaceMessages },
    titleRepo ? { repoName: titleRepo.fullName } : {},
  );
  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  // The sample run is listed while it is all there is, while the workbench
  // shows it, after the person imported it, or when the settings ask for it.
  const [sampleImported, setSampleImported] = useState(false);
  const showSample =
    runs.length === 0 ||
    appSettings?.showSampleProject === true ||
    sampleImported ||
    (page === "workspace" && demo);

  // The open run's project, for a deletion that ends while it is open.
  const runRepoId = useRef(run.repoId);
  runRepoId.current = run.repoId;
  /** Shows the sample in place of an open run that is gone. */
  const dropOpenRun = () => {
    setRun(loadDemo(locale));
    setFiles(sample.files);
  };

  /** Frees a finished run's working files; the run and its notes stay. */
  async function freeRunSpace(id: string) {
    const { run: updated } = await api<{ run: Run }>(
      `/runs/${encodeURIComponent(id)}/workspace`,
      send("DELETE"),
    );
    setRuns((list) =>
      list.map((item) => (item.id === id ? summarizeRun(updated) : item)),
    );
    if (runIdRef.current === id) {
      setRun(updated);
      setFiles([]);
    }
    notify(runMessages.freed);
  }

  async function deleteRun(id: string) {
    await api(`/runs/${encodeURIComponent(id)}`, send("DELETE"));
    setRuns((list) => list.filter((item) => item.id !== id));
    if (runIdRef.current === id) dropOpenRun();
    notify(runMessages.deleted);
  }

  /** Deletes a project with its runs (and BELL's own clone of it). */
  async function deleteRepository(repo: Repo) {
    await api(`/repos/${encodeURIComponent(repo.id)}`, send("DELETE"));
    setRepos((list) => list.filter((item) => item.id !== repo.id));
    setRuns((list) => list.filter((item) => item.repoId !== repo.id));
    if (runRepoId.current === repo.id && runIdRef.current !== sample.run.id)
      dropOpenRun();
    notify(repoMessages.list.deleted({ name: repo.fullName }));
  }

  // Presenting the sample (or its playback): a badge says it is sample data.
  const showingSample =
    presentation.play ||
    (page === "workspace" && demo) ||
    (page === "explore" && exploreRepo === sample.repo);

  /** The sample's import played in the browser: list it and open it. */
  function openImportedSample(repo: Repo) {
    closeModal();
    setSource("");
    setSampleImported(true);
    setExploreRepoId(repo.id);
    navigate("explore");
    notify(repoMessages.import.sampleImported({ name: repo.fullName }));
  }

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

  // About opens from the app as a dialog over the page, and from #/about
  // over Home; closing the latter leaves the address on Home.
  const aboutOpen = modal === "about" || route?.name === "about";
  const closeAbout = useCallback(() => {
    if (currentRoute()?.name === "about")
      navigateTo({ name: "home" }, { replace: true });
    closeModal();
  }, [closeModal]);
  const dataDir = doctor.report?.checks.find((check) => check.id === "data-dir")
    ?.params?.path;

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
      inert={blocked}
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
        license={entitlements.summary}
        discoveryLocked={discoveryLocked}
        showSample={showSample}
        presenting={presentation.present}
        maskUser={presentation.maskUser}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        navigate={navigate}
        openWorkbench={openWorkbench}
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
          report={doctor.report}
          presenting={presentation.present}
          repoUrl={titleRepo && titleRepo !== sample.repo ? titleRepo.url : undefined}
          githubUser={status?.githubUser ?? ""}
        />
        {sessionNotice}
        {apiError && !sessionNotice && (
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
        {page === "home" ? (
          <HomePage
            runs={runs}
            repos={repos}
            doctor={doctor}
            license={entitlements.summary}
            discoveryLocked={discoveryLocked}
            presenting={presentation.present}
            maskUser={presentation.maskUser}
            maskPath={presentation.maskPath}
            lastRunId={lastRunId}
            openSample={() => navigateTo({ name: "demo" })}
            openImport={() => openModal("import")}
            openDiscovery={() => navigate("discovery")}
            chooseRun={chooseRun}
          />
        ) : page === "workspace" ? (
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
            discoveryLocked={discoveryLocked}
            maskPath={presentation.maskPath}
            deleteRepository={deleteRepository}
          />
        ) : page === "team" ? (
          <TeamPage beginContribution={beginContribution} />
        ) : page === "learning" ? (
          <ErrorBoundary>
          <Suspense fallback={null}>
            <LearningPage
              repos={repos}
              chooseRun={chooseRun}
              setSelectedPath={setSelectedPath}
              setTab={setTab}
            />
          </Suspense>
          </ErrorBoundary>
        ) : (
          // A chunk that fails to load stops at this page, so the shell
          // and what the person typed elsewhere stay.
          <ErrorBoundary>
          <Suspense fallback={null}>
            <SettingsPage
              status={status}
              setStatus={setStatus}
              setApiError={setApiError}
              setTab={setTab}
              navigate={navigate}
              doctor={doctor}
              onAppSettingsSaved={(view) => setAppSettings(view.settings)}
            />
          </Suspense>
          </ErrorBoundary>
        )}
      </main>
      {commandOpen && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <CommandPalette
              repos={[...repos, sample.repo]}
              runs={[...runs, { ...sample.run, status: demo ? run.status : sample.run.status }]}
              currentRepoId={insightRepo?.id}
              currentRunId={run.id}
              onClose={closeCommandPalette}
              onSelectRun={openPaletteRun}
              onSelectRepo={openPaletteRepo}
              onOpenSample={() => navigateTo({ name: "demo" })}
              onOpenSettings={() => navigate("settings")}
              onOpenAbout={() => openModal("about")}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      <Toasts toast={toast} setToast={setToast} />
      {modal === "import" && (
        <ImportRepoModal
          source={source}
          setSource={setSource}
          busy={busy}
          formError={formError}
          importRepo={importRepo}
          closeModal={closeModal}
          playDemo={presentation.play}
          speed={presentation.speed}
          onSampleImported={openImportedSample}
        />
      )}
      {modal === "models" && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <ModelSettingsModal
              setup={setup}
              busy={busy}
              formError={formError}
              setFormError={setFormError}
              closeModal={closeModal}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {modal === "task" && (
        <ErrorBoundary>
          <Suspense fallback={null}>
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
              doctor={doctor}
              maskUser={presentation.maskUser}
            />
          </Suspense>
        </ErrorBoundary>
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
          freeRunSpace={freeRunSpace}
          deleteRun={deleteRun}
        />
      )}
      {modal === "help" && (
        <HelpModal closeModal={closeModal} openAbout={() => openModal("about")} />
      )}
      {aboutOpen && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <AboutDialog
              onClose={closeAbout}
              license={entitlements.summary}
              dataDir={typeof dataDir === "string" ? dataDir : undefined}
              presenting={presentation.present}
              maskUser={presentation.maskUser}
              maskPath={presentation.maskPath}
              serverVersion={status?.version}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {/* Mounted once: every 402 and locked control opens it. */}
      <UpgradeDialog summary={entitlements.summary} demo={presentation.play} />
      {presentation.present && showingSample && (
        <p className="presentation-sample-badge">{t.presentation.sampleBadge}</p>
      )}
      {presentation.cursor && <PresentationCursor />}
      {/* Outside the inert shell in the page, so it alone stays usable. */}
      {blocked &&
        createPortal(
          <ErrorBoundary>
            <Suspense fallback={null}>
              <EulaPrompt onAccepted={(saved) => setAppSettings(saved.settings)} />
            </Suspense>
          </ErrorBoundary>,
          document.body,
        )}
    </div>
  );
}
