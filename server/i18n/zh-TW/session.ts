import { product } from "../../../shared/product.js";

export default {
  name: "協作夥伴",
  emptyMessage: "請輸入要請 Agent 處理的內容。",
  notAllowed:
    "只有開發完成、尚未發布 PR 的任務可以和 Agent 協作；已發布的 PR 請到「PR 草稿」分頁使用「依回饋繼續修正」。",
  followUpRunning: "這個 PR 已有一輪修正在進行，請先完成或放棄它。",
  busy: "這份貢獻還有 Agent 或審查在進行；請等它完成再繼續對話。",
  byHandRefused: "在親手學裡，程式碼由你自己寫；有問題請問嚮導。",
  role: "協作對話",
  description: "和你協作修改程式碼與檢查",
  requested: ({ text }: { text: string }) => `對 Agent 提出協作要求：${text}`,
  notRunning: "目前沒有進行中的對話。",
  setupRequested: ({ count }: { count: number }) =>
    `請準備這台機器的環境：環境清單中的 ${count} 個項目，並重跑因此受阻的檢查。`,
  setupFullAccessOnly:
    "只有完整權限的任務能把環境準備交給 Agent。請自行執行指令，或以完整權限開始新貢獻。",
  setupNotListed: "這個環境項目已經不在這個任務的清單上，請重新載入後再選擇。",
  setupUnsafe: `${product.name} 不會把「下載後執行或串接」或「pipe 給 shell 或直譯器」的指令交給 Agent；請自行確認後執行。`,
  draftUpdated: "已更新 PR 草稿的驗證結果與剩餘限制。",
  stopped: "這輪對話已停止",
  failed: "這輪對話未完成",
  editsKept: ({ reason }: { reason: string }) =>
    `${reason.replace(/[.。]+$/u, "")}；已改到的檔案保留在工作目錄，請到「程式碼變更」檢查。`,
  waiting: "等待你的下一則訊息",
  interrupted: "這輪對話中斷",
  draftStale: "協作中有新的檢查或修改；請重新產生符合目前狀態的 PR 草稿建議。",
  editing: "Agent 正在這個工作目錄中作業；等這輪對話完成再審閱、編輯或發布 PR。",
  restarted:
    "服務重新啟動，這輪對話已中斷；Agent 已改的檔案保留在工作目錄，請到「程式碼變更」檢查後再繼續。",
};
