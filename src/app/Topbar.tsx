import type { Dispatch, SetStateAction } from "react";
import {
  ChevronRight,
  ExternalLink,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  UserRound,
} from "lucide-react";
import type { DoctorReport } from "../../shared/doctor";
import { useT } from "../i18n";
import type { Page } from "./AppShell";
import { initialsOf } from "./labels";

/** Where the environment stands, as the top bar's pill shows it. */
export type Readiness =
  | { state: "ready" }
  /** No required check fails, but `count` checks fail or warn. */
  | { state: "steps"; count: number }
  /** A required check fails. */
  | { state: "not-ready" };

/** The pill's state for an environment report; undefined while none came. */
export function environmentReadiness(report: DoctorReport | null): Readiness | undefined {
  if (!report) return undefined;
  if (report.checks.some((check) => check.required && check.status === "fail"))
    return { state: "not-ready" };
  const count = report.checks.filter(
    (check) => check.status === "fail" || check.status === "warn",
  ).length;
  return count ? { state: "steps", count } : { state: "ready" };
}

/**
 * The repository's page on GitHub for an https://github.com/<owner>/<name>
 * URL (a trailing `.git` dropped); undefined for any other URL, such as a
 * local project's path or the sample project's empty one.
 */
export function gitHubUrl(url: string | undefined): string | undefined {
  const match = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(?:\.git)?\/?$/.exec(url ?? "");
  return match ? url!.replace(/(?:\.git)?\/?$/, "") : undefined;
}

interface TopbarProps {
  page: Page;
  busy: boolean;
  /** The narrow-screen drawer is open. */
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  toggleCommandPalette: () => void;
  navigate: (value: Page) => void;
  /** The environment report; null while the first one loads. */
  report: DoctorReport | null;
  /** present=1: no readiness pill and no initials. */
  presenting: boolean;
  /** The open project's repository URL; a GitHub one gets a link. */
  repoUrl?: string;
  /** The signed-in GitHub login; "" when there is none. */
  githubUser: string;
}

/** The top bar: menu toggles, breadcrumb, quick switch, readiness and profile. */
export function Topbar({
  page,
  busy,
  sidebarOpen,
  setSidebarOpen,
  sidebarCollapsed,
  setSidebarCollapsed,
  toggleCommandPalette,
  navigate,
  report,
  presenting,
  repoUrl,
  githubUser,
}: TopbarProps) {
  const t = useT("app");
  const commandShortcut = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
  const readiness = presenting ? undefined : environmentReadiness(report);
  const readinessText =
    readiness?.state === "ready"
      ? t.topbar.readiness.ready
      : readiness?.state === "steps"
        ? t.topbar.readiness.steps({ count: readiness.count })
        : t.topbar.readiness.notReady;
  const repoLink = gitHubUrl(repoUrl);
  return (
    <header className="topbar">
      <div className="breadcrumb">
        <button
          className="icon-button mobile-menu"
          aria-label={t.topbar.openNavigation}
          aria-controls="workspace-sidebar"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(true)}
        >
          <Menu size={18} />
        </button>
        <button
          className="icon-button sidebar-toggle"
          aria-label={
            sidebarCollapsed
              ? t.topbar.expandSidebar
              : t.topbar.collapseSidebar
          }
          title={
            sidebarCollapsed
              ? t.topbar.expandSidebar
              : t.topbar.collapseSidebar
          }
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
        <span className="breadcrumb-root">{t.topbar.root}</span>
        <ChevronRight size={13} className="breadcrumb-separator" aria-hidden="true" />
        <span className="breadcrumb-page">{t.pages[page]}</span>
      </div>
      <div className="topbar-right">
        <button
          className="workspace-command"
          onClick={toggleCommandPalette}
          disabled={busy}
          aria-label={t.topbar.quickSwitchLabel}
          aria-keyshortcuts="Meta+K Control+K"
          aria-haspopup="dialog"
          title={t.topbar.quickSwitchTitle({ shortcut: commandShortcut })}
        >
          <Search size={15} aria-hidden="true" />
          <span>{t.topbar.quickSwitch}</span>
          <kbd>{commandShortcut}</kbd>
        </button>
        {readiness && (
          <a
            className={`readiness-pill readiness-${readiness.state}`}
            href="#/settings/environment"
            aria-label={t.topbar.readiness.label({ state: readinessText })}
            title={t.topbar.readiness.label({ state: readinessText })}
          >
            <span className="readiness-dot" aria-hidden="true" />
            <span className="readiness-text">{readinessText}</span>
          </a>
        )}
        {repoLink && (
          <a
            className="topbar-repo-link"
            href={repoLink}
            target="_blank"
            rel="noreferrer"
            aria-label={t.topbar.openOnGitHub}
            title={t.topbar.openOnGitHub}
          >
            <ExternalLink size={14} aria-hidden="true" />
            <span className="topbar-repo-text">{t.topbar.openOnGitHub}</span>
          </a>
        )}
        <button
          className="top-avatar"
          onClick={() => navigate("settings")}
          aria-label={t.topbar.profile}
        >
          {githubUser && !presenting ? (
            initialsOf(githubUser)
          ) : (
            <UserRound size={15} aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  );
}
