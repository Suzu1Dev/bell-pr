import { formatters, type Translation } from "../../../shared/i18n/locale";
import type en from "../en/learning";

const fmt = formatters("zh-TW");

const m: Translation<typeof en> = {
  eyebrow: "LEARN BY CONTRIBUTING",
  title: "讓看懂的程式碼，成為你的經驗。",
  intro: "每個任務審查時產生的解說都會留在這裡，可以跨任務回顧同一個觀念。",
  keyword: "關鍵字",
  keywordPlaceholder: "搜尋觀念、提示、檔案或任務",
  run: "任務",
  allRuns: "全部任務",
  noteCount: ({ visible, total }) =>
    `${fmt.number(visible)} / ${fmt.number(total)} 則筆記`,
  noRealNotes: "尚無真實任務的筆記",
  emptyTitle: "還沒有屬於你的學習筆記",
  emptyBody:
    "先在「Repositories」頁匯入 repository 並建立任務；進入審查後，每個檔案的解說會自動彙整到這裡。",
  noMatches: "沒有符合篩選條件的筆記。",
  demoTitle: "示範筆記",
  demoTag: "示範",
  demoIntro: "來自內建示範任務的解說，用來預覽真實筆記的樣子。",
  tip: "提示",
  noteRun: "任務",
  generatedAt: "產生時間",
  sampleContent: "示範內容",
  notRecorded: "未記錄",
  openInCode: "回到程式碼理解它",
};

export default m;
