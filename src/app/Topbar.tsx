import type { Dispatch, SetStateAction } from "react";
import {
  ChevronRight,
  Github,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import { useT } from "../i18n";
import type { Page } from "./AppShell";

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
}

/** The top bar: menu toggles, breadcrumb, quick switch and profile. */
export function Topbar({
  page,
  busy,
  sidebarOpen,
  setSidebarOpen,
  sidebarCollapsed,
  setSidebarCollapsed,
  toggleCommandPalette,
  navigate,
}: TopbarProps) {
  const t = useT("app");
  const commandShortcut = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
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
        <ChevronRight size={13} />
        <span>{t.pages[page]}</span>
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
        <span className="local-badge">
          <span className="connection-dot" /> {t.topbar.localFirst}
        </span>
        <a
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          className="icon-button"
          aria-label={t.topbar.openGitHub}
        >
          <Github size={18} />
        </a>
        <button
          className="top-avatar"
          onClick={() => navigate("settings")}
          aria-label={t.topbar.profile}
        >
          M
        </button>
      </div>
    </header>
  );
}
