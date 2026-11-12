/** Settings (Traditional Chinese, Taiwan). */
import { formatters, type Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/settings";

const fmt = formatters("zh-TW");
const number = (value: number) => fmt.number(value);

const m: Translation<typeof en> = {
  title: "設定",
  intro: "這裡的設定都只保留在這台電腦上。",
  nav: { label: "設定分類" },
  sections: {
    general: "一般",
    provider: "AI 服務",
    safety: "Agent 安全",
    learning: "學習",
    performance: "效能",
    environment: "工作環境",
    data: "資料與隱私",
    about: "關於",
  },
  state: {
    loading: "載入中…",
    saving: "正在儲存…",
    saved: "已儲存。",
    loadFailed: ({ message }) => `設定沒有載入：${message}`,
    retry: "再試一次",
    cancel: "取消",
  },
  lock: {
    badge: "由環境設定",
    hint: ({ variable }) =>
      `這項由環境變數 ${variable} 設定。請在那裡修改，然後重新啟動 ${product.name}。`,
  },
  status: {
    checking: "檢查中…",
    ready: "已就緒",
    signedOut: "尚未登入",
    missing: "尚未安裝",
    notWorking: "無法使用",
    disabled: "已停用",
    connected: "已連線",
  },
  general: {
    devices: {
      unknown: "無資料",
      title: "裝置",
      text: "任何已配對裝置都可列出並撤銷任何裝置。",
      current: "此裝置",
      created: "建立時間",
      lastUsed: "上次使用",
      never: "尚未使用",
      revoke: "撤銷裝置",
      empty: "沒有已配對裝置。",
      access: "裝置遺失或遭竊？請從另一台已配對裝置撤銷，或在主機執行 bell-pr token rotate 使所有裝置失效。",
    },
    language: {
      title: "語言",
      text: "介面與之後新的貢獻、專案分析、問答都使用這個語言。已開始的貢獻沿用原本的語言。已經產生的內容不會翻譯。",
      label: "語言",
    },
    sample: {
      title: "示範專案",
      text: "示範專案用示範資料走過一次完整的貢獻，不需要任何工具或帳號就能試用每個步驟。",
      show: "顯示示範專案",
      showHelp: "開始你自己的貢獻後，示範專案仍留在側邊欄。關閉時，你有自己的貢獻後示範專案就會隱藏。",
      reset: "重設示範專案",
      resetHelp: "清除這個瀏覽器中示範專案的審閱進度、草稿與方向設定。",
      resetConfirm: "要讓示範專案從頭開始嗎？這個瀏覽器中的示範進度會被清除，頁面會重新載入。",
      resetYes: "重設並重新載入",
      resetFailed: "這個瀏覽器不允許清除示範專案的進度。",
    },
  },
  provider: {
    title: "AI 服務",
    intro: "Agent 透過這台電腦上的 AI 程式開發 CLI 工作：已安裝並登入的 Codex CLI、Claude Code 或 Antigravity CLI。",
    needOne: "你至少需要一個 AI 服務。請安裝並登入其中一個，指令列在下方。",
    readyWith: ({ providers }) => `已可使用 ${fmt.list(providers)}。`,
    description: {
      codex: "使用你已安裝並登入的 Codex CLI。用量計入你自己的帳號。",
      claude:
        "使用你已安裝並登入的 Claude Code CLI（Claude 方案或 Anthropic API 金鑰）。用量計入你自己的帳號。",
      antigravity:
        "使用你已安裝並登入的 Antigravity CLI（agy；Google 帳號、Gemini API 金鑰或 Google Cloud 憑證）。用量計入你自己的帳號。",
    },
    fixesTitle: "請執行以下指令完成設定：",
    models: {
      loading: "正在載入模型設定…",
      reload: "重新載入模型設定",
      save: "儲存模型設定",
      saved: "模型設定已儲存。",
      current: "查看目前貢獻使用的模型",
    },
  },
  safety: {
    title: "Agent 安全",
    intro: "Agent 會在這台電腦上執行專案的程式碼，這些設定決定它們能接觸到哪些東西。",
    sandbox: {
      title: "Claude Code 沙箱",
      text: "會修改檔案的 Claude Code Agent 在作業系統沙箱裡執行每個指令。寫入只限於該工作的工作目錄與 Claude Code 的暫存資料夾。網路是關閉的。你自己的 Claude Code 使用者設定可能放寬沙箱（proxy 連接埠、允許的網域或路徑、排除的指令、外掛的語言伺服器）。Codex CLI 使用它自己的沙箱。會修改檔案的 Antigravity Agent 在 Antigravity CLI 的終端機沙箱裡執行指令。寫入只限於工作目錄。網路是關閉的。",
    },
    unsandboxed: {
      label: "允許 Claude Code 與 Antigravity Agent 在沙箱外執行",
      help: "只在沙箱無法使用時才會用到。關閉時，需要它的工作會被拒絕。",
      confirmTitle: "要允許 Agent 在沙箱外執行嗎？",
      confirmText:
        "沙箱無法使用時，會修改檔案的 Claude Code 與 Antigravity Agent 將在沙箱外執行，因此能讀取與修改你的使用者帳號可以存取的一切，例如其他專案、你的 SSH 金鑰與各個工具的登入資訊。請只對你信任的專案這樣做。",
      confirmBadge: "只要有 Agent 在沙箱外工作過，該工作在貢獻工作台會帶有標記，紀錄中也會註明。",
      confirm: "允許在沙箱外執行",
      cancel: "維持使用沙箱",
    },
    web: {
      title: "網路存取",
      text: "可在「AI 服務」設定網路存取。Codex 與 Claude Code 只有在開啟後，才會在任務與追問中啟用網路工具。",
      exception: "Antigravity 的網路搜尋無法關閉，包含專案分析與探索。關閉此設定只會禁止它透過網頁讀取工具取得網頁內容。",
      privacy: "搜尋關鍵字會送到服務提供者的搜尋服務。處理機密資料時，請選擇能關閉網路搜尋的服務，並保持關閉。",
      open: "開啟 AI 服務設定",
    },
    disclose: {
      title: "AI 協助說明",
      label: "一律在我的 pull request 加上 AI 協助說明",
      help: "預設關閉：只有專案自己的規則要求時，pull request 草稿才會提到 AI。",
    },
  },
  learning: {
    title: "學習",
    intro: `${product.name} 如何在你核准之前請你確認自己理解變更，以及審閱時如何請你先想一想。`,
    check: {
      title: "理解檢查",
      text: "核准 pull request 之前，你要用自己的話講一遍這個變更、回答幾個相關問題，並自己對照參考答案評分。不會有 AI 模型替你評分。",
      label: "核准前，請我用自己的話講一遍每個變更",
      help: "開啟時，需針對最新版本的變更完成檢查，才能核准與發布。",
      lockedBy: ({ variable }) =>
        `由 ${variable} 保持開啟。移除這個變數並重新啟動 ${product.name} 才能修改。`,
      confirmTitle: "不用自己的話講一遍就核准？",
      confirmLost: "你將可以核准一個自己沒有講解過的 pull request。",
      confirmKept:
        "每個檔案仍須審閱，pull request 仍由你親自核准，專案規則、issue 與發布節奏的檢查也都照常進行。",
      confirmRecorded:
        "沒有經過檢查就核准的任務會永久標記為「檢查已關閉」：在貢獻工作台、你的學習紀錄與匯出檔中都看得到。",
      confirmBack: "你隨時可以重新開啟；屆時已核准的任務在發布前也必須先通過檢查。",
      keep: "保留檢查",
      turnOff: "關閉檢查",
    },
    counts: {
      checkOff: ({ count }) => `未經檢查就核准的任務：${number(count)}`,
      median: ({ count, minutes }) =>
        `最近 ${number(count)} 次檢查花費時間的中位數：${fmt.number(minutes, { maximumFractionDigits: 1 })} 分鐘`,
      local: "只在這台電腦上計算。",
    },
    tryFirst: {
      title: "先試著答",
      label: "先請我作答，再顯示答案",
      help: "預設開啟。你先作答：每個檔案的問題、猜猜另一種改法，以及程式碼解說裡每段的「考考自己」。之後才顯示答案與其他做法。關閉後，它們會收在單純的顯示按鈕或摺疊後面，不需要填寫。",
    },
  },
  performance: {
    title: "效能",
    intro: "同時進行多少工作，以及單次 Agent 回合最多能花多久。",
    maxActiveRuns: {
      label: "同時執行的工作數",
      help: "1 到 8。超過上限的工作會排隊等待。",
    },
    maxAgentProcesses: {
      label: "同時執行的 Agent CLI 行程數",
      help: "1 到 32。每位隊友、Reviewer 與 Test analyst 各需要一個，所有工作、專案分析與探索共用。",
    },
    agentTimeoutScale: {
      label: "Agent 逾時倍數",
      help: "0.5 到 10。大型專案或較高的思考強度逾時時，請調高它。",
    },
    queue: ({ count }) => `執行中、排隊中與等待核准計畫的工作合計最多 ${number(count)} 個。`,
    usage:
      "同時執行多個 Agent 會更快消耗你在服務提供者的帳號用量。在個人 Claude 方案上大量平行使用，可能超出該方案預期的個人使用範圍。",
    save: "儲存上限",
    saved: "上限已儲存。",
    invalid: ({ min, max }) => `請輸入 ${number(min)} 到 ${number(max)} 之間的數字。`,
    invalidWhole: ({ min, max }) => `請輸入 ${number(min)} 到 ${number(max)} 之間的整數。`,
  },
  environment: {
    title: "工作環境",
    intro: `${product.name} 在這台電腦上需要的工具，現在的檢查結果，以及缺少時的修正指令。`,
    github: {
      title: "GitHub CLI",
      connectedAs: ({ user }) => `以 ${user} 連線`,
      description: "匯入專案、推送分支與建立 Draft PR",
    },
    advanced: {
      summary: "進階：環境變數",
      text: `${product.name} 啟動前設定的環境變數優先於這裡的設定。該設定會顯示為由環境設定。修改後請重新啟動 ${product.name}。`,
      documentation: "詳見說明文件。",
      variables: {
        BELLPR_DATA_DIR: "資料目錄的位置（也可用 --data-dir）。預設是家目錄中的 .bellpr 資料夾。",
        BELLPR_MAX_ACTIVE_RUNS: "同時執行的工作數：1 到 8，預設 2。",
        BELLPR_MAX_AGENT_PROCESSES: "同時執行的 Agent CLI 行程數：1 到 32，預設 3。",
        BELLPR_AGENT_TIMEOUT_SCALE: "Agent 逾時倍數：0.5 到 10，預設 1。",
        BELLPR_ALLOW_UNSANDBOXED_AGENTS: "設為 1 允許 Claude Code 與 Antigravity Agent 在沙箱外執行。",
        BELLPR_REQUIRE_UNDERSTANDING_CHECK: "設為 1 會保持理解檢查開啟並鎖定這項設定。沒有任何值能關閉它。",
        BELLPR_RETENTION_DAYS: "保留已停止與失敗工作檔案的天數：1 到 365，預設 14。",
        BELLPR_LOG_LEVEL: "伺服器記錄的詳細程度：debug、info（預設）、warn 或 error。",
      },
    },
  },
  data: {
    title: "資料與隱私",
    intro: `${product.name} 把所有資料保存在這台電腦上的一個資料目錄。`,
    dataDir: {
      title: "資料目錄",
      copyLabel: "複製資料目錄的路徑",
    },
    storage: {
      title: "儲存空間",
      loading: "正在計算資料目錄的大小…",
      loadFailed: ({ message }) => `儲存空間用量沒有載入：${message}`,
      measuredAt: ({ time }) => `計算時間：${time}`,
      refresh: "重新計算",
      total: "合計",
      clones: "專案複本",
      analyses: "專案分析",
      logs: "紀錄",
      runs: "工作的檔案",
      runsHelp: "每個工作的工作目錄與隊友的獨立工作目錄。釋放空間後，工作的紀錄、報告與筆記都會保留。",
      published: "已發布的工作",
      publishedHelp: "已發布的工作會保留工作目錄，因為之後每一輪修正與同步都需要它。不再需要時再釋放。",
      others: "其他工作",
      noRuns: "沒有任何工作在磁碟上留有檔案。",
      runMeta: ({ status, date }) => `${status} · ${date}`,
      free: "釋放空間",
      freeLabel: ({ title }) => `釋放「${title}」的空間`,
      freeing: "釋放中…",
      freed: ({ size }) => `已釋放 ${size}。`,
      confirmFree: "要釋放這個工作的檔案嗎？之後就無法在這裡審閱或發布它的變更。",
      confirmPublished: "要釋放這個已發布工作的工作目錄嗎？之後它就無法再做一輪修正或同步。",
      outside: "位於資料目錄之外",
      busy: "進行中",
    },
    retention: {
      title: "自動清理",
      label: "保留已停止與失敗工作檔案的天數",
      help: "1 到 365。已停止或失敗的工作在這麼多天沒有動靜後，工作檔案會被移除；紀錄、報告與筆記會保留。已發布的工作會一直保留，直到你釋放它。",
      save: "儲存",
    },
    erase: {
      title: "刪除所有資料",
      text: "刪除資料目錄中的所有專案、工作、分析、探索結果、紀錄與備份。你的設定會保留。這個動作無法復原。",
      open: "刪除所有資料…",
      label: "輸入 ERASE 以確認",
      button: "刪除所有資料",
      erasing: "正在刪除…",
      done: "所有資料都已刪除，頁面會重新載入。",
    },
    privacy: {
      title: "哪些資料會離開這台電腦",
      none: `${product.name} 不傳送遙測、分析或當機報告，也沒有自己的帳號或雲端服務。`,
      ai: "你的程式碼與問題會以你自己的帳號，送到你使用的 AI 程式開發 CLI 的服務提供者。",
      github: "GitHub 會收到 GitHub CLI 與 Git 以你的帳號傳送的內容：複製與搜尋，以及只在你核准後才建立的分支與 draft pull request。",
      web: "除非你開啟，Agent 不會存取網路。",
      rest: "其他一切都留在資料目錄中。",
    },
  },
  about: {
    title: "關於",
    text: `${product.name} 是一個本機優先的開源貢獻工作台。`,
    version: "版本",
    open: `關於 ${product.name}`,
    docs: "說明文件",
    website: "網站",
  },
  modelDialog: {
    title: "設定貢獻模型",
    subtitle: "所有專案共用，套用到之後建立的任務與專案分析。",
    loading: "正在載入模型設定…",
    reload: "重新載入模型設定",
    close: "關閉",
    saving: "正在儲存…",
    save: "儲存設定",
  },
};

export default m;
