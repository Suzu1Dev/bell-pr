import { buildDemoContent } from "./shared";
import type { DemoContent } from "./types";

const answerPrefix = "示範回覆 · 本機預寫內容，未呼叫 AI 模型。\n\n";

const zhTW: DemoContent = buildDemoContent({
  explanations: {
    "src/utils/retry.ts": {
      example: {
        scenario:
          "你和許多人同時重新整理班次資訊，服務短暫忙不過來。程式需要決定：請求失敗後，什麼時候再試一次？",
        before:
          "預設每次都固定等 **1 秒**再試。大家若同時失敗，就可能又在同一時間送出下一批請求。",
        after:
          "每次等待時間改為隨機抽選，預設前兩輪分別小於 **1 秒、2 秒**，讓請求錯開；若錯誤不適合重試，也能直接停止。這只增加恢復的機會，仍可能在次數用盡後失敗。",
      },
      summary:
        "請求失敗時，不再每次固定等 1 秒，而是逐步拉長等待時間，並加上一點隨機性。短暫的網路問題，就有機會自動恢復。",
      reason:
        "如果很多使用者同時失敗、同時重試，伺服器會再次被大量請求淹沒。讓每次重試錯開，就能降低這種連鎖壓力。",
      concept:
        "指數退避（Exponential backoff）\n等待上限會依序變成 1 秒、2 秒、4 秒；full jitter 再從 0 到上限之間隨機選一個時間。maxDelay 則讓等待上限不超過 30 秒。",
      tip: "不是所有錯誤都值得重試。這裡保留 shouldRetry，讓呼叫端決定哪些失敗可以再試；有副作用的寫入請求還需要額外確認冪等性。",
      alternatives:
        "另一條路是固定間隔加上隨機抖動（例如每次 1 秒 ± 0.3 秒）：實作更簡單、等待時間可預期，但大量客戶端同時失敗時仍會在相近時間重試。這次沒採用，是因為示範的情境正是伺服器忙不過來；若重試次數很少、而且必須在固定時間內回應，固定間隔會是更好的選擇。",
      lookup: ["exponential backoff", "full jitter", "idempotency"],
      selfCheck: {
        question:
          "第三次重試（attempt = 2）時，等待時間最多可能是多少秒？為什麼不一定會等那麼久？",
        answer:
          "上限是 min(30, 1 × 2²) = 4 秒；但 full jitter 會在 0 到 4 秒之間隨機取值，所以實際等待可能更短。",
      },
    },
    "src/client.ts": {
      example: {
        scenario:
          "你打開帳戶頁面，程式用 GET 讀取資料，但伺服器暫時回傳 `503`，並附上一段錯誤說明。",
        before:
          "這段程式沒有先檢查 HTTP 是否成功，會直接把回覆當成 JSON 資料讀取；即使是 `503`，也不會因為這個狀態碼而重試。",
        after:
          "程式先認出 `503` 是可重試的錯誤，再交給重試工具處理。服務若及時恢復，就有機會拿到資料；超過上限仍會回報失敗。像 `401` 這類問題則直接回報，不會反覆嘗試。",
      },
      summary:
        "把重試能力接進 GET 請求。暫時性伺服器錯誤和網路錯誤可以再試，像 401 或 404 這些需要使用者修正的問題則直接回報。",
      reason:
        "fetch 遇到 HTTP 500 時仍會成功回傳 Response，不會自動拋出錯誤。先檢查 response.ok，重試工具才知道請求失敗了。",
      concept:
        "錯誤分類\nHTTP 狀態碼提供失敗原因。將 Response 留在 HttpError 裡，能讓上層用狀態碼決定是否重試，同時保留除錯資訊。",
      tip: "這份示範只對 GET 啟用重試。正式上線前還應處理 Retry-After、取消訊號與 JSON 解析失敗，避免把不同類型的問題混在一起。",
      alternatives:
        "也可以不另外定義 HttpError，直接在 shouldRetry 裡檢查 `error.status`；程式碼更短，但失去型別保護，呼叫端也拿不到完整的 Response 來除錯。當專案已經有統一的錯誤類別時，應改成沿用那個類別而不是再新增一個。",
      lookup: ["custom error class", "retryable HTTP status codes"],
      selfCheck: {
        question:
          "伺服器回傳 404 時，這段程式會重試嗎？判斷依據是 diff 的哪一行？",
        answer:
          "不會。shouldRetry 只對 408、429、500、502、503、504 回傳 true，404 不在清單中，所以 HttpError 會直接被拋出。",
      },
    },
    "src/types.ts": {
      example: {
        scenario:
          "維護網站的工程師想設定：第一次失敗後最多等 500 毫秒，後續等待上限為 5 秒。他需要知道設定欄位怎麼填。",
        before:
          "原本的型別只列出重試次數與固定等待 `delay`；`ClientOptions` 也沒有 `retry` 欄位，無法從這份介面得知新的設定方式。",
        after:
          "編輯器可以依新型別提示 `retry: { baseDelay: 500, maxDelay: 5000 }`。這個檔案定義的是設定規格，實際等待與重試仍由其他程式碼執行。",
      },
      summary:
        "把重試次數、等待上限和錯誤判斷定義成明確的 TypeScript 介面，使用 SDK 的人可以在編輯器裡直接看到說明。",
      reason:
        "集中管理設定的型別，能避免不同模組各自定義略有差異的參數，也讓新增能力時更容易找到需要更新的地方。",
      concept:
        "unknown 與型別縮小\n錯誤不一定是 Error 物件。使用 unknown 會要求程式先檢查型別，再讀取屬性，避免不安全的假設。",
      tip: "將 delay 改成 baseDelay 是相容性變更。正式 PR 應提供遷移說明，或先保留舊名稱並標記 deprecated，讓使用者有時間升級。",
    },
    "tests/retry.test.ts": {
      example: {
        scenario:
          "你想確認自動重試真的照設計運作，又不想讓測試依賴真實網路或每次等待好幾秒。",
        before:
          "這個新增的測試檔尚不存在；光看重試程式寫得合理，並不能當作這兩種情境已通過驗證的證據。",
        after:
          "測試先安排「第一次失敗、第二次成功」，用虛擬時間快轉 500 毫秒，檢查是否拿到 `ok`；另一個測試檢查不准重試時只呼叫一次。這是在增加檢查，不是更改使用者的請求行為，也不代表測試已實際通過。",
      },
      summary:
        "新增兩個可重複執行的測試：暫時失敗之後能成功，以及不符合條件的錯誤只執行一次。測試使用虛擬時間，不需要真的等待。",
      reason:
        "重試牽涉時間與隨機數，直接跑真實計時器容易讓測試變慢或不穩定。固定隨機值與控制時間，才能準確檢查執行次數。",
      concept:
        "Fake timers 與 test doubles\nvi.useFakeTimers 接管計時器；mockReturnValue(0.5) 固定隨機結果。第一輪上限 1 秒，所以推進 500 毫秒就能觸發第二次請求。",
      tip: "這是示範測試，尚未代表完整驗證。還需要補上重試次數上限、最大等待時間、連續失敗、參數驗證與呼叫端的狀態碼測試。",
    },
    "README.md": {
      example: {
        scenario:
          "一位正在升級 SDK 的工程師看到舊設定裡有 `delay: 1000`，想知道新版該怎麼改、重試次數又代表什麼。",
        before:
          "這段 README 只介紹 HTTP 用戶端，讀者無法從這裡得知重試設定、哪些錯誤會再試，以及如何替換舊欄位。",
        after:
          "文件提供完整設定範例，說明改用 `baseDelay`，並把預設次數寫成「第一次請求之外再試 3 次」。工程師更容易照著升級；文件本身不會改變程式執行行為。",
      },
      summary:
        "補上使用方式、預設行為與升級說明。讓使用者不必讀原始碼，也知道哪些錯誤會重試、最多等多久、設定要怎麼寫。",
      reason:
        "功能的行為改變時，文件也是介面的一部分。清楚寫出「首次請求以外再重試 3 次」，可以避免把總次數誤解成 3 次。",
      concept:
        "以使用者觀點寫文件\n先說功能會做什麼，再給一個可以照著修改的設定範例，最後列出限制與遷移方法。",
      tip: "審閱文件時，將每個預設值和實作逐一核對。範例應說明匯入方式，也需要指出重試無法取代應用程式自己的錯誤處理。",
    },
  },
  run: {
    title: "讓每一次請求，都有重試的機會",
    prompt:
      "為 SDK 的 GET 請求加入指數退避與 jitter，保留可設定的重試次數，補上測試和使用文件。",
    agents: {
      lead: { role: "任務規劃", detail: "已完成示範開發計畫" },
      "member-1": { role: "程式開發", detail: "已產生 3 個核心檔案的示範變更" },
      "member-2": { role: "程式開發", detail: "已產生 src/client.ts 的示範變更" },
      "member-3": { role: "程式開發", detail: "已產生 README.md 的示範變更" },
      reviewer: { role: "品質審查", detail: "已整理示範審閱重點" },
      tester: { role: "測試驗證", detail: "已準備測試範例；未實際執行" },
    },
    logs: {
      plan: "示範：將任務拆成重試工具、HTTP 整合、測試與文件。",
      implement: "示範：使用指數退避搭配 full jitter，並限制最大等待時間。",
      review: "示範：標示 API 相容性與測試覆蓋範圍，等待人工確認。",
    },
    reports: {
      implementer:
        "示範 · Lead 整合摘要（預寫內容）\n\n三個任務已整合：`src/utils/retry.ts` 的 `withRetry` 改為指數退避搭配 full jitter，並新增 `baseDelay`、`maxDelay` 與 `shouldRetry` 選項；`src/client.ts` 只對 GET 請求啟用重試；`tests/retry.test.ts` 補上兩個案例；README.md 記錄新的設定方式。\n\n靜態檢查：各任務回報的變更與整合後的 diff 一致。本示範未執行專案測試。\n\n未完成事項：`retry.delay` 更名為 `retry.baseDelay` 屬於不相容變更，仍需維護者確認版本號與遷移說明。\n\n## Suggested review order:\n\n先讀型別定義，知道新選項有哪些；再讀實作與呼叫端，看它們怎麼使用；測試放最後，用來驗證前面讀到的理解。\n\n1. `src/types.ts` — 新增的 `baseDelay`、`maxDelay`、`shouldRetry` 在這裡定義，其他檔案都依賴它。\n2. `src/utils/retry.ts` — 指數退避與 jitter 的實作，是這次變更的核心。\n3. `src/client.ts` — 呼叫端，只對 GET 請求啟用重試。\n4. `tests/retry.test.ts` — 兩個案例對應上面讀到的行為。\n5. `README.md` — 最後看使用者會讀到的設定說明是否一致。",
      reviewer:
        "示範 · 獨立審查（預寫內容）\n\n**正確性**：`src/utils/retry.ts` 以 `Math.floor(Math.random() * ceiling)` 計算等待時間，`ceiling` 以 `maxDelay` 封頂，等待不會超過上限；但 `maxRetries` 為負數或非整數時會直接拋出第一次錯誤而沒有提示。\n\n**相容性**：`src/client.ts` 改讀 `retry.baseDelay`，仍傳 `retry.delay` 的舊呼叫端會被靜默忽略，建議在型別或執行期提醒。\n\n**可維護性**：重試與否集中在 `shouldRetry`，之後支援 `Retry-After` 時只需擴充一處。\n\n本審查為靜態閱讀 diff，未執行程式碼。",
      tester:
        "示範 · 測試分析（預寫內容）\n\n`tests/retry.test.ts` 目前有兩個案例：暫時失敗後第二次成功、`shouldRetry` 回傳 false 時保留原始錯誤並只呼叫一次。\n\n缺少的案例：\n\n1. 達到 `maxRetries` 後仍失敗，應拋出最後一次的錯誤。\n2. 固定 `Math.random` 後驗證每一輪等待都不超過 `maxDelay`。\n3. `src/client.ts` 對 POST 不重試。\n\n回歸風險：`retry.delay` 改名後，舊設定會以預設 `baseDelay` 執行，現有測試無法察覺這種靜默變更。\n\n本分析未執行測試，以上皆為靜態閱讀。",
    },
  },
  insights: {
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
    modules: {
      "src/client.ts": "對外提供 client，送出 GET 請求並處理回應。",
      "src/utils/retry.ts": "包裝可以重試的操作，決定次數與等待方式。",
      "src/types.ts": "定義 client 與重試設定，協助呼叫端正確使用。",
      "tests/retry.test.ts":
        "驗證重試成功與排除錯誤的行為；這是本次新增的示範測試。",
    },
    readingPath: {
      "README.md": {
        why: "先知道這個 client 想替誰解決什麼問題，再看程式碼才有脈絡。",
        lookFor: "安裝方式、建立 client 的範例，以及它強調的「有型別」承諾。",
      },
      "src/types.ts": {
        why: "所有模組共用這裡的設定型別；先看型別，等於先看合約。",
        lookFor: "client 設定與重試設定各有哪些欄位，哪些是選填。",
      },
      "src/client.ts": {
        why: "這是使用者實際呼叫的入口，請求從這裡進出。",
        lookFor: "GET 如何組合網址、呼叫 fetch，以及目前沒有接入 retry 的位置。",
      },
      "src/utils/retry.ts": {
        why: "建議方向都圍繞它；理解它的等待策略，才能評估改法。",
        lookFor: "重試次數、固定等待時間，以及它如何判斷是否再試。",
      },
    },
    howItFitsTogether:
      "呼叫端依 src/types.ts 的設定建立 src/client.ts 的 client；client 的 GET 直接呼叫 fetch，把 JSON 回傳給畫面。src/utils/retry.ts 目前是獨立 helper，示範 diff 中尚未被 client 引用；「client 將來會包住 retry」是建議方向，不是現況。",
    evidence: {
      "README.md":
        "示範專案將自己定義為供現代應用程式使用的小型、有型別 HTTP client。",
      "src/client.ts":
        "示範 diff 的原始 GET 實作直接呼叫 fetch，沒有接入 retry helper。",
      "src/utils/retry.ts":
        "既有 helper 使用固定等待時間，沒有區分錯誤是否適合重試。",
    },
    recommendations: {
      "demo-smart-retry": {
        title: "讓暫時失敗的讀取請求，有機會自動恢復。",
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
      },
      "demo-retry-boundaries": {
        title: "把時間與次數的邊界，也寫進測試。",
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
      },
      "demo-upgrade-guide": {
        title: "讓使用舊設定的開發者，知道如何升級。",
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
      },
    },
  },
  contributionBrief: {
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
  },
  team: {
    planSummary:
      "將重試策略、HTTP client 整合與驗證拆成明確範圍。先建立共用型別，再讓 client 與文件分頭作業；最後整合測試並交叉審閱，確認重試只套用在可恢復的 GET 失敗。",
    tasks: {
      "task-1": {
        title: "定義重試策略與型別",
        description: "建立退避、jitter 與可重試條件，維持泛型回傳型別。",
        report:
          "示範報告：新增可配置的重試策略與型別。實際執行證據請以真實任務報告為準。",
      },
      "task-2": {
        title: "接進使用者的 GET 請求",
        description: "保留 HTTP 錯誤資訊，區分暫時性失敗與無法重試的狀態。",
        report: "示範報告：只有 GET 請求採用重試，沒有自動重送付款等寫入操作。",
      },
      "task-3": {
        title: "補齊使用範例與限制",
        description: "向 SDK 使用者說明怎麼設定，以及重試不適用的情境。",
        report: "示範報告：說明預設值、錯誤分類與相容性。",
      },
      "task-4": {
        title: "驗證邊界與整合行為",
        description: "檢查重試上限、不可重試錯誤與最後一次失敗的回傳行為。",
        report: "此為示範測試計畫，未執行真實 repository 的測試。",
      },
    },
    messages: {
      m1: "這次的目標是讓短暫網路失敗有機會恢復。請只調整 GET 行為，保留既有介面。",
      m2: "RetryOptions 已準備好。client 請透過 shouldRetry 傳入 HTTP 分類，不要在重試工具內耦合 HTTP。",
    },
  },
  draftPreparation: {
    warnings: [
      "這是介面示範，來源文件、規範與草稿均為示範資料，未讀取任何實際專案。",
    ],
    sources: {
      "demo-contributing": {
        label: "貢獻規範（示範）",
        content:
          "# 示範貢獻規範\n\n標題應直接描述使用者會得到的改善。\n\n測試段落應區分已執行的檢查與仍需驗證的項目。\n\n提交訊息主旨使用 type(scope): 說明 的格式，空一行後說明原因。",
      },
      "demo-template": {
        label: "PR 範本（示範）",
        content:
          "## 修改動機\n\n## 變更內容\n\n## 驗證與限制\n\n請區分已執行的檢查與待驗證項目。",
      },
    },
    proposal: {
      title: "改善讀取請求遇到暫時失敗時的恢復方式",
      summary:
        "這份示範沿用專案範本，先交代使用者遇到的問題，再說明重試範圍與需要確認的限制。",
      body: "## 修改動機\n\n當讀取請求遇到暫時性網路問題時，使用者需要重新操作才能繼續。此示範說明如何讓符合條件的讀取請求有機會自動恢復。\n\n## 變更內容\n\n- 限定可重試的請求與錯誤種類。\n- 加上等待時間與重試次數上限。\n- 保留最終失敗時的錯誤訊息。\n\n## 驗證與限制\n\n這是草稿介面示範，**尚未執行任何測試**。送出前需確認：\n\n- 暫時失敗後成功的情境。\n- 超過重試上限時仍正確回報錯誤。\n- 不適合重試的寫入操作不會重複送出。",
      rules: [
        {
          sourceId: "demo-contributing",
          text: "標題直接說明這次貢獻帶來的改善。",
          quote: "標題應直接描述使用者會得到的改善。",
        },
        {
          sourceId: "demo-template",
          text: "把驗證狀況與限制放進範本，避免把待測項目寫成已通過。",
          quote: "請區分已執行的檢查與待驗證項目。",
        },
      ],
      checklist: [
        "確認範本各段落與實際 diff 一致。",
        "填入真正執行過的測試指令與結果。",
        "核對重試上限及不應重試的操作範圍。",
      ],
      commitRationale:
        "示範貢獻規範要求主旨使用 type(scope): 說明 的格式，並在空一行後說明原因；這份建議不含任何簽署欄位。",
    },
  },
  answers: [
    {
      topic: "test",
      keywords: /測試|test|驗證|怎麼確認/i,
      text: ({ file }) =>
        `${answerPrefix}針對 ${file.path}，可以從可觀察的行為開始驗證：\n\n1. 第一次成功時，只呼叫 operation 一次。\n2. 暫時失敗後可以再試，但總呼叫次數不超過 maxRetries + 1。\n3. shouldRetry 回傳 false 時，保留原始錯誤並立即停止。\n4. 固定隨機值並使用 fake timers，檢查每輪等待上限與 maxDelay。\n\n目前示範測試只有成功恢復與不重試兩個案例，其他邊界條件還需要補齊。`,
    },
    {
      topic: "jitter",
      keywords: /jitter|隨機|退避|指數|2 \*\*|Math\.random/i,
      text: () =>
        `${answerPrefix}可以把它想成一群人遇到塞車後，分批再出發。\n\n第 1、2、3 輪的等待上限依序是 1、2、4 秒；程式用 baseDelay × 2^attempt 計算，再用 maxDelay 限制上限。\n\nMath.random() 會把真正的等待時間散佈在 0 到上限之間，這就是 full jitter。假設固定回傳 0.5，三輪實際等待就是 0.5、1、2 秒。\n\n隨機化能分散同時重試的流量，但不保證某一個請求一定成功。`,
    },
    {
      topic: "risk",
      keywords: /風險|注意|改善|問題|相容|更好/i,
      text: ({ file }) =>
        `${answerPrefix}${file.explanation?.tip ?? "先確認這段變更的輸入、輸出與錯誤處理。"}\n\n這份示範還需要驗證負數或非有限數值的設定、取消請求、Retry-After，以及超出重試次數時是否保留原始錯誤。實際貢獻時，應以目標 repository 的既有約定和測試結果為準。`,
    },
    {
      topic: "why",
      keywords: /為什麼|why|原因/i,
      text: ({ file }) =>
        `${answerPrefix}${file.explanation?.reason ?? "這份示範著重在將暫時性失敗的恢復邏輯集中管理。"}\n\n${file.explanation?.concept ?? ""}\n\n可以回頭對照 diff：紅色是移除的行，綠色是新增的行；沒標色的行提供上下文。`,
    },
    {
      topic: "generic",
      // The fallback: demoAnswer() uses it when no other topic matches.
      keywords: /(?:)/,
      text: ({ file }) =>
        `${answerPrefix}${file.path}\n\n${file.explanation?.summary ?? "這個檔案包含本次任務的程式變更。"}\n\n${file.explanation?.concept ?? ""}\n\n這是依檔案與關鍵字挑選的教學範例，不是對所選程式碼的即時推論。連接真實任務後，追問會交給設定的模型處理。`,
    },
  ],
});

export default zhTW;
