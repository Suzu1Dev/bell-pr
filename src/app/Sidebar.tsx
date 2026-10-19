import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  BookOpen,
  ChevronRight,
  CircleHelp,
  FolderGit2,
  House,
  Info,
  Languages,
  LayoutDashboard,
  Plus,
  Search,
  Settings2,
  UserRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { LicenseSummary } from "../../shared/plans";
import { Logo } from "../brand/Logo";
import { getDemo } from "../demo";
import { useLocale, useT } from "../i18n";
import { LanguageSwitcher } from "../i18n/LanguageSwitcher";
import { PracticeReadyChip } from "../learning/PracticeReadyChip";
import { usePracticeReady } from "../learning/practiceReady";
import { PlanChip } from "../license/PlanChip";
import { ProBadge } from "../license/ProBadge";
import type { Run, RunSummary } from "../types";
import type { ModalName, Page } from "./AppShell";
import type { Status } from "./hooks/useAppData";
import { initialsOf } from "./labels";
import { usePresentation } from "./presentation";
import "./sidebar.css";

interface SidebarProps {
  page: Page;
  /** The person's runs; the sample run is not one of them. */
  runs: RunSummary[];
  /** The open run, highlighted in the recent list. */
  run: Run;
  status: Status | null;
  /** The license for the plan chip; nothing shows while it is unknown. */
  license?: LicenseSummary;
  /** Free: searching GitHub needs Pro, so the discovery item says PRO. */
  discoveryLocked: boolean;
  /** Whether the sample run is listed, below its own heading. */
  showSample: boolean;
  /** present=1: the GitHub login reads "you" and no initials show. */
  presenting: boolean;
  maskUser: (value: string) => string;
  /** The narrow-screen drawer is open. */
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  navigate: (value: Page) => void;
  /** Opens the workbench: the run opened last, or the one open now. */
  openWorkbench: () => void;
  openModal: (value: ModalName) => void;
  beginContribution: () => void;
  chooseRun: (id: string) => Promise<boolean>;
}

/** How many of the person's runs the recent list shows. */
const recentLimit = 4;

/** The left navigation: pages, recent contributions, settings and help. */
export function Sidebar({
  page,
  runs,
  run,
  status,
  license,
  discoveryLocked,
  showSample,
  presenting,
  maskUser,
  sidebarOpen,
  setSidebarOpen,
  navigate,
  openWorkbench,
  openModal,
  beginContribution,
  chooseRun,
}: SidebarProps) {
  const t = useT("app");
  const [locale] = useLocale();
  const demoRun = getDemo(locale).run;
  const login = status?.githubUser ?? "";
  const { play } = usePresentation();
  // Practice items due now; counted again when a run changes state.
  const practiceReady = usePracticeReady({
    demo: play,
    refreshKey: runs.map((item) => `${item.id}:${item.status}`).join(),
  });
  // A repository's overview belongs to the Repositories section.
  const section: Page = page === "explore" ? "repos" : page;
  const navItem = (
    value: Page,
    Icon: LucideIcon,
    extra?: ReactNode,
    onClick = () => navigate(value),
  ) => (
    <button
      key={value}
      className={section === value ? "nav-item active" : "nav-item"}
      title={t.pages[value]}
      aria-current={section === value ? "page" : undefined}
      onClick={onClick}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{t.pages[value]}</span>
      {extra}
    </button>
  );
  const recentItem = (item: RunSummary | Run, sample: boolean) => (
    <button
      key={item.id}
      className={`recent-item ${run.id === item.id ? "selected" : ""}`}
      onClick={() => chooseRun(item.id)}
    >
      <span
        className={`small-status ${item.status === "running" ? "running" : ""}`}
      />
      <span>{sample ? t.sidebar.demoRunTitle : item.title}</span>
    </button>
  );
  return (
    <>
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label={t.sidebar.closeNavigation}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        id="workspace-sidebar"
        className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}
      >
        <div className="brand-row">
          <a
            href="#/home"
            className="brand"
            aria-label={t.sidebar.home}
            onClick={(e) => {
              e.preventDefault();
              navigate("home");
            }}
          >
            <Logo variant="wordmark" size={30} title="" className="brand-wordmark" />
            <Logo variant="mark" size={30} title="" className="brand-mark" />
          </a>
          <span className="sidebar-plan">
            <PlanChip summary={license} />
          </span>
        </div>
        <div className="nav-label">{t.sidebar.navigationHeading}</div>
        <nav aria-label={t.sidebar.mainNavigation}>
          {navItem("home", House)}
          {navItem(
            "workspace",
            LayoutDashboard,
            runs.length > 0 && <span className="nav-count">{runs.length}</span>,
            openWorkbench,
          )}
          {navItem("repos", FolderGit2)}
          {navItem("discovery", Search, discoveryLocked && <ProBadge />)}
          {navItem("team", Workflow)}
          {navItem("learning", BookOpen, <PracticeReadyChip count={practiceReady} />)}
        </nav>
        <div className="nav-label recent-label">
          {t.sidebar.recent}{" "}
          <button
            aria-label={t.sidebar.newTask}
            onClick={() => beginContribution()}
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="recent-list">
          {runs.slice(0, recentLimit).map((item) => recentItem(item, false))}
          {showSample && (
            <>
              <div className="recent-sample-heading">{t.sidebar.sampleHeading}</div>
              {recentItem(demoRun, true)}
            </>
          )}
          <button className="all-runs-link" onClick={() => openModal("runs")}>
            {t.sidebar.allRuns} <ChevronRight size={12} />
          </button>
        </div>
        <div className="sidebar-bottom">
          {navItem("settings", Settings2)}
          <button
            className="nav-item"
            title={t.sidebar.help}
            aria-keyshortcuts="?"
            onClick={() => openModal("help")}
          >
            <CircleHelp size={17} aria-hidden="true" />
            <span>{t.sidebar.help}</span>
            <span className="shortcut">?</span>
          </button>
          <button
            className="nav-item"
            title={t.sidebar.about}
            onClick={() => openModal("about")}
          >
            <Info size={17} aria-hidden="true" />
            <span>{t.sidebar.about}</span>
          </button>
          <div className="sidebar-language">
            <Languages size={16} aria-hidden="true" />
            <LanguageSwitcher className="sidebar-language-select" />
          </div>
          <div className="profile">
            <span className="profile-avatar" aria-hidden="true">
              {login && !presenting ? initialsOf(login) : <UserRound size={16} />}
            </span>
            <span>
              <strong>{maskUser(login) || t.sidebar.profileFallback}</strong>
              <small>
                <span className="connection-dot" /> {t.sidebar.localWorkspace}
              </small>
            </span>
            <button
              className="icon-button"
              aria-label={t.sidebar.workspaceSettings}
              onClick={() => navigate("settings")}
            >
              <Settings2 size={15} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
