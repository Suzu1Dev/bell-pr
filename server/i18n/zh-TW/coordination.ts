import type { Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/coordination.js";

/** 專案協調：檔案範圍的 claim、相依與整合。 */
const m: Translation<typeof en> = {
  store: {
    notSingleWriter:
      "協調需要由持有資料目錄鎖的這個行程執行，才能確保只有它寫入 claim。",
    missing:
      "協調檔不見了。系統不會因此當作沒有人持有 claim：請還原它，或重新設定協調。",
    exists: "這個資料目錄已經有協調檔。",
    damaged: "協調檔無法讀取或內容不一致，修好之前不會核發任何 claim。",
    unavailable: "寫入失敗後協調已停止。請重新啟動 BELL PR，讓它從磁碟重新讀回 claim。",
    full: "協調資料已沒有空間容納這項變更。已持有的 claim 仍可釋出、撤銷與整合。",
  },
  recovery: {
    undecided: ({ project }) =>
      `${project} 的一次整合被中斷，而整合分支已看不出它是否完成；在管理員結案之前，${project} 不接受任何變更。其他專案不受影響。`,
    nothingToSettle: "這個專案沒有等待結案的中斷整合。",
    stalePending: "這個專案等待結案的中斷整合與指定的不同。請重新讀取專案。",
    branchElsewhere: ({ current }) =>
      `整合分支位於 ${current}，既不是中斷整合的基底，也不是它的變更，因此無法結案。請先手動修復分支。`,
    branchUnreadable: "無法讀取整合分支，因此無法結案這次中斷的整合。",
  },
  participant: {
    unauthenticated: "這個請求沒有有效的參與者 token。",
    exists: ({ id }) => `參與者 ${id} 已存在。`,
    adminOnly: "只有協調管理員可以執行這個動作。",
  },
  invalidId: ({ id }) =>
    `「${id}」不是可用的 id：請用 1 到 64 個英文字母、數字、「.」、「_」或「-」，並以字母或數字開頭。`,
  project: {
    unknown: ({ project }) => `沒有 ${project} 這個專案。`,
    exists: ({ project }) => `專案 ${project} 已存在。`,
    invalidBaseline: "整合分支必須是某個 bare Git 儲存庫中已存在的分支。",
    branchTaken: "已有另一個專案整合到這個分支。",
  },
  task: {
    unknown: ({ task }) => `這個專案沒有 ${task} 這個任務。`,
    exists: ({ task }) => `這個專案已經有 ${task} 任務。`,
    closed: ({ task }) => `任務 ${task} 已整合或已失敗，不再接受新的 claim。`,
    claimed: ({ task }) => `任務 ${task} 已有一個有效的 claim。`,
    dependencyUnknown: ({ task }) => `這個任務相依的 ${task} 不存在。`,
    dependencyFailed: ({ task }) => `這個任務相依的 ${task} 已失敗，因此不能開始。`,
    dependencyPending: ({ task }) => `這個任務相依的 ${task} 還沒整合。`,
    notFailable: "只有持有該任務 claim 的人或管理員可以把它標為失敗。",
    notFailed: ({ task }) => `任務 ${task} 並未失敗，因此沒有可重開的內容：進行中的任務本來就是開啟的，已整合的任務則不會重開。`,
    tooManyDependencies: "一個任務最多相依 50 個其他任務。",
  },
  claim: {
    invalidScope: ({ scope }) =>
      `範圍「${scope}」無法可靠地和其他路徑比對，因此不能 claim。請使用儲存庫內、只含可列印 ASCII 字元的路徑。`,
    tooManyScopes: "一個 claim 最多 200 個範圍。",
    conflict: "這些範圍內有檔案已被其他有效的 claim 持有，因此沒有取得也沒有變更任何東西。",
    unknown: "這個專案沒有這個 claim。",
    ended: "這個 claim 已釋出、撤銷或整合，不再授權任何動作。",
    notHolder: "只有持有這個 claim 的參與者可以執行這個動作。",
    staleFence: "這份授權已過期：claim 的 fence 已改變，請重新讀取 claim。",
    outOfScope: ({ path }) => `${path} 不在這個 claim 的範圍內。`,
    unreliablePath: ({ path }) => `${path} 無法和 claim 比對，因此不接受。`,
  },
  integration: {
    invalidCommit: "請提供基底與變更的完整 commit id。",
    empty: "這個變更在基底之上沒有任何 commit。",
    unknownCommit: "整合儲存庫裡沒有這個 commit。",
    notFastForward: "這個變更不是建立在預期的基底上。",
    mergeCommit: "這個變更含有 merge commit；請整合線性的 commit 序列。",
    tooManyCommits: "這個變更超過 200 個 commit；請分成較小的部分整合。",
    staleBase: ({ current }) =>
      `整合分支已前進到 ${current}。請先把你的變更同步到它上面再試一次。`,
    baselineMoved: "整合分支在協調之外被修改，在有人檢查之前不會整合任何變更。",
    branchBusy: "整合分支目前無法更新，因此沒有整合任何變更。請再試一次。",
    needsManualHandling: ({ path }) =>
      `${path} 需要人工處理：協調不會整合秘密檔、符號連結、子模組或其他特殊檔案。`,
    unreadableChange: "無法可靠地讀出這個變更動到的檔案，因此沒有整合任何變更。",
  },
};
export default m;
