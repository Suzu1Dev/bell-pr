/** Dialogs (Traditional Chinese, Taiwan). */
import { formatters, type Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/modals";

const fmt = formatters("zh-TW");

const m: Translation<typeof en> = {
  close: "關閉視窗",
  split: {
    title: "拆分為不同的貢獻",
    subtitle: "讓每個 PR 只包含一項修正，方便維護者獨立審查。",
    creates: "每份貢獻會從同一個基底 commit 建立自己的分支、檔案與 PR 草稿。",
    original: "這份貢獻會維持原樣，並標記為已拆分。",
    filesOnly: "一個檔案只歸一份貢獻，同一檔案裡的修正無法分開。",
    testEach: `${product.name} 無法確認各部分能否獨立運作。發布前，請分別執行每份貢獻的測試。`,
    contribution: ({ number }) => `貢獻 ${number}`,
    titleLabel: ({ number }) => `貢獻 ${number} 的標題`,
    add: "新增一份貢獻",
    remove: ({ number }) => `移除貢獻 ${number}`,
    goesTo: ({ path }) => `${path} 的貢獻`,
    leaveOut: "只留在原本那份",
    titlePlaceholder: "這份貢獻的標題",
    empty: "還沒有檔案。請用每個檔案旁的選單把檔案移到這裡。",
    leftOutTitle: "只留在原本那份",
    blocked: ({ reason }) => `這個檔案目前無法審閱，因此無法移動：${reason}`,
    summary: ({ contributions, leftOut }) => `${contributions} 份貢獻；${leftOut} 個檔案只留在原本那份。`,
    pathLimit: ({ count }) => `每份貢獻最多可分配 ${count} 個檔案。`,
    suggestionLimit: ({ count }) => `僅預先分配前 ${count} 個部分。請分配其餘檔案，或讓它們只留在原本那份。`,
    mixed: ({ paths, issues }) =>
      `${fmt.list(paths, { type: "unit" })} 含有 ${fmt.list(issues, { type: "unit" })} 的變更，${product.name} 無法拆開檔案。請自行拆分，或維持在同一份。`,
    linked: ({ issues }) =>
      `計畫把 ${fmt.list(issues, { type: "unit" })} 的任務連成同一部分。能獨立運作的修正可移到自己的一份貢獻。`,
    submit: "拆分",
    submitting: "拆分中…",
  },
  help: {
    teamGuide: "AI 團隊如何分工",
    title: "如何完成一次貢獻",
    subtitle: "四個步驟，把開發、審查與學習串在一起。",
    steps: {
      import: {
        title: "匯入專案",
        text: "匯入 GitHub 連結或本機路徑，選擇要貢獻的專案。",
      },
      team: {
        title: "指揮 Agent team",
        text: "清楚描述需求，讓規劃、開發與審查角色完成分工。",
      },
      understand: {
        title: "理解每個變更",
        text: "閱讀每個差異；點選行號或按住 Shift 選取一段，向 Agent 提問。理解後勾選「已審閱」。",
      },
      submit: {
        title: "編輯並發布 PR",
        text: "調整標題與說明，儲存草稿，審閱完所有檔案後確認發布。",
      },
    },
    start: "開始探索",
    about: `關於 ${product.name}`,
  },
  runs: {
    title: "貢獻清單",
    subtitle: "切換貢獻，查看狀態、程式碼變更與 PR 草稿。",
    demo: "互動示範",
    newContribution: "新增貢獻",
    freeSpace: "釋放磁碟空間",
    freeSpaceLabel: ({ title }) => `釋放磁碟空間：${title}`,
    freeConfirm: `要移除這項貢獻的 Git worktree、隊友的工作目錄，以及 ${product.name} 專案副本中的分支嗎？貢獻、筆記與解說會保留，但無法再顯示變更。`,
    freeConfirmPublished: `要移除這項已發布貢獻的 Git worktree、隊友的工作目錄，以及 ${product.name} 專案副本中的分支嗎？之後無法再做一輪修正或同步。貢獻、筆記與解說會保留。`,
    freeYes: "釋放磁碟空間",
    filesRemoved: "檔案已移除",
    deleteRun: "刪除貢獻",
    deleteRunLabel: ({ title }) => `刪除貢獻：${title}`,
    deleteConfirm: "要刪除這項貢獻，以及它的筆記與工作檔案嗎？刪除後無法復原。",
    deleteYes: "刪除貢獻",
    working: "處理中…",
    activeHint: "請先停止這項貢獻，再釋放空間或刪除。",
    freed: "已釋放磁碟空間。貢獻與筆記都會保留。",
    deleted: "已刪除這項貢獻。",
  },
  newTask: {
    title: "新增貢獻",
    subtitle: "描述你想改善什麼，以及完成後應該有的行為。",
    repo: "目標專案",
    chooseRepo: "選擇專案",
    demoRepo: ({ name }) => `${name}（示範）`,
    importOther: "匯入其他專案",
    recommendations: "先看 AI 推薦方向",
    demoNote:
      "設定可任意試，不會啟動真實 Agent，示範團隊會重播任務。匯入專案即可開發。",
    loadingSettings: "正在載入這個專案的貢獻設定…",
    reloadSettings: "重新載入專案設定",
    saveDefault: "儲存為預設設定",
    taskName: "任務名稱",
    taskPlaceholder: "例如：為 API client 加入智慧重試",
    goal: "這次想完成什麼？",
    goalPlaceholder: "描述需求、相關檔案、預期行為與驗收方式…",
    usage: ({ provider }) =>
      `使用本機已登入的 ${provider} CLI，用量計入該帳號。完成後等你審閱。`,
    saveDemo: "播放示範團隊",
    planFirst: "產生團隊計畫",
    start: "開始任務",
  },
};

export default m;
