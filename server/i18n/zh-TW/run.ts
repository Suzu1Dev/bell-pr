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
  diff: {
    unparsable: "無法解析 Git 差異。",
    renameFirst: "檔案名稱包含不支援的字元，請先重新命名。",
    unsupportedName: "檔案名稱包含不支援的字元。",
    tooManyFiles: "差異超過 150 個檔案，請縮小任務後重新執行。",
    outsideWorktree: "檔案超出工作目錄。",
    tooLarge: "差異超過 2 MB，請拆成較小的工作。",
    blocked: {
      sensitive: "敏感檔案或產物不會被加入 PR；請先從本次變更移除。",
      notRegularFile: "新檔案必須是一般檔案；符號連結需要手動處理。",
      newFileTooLarge: "新檔案超過 512 KB，請手動檢視或拆分。",
      binary: "二進位檔案需要另外人工檢視，無法透過此工作流程發佈。",
      credentials: "差異疑似包含憑證，內容已隱藏；請移除後重新審閱。",
    },
    heldBack: ({ reason }) => `此檔案已暫停發佈：${reason}`,
  },
  integration: {
    snapshotBlocked: "整合快照含有無法審閱的檔案，已停止派工。",
    noWorktree: "任務缺少隔離工作目錄。",
    gitStateChanged: "Teammate 改動 Git 提交狀態，已停止整合。",
    outOfScope: ({ path }) =>
      `Teammate 修改了未分配的檔案 ${path}；差異保留在其隔離工作目錄，未整合。`,
    needsManualHandling: ({ path }) => `Teammate 的 ${path} 需要人工處理，未整合。`,
  },
  plan: {
    wholePlan: "計畫",
    tooBig: ({ path, maximum, items }) =>
      `${path}：超過 ${maximum} ${items ? "項" : "字"}`,
    empty: ({ path }) => `${path}：不可為空`,
    tooSmall: ({ path, minimum, items }) =>
      `${path}：至少 ${minimum} ${items ? "項" : "字"}`,
    wrongType: ({ path, expected, received }) =>
      `${path}：應為 ${expected}，收到 ${received}`,
    badFormat: ({ path }) => `${path}：格式不正確`,
    other: ({ path, reason }) => `${path}：${reason}`,
    notJson: "Lead 未回傳有效的任務計畫 JSON，請調整需求後重試。",
    invalid: ({ problem }) =>
      `Lead 回傳的計畫不符合格式（${problem}）；請調整需求後重試。`,
    duplicateIds: "Lead 計畫包含重複或保留的任務 ID。",
    invalidDependency: "Lead 計畫包含無效的任務依賴。",
    invalidScope: ({ scope }) => `Lead 計畫的檔案範圍無效：${scope}`,
    cycle: "Lead 計畫的任務依賴形成循環。",
  },
  report: {
    member: ({ summary, checks, limitations, tradeoffs }) =>
      [
        summary,
        `驗證證據（成員自述的執行結果）：\n${checks.length ? checks.join("\n") : "（成員未回報任何實際執行的檢查）"}`,
        `限制與未達成的驗收條件：\n${limitations || "（未回報）"}`,
        `設計取捨（考慮過但未採用的做法）：\n${tradeoffs || "（未回報）"}`,
      ].join("\n\n"),
  },
  publish: {
    commitMessageInvalid: "提交訊息只能包含文字與換行。",
    invalidBranch:
      "GitHub 分支名稱只能用英數字與 . _ - /，不能有 ..，也不能以 . 或 .lock 結尾。",
  },
};
export default m;
