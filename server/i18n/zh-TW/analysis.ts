import type { Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/analysis.js";

const m: Translation<typeof en> = {
  insights: {
    issueUrlInvalid:
      "相關 issue 連結需為 https://github.com/<owner>/<repo>/issues/<編號>",
    duplicateRecommendationIds: "建議識別碼不可重複。",
    citesUnsampledFile: ({ path }) => `引用了未抽樣的檔案 ${path}`,
    citesUnsuppliedFile: ({ path }) => `引用了未提供的檔案 ${path}`,
    quotePathNotInEvidence: ({ path, quote }) =>
      `引文路徑 ${path} 不在這項建議的 evidence 清單：「${quote}」`,
    quoteNotFound: ({ path, quote }) => `引文在 ${path} 找不到：「${quote}」`,
    evidenceWithoutQuote: ({ path }) => `evidence 路徑 ${path} 缺對應引文`,
    incompleteAnswer: "AI 分析格式不完整，請重新分析；原有結果已保留。",
    sensitiveAnswer: "AI 回應疑似包含敏感內容，結果未儲存。",
    unsuppliedCitation: ({ field, path }) =>
      `AI 分析引用了未提供的檔案（${field}：${path}），請重新分析；原有結果已保留。`,
    readingPathTooShort: "AI 分析的建議閱讀順序過短，請重新分析；原有結果已保留。",
    duplicateIds: "AI 建議的識別碼重複，請重新分析。",
    repositoryNotFound: "找不到 Repository。",
    cacheUnreadable: "專案分析資料無法讀取，請檢查本機 insights 資料檔。",
    modelSettingsUnreadable: "模型設定無法讀取，請檢查本機 model-settings.json。",
    analyzeFirst: "請先分析專案，再調整貢獻建議。",
    recommendationsChanged: "部分貢獻建議已更新，請重新整理後再調整。",
    cancelled: "專案分析已取消。",
    noCommit: "Repository 沒有可分析的 Git 版本。",
    noTextFiles: "找不到可分析的已追蹤文字檔案；請先加入 README 或程式碼並提交。",
    shuttingDown: "服務正在關閉，無法開始新的專案分析。",
    alreadyRunning: "這個專案正在分析，請等待目前分析完成。",
    tooManyRunning: "同時最多分析兩個專案，請稍後再試。",
    reanalyzeBeforeMore: "請先重新分析專案全貌，再產出更多貢獻方向。",
    recommendationLimit: ({ max }) =>
      `已累積 ${max} 個貢獻方向；請先選擇想改善的項目，或重新分析專案。`,
    agentUnavailable: ({ agent, login }) =>
      `無法使用 ${agent}：請確認已安裝 CLI 並執行 ${login}。`,
    started: ({ repository, runner, wait }) =>
      `專案分析 ${repository}（${runner}）開始，${wait}。`,
    unfinished: "AI 分析未完成或回應過大，請重試；原有結果已保留。",
    repositoryChanged: "分析期間 Repository 已改變，請重新分析最新版本。",
  },
};
export default m;
