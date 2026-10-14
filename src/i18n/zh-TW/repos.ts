/** Repositories (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import type en from "../en/repos";

const m: Translation<typeof en> = {
  list: {
    eyebrow: "你的專案",
    title: "下一個貢獻，從這裡開始。",
    intro: "帶入你在意的專案，讓想法成為真正的改動。",
    import: "匯入 Repository",
    discoveryTitle: "還沒決定要貢獻哪個專案？",
    discoveryText: "讓 AI 從 GitHub 找出有需求、適合你起步的開發機會。",
    discoveryAction: "推薦貢獻項目",
    demoBadge: "示範專案",
    imported: "已匯入",
    demoDescription: "透過 SDK 智慧重試的範例，體驗一次完整的貢獻與審查。",
    languageFallback: "Git repository",
    openDemo: "探索示範工作台",
    explore: "了解專案與貢獻方向",
    addTitle: "加入你的 Repository",
    addText: "GitHub 連結或本機 Git 專案",
  },
  explore: {
    eyebrow: "專案探索",
    intro: "先了解使用者與問題，再決定這次貢獻的方向。",
    chooseDirection: "指定貢獻方向",
  },
  import: {
    title: "帶入你的下一個貢獻。",
    subtitle: "貼上 GitHub 連結，或選擇本機 Git 專案的完整路徑。",
    source: "Repository 來源",
    localPathHint: "也支援 /Users/你的名稱/projects/repository",
    callout:
      "GitHub 專案會下載至本機；後續開發使用獨立 worktree，保留原專案狀態。",
    later: "稍後再說",
    importing: "正在匯入…",
    import: "匯入 Repository",
  },
};

export default m;
