import type { Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/common.js";

const bin = product.binNames[0];

const m: Translation<typeof en> = {
  cancelled: "工作已取消。",
  shuttingDown: "服務正在關閉，請稍後重試。",
  notFound: "找不到 API。",
  invalidJson: "請求內容不是有效的 JSON。",
  payloadTooLarge: "請求內容過大。",
  internalError: "操作未完成；請檢查本機服務記錄。",
  hostNotAllowed: `${product.name} 不接受這個位址。請用啟動位址（\`${bin} open\` 可再印出），或設定 BELLPR_PUBLIC_URL 改用其他位址。`,
  crossOriginNotAllowed: "不允許跨來源請求。",
  jsonRequired: "變更操作必須使用 application/json。",
  apiTokenRequired: `缺少這份 ${product.name} 的 API token。在這台電腦執行 \`${bin} open\` 會帶 token 開啟；API 用戶端請以 Authorization: Bearer <token> 或 X-Bell-Token 標頭送出。`,
  unsupportedProvider: "不支援這個 AI 服務。",
  suite: {
    summary: "貢獻與審查",
    untitled: "未命名的任務",
    detail: {
      followUpRunning: "一輪修正進行中",
      followUpReady: "一輪修正等你處理",
      byHandPlan: "輪到你：寫下計畫",
      planReady: "計畫等你核准",
      byHandChange: "輪到你：動手修改",
      review: "等你審閱",
      publishing: "發布中",
      approved: "已核准，尚未發布",
      failed: "執行失敗",
      queued: "等待執行",
      running: "進行中",
    },
  },
};
export default m;
