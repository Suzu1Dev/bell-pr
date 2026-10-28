export default {
  name: "協作夥伴",
  emptyMessage: "請輸入要請 Agent 處理的內容。",
  notAllowed:
    "只有開發完成、尚未送出 PR 的工作可以和 Agent 協作；已送出的 PR 請用「依 review 修正」。",
  followUpRunning: "這個 PR 已有一輪修正在進行，請先完成或放棄它。",
  busy: "這個工作還有 Agent 或審查在進行；請等它完成再繼續對話。",
  byHandRefused: "親手練習模式由你撰寫程式碼；有問題請向引導 Agent 提問。",
  role: "協作對話",
  description: "和你協作修改程式碼與檢查",
  requested: ({ text }: { text: string }) => `對 Agent 提出協作要求：${text}`,
  notRunning: "目前沒有進行中的對話。",
  limitationsUpdated: "已依這輪結果更新 PR 草稿的 Limitations。",
  stopped: "這輪對話已停止",
  failed: "這輪對話未完成",
  editsKept: ({ reason }: { reason: string }) =>
    `${reason}；已改到的檔案保留在工作目錄，請到「檔案變更」檢查。`,
  waiting: "等待你的下一則訊息",
  interrupted: "這輪對話中斷",
  draftStale: "協作中有新的檢查或修改；請重新產生符合目前狀態的 PR 草稿建議。",
  editing: "Agent 正在修改程式碼；等這輪對話完成再審閱、編輯或送出 PR。",
  restarted:
    "服務重新啟動，這輪對話已中斷；Agent 已改的檔案保留在工作目錄，請到「檔案變更」檢查後再繼續。",
};
