/** Free/Pro table copy (Traditional Chinese, Taiwan); typed against the English copy. */
import type { Translation } from "./locale.js";
import type en from "./plans.en.js";

const plans: Translation<typeof en> = {
  columns: { feature: "功能", tier: "方案", limit: "限制" },
  tiers: {
    free: "免費",
    "free-limited": "免費（有限制）",
    pro: "Pro",
  },
  features: {
    runs: {
      label: "Repository 與貢獻工作",
      limit: "Repository 與工作數量不限",
    },
    analysis: {
      label: "專案分析與經驗證的建議",
      limit:
        "每次分析最多 5 個建議，可重新分析。降級後，已產生的建議（最多 30 個）仍會保留。",
    },
    moreRecommendations: {
      label: "更多建議（「產出 5 個新建議」，每個專案最多 30 個）",
      limit: "免費：5 個。Pro：每個專案最多 30 個。",
    },
    teamSize: {
      label: "Agent 團隊規模",
      limit:
        "免費：Lead、2 位隊友、Reviewer 與 Test analyst。Pro 與試用：3 或 4 位隊友。",
    },
    parallelRuns: {
      label: "同時執行的工作",
      limit:
        "免費：一次進行一項貢獻，其餘工作依序排隊。Pro：依你的設定同時執行（預設 2 項，最多 8 項）。",
    },
    planApproval: {
      label: "計畫核准與修訂、團隊收件匣、重試失敗的子任務",
      limit: "計畫最多修訂 3 次",
    },
    review: {
      label: "差異審查、解說、追問對話、筆記與建議審查順序",
      limit: "不限",
    },
    reviewRerun: {
      label: "重新執行 Reviewer 與 Test analyst",
      limit: "不限（屬於人工審查的安全關卡）",
    },
    publish: {
      label: "依專案規範撰寫 PR 草稿、送出前檢查、發布 Draft PR",
      limit: "所有方案都必須經過人工核准",
    },
    sync: {
      label: "將工作同步到目標分支的最新版本、由 Agent 解決衝突、更新專案的本機 clone",
      limit: "不限（未發布的工作與已發布的 PR 皆可）",
    },
    learningNotes: {
      label: "學習筆記頁面",
      limit: "不限",
    },
    learningExport: {
      label: "匯出學習紀錄（Markdown）",
      limit: "免費：不提供（學習筆記頁面仍免費）",
    },
    prFeedback: {
      label: "維護者回饋、CI 指導與 AI 後續修改回合",
      limit:
        "免費：不提供；範例專案會顯示標示 PRO 的範例回饋。降級後，工作上已有的後續修改回合仍可查看，進行中的回合仍可審查、推送、停止或捨棄。",
    },
    discovery: {
      label: "探索貢獻（全 GitHub 推薦）",
      limit:
        "免費：僅提供標示為範例的結果。既有結果仍可查看，進行中的探索仍可取消。",
    },
    webAccess: {
      label: "Agent 網路存取",
      limit: "免費：關閉。Pro：開啟，僅限允許清單中的網域",
    },
    deepReasoning: {
      label: "深度思考強度（xhigh、max、ultra）",
      limit:
        "免費：可選 none 到 high。思考強度維持「模型預設」時，所有方案都使用模型本身的預設強度。",
    },
    providers: {
      label: "Provider、模型選擇、效率模式",
      limit: "Codex CLI 與 Claude Code、所有模型、所有效率模式",
    },
    demo: {
      label: "範例專案／示範（以範例資料展示 Pro 功能）",
      limit: "僅在瀏覽器中使用範例資料",
    },
    trial: {
      label: "14 天 Pro 試用",
      limit:
        "每個資料目錄一次，只在你選擇時開始（在 App 中或使用 bell-pr license trial）",
    },
    licenseTerm: {
      label: "Pro 授權期限與更新",
      limit: "授權給指定使用者；購買後 12 個月內發布的版本可永久使用",
    },
  },
};

export default plans;
