import type { Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/common.js";

const bin = product.binNames[0];

const m: Translation<typeof en> = {
  cancelled: "工作已取消。",
  shuttingDown: "服務正在關閉，請稍後重試。",
  notFound: "找不到 API。",
  invalidJson: "JSON 格式不正確。",
  payloadTooLarge: "請求內容過大。",
  internalError: "操作未完成；請檢查本機服務記錄。",
  hostNotAllowed: "不允許此服務網址。",
  crossOriginNotAllowed: "不允許跨來源請求。",
  jsonRequired: "變更操作必須使用 application/json。",
  apiTokenRequired: `這個請求需要這份 ${product.name} 的 API 權杖。請在這台電腦執行 \`${bin} open\` 開啟帶有權杖的頁面，或以 Authorization: Bearer <token> 或 X-Bell-Token 標頭送出。`,
  unsupportedProvider: "不支援這個 Agent 類型。",
};
export default m;
