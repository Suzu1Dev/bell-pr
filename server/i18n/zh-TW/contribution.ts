import type { Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/contribution.js";

const contribution: Translation<typeof en> = {
  prCap:
    "GitHub 限制每人在這個 repository 同時開著的 Pull Request 數量，你已達上限。請先完成或關閉一個，再發布一次。",
  testReasonShort: "每個理由至少要寫 3 個字，維護者才能查證。",
};

export default contribution;
