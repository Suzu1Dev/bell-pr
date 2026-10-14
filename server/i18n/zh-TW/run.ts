import type { Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/run.js";

const m: Translation<typeof en> = {
  publish: {
    commitMessageInvalid: "提交訊息只能包含文字與換行。",
    invalidBranch:
      "GitHub 分支名稱只能用英數字與 . _ - /，不能有 ..，也不能以 . 或 .lock 結尾。",
  },
};
export default m;
