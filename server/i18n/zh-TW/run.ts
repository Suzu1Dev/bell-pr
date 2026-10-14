import type { Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/run.js";

const m: Translation<typeof en> = {
  agentCli: {
    commandSucceeded: "成功",
    commandFailed: "失敗",
    codexTurnFailed: "Codex 工作回合失敗。",
    codexError: "Codex 回報執行錯誤。",
    claudeTurnFailed: ({ subtype }) => `Claude Code 工作回合失敗（${subtype}）。`,
    apiRetry: ({ attempt, maxRetries, reason, delaySeconds }) => {
      const details = [
        attempt === undefined
          ? ""
          : `第 ${attempt}${maxRetries === undefined ? "" : `/${maxRetries}`} 次`,
        reason ? `原因 ${reason}` : "",
        delaySeconds === undefined ? "" : `${delaySeconds} 秒後重試`,
      ].filter(Boolean);
      return `Claude Code 重試中${details.length ? `（${details.join("，")}）` : ""}。`;
    },
    rateLimitWindows: {
      five_hour: "5 小時滾動視窗：用量每 5 小時依開始時間重置",
      seven_day: "7 天滾動視窗：所有模型的每週總量",
      seven_day_opus: "7 天滾動視窗：Opus 的每週用量",
      seven_day_sonnet: "7 天滾動視窗：Sonnet 的每週用量",
      seven_day_overage_included: "7 天滾動視窗：含額外用量的每週總量",
      overage: "額外用量",
    },
    rateLimit: ({ status, window, used, resetsAt }) => {
      const state =
        status === "rejected"
          ? "已達上限，等待重置中"
          : status === "allowed_warning"
            ? "接近上限"
            : `狀態 ${status}`;
      const details = [
        window ?? "",
        used === undefined ? "" : `已用 ${used}%`,
        resetsAt === undefined ? "" : `預計 ${resetsAt} 重置`,
      ].filter(Boolean);
      return `Claude 額度${state}${details.length ? `（${details.join("；")}）` : ""}。`;
    },
    deniedTool: ({ tool, reason }) =>
      `工具 ${tool} 被權限設定拒絕${reason ? `：${reason}` : "。"}`,
    authRetry: ({ seconds, attempt, total }) =>
      `Claude Code 正在更新登入憑證（其他行程持有更新鎖），${seconds} 秒後重試（第 ${attempt}/${total} 次）。`,
    timeoutLimit: ({ minutes }) => `最多等待 ${minutes} 分鐘`,
    timedOut: ({ executable, minutes }) =>
      `${executable} 執行逾時（已等待 ${minutes} 分鐘）。較高的思考強度或大型專案需要更久；可降低思考強度、改用較快的模型，或提高 BELLPR_AGENT_TIMEOUT_SCALE。`,
  },
  command: {
    timedOut: ({ executable }) => `${executable} 執行逾時。`,
    outputTooLarge: ({ executable }) =>
      `${executable} 輸出超過安全上限；請縮小工作範圍。`,
    spawnFailed: ({ executable, reason }) => `${executable} 無法啟動：${reason}`,
    failed: ({ executable, output }) => `${executable} 執行失敗：${output}`,
  },
  publish: {
    commitMessageInvalid: "提交訊息只能包含文字與換行。",
    invalidBranch:
      "GitHub 分支名稱只能用英數字與 . _ - /，不能有 ..，也不能以 . 或 .lock 結尾。",
  },
};
export default m;
