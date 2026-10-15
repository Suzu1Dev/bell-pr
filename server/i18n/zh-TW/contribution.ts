import type { Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/contribution.js";

const contribution: Translation<typeof en> = {
  prCap:
    "GitHub 限制了一個人在這個 repository 同時開著的 Pull Request 數量，而你已經到上限了。請先完成或關閉一個你在這裡開著的 Pull Request，再發布一次。",
  testReasonShort: "每個理由至少要寫 3 個詞，維護者才能查證。",
};

export default contribution;
