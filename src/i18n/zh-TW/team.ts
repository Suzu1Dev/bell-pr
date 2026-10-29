/** The agent team board (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/team";

const m: Translation<typeof en> = {
  legacy: {
    title: "這是舊版流程的任務",
    body: "新建立的任務會使用共享任務板、相依排程與獨立 teammate 工作目錄。以下保留原本的執行紀錄。",
  },
  boardLabel: "共享任務與團隊訊息",
  eyebrow: "SHARED TASKS · INDEPENDENT CONTEXTS",
  title: "一起開發，有分工也有對話。",
  intro: "Lead 拆解與整合，每位 teammate 有自己的工作目錄與上下文。",
  runtime: {
    demo: "團隊協作示範",
    engine: ({ provider }) => `${provider} · ${product.name} 協作引擎`,
    capacity: ({ count }) => `最多 ${count} 位成員同時工作`,
  },
  flow: {
    plan: "Lead 規劃",
    approve: "你確認計畫",
    autoApprove: "自動執行計畫",
    parallel: "Teammates 並行",
    integrate: "整合與審查",
  },
  queued: "等待開始",
  phase: {
    planning: "Lead 正在規劃",
    awaiting_approval: "等待你確認開發計畫",
    developing: "Teammates 協作中",
    integrating: "Lead 整合中",
    reviewing: "交叉審查中",
    complete: "團隊工作已完成",
    failed: "需要處理執行問題",
    cancelled: "團隊已停止",
  },
  progress: ({ done, total }) => `${done} / ${total} 子任務完成`,
  plan: {
    queued: "任務正在排隊；輪到執行時，Lead 會立即開始規劃。",
    replanning: "Lead 正依你的意見重新規劃。",
    none: "Lead 完成計畫前，團隊就已停止。",
    reading: "正在閱讀專案並建立有明確範圍與相依關係的計畫。",
    showAll: "顯示完整計畫",
    showLess: "收起計畫",
  },
  revisions: {
    label: "計畫重擬紀錄",
    title: ({ number }) => `第 ${number} 次退回`,
    previousTasks: ({ count, titles }) => `上一版有 ${count} 個任務：${titles}`,
    feedback: "你的意見：",
    notes: "Lead 的調整說明：",
    replanning: "重新規劃中…",
    noNotes: "Lead 未說明調整內容；請直接比對新舊任務。",
  },
  approval: {
    hint: "先查看各任務的檔案範圍與相依，再允許寫入程式碼。",
    approve: "確認計畫並開始開發",
  },
  revise: {
    action: "退回並補充意見",
    hint: "拆解不合理、範圍太大、少了測試任務或相依奇怪時，寫下原因讓 Lead 重擬；這是練習「怎麼拆任務」的機會。",
    label: "退回計畫的意見",
    placeholder:
      "例如：把 API 與 UI 拆成兩個任務，並加一個只負責測試的任務。",
    limitReached: "已達重擬上限，請核准目前計畫或取消工作。",
    counter: ({ count, max }) =>
      `已重擬 ${count}/${max}；每次重擬是一次 Lead 唯讀規劃回合`,
  },
  retry: {
    partial: ({ kept, retried }) =>
      `${kept} 個已整合的子任務不會重跑；${retried} 個失敗或被阻擋的子任務會丟棄舊的隔離目錄，從新的快照重新開始。`,
    integrationOnly:
      "所有子任務都已整合；重試只會重新執行 Lead 整合與獨立審查。",
    notStarted: "尚有未開始的子任務；若計畫尚未核准，重試會先回到等待核准。",
    label: "給重試任務的補充說明",
    placeholder: "選填：給重試成員的補充說明，會在第一回合送達",
    action: "重試失敗的子任務",
  },
  lanes: {
    todo: "待處理",
    running: "進行中",
    done: "已完成",
  },
  laneEmpty: {
    todo: "目前沒有等待中的子任務",
    running: "目前沒有正在執行的子任務",
    done: "還沒有完成的子任務",
  },
  laneEmptyPlanning: "Lead 的計畫完成後，子任務會出現在這裡。",
  laneEmptyAwaiting: "你確認計畫後，子任務才會開始。",
  task: {
    worktree: "獨立 worktree",
    worktreeRemoved: "獨立 worktree 已清理",
    filesPending: "規劃中",
    dependsOn: ({ tasks }) => `先完成 ${tasks}`,
    integrated: ({ files }) => `已整合：${files}`,
    showAll: "顯示完整說明",
    showLess: "收起說明",
    showError: "查看失敗原因",
    showReport: "查看工作報告",
    checks: ({ count }) =>
      `應用程式觀察到 ${count} 次指令執行（只有結束碼，未擷取輸出；可與報告自述的檢查對照）`,
  },
  mailbox: {
    title: "團隊對話",
    delivery: {
      planning: "Lead 正在規劃。計畫產生後，即可向成員補充指示。",
      leadDuringApproval: ({ action }) =>
        `要調整計畫，請用上方「${action}」讓 Lead 重擬；這裡的訊息只會在整合回合被讀到。`,
      lead: "Lead 會在下一次整合回合讀取訊息，不會重排計畫；開發指示請傳給全體成員或指定隊友。",
      members: "訊息在下一個工作回合送達；執行中的回合不會即時中斷。",
    },
    you: "你",
    everyone: "全體成員",
    queued: "等待下一回合",
    delivered: "已送達",
    sample: "示範",
    empty: "補充限制、詢問設計，或提醒成員注意相依變更。",
    sendTo: "傳送給",
    recipientLabel: "團隊訊息收件人",
    teamLead: "Team lead",
    closedRecipient: ({ name }) => `${name}（已停止收件）`,
    messageLabel: "團隊訊息",
    messagesLabel: "團隊訊息列表",
    finishedPlaceholder: "此團隊已結束，可在程式碼閱讀區追問。",
    placeholder: "例如：請保留目前的 API 相容性…",
    demoHint: "示範訊息僅保留在畫面",
    hint: "傳送會留存在任務記錄",
    send: "傳送團隊訊息",
    unavailable: "這個任務已停止收件，請選擇 Lead 或其他成員。",
  },
  runDetails: {
    title: "執行細節",
    hint: "模型、推理強度與 AI 用量",
    calls: ({ count }) => `${count} 次 AI 呼叫`,
    tokens: ({ input, output, partial }) =>
      `輸入 ${input} · 輸出 ${output} tokens${partial ? "（部分回報）" : ""}`,
    unreported: "用量未回報",
  },
  setupNeeds: {
    title: "需要你在這台機器準備的環境",
    intro:
      "Agent 在目前權限與環境下仍無法完成下列檢查。完整權限模式允許 Agent 先嘗試必要的安裝；需要密碼或其他無法完成的設定仍由你處理。指令是 Agent 的建議，執行前請對照專案文件確認；裝好後可以自己在工作目錄重跑這些檢查，之後的貢獻也能直接執行。",
    reportedBy: ({ names }) => `回報者：${names}`,
    round: ({ number }) => `修正第 ${number} 輪`,
    agent: ({ name, id }) => `${name}（${id}）`,
  },
  guide: "嚮導",
  howItWorks: "運作方式",
  protocolNote: ({ provider }) =>
    `${product.name} 使用共享任務、獨立工作目錄及回合間訊息協作。這是由 ${provider} 逐回合驅動的 ${product.name} 實作，並非 Claude Code 原生 Agent Teams。`,
};

export default m;
