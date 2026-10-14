import { formatters, type Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/security.js";

const list = (items: readonly string[]) =>
  formatters("zh-TW").list(items, { type: "unit" });

const m: Translation<typeof en> = {
  gitConfigUnsafe: ({ keys }) =>
    `這個儲存庫的 Git 設定含有 ${list(keys)}，可能讓 Git 執行其他程式或把憑證送到別處。${product.name} 不會在其中執行 Git。請從它的 .git/config 移除這些設定，或重新匯入專案。`,
  worktreeForged:
    "隊員的工作目錄已不再指向這個工作的 Git 儲存庫，因此不會使用它。請重試任務，取得新的工作目錄。",
  invalidRemote:
    "這個工作記錄的 GitHub 儲存庫或分支名稱不正確，因此沒有擷取或推送任何內容。",
};
export default m;
