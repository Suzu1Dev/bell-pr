import type { Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/sudo.js";
const messages: Translation<typeof en> = {
  fullAccessNotice: "這個 Claude Agent 未在作業系統沙箱中執行，因為這次工作已選擇完整權限。",
  busy: "正在設定免密碼 sudo，請稍候。",
  invalidUser: "這個帳號名稱無法安全寫入 sudoers 規則。",
  invalidRule: "產生的 sudoers 規則沒有通過 visudo 檢查，未寫入。",
  overridden: "規則已寫入，但 sudo 仍要求密碼（可能被其他規則覆蓋），已移除這個規則。",
  removeManually: ({ file }) => `移除需要密碼；請在終端機執行 sudo rm ${file}`,
  locked: ({ minutes }) => `密碼輸錯 3 次，已暫停設定；請 ${minutes} 分鐘後再試。`,
  forbidden: "這個帳號無法使用 sudo，不能啟用免密碼 sudo。",
  wrongPassword: ({ remaining, minutes }) => `密碼不正確；再輸錯 ${remaining} 次會暫停 ${minutes} 分鐘。`,
  failed: ({ detail }) => `sudo 執行失敗：${detail}`,
};
export default messages;
