import type { Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/license.js";

const name = product.name;
const bin = product.binNames[0];

const m: Translation<typeof en> = {
  featureNeedsPro: {
    teamSize: "3 或 4 位隊友的團隊需要 Pro 授權。",
    parallelRuns: "同時進行多項貢獻需要 Pro 授權。",
    discovery: "在整個 GitHub 探索可貢獻的專案需要 Pro 授權。",
    moreRecommendations: "產出更多建議需要 Pro 授權。",
    learningExport: "匯出學習紀錄需要 Pro 授權。",
    prFeedback: "維護者回饋指導與後續修改回合需要 Pro 授權。",
    webAccess: "Agent 網路存取需要 Pro 授權。關閉網路存取即可繼續使用免費方案。",
    deepReasoning:
      "xhigh、max 與 ultra 思考強度需要 Pro 授權。改選其他強度或「模型預設」即可繼續使用免費方案。",
  },
  invalidKey: {
    malformed: `這不是 ${name} 授權金鑰。請貼上完整的金鑰，開頭是 BELLPR1。`,
    badSignature: "這組授權金鑰無效。請確認已完整貼上，且沒有任何改動。",
    unknownKid: `這個版本的 ${name} 無法驗證這組授權金鑰。請將 ${name} 更新到最新版本。`,
    revoked: "這組授權金鑰已被撤銷。",
    expired: ({ date }) => `這組授權金鑰已在 ${date} 到期。`,
    updatesExpired: ({ until, build }) =>
      `這組授權金鑰涵蓋 ${until} 以前發布的 ${name} 版本，而這個版本發布於 ${build}。請使用較早的版本，或續購授權。`,
  },
  envLocked: `授權金鑰是由環境變數 BELLPR_LICENSE_KEY 設定的。請在那裡變更或移除，再重新啟動 ${name}。`,
  fixedPlan: `這個 ${name} 啟動時已固定方案，無法在這裡變更授權。`,
  trialUsed: "這個資料目錄已經用過 14 天 Pro 試用。",
  trialNotNeeded: "Pro 授權已經生效，不需要開始試用。",
  planNames: { free: "免費", trial: "Pro 試用", pro: "Pro" },
  startup: {
    free: ({ reason, trial }) =>
      [
        "方案：免費。",
        reason,
        trial ? `可在「設定」或用 \`${bin} license trial\` 開始 14 天 Pro 試用。` : undefined,
      ]
        .filter(Boolean)
        .join(""),
    trial: ({ daysLeft }) => `方案：Pro 試用，剩 ${daysLeft} 天。`,
    pro: ({ licenseId }) =>
      licenseId ? `方案：Pro（授權 ${licenseId}）。` : "方案：Pro。",
  },
  cli: {
    usage: `用法：${bin} license [status [--json] | activate <金鑰> | deactivate | trial]。以 - 取代金鑰即可從標準輸入讀取。`,
    unknownSubcommand: ({ command }) => `沒有「${command}」這個 license 指令。`,
    missingKey: `請提供授權金鑰：${bin} license activate <金鑰>，或用 ${bin} license activate - 從標準輸入讀取。`,
    plan: ({ plan }) => `方案：${plan}`,
    trialLeft: ({ daysLeft }) => `試用：剩 ${daysLeft} 天`,
    licenseId: ({ id }) => `授權：${id}`,
    licensee: ({ who }) => `授權給：${who}`,
    expires: ({ date }) => `到期：${date}`,
    expiresNever: "到期：永久有效",
    grace: ({ date }) => `授權已到期；Pro 會保留到 ${date}。請在那之前續購。`,
    updatesUntil: ({ date }) => `更新：涵蓋 ${date} 以前發布的版本`,
    source: {
      env: "金鑰來源：環境變數 BELLPR_LICENSE_KEY",
      file: "金鑰來源：資料目錄中的 license.json",
    },
    envLocked: "金鑰由 BELLPR_LICENSE_KEY 設定，只能在那裡變更。",
    reasons: {
      no_license: "目前沒有生效的授權金鑰。",
      expired: "授權金鑰已到期。",
      trial_ended: "14 天 Pro 試用已結束。",
      updates_expired: `授權金鑰不涵蓋這個版本的 ${name}。`,
      invalid: "授權金鑰無效。",
    },
    fixes: {
      trial: "開始 14 天 Pro 試用",
      activate: "啟用授權金鑰",
    },
    fixLine: ({ label, command }) => `${label}：${command}`,
    activated: "授權已啟用。",
    deactivated: "已移除授權金鑰。",
    nothingToRemove: "這個資料目錄沒有儲存授權金鑰。",
    trialStarted: "Pro 試用已開始。",
    running: `使用這個資料目錄、正在執行的 ${name} 會在幾秒內套用這項變更。`,
  },
};
export default m;
