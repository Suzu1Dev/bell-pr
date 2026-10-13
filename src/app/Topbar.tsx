import type { Dispatch, SetStateAction } from "react";
import {
  ChevronRight,
  Github,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
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
  const commandShortcut = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
  return (
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
  );
}
