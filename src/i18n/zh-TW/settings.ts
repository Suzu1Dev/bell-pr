/** Settings (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/settings";

const m: Translation<typeof en> = {
  eyebrow: "連線",
  title: "讓工作環境準備就緒。",
  intro: "沿用本機 CLI 的登入狀態，憑證不會儲存在瀏覽器。",
  recheck: "重新檢查連線",
  rechecked: "連線狀態已更新",
  status: {
    ready: "已就緒",
    signedOut: "尚未登入",
    missing: "尚未安裝",
    connected: "已連線",
  },
  signInHint: "在終端機完成登入",
  authorizeHint: "在終端機完成授權",
  general: {
    title: "一般",
    text: "介面的語言，也是之後新產生內容使用的語言；已經產生的內容不會翻譯。",
    language: "語言",
  },
  codex: {
    description: "執行 agent team、程式碼解說與追問",
  },
  claude: {
    description:
      "使用你已安裝並登入的 Claude Code CLI（Claude 方案或 Anthropic API 金鑰），用量計入你自己的帳戶。",
  },
  models: {
    title: "模型與思考強度",
    text: "所有專案共用一組設定，既有任務保留當次設定。",
    configure: "設定貢獻模型",
    current: "查看目前任務模型",
  },
  github: {
    connectedAs: ({ user }) => `以 ${user} 連線`,
    description: "匯入專案、推送分支與建立 Draft PR",
  },
  local: {
    title: "本機工作空間",
    text: "Repository 與任務資料保存在執行本服務的電腦",
    badge: "本機優先",
  },
  concurrency: {
    title: "同時進行的工作數",
    text: "多個專案（或同一專案）的工作可以同時執行並各自發佈 PR",
    maxActiveRuns: "同時執行的工作上限",
    maxAgentProcesses: "Agent CLI 行程上限",
    maxQueued: "排隊上限（執行中、等待執行與等待確認計畫合計）",
    explanation:
      "每個工作的 teammates、Reviewer 與 Test analyst 各需要一個 CLI 行程，因此 Agent CLI 行程上限決定實際能同時進行多少。同一個 repository 的多個工作彼此獨立，各自使用自己的 worktree 與分支。",
    usage:
      "同時執行多個 Agent 會更快消耗你在服務提供者的帳戶用量。在個人方案上大量平行使用，可能超出該方案預期的個人使用範圍。",
    advanced: "進階：環境變數",
    advancedText: `設定環境變數後重新啟動 ${product.name}。詳見說明文件。`,
    documentation: "說明文件",
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
