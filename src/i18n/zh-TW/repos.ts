/** Repositories (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
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
    delete: "刪除 Repository",
    deleteLabel: ({ name }) => `刪除 Repository：${name}`,
    deleteConfirm: ({ name }) =>
      `要從 ${product.name} 刪除 ${name} 嗎？它的貢獻、筆記與專案分析也會一併刪除。${product.name} 下載的副本會被移除；從這台電腦匯入的資料夾則保留在原處。`,
    deleteYes: "刪除",
    deleteNo: "保留",
    deleting: "正在刪除…",
    deleted: ({ name }) => `已刪除 ${name}。`,
  },
  explore: {
    eyebrow: "專案探索",
    intro: "先了解使用者與問題，再決定這次貢獻的方向。",
    chooseDirection: "指定貢獻方向",
  },
  import: {
    title: "帶入你的下一個貢獻。",
    subtitle: "貼上 GitHub 連結或 owner/repository，或本機 Git 專案的完整路徑。",
    source: "Repository 來源",
    placeholder: "owner/repository 或 https://github.com/owner/repository",
    localPathHint: ({ example }) => `也支援本機 Git 專案：貼上完整路徑，例如 ${example}`,
    callout:
      "GitHub 專案會下載至本機；後續開發使用獨立 worktree，保留原專案狀態。",
    later: "稍後再說",
    importing: "正在匯入…",
    import: "匯入 Repository",
    cloning: "正在複製…大型 Repository 可能需要幾分鐘。",
    sampleProgress: "正在匯入示範專案",
    sampleImported: ({ name }) => `已匯入示範專案 ${name}。`,
  },
};

export default m;
