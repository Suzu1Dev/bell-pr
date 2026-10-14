import { Fragment, type Dispatch, type SetStateAction } from "react";
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FolderGit2,
  Languages,
  LayoutDashboard,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Workflow,
} from "lucide-react";
import { getDemo } from "../demo";
import { useLocale, useT } from "../i18n";
import { LanguageSwitcher } from "../i18n/LanguageSwitcher";
import type { Run, RunSummary } from "../types";
import type { ModalName, Page } from "./AppShell";
import type { Status } from "./hooks/useAppData";
import "./sidebar.css";

interface SidebarProps {
  page: Page;
  runs: RunSummary[];
  /** The open run, highlighted in the recent list. */
  run: Run;
  status: Status | null;
  /** The narrow-screen drawer is open. */
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  navigate: (value: Page) => void;
  openModal: (value: ModalName) => void;
  beginContribution: () => void;
  chooseRun: (id: string) => Promise<boolean>;
}

/** The left navigation: pages, recent contributions, settings and help. */
export function Sidebar({
  page,
  runs,
  run,
  status,
  sidebarOpen,
  setSidebarOpen,
  navigate,
  openModal,
  beginContribution,
  chooseRun,
}: SidebarProps) {
  const t = useT("app");
  const [locale] = useLocale();
  const demoRun = getDemo(locale).run;
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
        <a
          href="#"
          className="brand"
          aria-label={t.sidebar.home}
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
          <span className="beta-label">{t.sidebar.beta}</span>
        </a>
        <button className="workspace-switch" onClick={() => navigate("repos")}>
          <span className="workspace-avatar">M</span>
          <span>
            <strong>{t.sidebar.workspaceName}</strong>
            <small>{t.sidebar.workspaceKind}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">{t.sidebar.navigationHeading}</div>
        <nav aria-label={t.sidebar.mainNavigation}>
          <button
            className={page === "workspace" ? "nav-item active" : "nav-item"}
            title={t.pages.workspace}
            onClick={() => navigate("workspace")}
          >
            <LayoutDashboard size={18} />
            <span>{t.pages.workspace}</span>
            <span className="nav-count">{runs.length + 1}</span>
          </button>
          <button
            className={page === "repos" ? "nav-item active" : "nav-item"}
            title={t.pages.repos}
            onClick={() => navigate("repos")}
          >
            <FolderGit2 size={18} />
            <span>{t.pages.repos}</span>
          </button>
          <button
            className={page === "discovery" ? "nav-item active" : "nav-item"}
            title={t.pages.discovery}
            onClick={() => navigate("discovery")}
          >
            <Search size={18} />
            <span>{t.pages.discovery}</span>
          </button>
          <button
            className={page === "team" ? "nav-item active" : "nav-item"}
            title={t.pages.team}
            onClick={() => navigate("team")}
          >
            <Workflow size={18} />
            <span>{t.pages.team}</span>
          </button>
          <button
            className={page === "learning" ? "nav-item active" : "nav-item"}
            title={t.pages.learning}
            onClick={() => navigate("learning")}
          >
            <BookOpen size={18} />
            <span>{t.pages.learning}</span>
            <span className="tiny-new">{t.sidebar.newBadge}</span>
          </button>
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
          {[...runs.slice(0, 4), demoRun].map((r) => (
            <button
              key={r.id}
              className={`recent-item ${run.id === r.id ? "selected" : ""}`}
              onClick={() => chooseRun(r.id)}
            >
              <span
                className={`small-status ${r.status === "running" ? "running" : ""}`}
              />
              <span>
                {r.id === demoRun.id ? t.sidebar.demoRunTitle : r.title}
              </span>
              {r.id === demoRun.id && (
                <span className="demo-small">{t.sidebar.demoBadge}</span>
              )}
            </button>
          ))}
          <button className="all-runs-link" onClick={() => openModal("runs")}>
            {t.sidebar.allRuns} <ChevronRight size={12} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="learning-card">
            <div className="learning-card-icon">
              <Sparkles size={17} />
            </div>
            <strong>{t.sidebar.learningTitle}</strong>
            <p>
              {t.sidebar.learningText.split("\n").map((line, index) => (
                <Fragment key={index}>
                  {index > 0 && <br />}
                  {line}
                </Fragment>
              ))}
            </p>
            <button onClick={() => navigate("learning")}>
              {t.sidebar.learningAction} <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className="nav-item"
            title={t.pages.settings}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={17} />
            <span>{t.pages.settings}</span>
          </button>
          <button
            className="nav-item"
            title={t.sidebar.help}
            aria-keyshortcuts="?"
            onClick={() => openModal("help")}
          >
            <CircleHelp size={17} />
            <span>{t.sidebar.help}</span>
            <span className="shortcut">?</span>
          </button>
          <div className="sidebar-language">
            <Languages size={16} aria-hidden="true" />
            <LanguageSwitcher className="sidebar-language-select" />
          </div>
          <div className="profile">
            <span className="profile-avatar">MC</span>
            <span>
              <strong>{status?.githubUser || t.sidebar.profileFallback}</strong>
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
