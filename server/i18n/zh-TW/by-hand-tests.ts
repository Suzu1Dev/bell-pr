import type { Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/by-hand-tests.js";

const tests: Translation<typeof en> = {
  noCommand: "請先為這個專案確認一個測試指令。",
  running: "你的測試正在執行。請等它跑完，或先停止它。",
  notNow: "測試在變更等待你審閱時才能執行；規劃中或發布中不行。",
  commandInvalid: "請把測試指令寫成一行，不要包含控制字元。",
  tooMuchOutput: ({ megabytes }) =>
    `你的測試輸出超過 ${megabytes} MB，所以 ${product.name} 停止了它。輸出的結尾已保留。`,
  couldNotStart: ({ reason }) => `你的測試指令無法啟動：${reason}`,
  noExitCode: "你的測試沒有結束代碼就停止了；它被某個訊號終止。",
};

export default tests;
