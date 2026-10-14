/** The PR draft tab's panels (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import type en from "../en/draft";

const m: Translation<typeof en> = {
  sync: {
    title: "目標分支",
    intro: {
      published: ({ branch, commit }) =>
        `這個貢獻以 ${branch} 的 ${commit} 為基準。同步會把最新版本合併進 PR：審閱後推送一個合併 commit，不會 force push，PR 說明也不變。`,
      unpublished: ({ branch, commit }) =>
        `這個貢獻以 ${branch} 的 ${commit} 為基準。同步會把這次的修改移到最新版本上；目標分支改過的檔案需要重新審閱，可以復原。`,
    },
    lastSync: ({ from, to, date }) => `上次同步：${from} 到 ${to}，${date}`,
    waitConflicts: "上一次同步的衝突解決前不能再同步。",
    waitStatus:
      "只有審閱中、已核准或等待計畫核准的工作可以同步到最新目標分支。",
    roundOpen: "這個 PR 有一輪修正在進行；完成或放棄後才能同步。",
    sync: "同步到最新目標分支",
    undo: "復原同步",
    conflicts: "合併衝突",
    resolved: "已解決",
    conflictHelp: {
      published: ({ latest, ours }) =>
        `檔案裡標示 ${latest} 的一邊是目標分支現在的內容，標示 ${ours} 的一邊是這個 PR。衝突標記全部移除前不能核准；可以在工作目錄自己改，改完到「程式碼變更」重新整理差異，或請 Agent 解決。改過的檔案仍要逐檔審閱。`,
      unpublished: ({ latest, ours }) =>
        `檔案裡標示 ${latest} 的一邊是目標分支現在的內容，標示 ${ours} 的一邊是這次的貢獻。衝突標記全部移除前不能核准；可以在工作目錄自己改，改完到「程式碼變更」重新整理差異，或請 Agent 解決。改過的檔案仍要逐檔審閱。`,
    },
    allResolved: "衝突標記都已移除；改過的檔案仍要逐檔審閱。",
    resolving: "Agent 正在解衝突…",
    resolve: "請 Agent 解決衝突",
  },
  followUps: {
    title: "依 review 修正的紀錄",
    intro:
      "每一輪經你審閱、核准後，會成為 PR 分支上的一個新 commit；PR 標題與說明維持原樣，回覆 reviewer 仍由你在 GitHub 上處理。",
    status: {
      running: "修正中",
      review: "等待審閱與推送",
      published: "已推送",
      failed: "沒有完成",
      cancelled: "已停止",
      discarded: "已放棄",
    },
    round: ({ number }) => `第 ${number} 輪`,
    adopted: "接續 GitHub 上的提交",
    syncRound: "同步目標分支",
    yourNote: "你的補充說明",
    feedback: "回饋",
    note: ({ note }) => `補充說明：${note}`,
    conflicts: "合併衝突",
    addressed: "已處理",
    notAddressed: "沒有修改，需要你判斷",
    checks: "實際執行的指令",
    pushed: ({ commit, date }) => `${commit} 已推送 ${date}`,
    notPushed: ({ commit }) => `${commit} 已建立，尚未確認推送`,
    discard: "放棄這輪修改",
  },
};

export default m;
