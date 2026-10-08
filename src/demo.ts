import type { DiffFile, Repo, Run } from "./types";

export const demoRepo: Repo = {
  id: "demo-repo",
  name: "open-fetch",
  owner: "acme-labs",
  fullName: "acme-labs/open-fetch",
  path: "",
  defaultBranch: "main",
  url: "",
  language: "TypeScript",
};

function diff(
  path: string,
  lines: string[],
  explanation: NonNullable<DiffFile["explanation"]>,
  status = "modified",
): DiffFile {
  const additions = lines.filter((line) => line.startsWith("+")).length;
  const deletions = lines.filter((line) => line.startsWith("-")).length;
  const oldCount = lines.filter((line) => !line.startsWith("+")).length;
  const newCount = lines.filter((line) => !line.startsWith("-")).length;
  return {
    path,
    language: path.endsWith(".md") ? "Markdown" : "TypeScript",
    additions,
    deletions,
    status,
    patch: `diff --git a/${path} b/${path}\n--- ${status === "added" ? "/dev/null" : `a/${path}`}\n+++ b/${path}\n@@ -${oldCount ? "1" : "0"},${oldCount} +1,${newCount} @@\n${lines.join("\n")}\n`,
    explanation,
  };
}

export const demoFiles: DiffFile[] = [
  diff(
    "src/utils/retry.ts",
    [
      " import type { RetryOptions } from '../types';",
      " ",
      " const sleep = (ms: number) =>",
      "   new Promise<void>((resolve) => setTimeout(resolve, ms));",
      " ",
      " export async function withRetry<T>(",
      "   operation: () => Promise<T>,",
      "   options: RetryOptions = {},",
      " ): Promise<T> {",
      "-  const { maxRetries = 3, delay = 1000 } = options;",
      "+  const {",
      "+    maxRetries = 3,",
      "+    baseDelay = 1000,",
      "+    maxDelay = 30_000,",
      "+    shouldRetry = () => true,",
      "+  } = options;",
      " ",
      "   for (let attempt = 0; ; attempt++) {",
      "     try {",
      "       return await operation();",
      "     } catch (error) {",
      "-      if (attempt >= maxRetries) throw error;",
      "-      await sleep(delay);",
      "+      if (attempt >= maxRetries || !shouldRetry(error)) {",
      "+        throw error;",
      "+      }",
      "+",
      "+      // Exponential backoff with full jitter.",
      "+      const ceiling = Math.min(",
      "+        maxDelay,",
      "+        baseDelay * 2 ** attempt,",
      "+      );",
      "+      const delay = Math.floor(Math.random() * ceiling);",
      "+      await sleep(delay);",
      "     }",
      "   }",
      " }",
    ],
    {
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
  ),
  diff(
    "src/client.ts",
    [
      " import { withRetry } from './utils/retry';",
      " import type { ClientOptions } from './types';",
      " ",
      "+export class HttpError extends Error {",
      "+  constructor(public readonly response: Response) {",
      "+    super(`HTTP ${response.status}`);",
      "+  }",
      "+}",
      "+",
      " export function createClient(options: ClientOptions) {",
      "   return {",
      "     async get<T>(path: string): Promise<T> {",
      "-      const response = await fetch(new URL(path, options.baseURL));",
      "-      return response.json() as Promise<T>;",
      "+      return withRetry(async () => {",
      "+        const response = await fetch(new URL(path, options.baseURL));",
      "+        if (!response.ok) throw new HttpError(response);",
      "+        return response.json() as Promise<T>;",
      "+      }, {",
      "+        ...options.retry,",
      "+        shouldRetry: (error) => error instanceof HttpError",
      "+          ? [408, 429, 500, 502, 503, 504].includes(error.response.status)",
      "+          : error instanceof TypeError,",
      "+      });",
      "     },",
      "   };",
      " }",
    ],
    {
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
  ),
  diff(
    "src/types.ts",
    [
      " export interface RetryOptions {",
      "   maxRetries?: number;",
      "-  delay?: number;",
      "+  /** Initial backoff ceiling, in milliseconds. */",
      "+  baseDelay?: number;",
      "+  /** Maximum backoff ceiling, in milliseconds. */",
      "+  maxDelay?: number;",
      "+  /** Return true to allow another attempt. */",
      "+  shouldRetry?: (error: unknown) => boolean;",
      " }",
      " ",
      " export interface ClientOptions {",
      "   baseURL: string;",
      "+  retry?: Omit<RetryOptions, 'shouldRetry'>;",
      " }",
    ],
    {
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
  ),
  diff(
    "tests/retry.test.ts",
    [
      "+import { afterEach, describe, expect, it, vi } from 'vitest';",
      "+import { withRetry } from '../src/utils/retry';",
      "+",
      "+describe('withRetry', () => {",
      "+  afterEach(() => {",
      "+    vi.restoreAllMocks();",
      "+    vi.useRealTimers();",
      "+  });",
      "+",
      "+  it('recovers after a temporary failure', async () => {",
      "+    vi.useFakeTimers();",
      "+    vi.spyOn(Math, 'random').mockReturnValue(0.5);",
      "+    const operation = vi.fn()",
      "+      .mockRejectedValueOnce(new Error('temporary'))",
      "+      .mockResolvedValue('ok');",
      "+",
      "+    const result = withRetry(operation);",
      "+    await vi.advanceTimersByTimeAsync(500);",
      "+    await expect(result).resolves.toBe('ok');",
      "+    expect(operation).toHaveBeenCalledTimes(2);",
      "+  });",
      "+",
      "+  it('does not retry an excluded error', async () => {",
      "+    const error = new Error('not retryable');",
      "+    const operation = vi.fn().mockRejectedValue(error);",
      "+    await expect(withRetry(operation, {",
      "+      shouldRetry: () => false,",
      "+    })).rejects.toBe(error);",
      "+    expect(operation).toHaveBeenCalledTimes(1);",
      "+  });",
      "+});",
    ],
    {
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
    "added",
  ),
  diff(
    "README.md",
    [
      " # Open Fetch",
      " ",
      " A small, typed HTTP client for modern applications.",
      "+",
      "+## Automatic retries",
      "+",
      "+GET requests retry temporary failures with exponential backoff",
      "+and full jitter. The default is 3 retries after the first attempt.",
      "+",
      "+```ts",
      "+const client = createClient({",
      "+  baseURL: 'https://api.example.com',",
      "+  retry: { maxRetries: 3, baseDelay: 1000, maxDelay: 30_000 },",
      "+});",
      "+```",
      "+",
      "+Only network errors and HTTP 408, 429, 500, 502, 503, 504 are retried.",
      "+Other HTTP errors fail immediately.",
      "+",
      "+### Migration",
      "+",
      "+Replace `retry.delay` with `retry.baseDelay`. Unlike a fixed delay,",
      "+this value sets the upper bound of the first randomized wait.",
    ],
    {
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
  ),
];

export const demoRun: Run = {
  id: "demo-run",
  repoId: demoRepo.id,
  title: "讓每一次請求，都有重試的機會",
  prompt:
    "為 SDK 的 GET 請求加入指數退避與 jitter，保留可設定的重試次數，補上測試和使用文件。",
  status: "review",
  branch: "feat/smart-retry",
  baseBranch: "main",
  createdAt: "2026-10-03T01:30:00.000Z",
  agents: [
    {
      id: "planner",
      name: "Planner",
      role: "任務規劃",
      status: "complete",
      detail: "已完成示範開發計畫",
    },
    {
      id: "developer",
      name: "Developer",
      role: "程式開發",
      status: "complete",
      detail: "已產生 3 個核心檔案的示範變更",
    },
    {
      id: "reviewer",
      name: "Reviewer",
      role: "品質審查",
      status: "complete",
      detail: "已整理示範審閱重點",
    },
    {
      id: "tester",
      name: "Tester",
      role: "測試驗證",
      status: "complete",
      detail: "已準備測試範例；未實際執行",
    },
  ],
  logs: [
    {
      time: "09:30",
      agent: "Planner",
      message: "示範：將任務拆成重試工具、HTTP 整合、測試與文件。",
    },
    {
      time: "09:32",
      agent: "Developer",
      message: "示範：使用指數退避搭配 full jitter，並限制最大等待時間。",
    },
    {
      time: "09:34",
      agent: "Reviewer",
      message: "示範：標示 API 相容性與測試覆蓋範圍，等待人工確認。",
    },
  ],
  draft: {
    title: "feat: add exponential backoff and jitter to GET retries",
    body: "## Summary\n\n- Add configurable exponential backoff with full jitter.\n- Retry temporary GET failures and preserve HTTP error details.\n- Add example retry tests and document the new configuration.\n\n## Compatibility\n\n`retry.delay` is renamed to `retry.baseDelay`; callers must update their configuration.\n\n## Validation\n\nThis is demonstration content. Tests have not been executed against a real repository.\n\n## Review notes\n\nConfirm parameter validation, maximum retry coverage, cancellation behavior and Retry-After handling before production use.",
  },
  reviewedFiles: [],
  reports: {
    implementer:
      "示範 · Lead 整合摘要（預寫內容）\n\n三個任務已整合：`src/utils/retry.ts` 的 `withRetry` 改為指數退避搭配 full jitter，並新增 `baseDelay`、`maxDelay` 與 `shouldRetry` 選項；`src/client.ts` 只對 GET 請求啟用重試；`tests/retry.test.ts` 補上兩個案例；README.md 記錄新的設定方式。\n\n靜態檢查：各任務回報的變更與整合後的 diff 一致。本示範未執行專案測試。\n\n未完成事項：`retry.delay` 更名為 `retry.baseDelay` 屬於不相容變更，仍需維護者確認版本號與遷移說明。\n\n## Suggested review order:\n\n先讀型別定義，知道新選項有哪些；再讀實作與呼叫端，看它們怎麼使用；測試放最後，用來驗證前面讀到的理解。\n\n1. `src/types.ts` — 新增的 `baseDelay`、`maxDelay`、`shouldRetry` 在這裡定義，其他檔案都依賴它。\n2. `src/utils/retry.ts` — 指數退避與 jitter 的實作，是這次變更的核心。\n3. `src/client.ts` — 呼叫端，只對 GET 請求啟用重試。\n4. `tests/retry.test.ts` — 兩個案例對應上面讀到的行為。\n5. `README.md` — 最後看使用者會讀到的設定說明是否一致。",
    reviewer:
      "示範 · 獨立審查（預寫內容）\n\n**正確性**：`src/utils/retry.ts` 以 `Math.floor(Math.random() * ceiling)` 計算等待時間，`ceiling` 以 `maxDelay` 封頂，等待不會超過上限；但 `maxRetries` 為負數或非整數時會直接拋出第一次錯誤而沒有提示。\n\n**相容性**：`src/client.ts` 改讀 `retry.baseDelay`，仍傳 `retry.delay` 的舊呼叫端會被靜默忽略，建議在型別或執行期提醒。\n\n**可維護性**：重試與否集中在 `shouldRetry`，之後支援 `Retry-After` 時只需擴充一處。\n\n本審查為靜態閱讀 diff，未執行程式碼。",
    tester:
      "示範 · 測試分析（預寫內容）\n\n`tests/retry.test.ts` 目前有兩個案例：暫時失敗後第二次成功、`shouldRetry` 回傳 false 時保留原始錯誤並只呼叫一次。\n\n缺少的案例：\n\n1. 達到 `maxRetries` 後仍失敗，應拋出最後一次的錯誤。\n2. 固定 `Math.random` 後驗證每一輪等待都不超過 `maxDelay`。\n3. `src/client.ts` 對 POST 不重試。\n\n回歸風險：`retry.delay` 改名後，舊設定會以預設 `baseDelay` 執行，現有測試無法察覺這種靜默變更。\n\n本分析未執行測試，以上皆為靜態閱讀。",
  },
};

/** Local fixture responses, never represented as a model-generated answer. */
export function demoAnswer(file: DiffFile, question: string): string {
  const prefix = "示範回覆 · 本機預寫內容，未呼叫 AI 模型。\n\n";
  if (/測試|test|驗證|怎麼確認/i.test(question)) {
    return `${prefix}針對 ${file.path}，可以從可觀察的行為開始驗證：\n\n1. 第一次成功時，只呼叫 operation 一次。\n2. 暫時失敗後可以再試，但總呼叫次數不超過 maxRetries + 1。\n3. shouldRetry 回傳 false 時，保留原始錯誤並立即停止。\n4. 固定隨機值並使用 fake timers，檢查每輪等待上限與 maxDelay。\n\n目前示範測試只有成功恢復與不重試兩個案例，其他邊界條件還需要補齊。`;
  }
  if (/jitter|隨機|退避|指數|2 \*\*|Math\.random/i.test(question)) {
    return `${prefix}可以把它想成一群人遇到塞車後，分批再出發。\n\n第 1、2、3 輪的等待上限依序是 1、2、4 秒；程式用 baseDelay × 2^attempt 計算，再用 maxDelay 限制上限。\n\nMath.random() 會把真正的等待時間散佈在 0 到上限之間，這就是 full jitter。假設固定回傳 0.5，三輪實際等待就是 0.5、1、2 秒。\n\n隨機化能分散同時重試的流量，但不保證某一個請求一定成功。`;
  }
  if (/風險|注意|改善|問題|相容|更好/i.test(question)) {
    return `${prefix}${file.explanation?.tip ?? "先確認這段變更的輸入、輸出與錯誤處理。"}\n\n這份示範還需要驗證負數或非有限數值的設定、取消請求、Retry-After，以及超出重試次數時是否保留原始錯誤。實際貢獻時，應以目標 repository 的既有約定和測試結果為準。`;
  }
  if (/為什麼|why|原因/i.test(question)) {
    return `${prefix}${file.explanation?.reason ?? "這份示範著重在將暫時性失敗的恢復邏輯集中管理。"}\n\n${file.explanation?.concept ?? ""}\n\n可以回頭對照 diff：紅色是移除的行，綠色是新增的行；沒標色的行提供上下文。`;
  }
  return `${prefix}${file.path}\n\n${file.explanation?.summary ?? "這個檔案包含本次任務的程式變更。"}\n\n${file.explanation?.concept ?? ""}\n\n這是依檔案與關鍵字挑選的教學範例，不是對所選程式碼的即時推論。連接真實任務後，追問會交給設定的模型處理。`;
}
