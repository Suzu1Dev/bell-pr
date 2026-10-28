import type { Translation } from "../../../shared/i18n/locale";
import type en from "../en/session";

const messages: Translation<typeof en> = {
  "tab": "協作",
  "attention": "有待處理",
  "busy": "Agent 正在修改程式碼，完成後再操作。",
  "label": "和 Agent 協作",
  "empty": "說明你希望 Agent 做什麼，例如修正失敗的檢查或補上測試。Agent 會在這個工作尚未送出的工作目錄中修改程式碼並執行檢查；每一輪結束後，這裡會列出改動的檔案、實際執行的指令與它提出的問題。",
  "progress": "Agent 目前的進度",
  "working": "Agent 正在工作",
  "stop": "停止",
  "messageLabel": "傳給 Agent 的訊息",
  "blockedPlaceholder": "目前不能傳送訊息",
  "placeholder": "例如：補上失敗檢查的測試，或修正 lint 錯誤",
  "send": "送出訊息",
  "hint": "Enter 送出 · Shift + Enter 換行",
  "authors": {
    "user": "你",
    "agent": "Agent",
    "system": "系統"
  },
  "failed": "這一輪沒有完成",
  "loading": "正在載入內容…",
  "questions": "Agent 需要你回答",
  "changedFiles": "改動的檔案",
  "checks": "BELL 實際看到執行的指令",
  "notRun": "尚未執行的檢查",
  "draftUpdated": "已更新 PR 草稿的 Limitations",
  "draftUpdatedNote": "PR 說明裡的 Limitations 已改成這輪的結果；送出前請在「PR 草稿」分頁確認。",
  "compare": "查看更新前後",
  "before": "更新前",
  "after": "更新後",
  "setupAgent": "協作 Agent",
  "copied": "已複製指令。",
  "copyFailed": "無法複製指令。",
  "limitationsNotice": "PR 說明的 Limitations 寫著還有未完成或沒有驗證的項目。",
  "limitationsAction": "請 Agent 處理這些未完成的項目",
  "limitationsIntro": "PR 草稿的 Limitations 寫到以下項目尚未完成或沒有驗證，請在可以做到的範圍內補做（修正程式碼、補測試、執行檢查），做不到的請說明原因並問我需要什麼；做完後請一併更新 PR 草稿的 Limitations：\n\n",
  "blocks": {
    "running": "Agent 正在修改程式碼，完成後再操作。",
    "publishing": "正在送出 PR，完成後才能和 Agent 協作。",
    "published": "PR 已送出；之後的 review 回饋請在「PR 草稿」分頁用「依 review 修正」處理。",
    "ended": "這個工作已結束，不能再和 Agent 協作。",
    "active": "這個工作還有 Agent 或審查在進行；請等它完成再繼續對話。",
    "followUp": "這個 PR 已有一輪修正在進行，請先完成或放棄它。",
    "byHand": "親手學習由你修改程式碼；需要協助時請使用引導。"
  },
  elapsed: ({ seconds }: { seconds: number }) => `已執行 ${seconds} 秒`,
};

export default messages;
