import type { Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/storage.js";

const m: Translation<typeof en> = {
  store: {
    dataDirOwner: ({ path }) =>
      `資料目錄 ${path} 屬於另一個使用者。請以該使用者啟動 ${product.name}，或用 --data-dir 指定你自己的資料目錄。`,
  },
  recovery: {
    publishingInterrupted: "發布中斷了。請先到 GitHub 確認狀態，再重新發布。",
    resumed: "服務重新啟動；這個排隊中的工作重新開始。",
    retryPlanning: "重試這個工作：Lead 會重新規劃任務。",
  },
};
export default m;
