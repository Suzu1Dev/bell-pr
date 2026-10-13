import type { Dispatch, SetStateAction } from "react";
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FolderGit2,
  LayoutDashboard,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Workflow,
} from "lucide-react";
import { demoRun } from "../demo";
import type { Run, RunSummary } from "../types";
import type { ModalName, Page } from "./AppShell";
import type { Status } from "./hooks/useAppData";

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
  return (
    <>
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
    </>
  );
}
