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
};

export default m;
