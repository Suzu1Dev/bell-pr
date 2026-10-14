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
  discovery: {
    incompleteAnswer: "探索分析格式不完整，請重試；上一份結果仍保留。",
    duplicateIds: "探索分析包含重複的機會識別，請重試。",
    unverifiedRepository: "探索建議引用了未查證的 Repository，請重試。",
    skippedUnmatchedQuote: ({ repository, title, sourceId }) =>
      `已略過 ${repository}「${title}」：引文無法對應來源 ${sourceId}。`,
    skippedNoIssueQuote: ({ repository, title }) =>
      `已略過 ${repository}「${title}」：缺少可核對的 issue 引文。`,
    skippedNoContributingQuote: ({ repository, title }) =>
      `已略過 ${repository}「${title}」：未引用已取得的 CONTRIBUTING 規定。`,
    popularity: ({ stars, forks, pushedAt }) =>
      `GitHub 查詢快照：${stars} stars、${forks} forks，最近推送於 ${pushedAt}。人氣不能保證提案會被接受。`,
    popularityWithoutPush: ({ stars, forks }) =>
      `GitHub 查詢快照：${stars} stars、${forks} forks，最近推送於 未提供。人氣不能保證提案會被接受。`,
    skippedDifficulty: ({ count }) => `已略過 ${count} 項超出指定難度的建議。`,
    fileTooLarge: "探索結果檔案過大，無法安全載入。",
    interruptedError:
      "服務重新啟動，探索已中斷；已保存的來源及上一份結果仍保留，可重新探索。",
    interrupted: "上次探索已中斷",
    shuttingDown: "服務正在關閉，請稍後再探索。",
    alreadyRunning: "已有探索正在執行，請等待完成或先取消。",
    searching: "正在查找符合條件的 GitHub 專案",
    startFailed: "探索無法啟動",
    startSaveFailed:
      "探索工作無法儲存，請確認本機儲存空間後重試；上一份結果仍保留。",
    cancelled: "探索已取消。",
    duplicateRepository: "探索來源包含重複 Repository。",
    skippedFilter: ({ repository }) =>
      `略過 ${repository}：不符合語言或最低 stars 條件。`,
    duplicateSourceIds: "探索來源識別重複，無法可靠核對引用。",
    skippedSensitiveSource: "已略過疑似包含敏感資訊的來源。",
    sourcesTruncated: "來源超過 30 KB 範圍，已省略完整段落。",
    noEvidence: "這次未找到同時符合條件且具有可核對 issue 證據的機會。",
    analyzing: "已取得真實 GitHub 來源，正在分析適合的貢獻機會",
    analyzingWithWait: ({ wait }) =>
      `已取得真實 GitHub 來源，正在分析適合的貢獻機會（${wait}）`,
    unusableAnswer:
      "AI 探索分析未完成或回應無法安全使用，請重試；上一份結果仍保留。",
    found: ({ count }) =>
      `找到 ${count} 項有來源支持的貢獻機會；仍需確認維護者意願與實作範圍。`,
    noneFound:
      "這次沒有適合目前條件、規範與可用證據的貢獻機會，可調整條件再探索。",
    cancelledKept: "探索已取消；上一份結果仍保留。",
    failed: "探索失敗，請稍後重試。",
    cancelledStatus: "探索已取消",
    unfinishedStatus: "探索未完成",
    saveFailed: "探索結果無法儲存，請確認本機儲存空間後重試。",
  },
  discoverySources: {
    invalidInterests: "興趣關鍵字最多 300 字，且不能包含控制字元。",
    invalidLanguage: "請填寫單一程式語言名稱，最多 40 字。",
    invalidMinStars: "最低 stars 必須介於 0 到 1,000,000。",
    invalidDifficulty: "無效的探索難度。",
    invalidSort: "無效的探索排序。",
    cancelled: "貢獻探索已取消。",
    limitReached: "探索達到請求或時間上限。",
    unreadableText: ({ title }) => `${title} 不是可安全讀取的文字，已略過。`,
    maskedCredentials: ({ title }) => `${title} 已遮蔽疑似憑證。`,
    truncatedSource: ({ title, bytes }) =>
      `${title} 僅保留前 ${bytes} bytes，尚未讀取完整內容。`,
    searching: "正在搜尋公開、未封存且符合條件的 GitHub 專案。",
    searchFailed:
      "GitHub 搜尋未成功完成，可能受到權限、連線或 API 限制影響；尚不能判定沒有符合條件的專案。",
    partialResults: "GitHub 回傳部分搜尋結果，這次探索不是完整清單。",
    noRepositories:
      "這次有界搜尋未找到符合條件的公開專案；可減少關鍵字、降低 stars 門檻或調整難度。",
    samplingScope: ({ sort }) =>
      `最多取樣 6 個${
        {
          relevance: "GitHub 相關度（best match）最高",
          updated: "最近更新",
          stars: "星數最多",
        }[sort]
      }的專案，每個最多 3 個開啟中的 issue 與每則最後 3 則留言；標籤不保證實際難度或仍可認領。文件僅讀取 GitHub community profile 識別的根目錄、.github、docs 內 README、CONTRIBUTING 與 PR 模板，未讀取帳號共用規範、多模板目錄及外部連結。`,
    screening: ({ repository }) =>
      `正在檢查 ${repository} 的 issue、貢獻文件與維護者回應。`,
    repositoryUnconfirmed: ({ repository }) =>
      `${repository} 的公開狀態與 issue 資料未能完整確認，已略過；不代表沒有貢獻機會。`,
    profileFailed: "貢獻文件索引讀取失敗，不能據此判定沒有規範。",
    noBaseCommit: "未取得可驗證的預設分支版本，未讀取文件。",
    documentNotIndexed: ({ document }) =>
      `${
        {
          readme: "README",
          contributing: "CONTRIBUTING",
          template: "PR 模板",
        }[document]
      } 未在本次允許的索引範圍找到，其他位置仍可能有規範。`,
    documentFailed: ({ path }) =>
      `${path} 讀取失敗或超出文字大小限制，尚未確認其完整內容。`,
    issueHeader: ({ labels, updatedAt, assignees, locked, reactions }) =>
      `GitHub 狀態：OPEN；標籤：${labels || "無"}；更新時間：${updatedAt ?? "未確認"}；受指派人數：${assignees ?? "未確認"}；討論鎖定：${locked ? "是" : "否"}；表情回應總數：${reactions ?? "未確認"}（不代表支持票）。`,
    commentTitle: ({ number, association }) => `#${number} · ${association} 留言`,
    noMatchingIssue:
      "本次取樣未取得符合難度標籤的開啟中 issue，尚不能確認具體需求或可認領性。",
    noPushTime: "GitHub 未提供可驗證的最後推送時間。",
    candidateBytesLimit: "來源已達每個專案 30 KB 上限，部分內容未讀取。",
    requestLimit:
      "探索達到 36 次請求或 90 秒上限，已保留取得的結果；尚未完整讀取其餘候選來源。",
    noCandidates:
      "候選資料未能通過公開狀態與來源驗證，這次沒有可分析的專案；可稍後重試或調整條件。",
  },
};
export default m;
