import type { Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/by-hand-guide.js";

const guide: Translation<typeof en> = {
  aboutYourChange: "這是關於你的變更；下一步請用「提示」。",
  rungTooHigh: "請依序一階一階地要這個步驟的提示。",
  canBeWrong: "嚮導也可能出錯。請拿程式碼與你的測試核對它指出的地方。",
};

export default guide;
