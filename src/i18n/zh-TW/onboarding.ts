import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/onboarding";

const m: Translation<typeof en> = {
  title: `歡迎使用 ${product.name}`,
  intro: "幾個步驟就能準備就緒：語言、這台電腦上的工具，以及 Agent 使用的 AI 服務。",
  progress: "設定步驟",
  stepOf: ({ step, total }) => `第 ${step} 步，共 ${total} 步`,
  steps: {
    language: "語言",
    environment: "工作環境",
    provider: "AI 服務",
    start: "開始使用",
  },
  next: "繼續",
  back: "上一步",
  language: {
    title: "選擇語言",
    text: `${product.name} 會以這個語言顯示頁面、說明與 Agent 報告。之後隨時可以在「設定」中變更。`,
    label: "語言",
  },
  environment: {
    title: "檢查工作環境",
    text: `${product.name} 需要 Git 與至少一個 AI 服務。發佈 Pull Request 與尋找專案需要 GitHub CLI。`,
    later: "你可以先繼續，之後再到「設定」處理其餘項目。",
  },
  provider: {
    title: "你的 AI 服務",
    text: "Agent 執行工作與分析專案時會使用你在這裡選擇的服務。之後可以在模型設定中變更。",
    auto: ({ provider }) => `${provider} 已安裝並登入，你的 Agent 會使用它。`,
    choose: "兩個服務都已就緒。你的 Agent 要使用哪一個？",
    none: "目前還沒有就緒的 AI 服務。請安裝並登入 Codex CLI 或 Claude Code（見上一步），再重新檢查。你仍可以先看範例導覽。",
    checking: "正在檢查哪些服務已就緒…",
    saving: "儲存中…",
    saved: ({ provider }) => `你的 Agent 會使用 ${provider}。`,
    saveFailed: ({ message }) => `無法儲存 AI 服務：${message}`,
    codexNote: "使用你已安裝並登入的 Codex CLI。用量計入你自己的帳號。",
    claudeNote:
      "使用你已安裝並登入的 Claude Code CLI（Claude 方案或 Anthropic API 金鑰）。用量計入你自己的帳號。",
  },
  start: {
    title: "你想從哪裡開始？",
    tour: "觀看 2 分鐘範例導覽",
    tourText: "在範例專案上看一次完整的貢獻流程，不需任何設定。",
    import: "匯入儲存庫",
    importText:
      "從 GitHub 或這台電腦帶入專案，開始貢獻。每一份貢獻最後都由你用自己的話講一遍；可在「設定 → 學習」調整。",
    importTextLocked: "從 GitHub 或這台電腦帶入專案，開始貢獻。每一份貢獻最後都由你用自己的話講一遍。",
    discover: "尋找可以貢獻的專案",
    discoverText: "在 GitHub 上搜尋歡迎你提供這類協助的專案。",
    discoverDisabled: "請先安裝並登入 GitHub CLI。",
    finishFailed: ({ message }) => `無法完成設定：${message}`,
  },
};

export default m;
