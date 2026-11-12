import { formatters, type Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/security-draft-checks.js";

const m: Translation<typeof en> = {
  secret: "發布前會擋下常見格式的 token 與私鑰。",
  secretIn: ({ field }) =>
    ({
      title: "位於標題",
      body: "位於說明",
      commitMessage: "位於提交訊息",
    })[field],
  localPaths:
    "PR 文字含有這台電腦的路徑，可能洩漏使用者名稱與資料夾結構。請確認要發布，或移除它。",
  localPath: ({ path }) => `找到：${path}`,
  workflows:
    "這次修改動到 GitHub Actions 工作流程或其他 CI 設定，維護者會仔細檢查。推送工作流程檔案需要 GitHub CLI 的 workflow 權限。",
  workflowFile: ({ path }) => `已修改：${path}`,
  authorEmail: ({ emails }) =>
    `這個 commit 的電子郵件地址 ${formatters("zh-TW").list(emails)} 在 GitHub 上人人可見。若要保密，請用 git config user.email 設定 GitHub no-reply 地址；只會詢問一次。`,
};
export default m;
