/** The About dialog (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/about";

const m: Translation<typeof en> = {
  title: `關於 ${product.name}`,
  subtitle: "版本、你的方案、資料存放的位置，以及說明與法律文件在哪裡。",
  appVersion: "App 版本",
  serverVersion: "伺服器版本",
  checking: "正在確認…",
  unavailable: "無法取得",
  mismatch: ({ app, server }) =>
    `這個頁面是 ${app} 版，但伺服器執行的是 ${server} 版。請重新載入頁面；如果版本仍然不同，請重新啟動 ${product.name}。`,
  plan: "方案",
  licensee: ({ name }) => `授權給 ${name}`,
  dataDir: "資料目錄",
  copyDataDir: "複製資料目錄的路徑",
  copy: "複製",
  copied: "已複製。",
  copyFailed: "無法複製，請直接選取文字。",
  help: "說明與更新",
  links: {
    docs: "說明文件",
    changelog: "更新紀錄",
    security: "回報安全性問題",
    issue: "回報問題",
  },
  documents: "法律文件",
  documentNames: {
    eula: "終端使用者授權合約",
    privacy: "隱私權政策",
    terms: "銷售與負責任使用條款",
    security: "安全性政策",
    notices: "第三方授權",
  },
  diagnostics: {
    copy: "複製診斷資訊",
    collecting: "正在收集診斷資訊…",
    copied: "已複製診斷資訊。其中的密鑰、路徑與你的 GitHub 帳號都已替換，可以直接貼到支援請求中。",
    copyFailed: "無法複製，請直接選取下方的文字。",
    failed: ({ message }) => `無法收集診斷資訊：${message}`,
  },
  close: "關閉",
};

export default m;
