import type { Translation } from "../../../shared/i18n/locale";
import type en from "../en/permissions";
import { product } from "../../../shared/product";
const messages: Translation<typeof en> = {
  label: "Agent 權限",
  workspace: "工作目錄（預設）",
  full: "完整權限",
  summary: "完整權限（取消沙箱與指令拒絕規則）",
  workspaceHelp: "Codex 使用工作目錄沙箱。Claude Code 保留作業系統沙箱與指令拒絕規則，除非你另外允許在無沙箱時執行。唯讀角色仍維持限制。",
  fullHelp: "可寫入的 Agent 會以你的帳號執行，取消沙箱與指令拒絕規則，可以安裝套件、修改系統設定並使用免密碼 sudo。專案內容可能誘導 Agent，影響整台電腦；只在信任的專案使用。唯讀角色仍維持限制。",
  sudoTitle: "免密碼 sudo",
  loadFailed: ({ message }) => `無法讀取 sudo 狀態：${message}`,
  loading: "正在讀取 sudo 狀態…",
  unavailable: "這台機器沒有 sudo 指令，無法設定免密碼 sudo。",
  installed: ({ user }) => `已啟用：帳號 ${user} 使用 sudo 不需要密碼。這是 ${product.name} 建立的規則，可在這裡移除。`,
  external: ({ user }) => `帳號 ${user} 使用 sudo 已不需要密碼，但規則不是 ${product.name} 建立的，${product.name} 不會移除它。`,
  password: ({ user }) => `sudo 密碼（${user}）`,
  enable: "啟用免密碼 sudo",
  enabling: "設定中…",
  remove: `移除 ${product.name} 的 sudo 規則`,
  removing: "移除中…",
  help: ({ user }) => `輸入一次密碼，為帳號 ${user} 建立免密碼 sudo 規則（/etc/sudoers.d/bell-pr-agent）。密碼只交給 sudo 完成這一次設定，不會被儲存或寫入記錄。這條規則讓帳號 ${user} 不需密碼就能取得 root 權限，包含以它執行的所有程式與 Agent。`,
  failed: "操作未完成，請再試一次。",
};
export default messages;
