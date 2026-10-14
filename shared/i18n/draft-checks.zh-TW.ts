/** PR text check messages (Traditional Chinese, Taiwan); typed against the English copy. */
import type { Translation } from "./locale.js";
import type en from "./draft-checks.en.js";

const messages: Translation<typeof en> = {
  placeholder: ({ count }) =>
    `PR 說明還有 ${count} 處待填寫的內容。這段文字會原樣送到 GitHub；請改成目前的事實或刪除，待辦事項留在核對清單。若是在描述 TODO 註解或檔案本身，請用反引號包起來，例如 \`TODO\`。`,
  placeholderLine: ({ line, text }) => `第 ${line} 行：「${text}」`,
  unchecked:
    "這些段落的勾選項目全部沒有勾，會原樣送出。專案的範本或自動檢查可能要求勾選；只勾你真正完成或確認的項目。",
  uncheckedSection: ({ heading, count }) => `${heading}：${count} 項都未勾`,
  noHeading: "（無標題）",
  issue: "專案規範要求 PR 連結既有的 issue，這份說明沒有引用任何 issue。",
  ruleQuote: ({ label, quote }) => `${label}：「${quote}」`,
  brevityUnrevised:
    "這份說明仍是未改寫的 BELL 建議原文，而專案要求用自己的話寫簡短的說明。",
  brevityOver: ({ words, budget }) =>
    `這份說明約 ${words} 字，超過 BELL 建議的 ${budget} 字；專案要求簡短的說明。`,
};

export default messages;
