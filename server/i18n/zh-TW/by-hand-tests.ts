import type { Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/by-hand-tests.js";

const tests: Translation<typeof en> = {
  noCommand: "請先為這個專案確認一個測試指令。",
  running: "你的測試正在執行。請等它跑完，或先停止它。",
  notNow: "測試在變更等待你審閱時才能執行；規劃中或發布中不行。",
};

export default tests;
