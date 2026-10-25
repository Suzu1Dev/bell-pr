import { formatters, type Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/security.js";
import draftChecks from "./security-draft-checks.js";

const list = (items: readonly string[]) =>
  formatters("zh-TW").list(items, { type: "unit" });

const m: Translation<typeof en> = {
  sandbox: {
    unavailable: `會修改檔案與執行指令的 Claude Code Agent 需要作業系統沙箱，但這台電腦無法使用。Linux 需要 bubblewrap（bwrap）與 socat；macOS 需要 sandbox-exec。請安裝它們、把這個專案改用 Codex，或在「設定 → Agent 安全」允許不使用沙箱的 Agent。`,
    blocked: `會修改檔案與執行指令的 Claude Code Agent 需要作業系統沙箱。bubblewrap 已安裝，但在這裡無法建立沙箱，例如在啟動時沒有加上 docs/docker.md 所列安全選項的 Docker 容器中。請用這些選項啟動容器；若你接受以容器作為唯一的隔離，也可以允許不使用沙箱的 Agent。`,
    installFix: "安裝 bubblewrap 與 socat（Debian、Ubuntu）",
    dockerFix: "在 Docker 中，把這些選項加到 docker run（見 docs/docker.md）",
    codexFix: "或登入 Codex，並在「設定 → 模型」選用它",
    allowFix: `或在「設定 → Agent 安全」允許不使用沙箱的 Claude Agent，或用這個變數啟動 ${product.name}（Agent 會以你的完整使用者權限執行）`,
  },
  invalidOrigins:
    "BELLPR_ALLOWED_ORIGINS 必須是以逗號分隔的來源（origin），不可含帳號密碼、路徑、查詢字串、片段或萬用字元；只有本機回送位址可以使用純 HTTP。",
  gitConfigUnsafe: ({ keys }) =>
    `這個儲存庫的 Git 設定含有 ${list(keys)}，可能讓 Git 執行其他程式或把憑證送到別處。${product.name} 不會在其中執行 Git。請從它的 .git/config 移除這些設定，或重新匯入專案。`,
  worktreeForged:
    "隊員的工作目錄已不再指向這個工作的 Git 儲存庫，因此不會使用它。請重試任務，取得新的工作目錄。",
  invalidRemote:
    "這個工作記錄的 GitHub 儲存庫或分支名稱不正確，因此沒有擷取或推送任何內容。",
  draftChecks,
};
export default m;
