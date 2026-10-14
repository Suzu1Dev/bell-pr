import { formatters, type Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/security.js";

const list = (items: readonly string[]) =>
  formatters("zh-TW").list(items, { type: "unit" });
const [bin] = product.binNames;

const m: Translation<typeof en> = {
  authRequired: `請先登入 ${product.name}：開啟終端機印出的登入連結，或在這台電腦上執行 ${bin} open。`,
  signIn: {
    title: `登入 ${product.name}`,
    heading: `登入 ${product.name}`,
    howTo: `請開啟終端機印出的登入連結，或在這台電腦的終端機執行 \`${bin} open\`（Docker：\`docker exec <container> ${bin} open --print\`）。`,
    linkInvalid: `這個登入連結已失效。\`${bin} open\` 產生的連結只能在兩分鐘內使用一次；${product.name} 啟動時印出的連結在它重新啟動前都有效。`,
    signedInTitle: `已登入 ${product.name}`,
    signedIn: "這個瀏覽器已登入。",
    continue: `繼續前往 ${product.name}`,
  },
  sandbox: {
    unavailable: `會修改檔案與執行指令的 Claude Code Agent 需要作業系統沙箱，但這台電腦無法使用。Linux 需要 bubblewrap（bwrap）與 socat；macOS 需要 sandbox-exec。請安裝它們、把這個專案改用 Codex，或在「設定 → Agent 安全」允許不使用沙箱的 Agent。`,
    blocked: `會修改檔案與執行指令的 Claude Code Agent 需要作業系統沙箱。bubblewrap 已安裝，但在這裡無法建立沙箱，例如在啟動時沒有加上 docs/docker.md 所列安全選項的 Docker 容器中。請用這些選項啟動容器；若你接受以容器作為唯一的隔離，也可以允許不使用沙箱的 Agent。`,
    installFix: "安裝 bubblewrap 與 socat（Debian、Ubuntu）",
    dockerFix: "在 Docker 中，用這些選項啟動容器（見 docs/docker.md）",
    codexFix: "或登入 Codex，並在「設定 → 模型」選用它",
    allowFix: `或在「設定 → Agent 安全」允許不使用沙箱的 Claude Agent，或用這個變數啟動 ${product.name}（Agent 會以你的完整使用者權限執行）`,
  },
  gitConfigUnsafe: ({ keys }) =>
    `這個儲存庫的 Git 設定含有 ${list(keys)}，可能讓 Git 執行其他程式或把憑證送到別處。${product.name} 不會在其中執行 Git。請從它的 .git/config 移除這些設定，或重新匯入專案。`,
  worktreeForged:
    "隊員的工作目錄已不再指向這個工作的 Git 儲存庫，因此不會使用它。請重試任務，取得新的工作目錄。",
  invalidRemote:
    "這個工作記錄的 GitHub 儲存庫或分支名稱不正確，因此沒有擷取或推送任何內容。",
  draftChecks: {
    secret:
      "PR 標題、說明或提交訊息含有疑似憑證的內容，例如存取權杖或私密金鑰。請移除：發佈到 GitHub 的內容任何人都看得到。",
    secretIn: ({ field }) =>
      ({
        title: "位於標題",
        body: "位於說明",
        commitMessage: "位於提交訊息",
      })[field],
    localPaths:
      "PR 文字含有這台電腦上的路徑，可能透露你的使用者名稱與資料夾結構。請確認要發佈，或將它移除。",
    localPath: ({ path }) => `找到：${path}`,
    workflows:
      "這次修改涉及 GitHub Actions 工作流程或其他 CI 設定。維護者會仔細檢查這類修改，而推送工作流程檔案需要 GitHub CLI 的 workflow 權限。",
    workflowFile: ({ path }) => `已修改：${path}`,
    authorEmail: ({ emails }) =>
      `這個提交會帶有電子郵件地址 ${formatters("zh-TW").list(emails)}，任何人都能在 GitHub 上看到。若要保密，請用 git config user.email 設定你的 GitHub no-reply 地址；這項確認只會出現一次。`,
  },
};
export default m;
