import { formatters, type Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/security.js";

const list = (items: readonly string[]) =>
  formatters("zh-TW").list(items, { type: "unit" });
const [bin] = product.binNames;

const m: Translation<typeof en> = {
  authRequired: `請先登入 ${product.name}：開啟終端機印出的登入連結，或在這台電腦上執行 \`${bin} open\`。`,
  signIn: {
    title: `登入 ${product.name}`,
    heading: `登入 ${product.name}`,
    howTo: `請開啟終端機印出的登入連結，或在這台電腦的終端機執行 \`${bin} open\`（Docker：\`docker exec <container> ${bin} open --print\`）。`,
    linkInvalid: "這個登入連結已過期或已使用過。每個連結只能在兩分鐘內使用一次。",
    signedInTitle: `已登入 ${product.name}`,
    signedIn: "這個瀏覽器已登入。",
    continue: `繼續前往 ${product.name}`,
  },
  sandbox: {
    unavailable: `會修改檔案與執行指令的 Claude Code Agent 需要作業系統沙箱，但這台電腦無法使用。Linux 需要 bubblewrap（bwrap）與 socat；macOS 需要 sandbox-exec。請安裝它們、把這個專案改用 Codex，或在「設定 → Agent 安全」允許不使用沙箱的 Agent。`,
    installFix: "安裝 bubblewrap 與 socat（Debian、Ubuntu）",
    codexFix: "或登入 Codex，並在「設定 → 模型」選用它",
    allowFix: `或在「設定 → Agent 安全」允許不使用沙箱的 Claude Agent，或用這個變數啟動 ${product.name}（Agent 會以你的完整使用者權限執行）`,
  },
  gitConfigUnsafe: ({ keys }) =>
    `這個儲存庫的 Git 設定含有 ${list(keys)}，可能讓 Git 執行其他程式或把憑證送到別處。${product.name} 不會在其中執行 Git。請從它的 .git/config 移除這些設定，或重新匯入專案。`,
  worktreeForged:
    "隊員的工作目錄已不再指向這個工作的 Git 儲存庫，因此不會使用它。請重試任務，取得新的工作目錄。",
  invalidRemote:
    "這個工作記錄的 GitHub 儲存庫或分支名稱不正確，因此沒有擷取或推送任何內容。",
};
export default m;
