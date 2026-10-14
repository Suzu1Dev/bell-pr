import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/setup";

const m: Translation<typeof en> = {
  checklist: {
    title: "工作環境",
    intro: `${product.name} 在這台電腦上需要的工具，以及缺少時的修正方式。`,
    recheck: "重新檢查",
    rechecking: "檢查中…",
    checking: "正在檢查你的工作環境…",
    checkedAt: ({ time }) => `檢查時間：${time}`,
    loadFailed: ({ message }) => `環境檢查沒有回應：${message}`,
    required: "必要",
    fixesTitle: "請執行以下指令修正：",
    dataDir: ({ path }) => `資料夾：${path}`,
    labels: {
      node: "Node.js",
      git: "Git",
      "git-identity": "Git 名字與電子郵件",
      gh: "GitHub CLI",
      "gh-auth": "GitHub 登入",
      "gh-scopes": "GitHub 權限",
      codex: "Codex CLI",
      "codex-auth": "Codex 登入",
      claude: "Claude Code",
      "claude-auth": "Claude Code 登入",
      "claude-sandbox": "Claude Code 沙箱",
      "provider-ready": "AI 服務",
      "data-dir": "資料目錄",
      app: product.name,
      platform: "平台",
    },
    status: {
      ok: "已就緒",
      warn: "請確認",
      fail: "尚未就緒",
      skip: "未使用",
    },
    summaryReady: `${product.name} 需要的一切都已就緒。`,
    summaryNotReady: ({ count }) => `有 ${count} 個必要項目需要處理。`,
    summaryBlocked: ({ count }) =>
      `可以開始使用，但還有 ${count} 個項目需要修正，否則有些步驟無法進行。`,
    summaryWarnings: ({ count }) => `已就緒，另有 ${count} 個項目值得留意。`,
    openDetails: "開啟工作環境設定",
  },
  copy: {
    copy: "複製",
    copied: "已複製",
    copyCommand: ({ command }) => `複製指令：${command}`,
    selected: "已選取指令。請按 Ctrl+C（Mac 為 ⌘C）複製。",
  },
  readiness: {
    checking: "正在檢查你的工作環境…",
    provider: "這需要 AI 服務：請安裝並登入 Codex CLI 或 Claude Code。",
    gh: "這需要已安裝並登入的 GitHub CLI。",
    "git-identity": "這需要你的 Git 名字與電子郵件地址，每個提交都會帶有它們。",
    unavailable: "修正之前無法使用。",
    detail: ({ check, detail }) => `${check}：${detail}`,
  },
};

export default m;
