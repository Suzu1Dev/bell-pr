import {
  formatters,
  intlLocale,
  type Translation,
} from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/setup.js";

const fmt = formatters("zh-TW");

/** 磁碟大小，例如「12.3 GB」。 */
const size = (bytes: number) => {
  const units = ["kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return new Intl.NumberFormat(intlLocale("zh-TW"), {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value);
};

const m: Translation<typeof en> = {
  settings: {
    names: {
      maxActiveRuns: "同時執行的工作數",
      maxAgentProcesses: "同時執行的 Agent 程序數",
      agentTimeoutScale: "Agent 時間上限倍數",
      allowUnsandboxedAgents: "允許 Claude Code Agent 不用沙箱",
      retentionDays: "已結束工作的檔案保留天數",
    },
    locked: ({ setting, variable }) =>
      `「${setting}」這項設定來自環境變數 ${variable}。請修改或移除這個變數，再重新啟動 ${product.name}。`,
  },
  busy: {
    analysisRunning: "這個專案正在分析中。請等分析完成後再刪除專案。",
    eraseAnalysisRunning: "仍有專案分析在執行。請等它完成後再刪除所有資料。",
  },
  errors: {
    gitMissing: `尚未安裝 Git，或 ${product.name} 在它的 PATH 中找不到 Git。`,
    ghMissing: `尚未安裝 GitHub CLI（gh），或 ${product.name} 在它的 PATH 中找不到它。`,
    codexMissing: `尚未安裝 Codex CLI，或 ${product.name} 在它的 PATH 中找不到它。`,
    claudeMissing: `尚未安裝 Claude Code，或 ${product.name} 在它的 PATH 中找不到它。`,
    ghUnauthenticated: "GitHub CLI 尚未登入，或登入已失效。請重新登入後再試一次。",
    githubAuthRequired: "GitHub 要求登入。請用 GitHub CLI 登入後再試一次。",
    gitIdentityMissing:
      "Git 還不知道你的名字與電子郵件地址，而每個提交都需要它們。請先設定，再試一次。",
    ghWorkflowScope:
      "這次修改涉及 GitHub Actions 工作流程（.github/workflows），但你的 GitHub 登入沒有推送它們的權限。請加上 workflow 權限後再試一次。",
    codexUnauthenticated: "Codex 尚未登入，或登入已失效。請重新登入後再試一次。",
    claudeUnauthenticated:
      "Claude Code 尚未登入，或登入已失效。請重新登入後再試一次。",
    cloneTimeout:
      "複製儲存庫超過 10 分鐘，已經停止。請自行複製儲存庫，再匯入你那份複本的路徑。",
  },
  fixes: {
    installGit: "安裝 Git",
    useWsl: `安裝 WSL2，並在其中執行 ${product.name}`,
    installGh: "安裝 GitHub CLI",
    signInGh: "登入 GitHub",
    addWorkflowScope: "允許推送工作流程的修改",
    addRepoScope: "允許推送到儲存庫",
    installCodex: "安裝 Codex CLI",
    signInCodex: "登入 Codex",
    installClaude: "安裝 Claude Code",
    signInClaude: "登入 Claude Code",
    setGitName: "設定你的名字",
    setGitEmail: "設定你的電子郵件地址",
    setNoreplyEmail: "使用你專屬的 GitHub no-reply 地址",
    cloneLocally: "自行複製儲存庫",
    installNode: "安裝 Node.js 22 以上版本",
    dataDir: "改用你有寫入權限的資料目錄啟動",
  },
  placeholders: {
    name: "你的名字",
    email: "you@example.com",
    directory: "<目錄>",
  },
  doctor: {
    labels: {
      node: "Node.js",
      git: "Git",
      "git-identity": "Git 身分",
      gh: "GitHub CLI",
      "gh-auth": "GitHub 登入",
      "gh-scopes": "GitHub 權限",
      codex: "Codex CLI",
      "codex-auth": "Codex 登入",
      claude: "Claude Code",
      "claude-auth": "Claude Code 登入",
      "claude-sandbox": "Claude Code 沙箱",
      "provider-ready": "AI 服務",
      "data-dir": "資料目錄",
      app: product.name,
      platform: "平台",
    },
    nodeTooOld: ({ version }) =>
      `Node.js ${version} 版本太舊：${product.name} 需要 22 以上版本。`,
    notInstalled: "尚未安裝。",
    notResponding: "已安裝，但 5 秒內沒有回應。",
    versionFailed: ({ command }) => `已安裝，但執行 \`${command}\` 失敗。`,
    versionFailedWith: ({ command, output }) =>
      `已安裝，但執行 \`${command}\` 失敗：${output}`,
    gitTooOld: ({ version }) =>
      `Git ${version} 可以使用，但要把工作移到目標分支的最新版本，需要 Git 2.40 以上。其他功能都能正常使用。`,
    identityMissing:
      "尚未設定：Git 不知道你的名字與電子郵件地址，因此無法提交或發佈任何內容。",
    identityAutodetected: ({ email }) =>
      `尚未設定電子郵件地址。Git 推測為 ${email}，它會隨你的提交一起公開。`,
    identityUnknown: "Git 無法回報你的身分。",
    signedOut: "尚未登入。",
    githubOffline: "已登入，但無法連上 GitHub。請檢查網路連線。",
    githubRejected: "GitHub 拒絕了已儲存的登入。請重新登入。",
    scopesMissingRepo:
      "這個登入無法推送到儲存庫：需要 repo 或 public_repo 權限。",
    scopesMissingWorkflow:
      "沒有 workflow 權限時，無法推送修改 GitHub Actions 工作流程的 Pull Request。",
    scopesUnknown: "這種權杖不會回報它的權限，因此不檢查。",
    sandboxReady: "可以使用：會修改檔案的 Claude Code Agent 會在沙箱中執行。",
    sandboxMissing:
      "無法使用：請安裝 bubblewrap 與 socat，讓 Claude Code Agent 能在沙箱中修改檔案。",
    sandboxBlocked:
      "無法使用：bubblewrap 已安裝，但在這裡無法建立沙箱，例如在使用預設安全設定的容器中。",
    sandboxUnsupported:
      "這個平台無法使用，因此 Claude Code Agent 無法修改檔案。",
    sandboxAllowed:
      "無法使用。你已允許 Claude Code Agent 不用沙箱修改檔案；這類工作會有標示。",
    providersReady: ({ providers }) => `已就緒：${fmt.list(providers)}。`,
    noProvider: `請安裝並登入 Codex CLI 或 Claude Code：${product.name} 至少需要其中一個。`,
    savedProviderNotReady: ({ provider }) =>
      `模型設定選用的是 ${provider}，但它尚未就緒。`,
    dataDirReady: ({ free }) => `可以寫入，剩餘 ${size(free)}。`,
    dataDirWritable: "可以寫入。",
    dataDirNew: "會在第一次啟動時建立。",
    dataDirLowSpace: ({ free }) =>
      `可以寫入，但只剩 ${size(free)}。每個工作都需要空間存放專案的複本。`,
    dataDirReadOnly: `無法寫入：${product.name} 無法在這裡儲存資料。`,
    app: ({ port, runs, processes }) => {
      const parts = [
        port === undefined ? undefined : `連接埠 ${port}`,
        runs === undefined ? undefined : `同時執行 ${runs} 個工作`,
        processes === undefined ? undefined : `${processes} 個 Agent 行程`,
      ].filter(Boolean);
      return parts.length ? `${parts.join("，")}。` : "";
    },
    windows: `Windows 透過 WSL2 執行 ${product.name}：請在 WSL2 發行版中安裝。`,
  },
  cli: {
    title: `${product.name} 環境檢查`,
    ready: "已就緒：所有必要的檢查都通過了。",
    readyExcept: ({ checks }) =>
      `已就緒：所有必要的檢查都通過了。有些步驟要先修正標示 ✗ 的檢查（${fmt.list(checks)}）才能進行。`,
    notReady: ({ checks }) =>
      `尚未就緒：請修正標示 ✗ 的必要檢查（${fmt.list(checks)}），再重新檢查一次。`,
    dataDir: ({ path }) => `資料目錄：${path}`,
    fix: ({ label }) => `${label}：`,
    usage: `用法：${product.binNames[0]} doctor [--json] [--data-dir <目錄>]`,
    unknownArgument: ({ argument }) => `沒有「${argument}」這個參數。`,
  },
};
export default m;
