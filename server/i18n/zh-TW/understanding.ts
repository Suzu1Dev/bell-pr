import type { Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/understanding.js";

const understanding: Translation<typeof en> = {
  settingName: "核准前請我用自己的話講一遍每項變更",
  fallbackQuestion: ({ path }) =>
    `用一句話說明：對 ${path} 的變更做了什麼？為什麼這樣改？`,
  untestedQuestion: "你沒有測試哪些情況？為什麼？",
  notOpen: "工作等待你審閱或核准時才能進行理解檢查；執行中或發布中不行。",
  changed: "你打開檢查後，變更又更新了。請重新載入，看看最新版本的問題。",
  unknownQuestion: "有一個答案不屬於目前檢查的問題。請重新載入檢查後再回答。",
  alreadyLocked: "你的答案已經鎖定。要重新回答，請重新開始檢查。",
  answerAll: "鎖定答案前，請回答每一個問題。",
  summaryRequired: "請先用自己的話說明這份變更。",
  summaryLocked: "你的說明已經儲存。請改為確認或修改它。",
  summaryShort: ({ min }) =>
    `請至少用 ${min} 個字說明這份變更：解決什麼問題、做了什麼、可能弄壞什麼。`,
  summaryCopied: "你的說明逐字重複了 AI 寫的解說。請用自己的話寫。",
  answerShort: ({ min }) => `每個答案至少需要 ${min} 個字，或選「我不知道」。`,
  answerCopied: "有一個答案逐字重複了 AI 寫的參考答案。請用自己的話寫。",
  dontKnow: "選「我不知道」時答案留白，信心程度選「用猜的」。",
  notAnswered: "請先鎖定答案，再為答案評分。",
  notGradable: "「沒有測試哪些情況」這題不評分。",
  dontKnowMissed: "「我不知道」的答案算作沒答到。",
  correctionShort: ({ min }) => `請至少用 ${min} 個字寫下你哪裡想錯了。`,
  alreadyPassed: "你已經用自己的話講過這個版本的變更。要修改答案，請重新開始檢查。",
  noSummary: "還沒有可以確認的說明。請先鎖定答案。",
  attemptLocked: "這次作答已經評分或略過，會維持你當時的回答。",
  attemptSkipped: "略過的作答沒有答案。",
  attemptEmpty: "請送出測驗答案或做法選擇。",
  notImplemented: "這個版本的 BELL PR 還沒有這項功能。",
};

export default understanding;
