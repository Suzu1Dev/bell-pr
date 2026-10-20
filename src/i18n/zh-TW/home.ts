/** The Home page (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import type en from "../en/home";

const m: Translation<typeof en> = {
  tagline: "從「憑感覺寫」到「知道為什麼」。",
  start: {
    heading: "從這裡開始",
    sample: {
      title: "試試示範專案",
      text: "完整走一遍已完成的貢獻：專案的規範、Agent 團隊的計畫、用自己的話把改動講一遍，以及 PR 草稿。不需任何設定。",
    },
    import: {
      title: "匯入 Repository",
      text: "帶入 GitHub 上的專案（owner/repo 或連結），或這台電腦上的 Git 資料夾。",
    },
    discover: {
      title: "找一個想貢獻的專案",
      text: "在 GitHub 上搜尋歡迎你這類協助的專案。",
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
