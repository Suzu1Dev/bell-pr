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
  draftSources: {
    invalidBase: "草稿規範需要有效的基準版本。",
    cancelled: "草稿規範讀取已取消。",
    unreadableText: ({ label }) => `${label} 不是可安全讀取的文字，已略過。`,
    sensitive: ({ label }) => `${label} 疑似包含敏感資訊，已略過。`,
    totalLimit: "規範來源達到 80 KB 上限；尚未完整檢查所有文件與討論。",
    truncated: ({ label, bytes }) =>
      `${label} 僅讀取前 ${bytes} bytes；後續內容尚未檢查。`,
    accountDefault: ({ path }) => `共用預設 · ${path}`,
    notRegularFile: ({ label }) =>
      `${label} 不是一般檔案，已略過符號連結或子模組。`,
    tooLarge: ({ label }) =>
      `${label} 超過單檔讀取上限或大小不明，尚未檢查其內容。`,
    documentLimit: "文件取樣達到 16 份或 80 KB 上限；尚未完整檢查所有規範。",
    readFailed: ({ label }) => `${label} 讀取失敗，尚未確認其規範。`,
    searchScope:
      "本機規範搜尋範圍為基準版本的根目錄、.github、docs 與 documentation 內常見貢獻指南、README、維護者文件及 PR 模板，根目錄的 AGENTS.md／CLAUDE.md，以及 .github/workflows 中會自動檢查 PR 的流程；未追蹤文件中的外部連結。",
    automationLimit: ({ max, remaining }) =>
      `自動檢查流程最多收錄 ${max} 份；其餘 ${remaining} 個 workflow 尚未檢查。`,
    workflowScanLimit: ({ total, max }) =>
      `.github/workflows 有 ${total} 個檔案，只檢查了前 ${max} 個是否會自動檢查 PR。`,
    workflowReadFailed: ({ path }) =>
      `${path} 讀取失敗，尚未確認它是否會自動檢查 PR。`,
    baseUnreadable: "無法讀取任務基準版本的規範文件；不能據此判定專案沒有規範。",
    noRemote:
      "未提供可驗證的 github.com 專案網址，尚未檢查 GitHub 維護者討論與帳號共用預設規範。",
    metadataFailed:
      "GitHub 維護者討論與帳號共用資訊讀取失敗（可能是權限、連線或 API 限制）；不能據此判定沒有額外規範。",
    defaultsTruncated:
      "帳號共用 .github 的檔案清單已截斷；尚未完整檢查預設規範。",
    defaultsNotPublic:
      "帳號共用 .github 未確認為公開 repository，未採用其預設規範。",
    defaultsNoBranch:
      "帳號共用 .github 沒有可讀取的預設分支，尚未確認預設規範。",
    defaultsFailed:
      "帳號共用 .github 預設規範讀取失敗；尚未確認是否存在適用規範。",
    maintainerSample:
      "維護者偏好僅取樣最近更新的 3 個已合併 PR，各最多 5 則留言及 5 則 review；已合併不等於規範認可，仍需人工確認適用性。",
    maintainerComment: ({ number, association }) =>
      `PR #${number} · ${association} 留言`,
    maintainerReview: ({ number, association }) =>
      `PR #${number} · ${association} 審查`,
    mergedExample: ({ number }) => `PR #${number} · 已合併範例（非規範）`,
  },
  drafts: {
    stale: "程式碼差異已更新；請重新產生符合目前變更的 PR 草稿建議。",
    incompleteAnswer: "PR 草稿建議格式不完整，請重新產生。",
    commitMessageTrailer:
      "提交訊息建議不能包含 Signed-off-by 等署名欄位；簽署只能由本人輸入。",
    commitMessageSource: "提交訊息建議引用的來源不存在，請重新產生。",
    ruleQuoteMismatch: "PR 草稿的規範引用無法對應來源，請重新產生。",
    templateNotUsed: "PR 草稿未採用目標專案提供的範本，請重新產生。",
    templateHeadingsMissing: "PR 草稿缺少專案範本的段落標題，請重新產生。",
    rulesWithoutSource: "專案規範需要可核對的來源，請重新產生。",
    linuxOverridesRules:
      "已有適用的專案規範，不能以 Linux 預設取代，請重新產生。",
    certifiesForPerson:
      "PR 草稿不能代替使用者簽署、背書或勾選已完成的確認項目。",
    placeholdersInBody: ({ lines }) =>
      `PR 草稿把待辦事項或未填的範本欄位寫進了會送到 GitHub 的說明（第 ${lines} 行），請重新產生。`,
    provisionalLinuxPolicy:
      "來源查找有範圍限制或未完成項目，暫用 Linux 投稿寫作原則；送出前請人工確認專案規定。",
    noSafeDiff: "目前沒有可用來撰寫 PR 的安全程式碼差異。",
    diffTooLarge: "差異超過 PR 草稿的 100 KB 上限；請拆分變更後重試。",
  },
  explanations: {
    tooLargeForAutomatic:
      "差異超過自動解說的 100 KB 上限；請拆分變更後重新載入。",
    tooLarge: ({ path }) =>
      `「${path}」的差異超過解說的 100 KB 上限；請拆分變更後重試。`,
    incompleteAnswer: "變更解說格式不完整，請重試產生解說。",
    mismatchedFiles: "變更解說沒有完整對應本次差異，請重試產生解說。",
  },
  prFeedback: {
    githubError: ({ message }) => `GitHub 回傳錯誤：${message}`,
    notFound: "在 GitHub 找不到這個 PR。",
    urlMismatch: "GitHub 回傳的 PR 網址與工作紀錄不一致。",
    partialReviews: ({ shown, total }) =>
      `Review 只讀取最近 ${shown} 則，共 ${total} 則。`,
    partialComments: ({ shown, total }) =>
      `對話留言只讀取最近 ${shown} 則，共 ${total} 則。`,
    partialThreadReplies: ({ path, shown, total }) =>
      `${path} 的回覆只讀取前 ${shown} 則，共 ${total} 則。`,
    partialUnnamedThreadReplies: ({ shown, total }) =>
      `討論串的回覆只讀取前 ${shown} 則，共 ${total} 則。`,
    partialThreads: ({ shown, total }) =>
      `程式碼討論串只讀取最近 ${shown} 則，共 ${total} 則。`,
    partialChecks: ({ shown, total }) =>
      `CI 檢查只讀取前 ${shown} 則，共 ${total} 則。`,
    dropped: ({ count, limit }) =>
      `${count} 則留言未納入：超過 ${limit} 則上限，或連結不屬於這個 PR。`,
    partialLabels: ({ shown, total }) =>
      `PR 標籤只讀取 ${shown} 個，共 ${total} 個；未列出的標籤可能包含 needs: 開頭的標籤。`,
  },
  models: {
    catalogUnavailable:
      "暫時無法讀取 Codex 模型目錄。請確認 CLI 已安裝並登入，稍後再試。",
    claudeOpus: "適合複雜的程式修改、審查與多步驟推理。",
    claudeSonnet: "速度與能力較平衡，適合日常開發與分析。",
    claudeFable: "能力最強，單次工作可能較久；需方案支援。",
    claudeHaiku: "最快、用量最低；不支援思考強度設定。",
    invalidSettings: "模型設定格式不正確，請重新選擇。",
    providerMismatch: "模型目錄與所選 Agent 不一致，請重新載入後再選擇。",
    unknownModel: "無法確認這組模型設定，請重新載入模型目錄並選擇。",
    unsupportedEffort: "所選模型不支援這個思考強度，請重新選擇。",
  },
};
export default m;
