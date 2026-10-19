import { buildDemoContent } from "./shared";
import type { DemoContent } from "./types";

const answerPrefix = "示範回覆 · 本機預寫內容，未呼叫 AI 模型。\n\n";

const zhTW: DemoContent = buildDemoContent({
  locale: "zh-TW",
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
      alternatives:
        "另一條路是保留 `delay`，把它標成 `baseDelay` 的 deprecated 別名：既有設定能再撐一個版本，代價是同一個設定有兩個名字。這次直接改名，是因為示範專案小又新；被廣泛使用的 SDK 通常應該先保留別名一個版本。",
      lookup: ["TypeScript Omit", "deprecation"],
      selfCheck: {
        question:
          "為什麼 ClientOptions.retry 不包含 shouldRetry？如果呼叫端能在這裡設定它，會出什麼問題？",
        answer:
          "哪些 HTTP 狀態碼值得重試，是由用戶端自己的 shouldRetry 決定。呼叫端給的版本會被蓋掉、悄悄失效，所以型別乾脆不提供這個欄位。",
      },
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
      alternatives:
        "也可以不用 fake timers，而是把假的 `sleep` 傳進 withRetry，記錄每次要求的等待時間：不必模擬計時器就能直接檢查等待，但會為了測試改動工具函式的公開參數。fake timers 能讓 API 維持原樣。",
      lookup: ["fake timers", "dependency injection"],
      selfCheck: {
        question:
          "為什麼第一個測試剛好把時間推進 500 毫秒？如果沒有固定 Math.random，可能會發生什麼事？",
        answer:
          "Math.random 固定為 0.5、第一輪上限是 1 秒，所以等待時間是 500 毫秒。若不固定，等待時間是隨機的，測試可能失敗，也可能碰巧通過。",
      },
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
      alternatives:
        "重試設定也可以寫在另一個指南頁面，再從 README 連過去：README 會比較短，但升級的人常常只讀 README，可能錯過遷移說明。對小型 SDK 來說，在 README 放一個段落比較容易找到。",
      lookup: ["migration guide", "semantic versioning"],
      selfCheck: {
        question: "在預設設定下，一次 GET 最多會送出幾個請求？哪些狀態碼會直接失敗？",
        answer:
          "最多 4 個：第一次請求加上 3 次重試。408、429、500、502、503、504 以外的狀態碼（例如 404）不會重試，直接失敗。",
      },
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
        "示範 · Lead 整合摘要（預寫內容）\n\n四個任務已整合：`src/utils/retry.ts` 的 `withRetry` 改為指數退避搭配 full jitter，並新增 `baseDelay`、`maxDelay` 與 `shouldRetry` 選項；`src/client.ts` 只對 GET 請求啟用重試；`tests/retry.test.ts` 補上兩個案例；README.md 記錄新的設定方式。\n\n靜態檢查：各任務回報的變更與整合後的 diff 一致。本示範未執行專案測試。\n\n未完成事項：`retry.delay` 更名為 `retry.baseDelay` 屬於不相容變更，仍需維護者確認版本號與遷移說明。\n\n## Suggested review order:\n\n先讀型別定義，知道新選項有哪些；再讀實作與呼叫端，看它們怎麼使用；測試放最後，用來驗證前面讀到的理解。\n\n1. `src/types.ts` — 新增的 `baseDelay`、`maxDelay`、`shouldRetry` 在這裡定義，其他檔案都依賴它。\n2. `src/utils/retry.ts` — 指數退避與 jitter 的實作，是這次變更的核心。\n3. `src/client.ts` — 呼叫端，只對 GET 請求啟用重試。\n4. `tests/retry.test.ts` — 兩個案例對應上面讀到的行為。\n5. `README.md` — 最後看使用者會讀到的設定說明是否一致。",
      reviewer:
        "示範 · 獨立審查（預寫內容）\n\n**正確性**：`src/utils/retry.ts` 以 `Math.floor(Math.random() * ceiling)` 計算等待時間，`ceiling` 以 `maxDelay` 封頂，等待不會超過上限；但 `maxRetries` 從未驗證：負數會直接拋出第一次錯誤而不說明原因，`NaN` 則永遠到不了上限，呼叫會一直重試下去。\n\n**相容性**：`src/client.ts` 改讀 `retry.baseDelay`，仍傳 `retry.delay` 的舊呼叫端會被靜默忽略，建議在型別或執行期提醒。\n\n**可維護性**：重試與否集中在 `shouldRetry`，之後支援 `Retry-After` 時只需擴充一處。\n\n本審查為靜態閱讀 diff，未執行程式碼。",
      tester:
        "示範 · 測試分析（預寫內容）\n\n`tests/retry.test.ts` 目前有兩個案例：暫時失敗後第二次成功、`shouldRetry` 回傳 false 時保留原始錯誤並只呼叫一次。\n\n缺少的案例：\n\n1. 達到 `maxRetries` 後仍失敗，應拋出最後一次的錯誤。\n2. 固定 `Math.random` 後驗證每一輪等待都不超過 `maxDelay`。\n3. `src/client.ts` 會重試 503，但遇到 404 時呼叫一次就失敗。\n\n回歸風險：`retry.delay` 改名後，舊設定會以預設 `baseDelay` 執行，現有測試無法察覺這種靜默變更。\n\n本分析未執行測試，以上皆為靜態閱讀。",
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
    premise: {
      statement: "需求假設目前的 GET 請求不會重試，一次短暫失敗就讓整個請求失敗。",
      evidence:
        "src/client.ts:12 只送一次 fetch 就讀 JSON，不檢查狀態碼。src/utils/retry.ts:6 定義了 withRetry，但還沒有任何地方呼叫它。",
    },
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
        setup: [
          {
            need: "瀏覽器測試需要的 Chromium",
            reason:
              "README 的「Browser tests」一節以 npm run test:browser 在瀏覽器中執行重試測試。這台電腦沒有 Playwright 可用的 Chromium，因此這項檢查沒有在這裡執行。",
          },
        ],
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
          quote: "Titles should describe the improvement users get.",
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
  discovery: {
    interests: "開發者工具、文件、無障礙",
    message: ({ count }) =>
      `示範：找到 ${count} 項有來源支持的貢獻機會；仍需確認維護者意願與實作範圍。`,
    warnings: [
      "這是示範結果：專案、issue 與引文皆為虛構，未查詢 GitHub，也未呼叫 AI 模型。",
    ],
    popularity: ({ stars, forks, pushedAt }) =>
      `示範快照：${stars} stars、${forks} forks，最近推送於 ${pushedAt}。人氣不能保證提案會被接受。`,
    opportunities: {
      "markwell-link-positions": {
        title: "讓失效連結的警告標出行號與欄位",
        summary:
          "失效連結的警告目前只有檔名，讀者得在長文件裡自己找。標題規則已經會輸出 `file:line:column`，把同樣的位置資訊接到連結規則，是範圍清楚的第一個貢獻。",
        userNeed:
          "維護文件網站的人修正失效連結時，可以直接跳到出錯的那一行，不必手動搜尋整頁內容。",
        contributionRules:
          "動手前先在 issue 留言認領，避免兩個人修同一件事；每個規則變更都要在 `test/fixtures/` 補上範例，並更新 `CHANGELOG.md`；送出前執行 `npm test` 與 `npm run lint`。",
        feasibility:
          "issue 已說明期望的輸出格式，標題規則也有現成的位置資訊可以參考；變更集中在單一規則與它的測試，適合第一次參與這個專案。",
        effort:
          "約半天到一天：閱讀標題規則如何取得位置、修改連結規則的輸出，再補上測試範例。",
        firstSteps: [
          "在 #57 留言，說明打算沿用標題規則的位置格式。",
          "找出標題規則取得行號與欄位的程式，確認連結規則能否拿到相同的節點位置。",
          "在 `test/fixtures/` 新增一份含失效連結的範例文件。",
        ],
        acceptanceChecks: [
          "失效連結的警告以 `file:line:column` 開頭，位置與連結實際所在相符。",
          "既有的連結與標題測試全部通過。",
          "`CHANGELOG.md` 記錄這次輸出格式的變更。",
        ],
        risks: [
          "輸出格式改變，可能影響解析舊格式的 CI 腳本；需要確認維護者是否視為不相容變更。",
          "動手前請確認 issue 仍未被他人認領。",
        ],
        reasons: [
          "issue 直接提出需求，並指出標題規則已有相同格式，可以作為實作參考。",
          "規範要求規則變更附上測試範例與 CHANGELOG，這決定了這次貢獻的完整範圍。",
        ],
      },
      "cronwise-wrapping-ranges": {
        title: "修正跨週末星期範圍的下次執行時間",
        summary:
          "README 說明 `5-1` 代表星期五到星期一，文字說明也正確，但預覽下次執行時間時漏掉了星期六和星期日。問題很可能出在展開範圍的函式。",
        userNeed:
          "用 cronwise 確認排程的人，會依預覽結果判斷任務何時執行；漏掉週末，會讓他們誤以為週末不會執行。",
        contributionRules:
          "送出 pull request 前先開立或認領 issue；每修正一種運算式，都要在 `tests/test_schedule.py` 補上測試；CI 會檢查 `pytest` 與 `ruff`。",
        feasibility:
          "issue 已指出可疑的函式，README 也明確定義了跨週範圍的預期行為；需要理解範圍展開與排程計算，難度略高於入門。",
        effort:
          "約一到兩天：重現問題、修正範圍展開，並為跨週範圍與一般範圍各補一組測試。",
        firstSteps: [
          "在本機用 `0 22 * * 5-1` 重現 #112 的結果。",
          "閱讀 `expand_range()`，找出起點大於終點時的處理方式。",
          "在 #112 留言認領，並說明修正方向。",
        ],
        acceptanceChecks: [
          "`5-1` 的下次執行時間依序包含星期五、六、日、一。",
          "`1-5` 等一般範圍的結果不變。",
          "`pytest` 與 `ruff` 在本機通過。",
        ],
        risks: [
          "分鐘與小時欄位可能也使用同一個範圍展開函式，修改前要確認不會影響其他欄位。",
          "需要確認維護者是否希望一併處理月份等其他欄位的跨界範圍。",
        ],
        reasons: [
          "回報者指出可疑的實作位置，讓第一步調查有明確的起點。",
          "規範要求每個修正都附上測試，驗收時需要新增測試案例。",
          "README 明確定義 `5-1` 的意義，證明預期行為是星期五到星期一。",
        ],
      },
      "huecheck-skipped-variables": {
        title: "略過 CSS 變數時，告訴使用者略過了哪些宣告",
        summary:
          "使用 `var(--name)` 設定的顏色會被直接略過，程式仍以 0 結束。issue 建議先加上警告，列出被略過的宣告；這比完整解析 CSS 變數小得多。",
        userNeed:
          "依賴設計系統的團隊以為檢查全部通過，其實部分顏色從未被檢查；警告能讓他們看見結果的盲點。",
        contributionRules:
          "這個專案沒有 CONTRIBUTING 文件；請先在 issue 留言，確認維護者接受「先加警告」的做法，再依照既有的程式風格提交。",
        feasibility:
          "issue 已提出範圍明確的第一步，README 也承認目前不支援 CSS 變數；只需要在略過時收集並輸出宣告，不必實作變數解析。",
        effort:
          "約半天：找到略過 `var()` 的位置、收集宣告並輸出警告，再補一個測試。",
        firstSteps: [
          "在 #88 留言，確認維護者偏好先加警告，而不是直接解析變數。",
          "找出讀取顏色時略過 `var()` 的程式位置。",
          "準備一份含 `var(--text-muted)` 的 CSS 測試檔。",
        ],
        acceptanceChecks: [
          "遇到 `var()` 顏色時輸出警告，並列出檔名與宣告。",
          "沒有使用 CSS 變數的檔案，輸出維持不變。",
        ],
        risks: [
          "略過宣告時是否要改變結束代碼，需要先和維護者確認。",
          "沒有 CONTRIBUTING 文件，測試與提交慣例需要從既有的 pull request 推斷。",
        ],
        reasons: [
          "issue 直接建議以警告作為第一步，界定了這次貢獻的範圍。",
          "README 確認目前不解析 CSS 變數，說明這是已知限制，不是使用錯誤。",
        ],
      },
    },
  },
  prFeedback: {
    bodies: {
      review:
        "謝謝，這個改動很清楚，測試也好讀。合併前還有兩件事：\n\n1. 把 `retry.delay` 改名會讓既有設定失效。請讓 `delay` 再支援一個 minor 版本，並在使用時輸出棄用警告。\n2. 希望補一個重試用盡的測試：超過 `maxRetries` 後，應拋出最後一次的錯誤。",
      "retry-after":
        "429 和 503 常會附上 `Retry-After` 標頭。有這個標頭時，等待時間能不能參考它？想另開 issue 後續處理也可以。",
    },
    warnings: [
      "示範回饋：維護者、review 與 CI 檢查都是虛構的，未讀取 GitHub。",
    ],
  },
  extraRecommendations: {
    "demo-retry-after": {
      title: "遵守 Retry-After，等伺服器準備好再重試",
      problem:
        "遇到 429 或 503 時，伺服器常會送出 Retry-After。client 目前忽略它，重試可能在伺服器準備好之前就送達。",
      userImpact:
        "被限流的頁面能在時機正確的那次重試就恢復，不浪費重試次數；伺服器也得到它要求的緩衝時間。",
      approach:
        "從 HttpError 的回應讀取 Retry-After，作為最短等待時間，並仍以 maxDelay 封頂。",
      acceptance: [
        "帶有 Retry-After: 2 的 503 至少等待 2 秒。",
        "即使標頭要求更久，等待也不超過 maxDelay。",
        "沒有這個標頭的回應，維持現有的退避方式。",
      ],
    },
    "demo-retry-cancel": {
      title: "使用者離開頁面時，停止重試",
      problem:
        "withRetry 無法取消。需要資料的頁面關閉後，請求仍會繼續等待與重試。",
      userImpact:
        "離開頁面就停止背景請求，過期的資料不會再出現，也不浪費網路流量。",
      approach:
        "接受 AbortSignal 並傳給 fetch；訊號中止時，立即結束兩次嘗試之間的等待。",
      acceptance: [
        "在等待期間中止，會立即停止後續嘗試。",
        "呼叫端收到 AbortError，而不是最後一次的 HTTP 錯誤。",
        "沒有傳入訊號的請求，行為維持不變。",
      ],
    },
    "demo-validate-options": {
      title: "拒絕不合理的重試設定",
      problem:
        "withRetry 接受任何數字。負數的 maxRetries 會默默停用重試；NaN 永遠到不了上限，會一直重試下去。",
      userImpact:
        "設定打錯時會立刻以清楚的訊息失敗，而不是在正式環境卡住，或丟出難以理解的錯誤。",
      approach:
        "在第一次嘗試前檢查 maxRetries、baseDelay 與 maxDelay，並丟出指出錯誤選項的 RangeError。",
      acceptance: [
        "maxRetries 必須是 0 以上的整數。",
        "baseDelay 與 maxDelay 必須是有限且非負的數字。",
        "錯誤訊息指出選項名稱與它的值。",
      ],
    },
    "demo-delay-deprecation": {
      title: "讓舊的 delay 設定再支援一個版本",
      problem:
        "把 delay 改名為 baseDelay，會默默丟掉既有設定；升級的人會在沒有任何提示下改用預設等待時間。",
      userImpact:
        "團隊可以依自己的時程升級：舊設定照常運作，警告會告訴他們要改什麼。",
      approach:
        "把 retry.delay 當作 baseDelay 的棄用別名，只輸出一次警告，並在 README 註明預計移除的版本。",
      acceptance: [
        "retry.delay 仍會設定第一次的等待上限。",
        "每個 client 只輸出一次棄用警告。",
        "型別把 delay 標記為 @deprecated。",
      ],
    },
    "demo-client-status-tests": {
      title: "測試 client 會重試哪些 HTTP 狀態碼",
      problem:
        "目前的測試只涵蓋 withRetry 本身，沒有檢查 client 會重試 503、遇到 404 則立即停止。",
      userImpact:
        "日後修改狀態碼清單時，不會默默開始重試使用者造成的錯誤，也不會不再重試服務中斷。",
      approach:
        "用一連串預先安排的回應取代 fetch，針對每一類狀態碼檢查呼叫次數。",
      acceptance: [
        "503 之後回傳 200，第二次呼叫就拿到資料。",
        "404 在一次呼叫後拋出 HttpError。",
        "網路錯誤造成的 TypeError 會重試。",
      ],
    },
  },
  rerunReport: {
    reviewer:
      "示範 · 重新審查（預寫內容）\n\n重新閱讀目前的差異：仍是同樣 5 個檔案，第一次審查後沒有新的修改。\n\n**仍待處理**：`retry.delay` 依然會被靜默忽略，`maxRetries` 也仍未驗證；這兩項應優先處理。\n\n**已確認**：每次等待都不會超過 `maxDelay`，`HttpError` 也為呼叫端保留完整的 `Response`。\n\n**本次新發現**：`src/client.ts` 把 `shouldRetry` 放在 `...options.retry` 之後，呼叫端無法覆寫狀態碼判斷；這與 `ClientOptions` 的 `retry` 排除 `shouldRetry` 一致。\n\n本審查為靜態閱讀 diff，未執行程式碼。",
    tester:
      "示範 · 重新測試分析（預寫內容）\n\n仍是先前的兩個案例；第一次分析之後沒有新增測試。\n\n最值得先補的測試：讓 operation 每次都失敗，檢查它執行 `maxRetries + 1` 次並拋出最後一次的錯誤。這也能及早發現永遠停不下來的 `maxRetries` 設定。\n\n仍缺少：固定 `Math.random` 後檢查 `maxDelay` 上限，以及 client 會重試 503、遇到 404 只呼叫一次的測試。\n\n本分析未執行測試，以上皆為靜態閱讀。",
  },
  importSteps: [
    "正在複製 openfetch-sample/open-fetch…",
    "正在切換到 main 分支…",
    "正在讀取 repository…",
    "正在列出追蹤中的檔案…",
  ],
  analysisSteps: [
    "正在閱讀 README 與主要模組…",
    "正在了解大家怎麼使用它…",
    "正在追蹤一次請求經過 client 的路徑…",
    "正在尋找你能幫上忙的地方…",
    "正在對照程式碼核對每個建議…",
  ],
  publishedCard: {
    title: "已開啟 Draft PR",
    note: "示範：未在 GitHub 上建立",
  },
  understanding: {
    summary:
      "這份變更讓失敗的 GET 請求改用逐步拉長、帶隨機性的等待時間重試，不再固定停 1 秒。只有 503 或網路錯誤這類暫時性失敗會重試，等待也不會超過 maxDelay。把 delay 改名成 baseDelay，可能讓既有設定失效。",
    answers: {
      "selfCheck:src/utils/retry.ts": {
        answer: "上限是 2 秒，實際等待時間是低於上限的隨機值。",
        correction: "上限從 1 秒開始每次加倍，所以 attempt 2 的上限是 4 秒。",
      },
      untested: {
        answer: "我沒有測試會送出 Retry-After 的伺服器，因為用戶端目前會忽略它。",
      },
    },
    forecastQuestion: "他們會問重試次數上限有沒有測試。",
  },
  quizzes: {
    "src/utils/retry.ts": "最多 4 秒；jitter 讓每次實際等待都是隨機的，通常更短。",
    "src/client.ts": "不會。404 不在重試清單裡，所以 HttpError 會直接拋出。",
    "src/types.ts": "這樣呼叫端就不能換掉用戶端自己判斷哪些狀態碼要重試的邏輯。",
    "tests/retry.test.ts": "固定的隨機值讓第一輪 1 秒的上限減半，變成 500 毫秒。",
    "README.md": "三個請求，404 會直接失敗。",
  },
  roads: {
    "src/utils/retry.ts": {
      guess: "每次重試前固定等一小段時間，再加一點隨機。",
      why: "伺服器忙不過來時，固定等待還是會引來一波同時的重試。",
    },
    "src/client.ts": {
      guess: "在 shouldRetry 裡直接檢查 error.status，不另外定義錯誤類別。",
      why: "HttpError 保留完整的回應，除錯時比較方便。",
    },
    "src/types.ts": {
      guess: "把 delay 保留成 deprecated 別名一個版本。",
      why: "使用者升級期間，既有設定還能繼續運作。",
    },
    "tests/retry.test.ts": {
      guess: "把假的 sleep 函式傳進 withRetry。",
      why: "比較好讀，但會只為了測試改動公開參數。",
    },
    "README.md": {
      guess: "把重試設定寫在另一個指南頁面。",
      why: "要升級的人會先讀 README。",
    },
  },
  feedbackLessons: {
    "retry-after": "決定等待時間前，先看伺服器要求什麼，例如 Retry-After。",
  },
  practice: {
    "retry-check": {},
    "retry-after-feedback": {
      question:
        "維護者在 src/client.ts 問到 429 與 503 回應。伺服器送出這類回應時，等待時間應該參考什麼？",
      reference:
        "Retry-After 標頭：伺服器會說明要等多久，用戶端至少要等那麼久，但仍受 maxDelay 限制。",
    },
    "types-self-check": {},
  },
  debrief: {
    quotes: ["希望補一個重試用盡的測試：超過 `maxRetries` 後，應拋出最後一次的錯誤。"],
    drills: [
      {
        context: "決定 withRetry 每次重試之間要等多久。",
        optionA: "固定等 1 秒，前後浮動 0.3 秒。",
        optionB: "在每次加倍的上限內隨機等待，並以 maxDelay 封頂。",
        question: "哪一種比較適合這個專案？為什麼？",
        reveal:
          "B：許多畫面共用這個用戶端，失敗常常同時發生，逐步拉長的隨機等待能把重試錯開。A 比較簡單，只有少數用戶端會重試時就夠用。",
      },
    ],
    nextStep: "下次在這裡開 Pull Request 前，先寫最後一次允許重試的測試。",
  },
  restatement: "讓舊的 delay 選項再支援一個版本，並補上會拋出最後一次錯誤的測試。",
  walkthrough: {
    kind: "函式",
    summary:
      "收到設定（`baseURL` 與 `retry`）後，回傳一個帶有 `get` 方法的物件。`get` 用 `baseURL` 組出完整網址、送出請求，再把回覆讀成 JSON。改動前的 `get` 只送一次請求就讀 JSON，不看狀態碼，所以伺服器回 `503` 時也會被當成資料讀取。",
    change:
      "這次把 `get` 的本體包進 `withRetry`，並在讀 JSON 前檢查 `response.ok`。失敗時丟出 `HttpError`，讓 `shouldRetry` 依狀態碼決定要不要再試；`createClient` 本身的用法沒有變。",
    steps: [
      "工廠函式：把 `options` 記在閉包裡，回傳的物件之後每次呼叫 `get` 都讀得到同一份設定。",
      "`get` 的核心：組網址、送請求、確認狀態碼成功，再解析 JSON。這幾行包在傳給 `withRetry` 的函式裡，所以每次重試都會重新送一次請求。",
      "重試設定：先沿用使用者給的 `retry`，再加上判斷哪些錯誤值得重試。暫時性的伺服器錯誤與網路錯誤會再試，`401`、`404` 這類需要修正的錯誤不會。",
      "收尾：結束 `withRetry` 呼叫與回傳的物件。",
    ],
    callers: [
      {
        name: "README 的使用範例",
        note: "示範用 `baseURL` 與 `retry` 建立 client。",
      },
    ],
    callees: [
      "負責重試次數與等待時間；`get` 只告訴它要做什麼、哪些錯誤可以再試。",
      "把失敗的 Response 留下來，`shouldRetry` 才看得到狀態碼。",
      "瀏覽器與 Node.js 內建的 HTTP 請求；遇到 `500` 仍會正常回傳 Response，不會自己丟錯。",
    ],
    analogy:
      "像請助理幫你打電話訂位：你先交代餐廳名單（`baseURL`），之後每次只說想訂哪一家（`path`）。忙線時助理會照你的規則再撥（`withRetry`），但對方說「沒有這家店」就不必一直重撥。",
    selfCheck: {
      question:
        "為什麼 `fetch` 那一行要放在傳給 `withRetry` 的函式裡，而不是先 `fetch` 一次再把結果交給 `withRetry`？",
      answer:
        "`withRetry` 每次重試都會重新呼叫傳進去的函式。把 `fetch` 放在裡面，每次重試才會真的重新送出請求；先 `fetch` 再交出去，重試只會重複讀同一個失敗的結果。",
    },
  },
});

export default zhTW;
