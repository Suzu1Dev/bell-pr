import { formatters, type Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/security.js";
import draftChecks from "./security-draft-checks.js";

const list = (items: readonly string[]) =>
  formatters("zh-TW").list(items, { type: "unit" });

const m: Translation<typeof en> = {
  sandbox: {
    unavailable: `會改檔案、執行指令的 Claude Code Agent 需要作業系統沙箱，這台電腦沒有。Linux 要 bubblewrap（bwrap）與 socat，macOS 要 sandbox-exec。請安裝、把專案改用 Codex，或在「設定 → Agent 安全」允許 Agent 在沙箱外執行。`,
    blocked: `會改檔案、執行指令的 Claude Code Agent 需要作業系統沙箱。bubblewrap 已安裝，但這裡無法建立沙箱，例如 Docker 未加 docs/docker.md 的選項。請加上這些選項；若接受容器為唯一隔離，也可允許 Agent 在沙箱外執行。`,
    installFix: "安裝 bubblewrap 與 socat（Debian、Ubuntu）",
    dockerFix: "在 Docker 中，把這些選項加到 docker run（見 docs/docker.md）",
    codexFix: "或登入 Codex，並在「設定 → AI 服務」選用它",
    allowFix: `或在「設定 → Agent 安全」允許不使用沙箱的 Agent，或用這個變數啟動 ${product.name}（Agent 會以你的完整使用者權限執行）`,
    antigravityUnavailable: `會改檔案、執行指令的 Antigravity Agent 需要 Antigravity CLI 的終端機沙箱，這裡無法使用（Linux 要 user namespace，macOS 要 sandbox-exec）。請在「設定 → AI 服務」改選 Claude Code 或 Codex，或在「設定 → Agent 安全」允許 Agent 在沙箱外執行。`,
    antigravityRestricted: `會改檔案、執行指令的 Antigravity Agent 需要 Antigravity CLI 的終端機沙箱，但無法啟動：此 Linux 系統封鎖了 user namespace（kernel.apparmor_restrict_unprivileged_userns，Ubuntu 24.04 起的預設）。請依 docs/troubleshooting.md 允許 user namespace，或在「設定 → Agent 安全」允許 Agent 在沙箱外執行。改選 Claude Code 或 Codex 未必有用：它們的沙箱可能也需要這項設定。`,
    claudeFix: "或登入 Claude Code，並在「設定 → AI 服務」選用它",
    antigravityWorkspaceConfig: ({ paths }) =>
      `這個專案含有 Antigravity 自訂設定（${list(paths)}）。Antigravity CLI 會為每個 Agent 在沙箱外執行其中的 hooks 與 MCP 伺服器，所以 ${product.name} 不在這裡啟動 Antigravity。請在「設定 → AI 服務」改選 Claude Code 或 Codex。`,
  },
  invalidOrigins:
    "BELLPR_ALLOWED_ORIGINS 必須是以逗號分隔的來源（origin），不可含帳號密碼、路徑、查詢字串、片段或萬用字元；只有本機回送位址可以使用純 HTTP。",
  suiteLinksInvalid: `BELLPR_SUITE_LINKS 須為逗號分隔的 explain=<origin> 或 personal=<origin>，每個產品最多一筆。origin 不可含帳號密碼、路徑（含結尾 /）、查詢字串、片段、萬用字元或連接埠 0；須是這台電腦（localhost、127.x.x.x、[::1]），或與 BELLPR_PUBLIC_URL、BELLPR_ALLOWED_ORIGINS 同 tailnet 的 https *.ts.net 名稱，且不可是 ${product.name} 自己。`,
  gitConfigUnsafe: ({ keys }) =>
    `這個 repository 的 Git 設定含 ${list(keys)}，可能讓 Git 執行其他程式或外送憑證，所以 ${product.name} 不會在其中執行 Git。請從 .git/config 移除，或重新匯入專案。`,
  worktreeForged:
    "隊友的工作目錄已不指向這個任務的 Git repository，不予使用。請重試子任務，換新的工作目錄。",
  invalidRemote:
    "這個任務記錄的 GitHub repository 或分支名稱不正確，因此沒有擷取或推送任何內容。",
  draftChecks,
};
export default m;
