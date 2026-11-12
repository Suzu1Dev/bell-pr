import type { Translation } from "../../../shared/i18n/locale";
import { fullAccessDisclosure, sudoDisclosure } from "../../../shared/i18n/disclosures.zh-TW";
import type en from "../en/permissions";
import { product } from "../../../shared/product";
const messages: Translation<typeof en> = {
  label: "Agent 權限",
  workspace: "工作目錄權限（預設）",
  full: "完整權限",
  fullAccessDisclosure,
  fullConfirmTitle: "要改用完整權限嗎？",
  fullConfirm: "使用完整權限",
  fullCancel: "維持工作目錄權限",
  summary: "完整權限（取消沙箱與指令 deny 規則）",
  workspaceHelp: "Codex：工作目錄沙箱。Claude Code 與 Antigravity：作業系統沙箱與指令 deny 規則，除非你允許在沙箱外執行。唯讀角色仍受限。",
  sudoTitle: "免密碼 sudo",
  sudoDisclosure,
  loadFailed: ({ message }) => `無法讀取 sudo 狀態：${message}`,
  loading: "正在讀取 sudo 狀態…",
  unavailable: "這台電腦沒有 sudo 指令，無法設定免密碼 sudo。",
  installed: ({ user }) => `已啟用：帳號 ${user} 使用 sudo 不需要密碼。這是 ${product.name} 建立的規則，可在這裡移除。`,
  external: ({ user }) => `帳號 ${user} 使用 sudo 已不需要密碼，但規則不是 ${product.name} 建立的，${product.name} 不會移除它。`,
  password: ({ user }) => `sudo 密碼（${user}）`,
  ttl: "自動關閉時間",
  ttlOption: ({ minutes }) => (minutes < 60 ? `${minutes} 分鐘` : `${minutes / 60} 小時`),
  expiresAt: ({ time }) => `將於 ${time} 關閉。`,
  enable: "啟用免密碼 sudo",
  enabling: "設定中…",
  remove: `移除 ${product.name} 的 sudo 規則`,
  removing: "移除中…",
  help: ({ user }) => `每次啟用都要輸入密碼，為帳號 ${user} 建立 /etc/sudoers.d/bell-pr-agent，在上方選擇的時間內有效（最長 8 小時），時間到 ${product.name} 會移除規則。只能在這台電腦上的 ${product.name} 操作。密碼只交給 sudo，不會被儲存或寫入記錄。這條規則讓以 ${user} 執行的所有程式與 Agent 免密碼取得 root 權限。`,
  failed: "操作未完成，請再試一次。",
};
export default messages;
