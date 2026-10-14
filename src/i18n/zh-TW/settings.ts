/** Settings (Traditional Chinese, Taiwan). */
import { formatters, type Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/settings";

const fmt = formatters("zh-TW");
const number = (value: number) => fmt.number(value);

const m: Translation<typeof en> = {
  eyebrow: "設定",
  title: "讓工作環境準備就緒。",
  intro: "語言、AI 服務、Agent 安全、上限、資料與授權。這裡的設定都只保留在這台電腦上。",
  nav: { label: "設定分類" },
  sections: {
    general: "一般",
    provider: "AI 服務",
    safety: "Agent 安全",
    performance: "效能",
    environment: "工作環境",
    data: "資料與隱私",
    license: "授權",
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
    connected: "已連線",
  },
  general: {
    language: {
      title: "語言",
      text: "介面的語言，也是之後新的貢獻、專案分析與問答使用的語言；已開始的貢獻沿用開始時的語言，已經產生的內容不會翻譯。",
      label: "語言",
    },
    sample: {
      title: "範例專案",
      text: "範例專案用範例資料走過一次完整的貢獻，不需要任何工具或帳號就能試用每個步驟。",
      show: "顯示範例專案",
      showHelp: "開始你自己的貢獻後，範例仍留在側邊欄。關閉時，你有自己的貢獻後範例就會隱藏。",
      reset: "重設範例專案",
      resetHelp: "清除這個瀏覽器中範例專案的審閱進度、草稿與方向設定。",
      resetConfirm: "要讓範例專案從頭開始嗎？這個瀏覽器中的範例進度會被清除，頁面會重新載入。",
      resetYes: "重設並重新載入",
      resetFailed: "這個瀏覽器不允許清除範例專案的進度。",
    },
  },
  provider: {
    title: "AI 服務",
    intro: "Agent 透過這台電腦上的 AI 程式開發 CLI 工作：已安裝並登入的 Codex CLI 或 Claude Code。",
    needOne: "你至少需要一個 AI 服務。請安裝並登入 Codex CLI 或 Claude Code，指令列在下方。",
    readyWith: ({ providers }) => `已可使用 ${fmt.list(providers)}。`,
    description: {
      codex: "使用你已安裝並登入的 Codex CLI，用量計入你自己的帳戶。",
      claude:
        "使用你已安裝並登入的 Claude Code CLI（Claude 方案或 Anthropic API 金鑰），用量計入你自己的帳戶。",
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
      text: "會修改檔案的 Claude Code Agent 在作業系統沙箱裡執行每個指令：寫入只限於該工作的 checkout，網路也是關閉的。Codex CLI 使用它自己的沙箱。",
    },
    unsandboxed: {
      label: "允許 Claude Code Agent 在沙箱外執行",
      help: "只在沙箱無法使用時才會用到。關閉時，需要它的工作會被拒絕。",
      confirmTitle: "要允許 Agent 在沙箱外執行嗎？",
      confirmText:
        "沙箱無法使用時，會修改檔案的 Claude Code Agent 將在沙箱外執行，因此能讀取與修改你的使用者帳號可以存取的一切，例如其他專案、你的 SSH 金鑰與各個工具的登入資訊。請只對你信任的專案這樣做。",
      confirmBadge: "只要有 Agent 在沙箱外工作過，該工作在工作區會帶有標記，紀錄中也會註明。",
      confirm: "允許在沙箱外執行",
      cancel: "維持使用沙箱",
    },
    web: {
      title: "網路存取",
      text: "除非你在「AI 服務」中開啟，否則不會啟用。開啟後，貢獻工作與追問中的 Agent 可以透過 AI CLI 自己的網路工具搜尋網路並閱讀網頁；專案分析與探索永遠不會使用它。",
      privacy: "搜尋關鍵字會送到服務提供者的搜尋服務，網頁則從存放它們的網站取得。處理機密程式碼時請保持關閉。",
      pro: "網路存取是 Pro 功能。",
      open: "開啟 AI 服務設定",
    },
    disclose: {
      title: "AI 協助說明",
      label: "一律在我的 pull request 加上 AI 協助說明",
      help: "預設關閉：只有專案自己的規則要求時，pull request 草稿才會提到 AI。",
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
      help: "1 到 32。每位 teammate、Reviewer 與 Test analyst 各需要一個，所有工作、專案分析與探索共用。",
    },
    agentTimeoutScale: {
      label: "Agent 逾時倍數",
      help: "0.5 到 10。大型專案或較高的思考強度逾時時，請調高它。",
    },
    effective: ({ configured, effective }) =>
      `設定為 ${number(configured)}，實際為 ${number(effective)}（Free）。`,
    freeHint: "Free 一次執行一個貢獻，其他的排隊等待；Pro 依你在這裡的設定同時執行。",
    queue: ({ count }) => `執行中、排隊中與等待確認計畫的工作合計最多 ${number(count)} 個。`,
    usage:
      "同時執行多個 Agent 會更快消耗你在服務提供者的帳戶用量。在個人 Claude 方案上大量平行使用，可能超出該方案預期的個人使用範圍。",
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
      text: `${product.name} 啟動前設定的環境變數優先於這裡的設定，該設定會顯示為由環境設定。修改後請重新啟動 ${product.name}。`,
      documentation: "詳見說明文件。",
      variables: {
        BELLPR_DATA_DIR: "資料目錄的位置（也可用 --data-dir）。預設是家目錄中的 .bellpr 資料夾。",
        BELLPR_MAX_ACTIVE_RUNS: "同時執行的工作數：1 到 8，預設 2。",
        BELLPR_MAX_AGENT_PROCESSES: "同時執行的 Agent CLI 行程數：1 到 32，預設 3。",
        BELLPR_AGENT_TIMEOUT_SCALE: "Agent 逾時倍數：0.5 到 10，預設 1。",
        BELLPR_ALLOW_UNSANDBOXED_AGENTS: "設為 1 允許 Claude Code Agent 在沙箱外執行。",
        BELLPR_RETENTION_DAYS: "保留已取消與失敗工作檔案的天數：1 到 365，預設 14。",
        BELLPR_LOG_LEVEL: "伺服器紀錄的詳細程度：debug、info（預設）、warn 或 error。",
        BELLPR_LICENSE_KEY: "Pro 授權金鑰，優先於在 App 中儲存的金鑰。",
      },
    },
  },
  data: {
    title: "資料與隱私",
    intro: `${product.name} 把所有資料保存在這台電腦上的一個資料目錄。沒有 ${product.name} 雲端，也沒有遙測。`,
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
      runsHelp: "每個工作的工作副本與 teammates 的 checkout。釋放空間後，工作的紀錄、報告與筆記都會保留。",
      published: "已發佈的工作",
      publishedHelp: "已發佈的工作會保留 checkout，因為後續修改回合與同步需要它。不再需要時再釋放。",
      others: "其他工作",
      noRuns: "沒有任何工作在磁碟上留有檔案。",
      runMeta: ({ status, date }) => `${status} · ${date}`,
      free: "釋放空間",
      freeLabel: ({ title }) => `釋放「${title}」的空間`,
      freeing: "釋放中…",
      freed: ({ size }) => `已釋放 ${size}。`,
      confirmFree: "要釋放這個工作的檔案嗎？之後就無法在這裡審閱或發佈它的變更。",
      confirmPublished: "要釋放這個已發佈工作的 checkout 嗎？之後它就無法進行後續修改回合與同步。",
      outside: "位於資料目錄之外",
      busy: "進行中",
    },
    retention: {
      title: "自動清理",
      label: "保留已停止與失敗工作檔案的天數",
      help: "1 到 365。已取消或失敗的工作在這麼多天沒有動靜後，工作檔案會被移除；紀錄、報告與筆記會保留。已發佈的工作會一直保留，直到你釋放它。",
      save: "儲存",
    },
    erase: {
      title: "刪除所有資料",
      text: "刪除資料目錄中的所有專案、工作、分析、探索結果、紀錄與備份。你的設定與授權會保留。這個動作無法復原。",
      open: "刪除所有資料…",
      label: "輸入 ERASE 以確認",
      button: "刪除所有資料",
      erasing: "正在刪除…",
      done: "所有資料都已刪除，頁面會重新載入。",
    },
    privacy: {
      title: "哪些資料會離開這台電腦",
      none: `${product.name} 不傳送遙測、分析或當機報告，也沒有授權伺服器。`,
      ai: "你的程式碼與問題會以你自己的帳戶，送到你使用的 AI 程式開發 CLI 的服務提供者。",
      github: "GitHub 會收到 GitHub CLI 與 Git 以你的帳戶傳送的內容：複製與搜尋，以及只在你核准後才建立的分支與 draft pull request。",
      web: "除非你開啟，Agent 不會存取網路。",
      rest: "其他一切都留在資料目錄中。",
      link: "閱讀隱私權政策",
    },
  },
  license: {
    title: "授權",
    intro: "你的方案與授權金鑰。金鑰在這台電腦上檢查：啟用金鑰或開始試用都不會傳送任何資料。",
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
    subtitle:
      "所有專案共用的 Agent、模型與思考強度，套用到之後建立的任務與專案分析。",
    loading: "正在載入模型設定…",
    reload: "重新載入模型設定",
    close: "關閉",
    saving: "正在儲存…",
    save: "儲存設定",
  },
};

export default m;
