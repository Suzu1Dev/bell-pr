import type { Dispatch, SetStateAction } from "react";
import { Bot, Github, Sparkles, Terminal, Workflow } from "lucide-react";
import { api } from "../api";
import type { Notify, Page, Tab } from "../app/AppShell";
import type { Status } from "../app/hooks/useAppData";

interface SettingsPageProps {
  status: Status | null;
  setStatus: Dispatch<SetStateAction<Status | null>>;
  setApiError: Dispatch<SetStateAction<string>>;
  notify: Notify;
  configureContributionModels: () => void;
  setTab: Dispatch<SetStateAction<Tab>>;
  navigate: (value: Page) => void;
}

/** The local CLI connections, model settings and run limits. */
export function SettingsPage({
  status,
  setStatus,
  setApiError,
  notify,
  configureContributionModels,
  setTab,
  navigate,
}: SettingsPageProps) {
  return (
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
  );
}
