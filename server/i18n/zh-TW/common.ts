import type { Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/common.js";

const m: Translation<typeof en> = {
  cancelled: "工作已取消。",
  shuttingDown: "服務正在關閉，請稍後重試。",
  notFound: "找不到 API。",
};
export default m;
