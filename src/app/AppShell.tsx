import {
  useCallback,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type CSSProperties,
} from "react";
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleHelp,
  Code2,
  Columns2,
  Copy,
  ExternalLink,
  FileText,
  FolderGit2,
  GitBranch,
  Github,
  GitPullRequest,
  LayoutDashboard,
  ListTree,
  Loader2,
  Menu,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Target,
  Globe2,
  Minus,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Workflow,
  X,
} from "lucide-react";
import { api } from "../api";
import { demoRepo, demoRun, demoFiles } from "../demo";
import type { Run, DiffFile } from "../types";
import { groupPrFeedback, summarizeChecks } from "../../shared/pr-feedback";
import { applyReviewOrder, parseReviewOrder } from "../../shared/review-order";
import { DiffView } from "../review/DiffView";
import { LearningNotes } from "../learning/LearningNotes";
import { languageBadge } from "../review/diff";
import { CommandPalette } from "../navigation/CommandPalette";
const ExplanationPanel = lazy(() =>
  import("../review/ExplanationPanel").then((module) => ({
    default: module.ExplanationPanel,
  })),
);

const DraftGuidancePanel = lazy(() =>
  import("../draft/DraftGuidancePanel").then((module) => ({
    default: module.DraftGuidancePanel,
  })),
);
const MarkdownContent = lazy(() =>
  import("../review/MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);
const DiscoveryPanel = lazy(() => import("../discovery/DiscoveryPanel"));

import {
  ProjectOverview,
  demoContributionBrief,
} from "../mission";
import { useProjectInsights } from "../mission/useProjectInsights";
import { TeamBoard } from "../team/TeamBoard";
import { Modal } from "../modals/Modal";
import { HelpModal } from "../modals/HelpModal";
import { NewTaskModal } from "../modals/NewTaskModal";
import { RunsModal } from "../modals/RunsModal";
import { ImportRepoModal } from "../repos/ImportRepoModal";
import { ModelSettingsModal } from "../settings/ModelSettingsModal";
import { fileStatusLabel, statusLabels } from "./labels";
import { useAppData, type Status } from "./hooks/useAppData";
import { useDraftEditor } from "./hooks/useDraftEditor";
import { useExplanations } from "./hooks/useExplanations";
import { loadDemo, useRunActions } from "./hooks/useRunActions";
import { useRunPolling } from "./hooks/useRunPolling";
import { useTaskSetup } from "./hooks/useTaskSetup";
import {
  type ContributionBrief,
} from "../../shared/insights";

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
  const reviewGridRef = useRef<HTMLDivElement>(null);
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
  const file = files.find((f) => f.path === selectedPath) || files[0];
  const additions = files.reduce((sum, f) => sum + f.additions, 0);
  const deletions = files.reduce((sum, f) => sum + f.deletions, 0);
  const reviewedCount = files.filter((f) =>
    run.reviewedFiles.includes(f.path),
  ).length;
  const allReviewed = files.length > 0 && reviewedCount === files.length;
  const active = ["running", "queued", "awaiting_plan"].includes(run.status);
  const activeLogFilter = run.agents.some((agent) => agent.id === logFilter)
    ? logFilter
    : "all";
  const visibleLogs =
    activeLogFilter === "all"
      ? run.logs
      : run.logs.filter((log) => log.agent === activeLogFilter);
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
  const {
    draftTitle,
    setDraftTitle,
    draftBody,
    setDraftBody,
    draftCommitMessage,
    setDraftCommitMessage,
    draftPublishBranch,
    setDraftPublishBranch,
    acknowledged,
    setAcknowledged,
    draftChecks,
    draftPreview,
    setDraftPreview,
    draftMutationEpoch,
    draftRequests,
    draftDirty,
    draftUnfinished,
    draftTaskGroups,
    draftIsProposal,
    publishBranchError,
    publishBranchInvalid,
    publishBlocked,
    publishConfirmations,
    commitMessageSuggestion,
    prepareDraft,
    applyDraftProposal,
    applyCommitMessageSuggestion,
    saveDraft,
  } = draft;

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
  function contributionBrief(value: Run): ContributionBrief | undefined {
    const settings = value.contributionSettings;
    if (!settings) return;
    return {
      problem: value.prompt,
      motivation:
        settings.outcome || "這次貢獻的價值仍需由任務需求與驗收結果確認。",
      beneficiaries: settings.targetUser ? [settings.targetUser] : [],
      before: "目前存在任務描述中的問題，實際影響範圍由團隊在規劃時確認。",
      after: settings.outcome || "依任務需求改善現有行為，尚未驗證是否達成。",
      validation: settings.acceptance.split("\n").filter(Boolean),
      risks: settings.constraints
        ? [settings.constraints]
        : ["在送出前確認相容性、回歸測試與使用者行為。"],
    };
  }
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
  const {
    feedbackLoading,
    messages,
    chatRequests,
    setChatRequests,
    chatLoading,
    rerunRequests,
    approveTeamPlan,
    reviseTeamPlan,
    retryTeam,
    sendTeamMessage,
    chooseRun,
    refreshRun,
    copyWorktreePath,
    rerunReview,
    importRepo,
    startTask,
    reviewFile,
    saveNote,
    ask,
    approve,
    publish,
    fetchPrFeedback,
    cancel,
  } = actions;

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
                  <ProjectOverview
                    repo={currentRepo}
                    run={run}
                    insights={intelligence.insights}
                    brief={demo ? demoContributionBrief : contributionBrief(run)}
                    loading={intelligence.loading}
                    error={intelligence.error}
                    recommending={intelligence.recommending}
                    recommendationError={intelligence.recommendationError}
                    recommendationPreferences={intelligence.recommendationPreferences}
                    savingPreferences={intelligence.savingPreferences}
                    preferenceError={intelligence.preferenceError}
                    onSavePreferences={intelligence.savePreferences}
                    stale={intelligence.stale}
                    staleDetail={intelligence.staleDetail}
                    onAnalyze={intelligence.analyze}
                    onRecommendMore={intelligence.recommendMore}
                    onChooseRecommendation={chooseRecommendation}
                    onReadCode={() => setTab("changes")}
                  />
                )}
                {tab === "changes" && (
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
                )}
                {tab === "activity" && (
                  <TeamBoard
                    key={run.id}
                    run={run}
                    demo={demo}
                    onApprove={approveTeamPlan}
                    onRevise={reviseTeamPlan}
                    onMessage={sendTeamMessage}
                    onRetry={retryTeam}
                    busy={busy}
                  />
                )}
                {tab === "activity" && (
                  <div className="activity-layout">
                    <div className="activity-main">
                      <div className="section-heading">
                        {run.team ? (
                          <div>
                            <h2>執行過程</h2>
                            <p>任務板在上方；完整紀錄、錯誤訊息與停止操作保留在這裡。</p>
                          </div>
                        ) : (
                          <div>
                            <h2>你的 Agent team</h2>
                            <p>每個角色各司其職，所有過程都在這裡。</p>
                          </div>
                        )}
                        {(active || reviewRerunning) && (
                          <button className="button secondary" onClick={cancel}>
                            <Square size={14} />
                            {reviewRerunning ? "停止重新審查" : "停止任務"}
                          </button>
                        )}
                      </div>
                      {!run.team && (
                        <div className="agent-grid">
                          {run.agents.map((agent, index) => (
                            <div
                              className={`agent-card ${agent.status}`}
                              key={agent.id}
                            >
                              <div className={`agent-avatar color-${index}`}>
                                <Bot size={22} />
                              </div>
                              <div>
                                <strong>{agent.name}</strong>
                                <span>{agent.role}</span>
                              </div>
                              <span className="agent-state">
                                {agent.status === "complete" ? (
                                  <CircleCheck size={17} />
                                ) : agent.status === "running" ? (
                                  <Loader2 className="spin" size={17} />
                                ) : (
                                  <Circle size={17} />
                                )}
                              </span>
                              <p>{agent.detail}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="activity-log-heading">
                        <h3>執行紀錄</h3>
                        <span>
                          {demo
                            ? "示範紀錄"
                            : active
                              ? "每 2.5 秒更新"
                              : "任務紀錄"}
                        </span>
                      </div>
                      {run.agents.length > 0 && run.logs.length > 0 && (
                        <div
                          className="log-filters"
                          role="group"
                          aria-label="依角色篩選執行紀錄"
                        >
                          {[
                            { id: "all", label: "全部" },
                            ...run.agents.map((agent) => ({
                              id: agent.id,
                              label: agent.id,
                            })),
                          ].map((chip) => (
                            <button
                              key={chip.id}
                              className={`log-filter-chip ${activeLogFilter === chip.id ? "is-on" : ""}`}
                              aria-pressed={activeLogFilter === chip.id}
                              onClick={() => setLogFilter(chip.id)}
                            >
                              {chip.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="activity-log">
                        {visibleLogs.map((log, index) => (
                          <div
                            className={`log-line ${log.kind ? `log-${log.kind}` : ""}`}
                            key={index}
                          >
                            <span className="log-time">
                              {new Date(log.time).toLocaleTimeString("zh-TW", {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })}
                            </span>
                            <span className="log-agent">{log.agent}</span>
                            {log.kind === "command" ? (
                              // The command the CLI reported, with its exit code; no output was captured.
                              <p>
                                <code className="log-command">{log.message}</code>
                                {log.detail && (
                                  <span className="log-detail">{log.detail}</span>
                                )}
                              </p>
                            ) : (
                              <p>{log.message}</p>
                            )}
                          </div>
                        ))}
                        {!run.logs.length && (
                          <p className="muted">任務開始後會在此顯示紀錄。</p>
                        )}
                        {run.logs.length > 0 && !visibleLogs.length && (
                          <p className="muted">這個角色目前沒有紀錄。</p>
                        )}
                      </div>
                      {run.error && <p className="inline-error">{run.error}</p>}
                    </div>
                    <aside className="task-brief">
                      <span className="eyebrow">MISSION BRIEF</span>
                      <h3>這次的貢獻目標</h3>
                      <p>{run.prompt}</p>
                      <div className="brief-meta">
                        <GitBranch size={16} />
                        <span>{run.branch}</span>
                      </div>
                      <div className="callout">
                        <ShieldCheck size={18} />
                        <p>
                          開發在獨立的 Git worktree
                          中執行。審查完成後，由你決定何時送出。
                        </p>
                      </div>
                    </aside>
                  </div>
                )}
                {tab === "draft" && (
                  <div className="draft-workspace">
                    <Suspense
                      fallback={<p className="muted">正在載入草稿規範…</p>}
                    >
                      <DraftGuidancePanel
                        preparation={run.draftPreparation}
                        busy={draftRequests.has(run.id)}
                        disabled={
                          active ||
                          busy ||
                          !["review", "approved"].includes(run.status)
                        }
                        demo={demo}
                        issueUrl={run.contributionSettings?.issueUrl}
                        onGenerate={prepareDraft}
                        onApply={applyDraftProposal}
                        applied={
                          !!run.draftPreparation?.proposal &&
                          draftTitle === run.draftPreparation.proposal.title &&
                          !!draftChecks?.sameDraftProse(
                            draftBody,
                            run.draftPreparation.proposal.body,
                          )
                        }
                      />
                    </Suspense>
                    <div className="draft-layout">
                      <div className="draft-editor">
                        <div className="section-heading">
                          <div>
                            <h2>讓好的改動，也有好的說明。</h2>
                            <p>調整草稿，讓維護者輕鬆理解你的貢獻。</p>
                          </div>
                          <span className="draft-label">DRAFT PR</span>
                        </div>
                        {!demo && run.status !== "published" && draftIsProposal && (
                          <div className="draft-origin-notice" role="status">
                            <AlertCircle size={16} />
                            <p>
                              下方說明是 BELL
                              依專案規範產生的建議原文，你還沒有修改。這段文字會原樣送到
                              GitHub：送出前請用自己的話確認內容，待辦事項留在上方的核對清單，不要寫進說明。
                            </p>
                          </div>
                        )}
                        {!demo &&
                          run.status !== "published" &&
                          !draftBody.trim() &&
                          !preparingDraft && (
                            <div className="draft-origin-notice" role="status">
                              <AlertCircle size={16} />
                              <p>
                                還沒有 PR
                                說明。可以在上方產生並套用建議草稿，或用自己的話寫下改了什麼、為什麼，以及實際執行過哪些檢查。Agent
                                的完整報告在「審查者怎麼看」。
                              </p>
                            </div>
                          )}
                        <label className="field-label" htmlFor="pr-title">
                          Pull Request 標題
                        </label>
                        <input
                          id="pr-title"
                          className="text-input draft-title"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          disabled={run.status === "published"}
                        />
                        <div className="editor-toolbar">
                          <div>
                            <button
                              className={!draftPreview ? "selected" : ""}
                              onClick={() => setDraftPreview(false)}
                            >
                              編輯
                            </button>
                            <button
                              className={draftPreview ? "selected" : ""}
                              onClick={() => setDraftPreview(true)}
                            >
                              預覽
                            </button>
                          </div>
                          <span>Markdown</span>
                        </div>
                        {draftPreview ? (
                          <div className="markdown-preview">
                            <Suspense fallback={<p>正在載入預覽…</p>}>
                              <MarkdownContent>{draftBody}</MarkdownContent>
                            </Suspense>
                          </div>
                        ) : (
                          <textarea
                            className="draft-textarea"
                            aria-label="PR 說明"
                            value={draftBody}
                            onChange={(e) => setDraftBody(e.target.value)}
                            disabled={run.status === "published"}
                          />
                        )}
                        <label
                          className="field-label"
                          htmlFor="pr-commit-message"
                        >
                          提交訊息 <span>git commit</span>
                        </label>
                        <textarea
                          id="pr-commit-message"
                          className="draft-textarea draft-commit-message"
                          aria-describedby="pr-commit-message-help"
                          value={draftCommitMessage || draftTitle}
                          onChange={(e) =>
                            setDraftCommitMessage(e.target.value)
                          }
                          disabled={run.status === "published"}
                        />
                        <p id="pr-commit-message-help" className="field-help">
                          第一行是主旨，空一行後寫說明，最後放
                          trailers。留空時以 PR
                          標題作為單行提交訊息。Signed-off-by
                          等簽署由你本人輸入，BELL 與模型不會代填。
                        </p>
                        <label
                          className="field-label"
                          htmlFor="pr-publish-branch"
                        >
                          GitHub 分支 <span>git push</span>
                        </label>
                        <input
                          id="pr-publish-branch"
                          className="text-input"
                          value={draftPublishBranch}
                          placeholder={run.branch}
                          spellCheck={false}
                          aria-describedby="pr-publish-branch-help"
                          aria-invalid={publishBranchInvalid}
                          onChange={(e) => setDraftPublishBranch(e.target.value)}
                          disabled={
                            run.status === "published" || !!run.publishedBranch
                          }
                        />
                        <p id="pr-publish-branch-help" className="field-help">
                          推送到 GitHub 時使用的分支名稱，留空時使用{" "}
                          <code>{run.branch}</code>
                          。有些專案規定分支命名，例如不能有斜線或 feat/
                          前綴，請依核對清單調整。本機工作分支不會改名。
                          {run.publishedBranch &&
                            " 已推送到 GitHub 後不能再改分支，以免重複建立 PR。"}
                        </p>
                        {publishBranchInvalid && (
                          <p role="alert" className="inline-error">
                            {publishBranchError}
                          </p>
                        )}
                        {commitMessageSuggestion && (
                          <div className="commit-suggestion">
                            <div>
                              <strong>依專案規範建議的提交訊息</strong>
                              <p>{commitMessageSuggestion.rationale}</p>
                            </div>
                            <pre>{commitMessageSuggestion.message}</pre>
                            <div className="commit-suggestion-actions">
                              <span>只會填入欄位，簽署仍由你補上。</span>
                              <button
                                type="button"
                                className="button secondary"
                                disabled={run.status === "published"}
                                onClick={applyCommitMessageSuggestion}
                              >
                                採用建議
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="draft-save-row">
                          <span>
                            {demo
                              ? "示範草稿儲存在此瀏覽器"
                              : "草稿儲存在本機工作空間"}
                          </span>
                          <button
                            className="button primary"
                            disabled={
                              busy || !draftDirty || run.status === "published"
                            }
                            onClick={saveDraft}
                          >
                            {busy ? (
                              <Loader2 className="spin" size={15} />
                            ) : (
                              <Check size={15} />
                            )}
                            儲存草稿
                          </button>
                        </div>
                      </div>
                      <aside className="publish-checklist">
                        <div className="checklist-icon">
                          <GitPullRequest size={24} />
                        </div>
                        <h3>送出前，最後看一眼。</h3>
                        <p>一份清楚的 PR，是一次好合作的開始。</p>
                        <div
                          className={
                            allReviewed
                              ? "checklist-item checked"
                              : "checklist-item"
                          }
                        >
                          {allReviewed ? (
                            <CircleCheck size={18} />
                          ) : (
                            <Circle size={18} />
                          )}
                          <span>
                            已審閱所有檔案
                            <small>
                              {reviewedCount} / {files.length} 個檔案
                            </small>
                          </span>
                        </div>
                        <div
                          className={
                            !draftDirty
                              ? "checklist-item checked"
                              : "checklist-item"
                          }
                        >
                          {!draftDirty ? (
                            <CircleCheck size={18} />
                          ) : (
                            <Circle size={18} />
                          )}
                          <span>
                            PR 草稿已儲存
                            <small>
                              {draftDirty
                                ? "有尚未儲存的編輯"
                                : "可隨時返回調整內容"}
                            </small>
                          </span>
                        </div>
                        <div
                          className={
                            draftBody.trim() && !draftUnfinished
                              ? "checklist-item checked"
                              : "checklist-item"
                          }
                        >
                          {draftBody.trim() && !draftUnfinished ? (
                            <CircleCheck size={18} />
                          ) : (
                            <Circle size={18} />
                          )}
                          <span>
                            說明沒有待填寫的內容
                            <small>
                              {!draftBody.trim()
                                ? "還沒有說明"
                                : draftUnfinished
                                  ? draftUnfinished.details.join("\n")
                                  : "TODO 與待填空格不會送到 GitHub"}
                            </small>
                          </span>
                        </div>
                        {draftTaskGroups.length > 0 && (
                          <fieldset
                            className="draft-task-items"
                            disabled={run.status === "published" || busy}
                          >
                            <legend>說明中的勾選項目</legend>
                            <p>
                              只勾你真正完成或確認的項目。BELL
                              和模型不會替你勾；勾選會直接改寫左側說明，記得儲存。
                            </p>
                            {draftTaskGroups.map(([heading, items]) => (
                              <div key={`${heading}:${items[0].line}`}>
                                <strong>{heading || "未分段"}</strong>
                                {items.map((item) => (
                                  <label key={item.line}>
                                    <input
                                      type="checkbox"
                                      checked={item.checked}
                                      onChange={(event) => {
                                        const checked = event.target.checked;
                                        setDraftBody((body) =>
                                          draftChecks
                                            ? draftChecks.setDraftTaskItem(
                                                body,
                                                item.line,
                                                checked,
                                              )
                                            : body,
                                        );
                                      }}
                                    />
                                    <span>{item.text}</span>
                                  </label>
                                ))}
                              </div>
                            ))}
                          </fieldset>
                        )}
                        <div className="checklist-item">
                          <ShieldCheck size={18} />
                          <span>
                            以 Draft PR 送出
                            <small>
                              送出後仍可在 GitHub
                              繼續編輯；專案的自動檢查對 Draft PR 一樣會執行。
                            </small>
                          </span>
                        </div>
                      </aside>
                    </div>
                    {run.status === "published" && run.prUrl && (
                      <section
                        className="pr-feedback"
                        aria-labelledby="pr-feedback-title"
                      >
                        <div className="section-heading">
                          <div>
                            <h2 id="pr-feedback-title">維護者回饋</h2>
                            <p>
                              按下按鈕才會讀取 PR 上的 review、留言與 CI
                              結果；BELL 只讀不回，回覆請到 GitHub。
                            </p>
                          </div>
                          <div className="pr-feedback-actions">
                            <a
                              className="button secondary"
                              href={run.prUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Github size={15} />
                              查看 Pull Request
                              <ExternalLink size={13} />
                            </a>
                            <button
                              className="button primary"
                              disabled={feedbackLoading}
                              onClick={fetchPrFeedback}
                            >
                              {feedbackLoading ? (
                                <Loader2 className="spin" size={15} />
                              ) : (
                                <RefreshCw size={15} />
                              )}
                              {run.prFeedback ? "重新讀取回饋" : "讀取回饋"}
                            </button>
                          </div>
                        </div>
                        {run.prFeedback ? (
                          <>
                            <p className="pr-feedback-meta">
                              讀取時間{" "}
                              {new Date(run.prFeedback.fetchedAt).toLocaleString(
                                "zh-TW",
                              )}
                              {run.prFeedback.checks && (
                                <>
                                  {" · CI "}
                                  {(() => {
                                    const checks = summarizeChecks(
                                      run.prFeedback.checks,
                                    );
                                    return checks.total
                                      ? `${checks.total} 項檢查：${checks.success} 成功、${checks.pending} 進行中、${checks.failed} 失敗`
                                      : "尚無檢查";
                                  })()}
                                  {run.prFeedback.checksState &&
                                    `（整體 ${run.prFeedback.checksState}）`}
                                </>
                              )}
                              {!!run.prFeedback.labels?.length &&
                                ` · 標籤：${run.prFeedback.labels.join("、")}`}
                            </p>
                            {run.prFeedback.labels?.some((label) =>
                              label.startsWith("needs:"),
                            ) && (
                              <p className="pr-feedback-warning">
                                PR 被加上「needs:」開頭的標籤，通常代表專案的自動檢查認為還有項目沒完成；即使
                                CI 顯示成功也一樣。請看下方機器人的留言，並在 GitHub 上修改說明。
                              </p>
                            )}
                            {run.prFeedback.checks?.some(
                              (check) =>
                                !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(
                                  check.state.toUpperCase(),
                                ),
                            ) && (
                              <ul className="pr-feedback-checks">
                                {run.prFeedback.checks
                                  .filter(
                                    (check) =>
                                      !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(
                                        check.state.toUpperCase(),
                                      ),
                                  )
                                  .map((check) => (
                                    <li key={`${check.name}:${check.url ?? ""}`}>
                                      <span>{check.name}</span>
                                      <b>{check.state}</b>
                                      {check.url && (
                                        <a
                                          href={check.url}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          詳情
                                        </a>
                                      )}
                                    </li>
                                  ))}
                              </ul>
                            )}
                            {run.prFeedback.warnings?.map((warning) => (
                              <p className="pr-feedback-warning" key={warning}>
                                {warning}
                              </p>
                            ))}
                            {run.prFeedback.items.length === 0 && (
                              <p className="muted">
                                目前還沒有 review 或留言。維護者回應通常需要幾天到幾週；可以先準備回覆思路。
                              </p>
                            )}
                            {groupPrFeedback(run.prFeedback.items).map(
                              (group) => (
                                <div
                                  className="pr-feedback-group"
                                  key={group.path ?? "general"}
                                >
                                  <div className="pr-feedback-group-head">
                                    <strong>
                                      {group.path ?? "整體 review 與對話"}
                                    </strong>
                                    {group.path &&
                                      files.some(
                                        (f) => f.path === group.path,
                                      ) && (
                                        <button
                                          className="button secondary"
                                          onClick={() => {
                                            setSelectedPath(group.path!);
                                            setTab("changes");
                                          }}
                                        >
                                          在程式碼變更開啟
                                        </button>
                                      )}
                                  </div>
                                  <ul>
                                    {group.items.map((item) => (
                                      <li key={item.url}>
                                        <div className="pr-feedback-item-head">
                                          <strong>{item.author}</strong>
                                          <span>{item.authorAssociation}</span>
                                          {item.state && <span>{item.state}</span>}
                                          {typeof item.line === "number" && (
                                            <span>第 {item.line} 行</span>
                                          )}
                                          {item.isResolved && <span>已解決</span>}
                                          <a
                                            href={item.url}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            在 GitHub 開啟
                                          </a>
                                        </div>
                                        <p>{item.body}</p>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ),
                            )}
                          </>
                        ) : (
                          <p className="muted">
                            尚未讀取。按「讀取回饋」會向 GitHub 查詢一次，不會自動更新。
                          </p>
                        )}
                      </section>
                    )}
                  </div>
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
                        (!demo && !!draftUnfinished) ||
                        !["review", "approved"].includes(run.status)
                      }
                      title={
                        !allReviewed
                          ? "請先逐一勾選所有檔案的「已審閱」"
                          : draftDirty
                            ? "請先儲存 PR 草稿"
                            : !demo && draftUnfinished
                              ? "PR 說明還有待填寫的內容，請先改成事實或刪除"
                              : "確認變更並預覽送出"
                      }
                      onClick={approve}
                    >
                      <Check size={16} />
                      確認並準備 PR
                      <ChevronRight size={15} />
                    </button>
                  )}
                </div>
              </footer>
            </section>
          </>
        ) : page === "explore" && exploreRepo ? (
          <section className="page-content explore-page">
            <div className="page-title">
              <div>
                <span className="eyebrow">REPOSITORY EXPLORER</span>
                <h1 tabIndex={-1}>{exploreRepo.fullName}</h1>
                <p>先了解使用者與問題，再決定這次貢獻的方向。</p>
              </div>
              <button
                className="button primary"
                onClick={() => beginContribution(exploreRepo.id)}
              >
                <Target size={16} />
                指定貢獻方向
              </button>
            </div>
            <ProjectOverview
              repo={exploreRepo}
              insights={intelligence.insights}
              loading={intelligence.loading}
              error={intelligence.error}
              recommending={intelligence.recommending}
              recommendationError={intelligence.recommendationError}
              recommendationPreferences={intelligence.recommendationPreferences}
              savingPreferences={intelligence.savingPreferences}
              preferenceError={intelligence.preferenceError}
              onSavePreferences={intelligence.savePreferences}
              stale={intelligence.stale}
              staleDetail={intelligence.staleDetail}
              onAnalyze={intelligence.analyze}
              onRecommendMore={intelligence.recommendMore}
              onChooseRecommendation={chooseRecommendation}
              onReadCode={() => setTab("changes")}
              onStartContribution={() => beginContribution(exploreRepo.id)}
            />
          </section>
        ) : page === "discovery" ? (
          <section className="page-content">
            <Suspense
              fallback={<div className="empty-state">正在載入貢獻探索…</div>}
            >
              <DiscoveryPanel onChoose={chooseOpportunity} />
            </Suspense>
          </section>
        ) : page === "repos" ? (
          <section className="page-content">
            <div className="page-title">
              <div>
                <span className="eyebrow">YOUR REPOSITORIES</span>
                <h1 tabIndex={-1}>下一個貢獻，從這裡開始。</h1>
                <p>帶入你在意的專案，讓想法成為真正的改動。</p>
              </div>
              <button
                className="button primary"
                onClick={() => openModal("import")}
              >
                <Plus size={16} />
                匯入 Repository
              </button>
            </div>
            <button
              className="discovery-entry"
              onClick={() => navigate("discovery")}
            >
              <span className="discovery-entry-icon">
                <Sparkles size={24} />
              </span>
              <span>
                <strong>還沒決定要貢獻哪個專案？</strong>
                <small>
                  讓 AI 從 GitHub 找出有需求、適合你起步的開發機會。
                </small>
              </span>
              <span className="discovery-entry-action">
                推薦貢獻項目 <ArrowUpRight size={17} />
              </span>
            </button>
            <div className="repository-grid">
              {[...repos, demoRepo].map((repo) => (
                <article className="repository-card" key={repo.id}>
                  <div className="repository-card-top">
                    <span className="repo-icon">
                      <FolderGit2 size={24} />
                    </span>
                    {repo.id === demoRepo.id ? (
                      <span className="demo-pill">示範專案</span>
                    ) : (
                      <span className="repo-ready">
                        <Check size={13} />
                        已匯入
                      </span>
                    )}
                  </div>
                  <span className="repo-owner">{repo.owner}</span>
                  <h2>{repo.name}</h2>
                  <p>
                    {repo.id === demoRepo.id
                      ? "透過 SDK 智慧重試的範例，體驗一次完整的貢獻與審查。"
                      : repo.path}
                  </p>
                  <div className="repository-meta">
                    <span>
                      <span className="language-dot" />
                      {repo.language || "Git repository"}
                    </span>
                    <span>
                      <GitBranch size={13} />
                      {repo.defaultBranch}
                    </span>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => {
                      if (repo.id === demoRepo.id) chooseRun(demoRun.id);
                      else {
                        setExploreRepoId(repo.id);
                        navigate("explore");
                      }
                    }}
                  >
                    {repo.id === demoRepo.id
                      ? "探索示範工作台"
                      : "了解專案與貢獻方向"}
                    <ArrowUpRight size={15} />
                  </button>
                </article>
              ))}
              <button
                className="repository-add"
                onClick={() => openModal("import")}
              >
                <Plus size={27} />
                <strong>加入你的 Repository</strong>
                <span>GitHub 連結或本機 Git 專案</span>
              </button>
            </div>
          </section>
        ) : page === "team" ? (
          <section className="page-content">
            <div className="page-title">
              <div>
                <span className="eyebrow">BUILT TO COLLABORATE</span>
                <h1 tabIndex={-1}>一個目標，一支 Agent team。</h1>
                <p>從拆解問題到交叉審查，讓專業分工融入你的開發流程。</p>
              </div>
              <button
                className="button primary"
                onClick={() => beginContribution()}
              >
                <Play size={15} />
                指派新任務
              </button>
            </div>
            <div className="team-pipeline">
              {[
                {
                  name: "Team lead",
                  role: "共享計畫與相依拆解",
                  text: "依貢獻方向建立任務板，明確指定檔案範圍與相依，讓你先確認計畫。",
                  scope: "規劃 · 指派 · 整合",
                  icon: ListTree,
                },
                {
                  name: "Teammates",
                  role: "獨立上下文與並行開發",
                  text: "每位成員有獨立工作目錄；先完成相依任務，互不衝突的工作可同時執行。",
                  scope: "2–4 位 · 共享任務板",
                  icon: Code2,
                },
                {
                  name: "Team inbox",
                  role: "成員之間能交換發現",
                  text: "傳送給 Lead、任務成員或全體；訊息在下一個工作回合送達，可追蹤送達狀態。",
                  scope: "共享訊息 · 保留記錄",
                  icon: MessageSquare,
                },
                {
                  name: "Review & tests",
                  role: "整合後的獨立審查",
                  text: "受檔案範圍約束的變更依序整合，再由獨立審查者與測試分析員檢查結果。",
                  scope: "品質檢查 · 人工送出",
                  icon: Activity,
                },
              ].map((agent, index) => (
                <article key={agent.name} className="team-role">
                  <span className="role-number">0{index + 1}</span>
                  <div className={`agent-avatar color-${index}`}>
                    <agent.icon size={26} />
                  </div>
                  <h2>{agent.name}</h2>
                  <strong>{agent.role}</strong>
                  <p>{agent.text}</p>
                  <span className="role-scope">{agent.scope}</span>
                </article>
              ))}
            </div>
            <div className="team-note">
              <ShieldCheck size={25} />
              <div>
                <strong>Agent 負責開發，你保有最後決定權。</strong>
                <p>
                  使用本機 Codex 或 Claude Code CLI
                  登入狀態。每個任務有獨立分支，完成後進入審查，不會自動建立
                  PR。
                </p>
              </div>
            </div>
          </section>
        ) : page === "learning" ? (
          <section className="page-content">
            <LearningNotes
              runs={runs}
              repos={repos}
              demoFiles={demoFiles}
              onOpen={(id, path) => {
                chooseRun(id).then((opened) => {
                  if (!opened) return;
                  setSelectedPath(path);
                  setTab("changes");
                });
              }}
            />
            <div className="team-note">
              <MessageSquare size={25} />
              <div>
                <strong>你的下一個問題，就是下一個進步。</strong>
                <p>
                  在工作台選取程式碼並提問。對話依檔案保留於目前工作階段，讓每個問題都有上下文。
                </p>
              </div>
            </div>
          </section>
        ) : (
          <section className="page-content settings-page">
            <div className="page-title">
              <div>
                <span className="eyebrow">CONNECTIONS</span>
                <h1 tabIndex={-1}>讓工作環境準備就緒。</h1>
                <p>沿用本機 CLI 的登入狀態，憑證不會儲存在瀏覽器。</p>
              </div>
              <button
                className="button secondary"
                onClick={() => {
                  api<Status>("/status")
                    .then((s) => {
                      setStatus(s);
                      setApiError("");
                      notify("連線狀態已更新");
                    })
                    .catch((e) => notify(e.message, "error"));
                }}
              >
                重新檢查連線
              </button>
            </div>
            <div className="settings-card">
              <div className="settings-service">
                <div className="service-icon">
                  <Bot size={24} />
                </div>
                <div>
                  <h3>Codex CLI</h3>
                  <p>執行 agent team、程式碼解說與追問</p>
                </div>
                <span
                  className={`service-status ${status?.codex && status?.codexAuthenticated ? "connected" : ""}`}
                >
                  {status?.codex && status?.codexAuthenticated
                    ? "已就緒"
                    : status?.codex
                      ? "尚未登入"
                      : "尚未安裝"}
                </span>
              </div>
              <div className="setup-command">
                <span>在終端機完成登入</span>
                <code>codex login</code>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-service">
                <div className="service-icon">
                  <Bot size={24} />
                </div>
                <div>
                  <h3>Claude Code CLI</h3>
                  <p>可在模型設定改用 Claude，沿用你的 Claude 訂閱登入</p>
                </div>
                <span
                  className={`service-status ${status?.claude && status?.claudeAuthenticated ? "connected" : ""}`}
                >
                  {status?.claude && status?.claudeAuthenticated
                    ? "已就緒"
                    : status?.claude
                      ? "尚未登入"
                      : "尚未安裝"}
                </span>
              </div>
              <div className="setup-command">
                <span>在終端機完成登入</span>
                <code>claude auth login</code>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-service">
                <div className="service-icon">
                  <Sparkles size={24} />
                </div>
                <div>
                  <h3>模型與思考強度</h3>
                  <p>所有專案共用一組設定，既有任務保留當次設定。</p>
                </div>
              </div>
              <div className="setup-command">
                <button
                  className="button secondary"
                  onClick={configureContributionModels}
                >
                  設定貢獻模型
                </button>
                <button
                  className="button ghost"
                  onClick={() => {
                    setTab("activity");
                    navigate("workspace");
                  }}
                >
                  查看目前任務模型
                </button>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-service">
                <div className="service-icon">
                  <Github size={24} />
                </div>
                <div>
                  <h3>GitHub CLI</h3>
                  <p>
                    {status?.githubUser
                      ? `以 ${status.githubUser} 連線`
                      : "匯入專案、推送分支與建立 Draft PR"}
                  </p>
                </div>
                <span
                  className={`service-status ${status?.github ? "connected" : ""}`}
                >
                  {status?.github ? "已連線" : "尚未登入"}
                </span>
              </div>
              <div className="setup-command">
                <span>在終端機完成授權</span>
                <code>gh auth login</code>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-service">
                <div className="service-icon">
                  <Terminal size={24} />
                </div>
                <div>
                  <h3>本機工作空間</h3>
                  <p>Repository 與任務資料保存在執行本服務的電腦</p>
                </div>
                <span className="service-status connected">Local-first</span>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-service">
                <div className="service-icon">
                  <Workflow size={24} />
                </div>
                <div>
                  <h3>同時進行的工作數</h3>
                  <p>多個專案（或同一專案）的工作可以同時執行並各自發佈 PR</p>
                </div>
              </div>
              <div className="setup-command">
                <span>同時執行的工作上限（BELLPR_MAX_ACTIVE_RUNS）</span>
                <code>{status?.limits?.maxActiveRuns ?? "—"}</code>
              </div>
              <div className="setup-command">
                <span>Agent CLI 行程上限（BELLPR_MAX_AGENT_PROCESSES）</span>
                <code>{status?.limits?.maxAgentProcesses ?? "—"}</code>
              </div>
              <div className="setup-command">
                <span>排隊上限（執行中、等待執行與等待確認計畫合計）</span>
                <code>{status?.limits?.maxQueued ?? "—"}</code>
              </div>
              <p className="muted">
                每個工作的 teammates、Reviewer 與 Test analyst 各需要一個 CLI
                行程，因此 BELLPR_MAX_AGENT_PROCESSES
                決定實際能同時進行多少；訂閱的使用額度才是真正的上限，BELL
                只重試 OAuth 更新的競爭，不重試額度錯誤。同一個 repository
                的多個工作彼此獨立，各自使用自己的 worktree
                與分支。修改這些值需編輯環境檔並重新啟動服務（systemd 部署為
                ~/.config/bell-pr/environment）。
              </p>
            </div>
          </section>
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
        <Modal
          title={demo ? "你的示範貢獻，準備好了。" : "將這次貢獻送上 GitHub。"}
          subtitle={
            demo
              ? "你已完成所有檔案的審查。以下是 PR 的送出預覽。"
              : "這會推送審查過的分支，並在目標 repository 建立 Draft PR。"
          }
          onClose={closeModal}
        >
          <div className="publish-summary">
            <span>
              <Github size={16} />
              {currentRepo?.fullName}
            </span>
            <h3>{run.draft.title}</h3>
            <div>
              <GitBranch size={14} />
              {run.draft.publishBranch || run.branch}
              <span>→</span>
              {run.baseBranch}
            </div>
            <p>
              <CircleCheck size={15} />
              {files.length} 個檔案已審閱{" "}
              <b>
                +{additions} −{deletions}
              </b>
            </p>
          </div>
          {demo && (
            <div className="callout">
              <BookOpen size={18} />
              <p>
                這是互動示範，按下完成不會建立 GitHub
                PR。匯入你自己的專案，就能開始真正的貢獻。
              </p>
            </div>
          )}
          {!demo && (
            <details className="publish-body-preview" open>
              <summary>
                會送到 GitHub 的 PR 說明
                {draftChecks &&
                  `（約 ${draftChecks.draftProseWords(run.draft.body)} 字）`}
              </summary>
              <div className="markdown-preview">
                <Suspense fallback={<p>正在載入預覽…</p>}>
                  <MarkdownContent>{run.draft.body}</MarkdownContent>
                </Suspense>
              </div>
            </details>
          )}
          {!demo && publishBlocked && (
            <p role="alert" className="inline-error">
              {[publishBlocked.message, ...publishBlocked.details].join("\n")}
            </p>
          )}
          {!demo && publishConfirmations.length > 0 && (
            <fieldset className="publish-confirmations">
              <legend>送出前請逐項確認</legend>
              {publishConfirmations.map((check) => (
                <label key={check.id}>
                  <input
                    type="checkbox"
                    checked={acknowledged.includes(check.id)}
                    onChange={(event) =>
                      setAcknowledged((previous) =>
                        event.target.checked
                          ? [...previous, check.id]
                          : previous.filter((id) => id !== check.id),
                      )
                    }
                  />
                  <span>
                    {check.message}
                    {check.details.map((detail) => (
                      <small key={detail}>{detail}</small>
                    ))}
                  </span>
                </label>
              ))}
              <p>
                勾選只代表你知道這些項目還沒處理、願意照目前的說明送出。BELL
                不會因此改動說明或替你勾選任何項目，這些確認也不會寫進
                PR。想先修改，請按「返回編輯草稿」。
              </p>
            </fieldset>
          )}
          {formError && (
            <p role="alert" className="inline-error">
              {formError}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => {
                closeModal();
                setTab("draft");
              }}
            >
              返回編輯草稿
            </button>
            <button
              className="button primary"
              disabled={
                busy ||
                (!demo &&
                  (!draftChecks ||
                    !!publishBlocked ||
                    publishConfirmations.some(
                      (check) => !acknowledged.includes(check.id),
                    )))
              }
              onClick={publish}
            >
              {busy ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <GitPullRequest size={16} />
              )}{" "}
              {demo ? "完成示範審查" : busy ? "正在送出…" : "送出 Draft PR"}
            </button>
          </div>
        </Modal>
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
