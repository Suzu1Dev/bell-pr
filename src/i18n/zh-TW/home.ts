/** The Home page (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import type en from "../en/home";

const m: Translation<typeof en> = {
  tagline: "和 AI 團隊一起貢獻開源，並理解你送出的每一行程式碼。",
  plan: {
    label: "你的方案",
    upgrade: "升級至 Pro",
  },
  start: {
    heading: "從這裡開始",
    sample: {
      title: "試試示範專案",
      text: "從 Agent team 的計畫到 PR 草稿，完整走一遍已完成的貢獻，不需任何設定。",
    },
    import: {
      title: "匯入 Repository",
      text: "帶入 GitHub 上的專案（owner/repo 或連結），或這台電腦上的 Git 資料夾。",
    },
    discover: {
      title: "找一個想貢獻的專案",
      text: "在 GitHub 上搜尋歡迎你這類協助的專案。",
      textFree: "Free 方案可看範例結果；搜尋 GitHub 需要 Pro 或 14 天試用。",
    },
  },
  setup: {
    heading: "你的環境",
  },
  continue: {
    heading: "從上次離開的地方繼續",
    lastOpened: "上次開啟",
    detail: ({ repo, status }) => (repo ? `${repo} · ${status}` : status),
  },
};

export default m;
