/** The agent team board (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/team";

const m: Translation<typeof en> = {
  legacy: {
    title: "這是舊版流程的任務",
    body: "新建立的任務會使用共享任務板、相依排程與每位隊友的獨立工作目錄。以下保留原本的執行紀錄。",
  },
  boardLabel: "共享任務與團隊訊息",
  eyebrow: "SHARED TASKS · INDEPENDENT CONTEXTS",
  title: "AI 團隊分工",
  intro: "Lead 拆解與整合，每位 teammate 有自己的工作目錄與上下文。",
  runtime: {
    demo: "團隊協作示範",
    engine: ({ provider }) => provider,
    capacity: ({ count }) => `最多 ${count} 位隊友同時工作`,
  },
  flow: {
    plan: "Lead 規劃",
    approve: "你核准計畫",
    autoApprove: "自動執行計畫",
    parallel: "隊友並行",
    integrate: "整合與審查",
  },
  queued: "等待開始",
  phase: {
    planning: "Lead 正在規劃",
    awaiting_approval: "等待你核准計畫",
    developing: "隊友協作中",
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
    previousTasks: ({ count, titles }) => `上一版有 ${count} 個子任務：${titles}`,
    feedback: "你的意見：",
    notes: "Lead 的調整說明：",
    replanning: "重新規劃中…",
    noNotes: "Lead 未說明調整內容；請直接比對新舊子任務。",
  },
  approval: {
    hint: "先查看各子任務的檔案範圍與相依，再允許寫入程式碼。",
    approve: "核准計畫並開始開發",
  },
  revise: {
    action: "退回並補充意見",
    hint: "拆解不合理、範圍太大、少了測試子任務或相依奇怪時，寫下原因，Lead 會重擬。這是練習「怎麼拆任務」的機會。",
    label: "退回計畫的意見",
    placeholder:
      "例如：把 API 與 UI 拆成兩個子任務，並加一個只負責測試的子任務。",
    limitReached: "已達重擬上限，請核准目前計畫或取消任務。",
    counter: ({ count, max }) =>
      `已重擬 ${count}/${max}。每次重擬會讓 Lead 再規劃一次，不會寫入程式碼。`,
  },
  retry: {
    partial: ({ kept, retried }) =>
      `${kept} 個已整合的子任務不會重跑。${retried} 個失敗或受阻的子任務會丟棄舊的工作目錄，從新的快照重新開始。`,
    integrationOnly:
      "所有子任務都已整合；重試只會重新執行 Lead 整合與獨立審查。",
    notStarted: "尚有未開始的子任務；若計畫尚未核准，重試會先回到等待核准。",
    label: "給重試子任務的補充說明",
    placeholder: "選填：給重試隊友的補充說明，會在第一回合送達",
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
  laneEmptyAwaiting: "你核准計畫後，子任務才會開始。",
  task: {
    details: "分工與檔案",
    worktree: "獨立工作目錄",
    worktreeRemoved: "獨立工作目錄已清理",
    filesPending: "規劃中",
    dependsOn: "相依",
    dependencyUnknown: "未知",
    readyAfterRetry: "重試後可執行",
    integrated: ({ files }) => `已整合：${files}`,
    showAll: "顯示完整說明",
    showLess: "收起說明",
    showError: "查看失敗原因",
    showReport: "查看工作報告",
    checks: ({ count }) =>
      `應用程式觀察到 ${count} 次指令執行（只有結束碼，未擷取輸出）。可與報告自述的檢查對照。`,
  },
  mailbox: {
    title: "團隊對話",
    delivery: {
      planning: "Lead 正在規劃。計畫產生後，即可向隊友補充指示。",
      leadDuringApproval: ({ action }) =>
        `要調整計畫，請用上方「${action}」讓 Lead 重擬。這裡的訊息只會在整合回合被讀到。`,
      lead: "Lead 會在下一次整合回合讀取訊息，不會重排計畫。開發指示請傳給全體成員或指定隊友。",
      members: "訊息在下一個工作回合送達。執行中的回合不會即時中斷。",
    },
    you: "你",
    everyone: "全體成員",
    queued: "等待下一回合",
    delivered: "已送達",
    sample: "示範",
    empty: "補充限制、詢問設計，或提醒隊友注意相依變更。",
    sendTo: "傳送給",
    recipientLabel: "團隊訊息收件人",
    teamLead: "Team lead",
    closedRecipient: ({ name }) => `${name}（已停止收件）`,
    messageLabel: "團隊訊息",
    messagesLabel: "團隊訊息列表",
    finishedPlaceholder: "此團隊已結束，請到「程式碼變更」分頁追問。",
    placeholder: "例如：請保留目前的 API 相容性…",
    demoHint: "示範訊息僅保留在畫面",
    hint: "傳送的訊息會保留在任務紀錄中",
    send: "傳送團隊訊息",
    unavailable: "這個子任務已停止收件，請選擇 Lead 或其他隊友。",
  },
  runDetails: {
    title: "執行細節",
    hint: "模型、思考強度與 AI 用量",
    calls: ({ count }) => `${count} 次 AI 呼叫`,
    tokens: ({ input, output, partial }) =>
      `輸入 ${input} · 輸出 ${output} tokens${partial ? "（部分回報）" : ""}`,
    unreported: "用量未回報",
  },
  setupNeeds: {
    title: "需要你在這台電腦準備的環境",
    intro:
      "Agent 以當時的權限與環境無法完成下列檢查。指令是 Agent 的建議，執行前請對照專案文件確認。裝好後，你可以在工作目錄重跑這些檢查，之後的貢獻也能直接執行。使用完整權限時，Agent 可以先嘗試安裝；需要密碼或它無法完成的項目仍由你處理。",
    reportedBy: ({ names }) => `回報者：${names}`,
    round: ({ number }) => `修正第 ${number} 輪`,
    agent: ({ name, id }) => `${name}（${id}）`,
    handOffAction: "讓 Agent 準備這些環境",
    handOffNote:
      "這個任務使用完整權限：Agent 可以在沒有沙箱的情況下用你的帳號安裝你選擇的項目，再重跑因此受阻的檢查。開始前你會先確認要交出的指令。",
    handOffUnsafe: `這個指令會下載後執行或串接其他指令，或以 pipe 交給 shell 或其他直譯器，${product.name} 不會把它交給 Agent；請自行確認後執行。`,
    allHandled:
      "Agent 回報可交給它的項目都已安裝或原本就有，詳細內容在「協作」分頁；這裡剩下的項目請自行執行。",
    outcomeLine: ({ outcome, time }) => `Agent 回報：${outcome}（${time}）`,
    unreportedLine: ({ time }) => `${time} 的環境準備沒有回報這一項的結果。`,
    resultsTitle: "環境準備結果（Agent 回報）",
    agentAccount: "Agent 的說明：",
    outcomes: {
      installed: "已安裝",
      present: "原本就有",
      failed: "安裝失敗",
      needsYou: "需要你處理",
      unreported: "沒有結果",
    },
    dialog: {
      title: "要讓 Agent 準備這台電腦的環境嗎？",
      intro:
        "這些指令是先前的 Agent 讀專案時提出的建議，請先確認。Agent 只會執行你勾選、且與專案文件相符的指令；它可以加上 -y 等非互動參數、以 sudo -n 執行 sudo、更新套件索引，但不會換成別的指令。之後它會確認每個項目、重跑因此受阻的檢查，並逐項回報。",
      choose: "要交給 Agent 的指令",
      sudoTag: "使用 sudo",
      limit: ({ limit }) => `每輪最多 ${limit} 項，其餘留在清單上，下一輪再處理。`,
      sudoPasswordless: ({ user }) =>
        `${user} 在這台電腦使用 sudo 不需要密碼，Agent 可以用 root 權限執行這些 sudo 指令；但若 sudo 規則限制了可以免密碼執行的指令，則以規則為準。`,
      sudoPassword: ({ user }) =>
        `${user} 在這台電腦使用 sudo 需要密碼，而 Agent 不會輸入密碼，因此需要 sudo 的項目會交回給你。若 sudo 規則允許某個指令免密碼執行，Agent 會改以 root 執行該指令。其餘請自行執行，或在模型設定開啟「免密碼 sudo」；開啟後，你帳號下的每個程式都能以 root 執行任何指令。`,
      sudoMissing: "這台電腦沒有安裝 sudo，需要 sudo 的項目會交回給你。",
      sudoUnknown: `${product.name} 無法確認這台電腦的 sudo 是否需要密碼。Agent 只會用 sudo -n 執行，遇到密碼提示就會停下，該項目交回給你。`,
      runs: "Agent 會在沒有沙箱的情況下用你的帳號執行。用量計入你自己的帳號。",
      review:
        "Agent 被要求不修改程式碼。它若變更檔案（例如安裝步驟改寫的 lockfile），該檔案會取消已審閱標記。檔案或 PR 草稿的 Validation、Limitations 有變動時，已核准的貢獻會退回審閱。",
      stop: "可以在「協作」分頁查看進度並停止。停止不會還原已安裝的內容。已經透過 sudo 開始的安裝也可能繼續完成。",
      confirm: ({ count }) => `開始處理（${count} 項）`,
      starting: "正在啟動 Agent…",
    },
  },
  guide: "嚮導",
  howItWorks: "運作方式",
  protocolNote: ({ provider }) =>
    `${product.name} 使用共享任務、獨立工作目錄及回合間訊息協作。這是由 ${provider} 逐回合驅動的 ${product.name} 實作，並非 Claude Code 原生 Agent Teams。`,
};

export default m;
