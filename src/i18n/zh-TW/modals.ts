/** Dialogs (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import type en from "../en/modals";

const m: Translation<typeof en> = {
  close: "關閉視窗",
  help: {
    title: "從想法，到你的下一個 PR。",
    subtitle: "四個步驟，把開發、審查與學習串在一起。",
    steps: {
      import: {
        title: "帶入 Repository",
        text: "匯入 GitHub 連結或本機路徑，選擇要貢獻的專案。",
      },
      team: {
        title: "指揮 Agent team",
        text: "清楚描述需求，讓規劃、開發與審查角色完成分工。",
      },
      understand: {
        title: "理解每個改動",
        text: "切換檔案閱讀 diff；點選行號，或按住 Shift 選擇一段程式碼，向 agent 提問。理解後勾選「已審閱」。",
      },
      submit: {
        title: "編輯並送出 PR",
        text: "調整標題與說明，儲存草稿，完成所有檔案審查後確認送出。",
      },
    },
    start: "開始探索",
  },
  runs: {
    title: "每一個想法，都有進度。",
    subtitle: "切換任務以查看開發狀態、程式碼變更與 PR 草稿。",
    demo: "互動示範",
    newContribution: "新增貢獻",
  },
  newTask: {
    title: "把想法交給你的 Agent team。",
    subtitle: "描述你想改善什麼，以及完成後應該有的行為。",
    repo: "目標 Repository",
    chooseRepo: "選擇 Repository",
    demoRepo: ({ name }) => `${name}（示範）`,
    importOther: "匯入其他專案",
    recommendations: "先看 AI 推薦方向",
    demoNote:
      "示範設定可以自由調整；不會啟動真實 agent。請匯入你的 repository 開始開發。",
    loadingSettings: "正在載入這個專案的貢獻設定…",
    reloadSettings: "重新載入專案設定",
    saveDefault: "儲存為預設設定",
    taskName: "任務名稱",
    taskPlaceholder: "例如：為 API client 加入智慧重試",
    goal: "這次想完成什麼？",
    goalPlaceholder: "描述需求、相關檔案、預期行為與驗收方式…",
    lead: "Team lead",
    teammates: ({ count }) => `${count} 位 Teammates`,
    reviewers: "Reviewer + Test analyst",
    usage: ({ provider }) =>
      `會使用本機 ${provider} 帳號執行任務，消耗對應用量。完成後等待你審查。`,
    saveDemo: "儲存示範方向",
    planFirst: "產生團隊計畫",
    start: "啟動 Agent team",
  },
};

export default m;
