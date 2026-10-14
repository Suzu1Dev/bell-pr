import type { Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/storage.js";

const m: Translation<typeof en> = {
  store: {
    dataDirOwner: ({ path }) =>
      `資料目錄 ${path} 屬於另一個使用者。請以該使用者啟動 ${product.name}，或用 --data-dir 指定你自己的資料目錄。`,
  },
};
export default m;
