import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/onboarding";

const m: Translation<typeof en> = {
  title: `歡迎使用 ${product.name}`,
  intro: "幾個步驟就能準備就緒：語言、授權條款、這台電腦上的工具，以及 Agent 使用的 AI 服務。",
  progress: "設定步驟",
  stepOf: ({ step, total }) => `第 ${step} 步，共 ${total} 步`,
  steps: {
    language: "語言",
    license: "授權",
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
  license: {
    title: "授權條款",
    text: `請閱讀 ${product.name} 終端使用者授權合約。重點如下：`,
    summary: [
      `你可以在自己擁有或管理的電腦上使用 ${product.name}；Pro 功能需要授權金鑰或試用。`,
      `${product.name} 透過你自行安裝並登入的工具運作（Git、GitHub CLI，以及 Codex CLI 或 Claude Code），使用的是你自己的帳號，因此適用這些服務的條款與用量限制。`,
      "AI 的輸出可能有誤。每項修改都由你審閱，經你核准之前不會發佈任何內容。",
      "Agent 會在這台電腦上執行指令，包括匯入專案自己的程式碼。請只匯入你願意在這裡執行的專案。",
      `${product.name} 不傳送任何遙測資料：你的資料留在這台電腦上。`,
      "軟體依現狀提供；保證免責與責任限制以合約內容為準。",
    ],
    notice: "這份摘要不是合約本身，一切以完整條文為準。",
    read: "閱讀完整合約",
    version: ({ version }) => `合約版本 ${version}`,
    accept: `我接受 ${product.name} 終端使用者授權合約`,
    acceptButton: "接受並繼續",
    accepted: ({ version }) => `你已接受第 ${version} 版合約。`,
    saveFailed: ({ message }) => `無法儲存你的接受紀錄：${message}`,
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
    importText: "從 GitHub 或這台電腦帶入專案，開始貢獻。",
    discover: "尋找可以貢獻的專案",
    discoverText: "在 GitHub 上搜尋歡迎你提供這類協助的專案。",
    discoverTextFree: "免費方案可查看範例結果；在 GitHub 上搜尋專案需要 Pro 或 14 天試用。",
    discoverDisabled: "請先安裝並登入 GitHub CLI。",
    finishFailed: ({ message }) => `無法完成設定：${message}`,
  },
};

export default m;
