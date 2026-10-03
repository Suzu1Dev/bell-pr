import type { ContributionBrief, ProjectInsights } from "../../shared/insights";

export const demoInsights: ProjectInsights = {
  summary: "把 API 請求變簡單的 TypeScript 工具。",
  purpose:
    "Open Fetch 將原生 fetch 包裝成有型別、可共用設定的 HTTP client。開發者可以用一致的方式讀取 API，讓儀表板、搜尋結果與資料列表取得需要的資料。",
  audience: ["串接 API 的前端開發者", "維護共用 SDK 的團隊"],
  userJourney: [
    "開發者設定 API 網址，建立共用的 client。",
    "使用者打開儀表板或列表，畫面送出 GET 請求。",
    "client 取得 JSON 資料，交給畫面呈現。",
    "遇到短暫失敗時，應提供可預期的恢復方式。",
  ],
  modules: [
    {
      path: "src/client.ts",
      purpose: "對外提供 client，送出 GET 請求並處理回應。",
    },
    {
      path: "src/utils/retry.ts",
      purpose: "包裝可以重試的操作，決定次數與等待方式。",
    },
    {
      path: "src/types.ts",
      purpose: "定義 client 與重試設定，協助呼叫端正確使用。",
    },
    {
      path: "tests/retry.test.ts",
      purpose: "驗證重試成功與排除錯誤的行為；這是本次新增的示範測試。",
    },
  ],
  evidence: [
    {
      path: "README.md",
      note: "示範專案將自己定義為供現代應用程式使用的小型、有型別 HTTP client。",
    },
    {
      path: "src/client.ts",
      note: "示範 diff 的原始 GET 實作直接呼叫 fetch，沒有接入 retry helper。",
    },
    {
      path: "src/utils/retry.ts",
      note: "既有 helper 使用固定等待時間，沒有區分錯誤是否適合重試。",
    },
  ],
  recommendations: [
    {
      id: "demo-smart-retry",
      title: "讓暫時失敗的讀取請求，有機會自動恢復。",
      direction: "bugfix",
      problem:
        "GET 請求遇到短暫網路或伺服器錯誤時，client 缺乏恢復機制；既有重試工具也尚未接入請求流程。",
      userImpact:
        "使用這個 client 的列表與儀表板，有機會在短暫錯誤後取得資料，減少使用者手動重新整理的次數。",
      approach:
        "僅對 GET 啟用有上限的指數退避與隨機等待，並區分可重試的狀態碼。",
      acceptance: [
        "暫時失敗後，下一次成功可回傳資料。",
        "401、404 等不適合重試的錯誤直接回報。",
        "達到上限後停止，保留原始錯誤。",
      ],
      effort: "medium",
      confidence: "high",
      evidence: ["src/client.ts", "src/utils/retry.ts"],
    },
    {
      id: "demo-retry-boundaries",
      title: "把時間與次數的邊界，也寫進測試。",
      direction: "testing",
      problem:
        "目前的示範測試涵蓋成功恢復與排除錯誤，尚未完整確認次數上限、等待上限與連續失敗。",
      userImpact:
        "維護者修改重試策略時，能更早發現無限重試或等待過久的退步，保護使用者的載入體驗。",
      approach: "使用虛擬時間與固定隨機值，補上邊界案例，避免依賴真實等待。",
      acceptance: [
        "連續失敗會在設定次數後停止。",
        "退避等待不超過 maxDelay。",
        "測試結束後恢復計時器與 mock。",
      ],
      effort: "small",
      confidence: "high",
      evidence: ["tests/retry.test.ts", "src/utils/retry.ts"],
    },
    {
      id: "demo-upgrade-guide",
      title: "讓使用舊設定的開發者，知道如何升級。",
      direction: "docs",
      problem:
        "將 delay 改成 baseDelay 會影響既有呼叫端；只有新的設定範例，可能不足以解釋行為差異。",
      userImpact:
        "整合 SDK 的開發者可以理解固定等待與退避上限的差別，降低升級時的誤用。",
      approach:
        "補充遷移前後對照、重試總次數、不可重試情境，並說明相容性取捨。",
      acceptance: [
        "清楚區分首次請求與額外重試次數。",
        "呈現 delay 到 baseDelay 的遷移範例。",
        "提醒只重試適合的操作，避免重複寫入。",
      ],
      effort: "small",
      confidence: "medium",
      evidence: ["README.md", "src/types.ts"],
    },
  ],
  generatedAt: "2026-10-03T00:00:00+08:00",
  source: "demo",
  baseSha: "demo",
};

export const demoContributionBrief: ContributionBrief = {
  problem:
    "使用者載入列表或儀表板時，即使只是短暫網路錯誤，資料讀取也可能直接失敗。現有 GET client 尚未使用重試工具。",
  motivation:
    "短暫錯誤通常不需要使用者改變操作。把有界線的恢復邏輯放在共用 client，能讓不同畫面使用一致的策略。",
  beneficiaries: ["等待資料載入的使用者", "串接這個 SDK 的開發者"],
  before:
    "一次 GET 請求失敗後，client 直接回報錯誤。應用程式可能需要顯示錯誤，讓使用者自行重試。",
  after:
    "遇到可重試的錯誤時，client 以逐步拉長且錯開的等待時間重試；若仍失敗，達到次數上限後回報。401、404 與 POST 不套用這次策略。",
  validation: [
    "暫時失敗後能恢復，且回傳正確資料。",
    "不適合重試的錯誤不會重複請求。",
    "檢查次數與等待上限；目前示範測試尚未涵蓋全部邊界。",
  ],
  risks: [
    "重試會增加最終失敗前的等待時間與請求數。",
    "delay 改成 baseDelay 涉及設定相容性，需要遷移說明。",
    "仍需處理 Retry-After 與取消訊號；這份示範尚未實作。",
  ],
};
