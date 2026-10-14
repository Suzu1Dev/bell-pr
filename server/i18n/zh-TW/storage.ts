import {
  intlLocale,
  type Translation,
} from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/storage.js";

/** 磁碟大小，例如「12.3 MB」；不到 1 kB 也以 kB 表示。 */
const size = (bytes: number) => {
  const units = ["kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return new Intl.NumberFormat(intlLocale("zh-TW"), {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value);
};

const m: Translation<typeof en> = {
  store: {
    dataDirOwner: ({ path }) =>
      `資料目錄 ${path} 屬於另一個使用者。請以該使用者啟動 ${product.name}，或用 --data-dir 指定你自己的資料目錄。`,
  },
  recovery: {
    publishingInterrupted: "發布中斷了。請先到 GitHub 確認狀態，再重新發布。",
    resumed: "服務重新啟動；這個工作已重新排隊。",
    retryPlanning: "重試這個工作：Lead 會重新規劃任務。",
  },
  workspace: {
    removed: "為了釋出磁碟空間，這個工作的檔案已清除。報告與筆記仍保留。",
    removedPublished:
      "為了釋出磁碟空間，這個工作的檔案已移除，因此無法再在這裡同步它的 Pull Request 或進行後續修改回合。報告與筆記仍保留。請直接在 GitHub 上更新 Pull Request 的分支。",
    removedLog: ({ bytes }) =>
      `已移除這個工作的工作檔案，釋出 ${size(bytes)}；報告、筆記與解說仍保留。`,
    retentionLog: ({ bytes, days }) =>
      `這個工作結束 ${days} 天後已移除工作檔案，釋出 ${size(bytes)}；報告、筆記與解說仍保留。`,
    busy: "這個工作仍在進行中。請先停止或等它完成，再試一次。",
    outsideData: `這個工作的工作目錄不在 ${product.name} 的資料目錄內，因此不會移除。`,
  },
  repos: {
    busy: "這個專案仍有工作在進行中。請先停止或等它完成，再刪除專案。",
  },
  erase: {
    confirm: "請輸入 ERASE，確認要刪除所有資料。",
    busy: "仍有工作在進行中。請先停止所有工作與探索搜尋，再刪除所有資料。",
  },
  learning: {
    invalidCursor: "這一頁學習筆記已過期，請重新載入清單。",
  },
};
export default m;
