/** Repositories (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/repos";

const m: Translation<typeof en> = {
  list: {
    title: "專案",
    intro: "開啟已匯入的專案，或加入新專案。",
    import: "匯入專案",
    discoveryTitle: "還沒決定要貢獻哪個專案？",
    discoveryText: "讓 AI 從 GitHub 找出有需求、適合你起步的開發機會。",
    discoveryAction: "尋找貢獻項目",
    demoBadge: "示範專案",
    imported: "已匯入",
    demoDescription: "透過 SDK 智慧重試的示範，體驗一次完整的貢獻與審查。",
    languageFallback: "Git 專案",
    openDemo: "開啟示範工作台",
    explore: "開啟專案",
    addTitle: "匯入專案",
    addText: "GitHub 連結或本機 Git 專案",
    delete: "刪除專案",
    deleteLabel: ({ name }) => `刪除專案：${name}`,
    deleteConfirm: ({ name }) =>
      `要從 ${product.name} 刪除 ${name} 嗎？貢獻、筆記與分析也會刪除。下載的副本會移除；本機匯入的資料夾會保留。`,
    deleteYes: "刪除",
    deleteNo: "保留",
    deleting: "正在刪除…",
    deleted: ({ name }) => `已刪除 ${name}。`,
  },
  explore: {
    intro: "先了解使用者與問題，再決定這次貢獻的方向。",
    chooseDirection: "指定貢獻方向",
  },
  import: {
    title: "匯入專案",
    subtitle: "從 GitHub 或這台電腦匯入。",
    source: "專案來源",
    placeholder: "owner/repository 或 https://github.com/owner/repository",
    localPathHint: ({ example }) =>
      `貼上 GitHub 連結、owner/repository，或本機 Git 專案的完整路徑，例如 ${example}`,
    wslPathHint: `若 ${product.name} 在這台電腦的 WSL2 中執行，請使用 Linux 路徑，例如 Windows 資料夾是 /mnt/c/projects/repository。`,
    callout:
      "GitHub 專案會下載到這台電腦。之後的開發在獨立的工作目錄（Git worktree）進行，原專案維持原狀。",
    later: "稍後再說",
    importing: "正在匯入…",
    import: "匯入專案",
    cloning: "正在複製…大型專案可能需要幾分鐘。",
    sampleProgress: "正在匯入示範專案",
    sampleImported: ({ name }) => `已匯入示範專案 ${name}。`,
  },
};

export default m;
