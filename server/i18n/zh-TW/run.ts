import { formatters, type Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type { RunStatus } from "../../../shared/types.js";
import type en from "../en/run.js";

const list = (items: readonly string[]) =>
  formatters("zh-TW").list(items, { type: "unit" });
/** 另一個貢獻目前的狀態，重疊確認用。 */
const runStates: Record<RunStatus, string> = {
  queued: "排隊中",
  running: "進行中",
  awaiting_plan: "等待核准計畫",
  review: "審閱中",
  approved: "已核准、尚未發布",
  published: "已發布、尚未看到合併",
  failed: "失敗",
  cancelled: "已取消",
};
const followUpAgentCommitted =
  "Agent 自行建立 commit 或切換分支，已還原到推送的 PR；修改留在工作目錄待審閱。";

const m: Translation<typeof en> = {
  unsandboxedNotice:
    "這個 Claude Agent 未在作業系統沙箱中執行，因為已允許不使用沙箱的 Claude Agent（在設定中，或以 BELLPR_ALLOW_UNSANDBOXED_AGENTS=1 啟動）。",
  agents: {
    lead: "分析專案與拆解需求",
    reviewer: "獨立審查正確性與維護性",
    tester: "檢查測試證據與回歸風險",
    member: "等待認領共享子任務，使用獨立工作目錄",
    memberRetry: "等待重新認領子任務，使用新的獨立工作目錄",
    running: ({ cli }) => `正在執行 ${cli}…`,
    waitingForSlot: ({ queued }) => `等待其他 Agent 完成（${queued} 個排隊中）`,
    complete: "已完成，報告可供審閱",
    failed: "已停止或失敗",
    rerunWaiting: "等待重新審查…",
    sync: "解決同步後的合併衝突",
    syncResolved: "衝突已解決，等待審閱",
    syncUnresolved: "仍有衝突或已停止",
    followUp: "依維護者回饋修正",
    followUpDone: "修正完成，等待審閱",
    followUpStoppedKept: "修正已停止，修改保留待審閱",
    followUpStopped: "修正已停止或沒有修改",
  },
  queue: {
    runNotFound: "找不到任務。",
    claudeMissing: "尚未安裝 Claude Code CLI。請先安裝並執行 claude auth login。",
    claudeSignedOut: "Claude Code 尚未登入。請先在終端機執行 claude auth login。",
    codexMissing: "尚未安裝 Codex CLI。請先安裝並執行 codex login。",
    codexSignedOut: "Codex 尚未登入。請先在終端機執行 codex login。",
    antigravityMissing:
      "尚未安裝 Antigravity CLI（agy）。請先安裝，再在終端機執行一次 agy 完成登入。",
    antigravitySignedOut: "Antigravity CLI 尚未登入。請先在終端機執行 agy 並登入。",
    full: ({ max }) => `最多可同時排入 ${max} 個任務；請等待現有任務完成。`,
    teamStopped: "團隊已停止處理這個任務；程式碼的問題請改到「追問 Agent」分頁詢問。",
    noPlanToApprove: "目前沒有等待核准的團隊計畫。",
    planApproved: "已核准子任務分工與檔案範圍，團隊進入開發佇列。",
    feedbackLength: "退回意見必須介於 1 至 4000 字。",
    revisionLimit: ({ max }) =>
      `已重擬 ${max} 次，請核准目前計畫，或取消後調整需求再建立新任務。`,
    planSentBack: ({ revision, max }) =>
      `已退回計畫並補充意見（第 ${revision}/${max} 次），Lead 將依意見重新規劃。`,
    cancelNotAllowed: "只有排隊、等待計畫核准或執行中的任務可取消。",
    cancelRequested:
      "已要求取消；失敗或取消的子任務保留獨立工作目錄。可用「重試失敗的子任務」接續。",
  },
  team: {
    guideName: "嚮導",
    started: ({ name, cli, model, effort, web, timeout, inbox }) =>
      `${name} 開始工作。模型：${model ?? `${cli} CLI 預設（未記錄模型）`}；思考強度：${effort ?? "模型預設"}${web ? "；已允許上網" : ""}${timeout ? `；${timeout}` : ""}。${inbox ? ` 已在回合起點收到 ${inbox} 則團隊訊息。` : ""}`,
    waitingForSlot: ({ queued }) => `等待其他 Agent 完成（${queued} 個排隊中）。`,
    structuredResult: "已收到回覆，正在檢查來源與內容。",
    checkFinished: ({ outcome }) => `執行檢查完成（${outcome}）。`,
    fileUpdated: ({ path }) => `已更新 ${path}。`,
    filesUpdated: "已更新工作目錄中的檔案。",
    webSearch: ({ detail }) => `搜尋網路：${detail}`,
    webFetch: ({ detail }) => `讀取網頁：${detail}`,
    reportedModel: ({ cli, model, requested, version }) =>
      `${cli} 回報實際模型：${model}（${requested ? `--model 傳入 ${requested}` : "未傳入 --model"}${version ? `，CLI ${version}` : ""}）。`,
    noReport: ({ cli }) => `${cli} 沒有回傳工作報告。`,
    noTeam: "此任務沒有 Agent Team。",
    messageTargetClosed: "此隊友或子任務已完成，無法再排入訊息；請傳給 Lead。",
    messageLength: "團隊訊息必須介於 1 至 4000 字。",
    messageLimit: "此任務的團隊訊息已達 200 則上限。",
    messageQueued: ({ to }) =>
      `已排入給 ${to} 的團隊訊息，將在下一回合起點送達。`,
    taskClaimed: ({ title }) =>
      `領取子任務 ${title}；獨立工作目錄與檔案範圍已建立。`,
    messageNotQueued: ({ reason }) => `協調訊息未排入：${reason}`,
    turnLimit:
      "已達每個子任務 3 回合上限；尚未送達的訊息保留在團隊收件匣，交由 Lead 在整合時檢視。",
    taskIntegrated: ({ title, files }) =>
      files.length
        ? `${title} 完成，${files.length} 個檔案通過範圍檢查並整合：${list(files)}。`
        : `${title} 完成，沒有需要整合的檔案變更。`,
    checkoutRemoved: ({ owner }) =>
      `${owner} 的變更已整合進本次任務的工作目錄，其獨立工作目錄已移除。`,
    checkoutNotRemoved: ({ task, reason }) =>
      `無法移除 ${task} 的獨立工作目錄，可手動刪除：${reason}`,
    taskFailed: "子任務失敗。",
    stuck: "子任務相依或檔案分工讓團隊無法繼續，請查看任務板。",
    creatingWorktree: "建立獨立 Git worktree。",
    legacyRun: "舊任務無法重新派工，請建立新的 Agent Team 任務。",
    planCreated: ({ tasks, max }) =>
      `已建立 ${tasks} 個有相依關係與檔案範圍的子任務，最多 ${max} 位隊友同時工作。`,
    awaitingApproval: "等待你核准計畫；尚未開始修改程式碼。",
    noChanges: "Agent Team 沒有產生程式碼變更。請檢查子任務報告或調整方向。",
    done: ({ files }) =>
      `團隊開發與獨立審查完成，共 ${files} 個變更檔案，等待逐檔審閱。`,
    draftIncomplete: "PR 草稿建議未完成，請重試。",
    runFailed: "任務失敗。",
    retryNotAllowed: "只有已失敗或已取消、且 Lead 已建立計畫的團隊任務可以重試。",
    stillStopping: "此任務仍在收尾，請稍後再重試。",
    retryAwaitingApproval: "要求重試；計畫尚未核准，先回到等待核准。",
    retryTasks: ({ kept, retried }) =>
      `重試失敗的子任務：${kept} 個已完成的子任務不重跑，${retried} 個子任務以新快照重新開始。`,
    retryIntegration: "重試：所有子任務都已完成，直接重跑整合與獨立審查。",
    retryPending: "重試：繼續執行尚未開始的子任務。",
    scopeDirectories: ({ scopes }) =>
      `${list(scopes)} 在基準版本中是資料夾，已當成資料夾處理，計畫涵蓋其中的檔案。`,
  },
  agentCli: {
    commandSucceeded: "成功",
    commandFailed: "失敗",
    commandUnreported: "已結束，未回報結束代碼",
    commandUnverified: ({ outcome }) =>
      `${outcome}，未經確認：一起執行的其他指令可能掩蓋失敗`,
    codexTurnFailed: "Codex 工作回合失敗。",
    codexError: "Codex 回報執行錯誤。",
    claudeTurnFailed: ({ subtype }) => `Claude Code 工作回合失敗（${subtype}）。`,
    antigravityTurnFailed: ({ status }) => `Antigravity 工作回合失敗（${status}）。`,
    antigravityEndedOnDenial:
      "Antigravity 拒絕了這個回合不允許的動作，接著在沒有回答的情況下結束了回合。",
    apiRetry: ({ attempt, maxRetries, reason, delaySeconds }) => {
      const details = [
        attempt === undefined
          ? ""
          : `第 ${attempt}${maxRetries === undefined ? "" : `/${maxRetries}`} 次`,
        reason ? `原因 ${reason}` : "",
        delaySeconds === undefined ? "" : `${delaySeconds} 秒後重試`,
      ].filter(Boolean);
      return `Claude Code 重試中${details.length ? `（${details.join("，")}）` : ""}。`;
    },
    rateLimitWindows: {
      five_hour: "5 小時滾動視窗：用量每 5 小時依開始時間重置",
      seven_day: "7 天滾動視窗：所有模型的每週總量",
      seven_day_opus: "7 天滾動視窗：Opus 的每週用量",
      seven_day_sonnet: "7 天滾動視窗：Sonnet 的每週用量",
      seven_day_overage_included: "7 天滾動視窗：含額外用量的每週總量",
      overage: "額外用量",
    },
    rateLimit: ({ status, window, used, resetsAt }) => {
      const state =
        status === "rejected"
          ? "已達上限，等待重置中"
          : status === "allowed_warning"
            ? "接近上限"
            : `狀態 ${status}`;
      const details = [
        window ?? "",
        used === undefined ? "" : `已用 ${used}%`,
        resetsAt === undefined ? "" : `預計 ${resetsAt} 重置`,
      ].filter(Boolean);
      return `Claude 用量${state}${details.length ? `（${details.join("；")}）` : ""}。`;
    },
    deniedTool: ({ tool, reason }) =>
      `工具 ${tool} 被權限設定拒絕${reason ? `：${reason}` : "。"}`,
    authRetry: ({ seconds, attempt, total }) =>
      `Claude Code 正在等另一個行程更新完登入狀態，${seconds} 秒後重試（第 ${attempt}/${total} 次）。`,
    timeoutLimit: ({ minutes }) => `最多等待 ${minutes} 分鐘`,
    timedOut: ({ executable, minutes }) =>
      `${executable} 執行逾時（${minutes} 分鐘）。請調低思考強度、換較快的模型或提高 BELLPR_AGENT_TIMEOUT_SCALE；大型專案需要更久。`,
  },
  command: {
    timedOut: ({ executable }) => `${executable} 執行逾時。`,
    outputTooLarge: ({ executable }) =>
      `${executable} 輸出超過安全上限；請縮小工作範圍。`,
    spawnFailed: ({ executable, reason }) => `${executable} 無法啟動：${reason}`,
    failed: ({ executable, output }) => `${executable} 執行失敗：${output}`,
  },
  diff: {
    viewUnavailable: "這一輪在這個工作目錄中沒有可讀取的已發布歷史。",
    unparsable: "無法解析 Git 差異。",
    renameFirst: "檔案名稱包含不支援的字元，請先重新命名。",
    unsupportedName: "檔案名稱包含不支援的字元。",
    tooManyFiles: "差異超過 150 個檔案，請縮小任務後重新執行。",
    outsideWorktree: "檔案超出工作目錄。",
    tooLarge: "差異超過 2 MB，請拆成較小的任務。",
    blocked: {
      sensitive: "敏感檔案或產物不會被加入 PR；請先從本次變更移除。",
      notRegularFile: "新檔案必須是一般檔案；符號連結需要手動處理。",
      newFileTooLarge: "新檔案超過 512 KB，請手動檢視或拆分。",
      binary: "二進位檔案需要另外人工檢視，無法透過此工作流程發佈。",
      credentials: "發佈前會擋下常見格式的 token 與私鑰。",
    },
    heldBack: ({ reason }) => `此檔案已被擋下、不會發布：${reason}`,
  },
  context: {
    notAFile: "子模組或特殊項目沒有可展開的程式碼。",
    tooLarge: "檔案超過 512 KB，無法展開周圍的程式碼。",
    binary: "二進位檔案無法展開周圍的程式碼。",
    credentials: "發布前會擋下常見格式的 token 與私鑰。",
    blocked: "這個檔案目前無法審閱，也不會顯示周圍的程式碼。",
    stale: "檔案差異已更新，請重新整理差異。",
    baseMoved: "任務的基準已更新，請重新整理差異。",
    wholeFile: "新增或刪除的檔案已經完整顯示。",
    unreadable: "檔案無法讀取或超過 512 KB。",
  },
  commits: {
    notFound: "找不到這個貢獻的 commit。",
    unsupportedName: "檔案名稱包含不支援的字元。",
    sensitive: "敏感檔案或產物，不顯示內容。",
    binary: "二進位檔案，不顯示內容。",
    tooLarge: "差異超過 600 KB，不顯示內容。",
    credentials: "發布前會擋下常見格式的 token 與私鑰。",
  },
  premise: {
    tooEarly: "請等待開發完成後再查核前提。",
    busy: "這個任務還有 Agent、審查或解說在進行；請等它完成再查核前提。",
    incomplete: "Agent 回傳的前提查核格式不完整。",
    checked: ({ verdict, changed }) =>
      `前提查核：${{ holds: "假設成立", refuted: "假設不成立", unclear: "無法確認假設" }[verdict]}。${changed ? "程式碼解說與還沒作答的變更解說會依這個結論重新產生。" : "結論沒有改變。"}`,
    noAssumption: "前提查核：需求裡沒有需要查核的假設。",
  },
  walkthrough: {
    wholeFile: "新增或刪除的檔案沒有原本的邏輯可以拆解；請看「變更解說」。",
    noFunctions: "這類檔案沒有函式可以拆解。",
    tooLarge: "差異超過 100 KB，不自動產生程式碼解說。",
    overLimit: ({ limit }) =>
      `只有前 ${limit} 個程式檔會自動產生程式碼解說；其餘請在「追問 Agent」詢問。`,
    incomplete: "Agent 回傳的程式碼解說格式不完整。",
    tooEarly: "請等待開發完成後再產生程式碼解說。",
    stopped: "程式碼解說已停止，可以重試。",
    failed: "程式碼解說產生失敗，請重試。",
    notFinished: ({ path, reason }) => `${path} 的程式碼解說未完成：${reason}`,
    lineName: ({ line }) => `第 ${line} 行`,
  },
  integration: {
    snapshotBlocked: "整合快照含有無法審閱的檔案，已停止派工。",
    noWorktree: "子任務沒有獨立工作目錄。",
    gitStateChanged: "隊友自行建立了 commit 或切到別的 commit，已停止整合。",
    outOfScope: ({ path }) =>
      `隊友修改了未分配的檔案 ${path}；變更保留在該子任務的獨立工作目錄，未整合。`,
    needsManualHandling: ({ path }) => `隊友的 ${path} 需要人工處理，未整合。`,
  },
  plan: {
    wholePlan: "計畫",
    tooBig: ({ path, maximum, items }) =>
      `${path}：超過 ${maximum} ${items ? "項" : "字"}`,
    empty: ({ path }) => `${path}：不可為空`,
    tooSmall: ({ path, minimum, items }) =>
      `${path}：至少 ${minimum} ${items ? "項" : "字"}`,
    wrongType: ({ path, expected, received }) =>
      `${path}：應為 ${expected}，收到 ${received}`,
    badFormat: ({ path }) => `${path}：格式不正確`,
    other: ({ path, reason }) => `${path}：${reason}`,
    notJson: "Lead 沒有回傳可用的計畫；請調整需求後重試。",
    invalid: ({ problem }) =>
      `Lead 回傳的計畫不符合格式（${problem}）；請調整需求後重試。`,
    duplicateIds: "Lead 計畫包含重複或保留的子任務 ID；請調整需求後重試。",
    invalidDependency: "Lead 計畫包含無效的子任務相依關係；請調整需求後重試。",
    invalidScope: ({ scope }) =>
      `Lead 計畫的檔案範圍無效（${scope}）；請調整需求後重試。`,
    cycle: "Lead 計畫的子任務彼此相依、形成循環；請調整需求後重試。",
  },
  report: {
    member: ({ summary, checks, limitations, tradeoffs }) =>
      [
        summary,
        `驗證證據（成員自述的執行結果）：\n${checks.length ? checks.join("\n") : "（成員未回報任何實際執行的檢查）"}`,
        `限制與未達成的驗收條件：\n${limitations || "（未回報）"}`,
        `設計取捨（考慮過但未採用的做法）：\n${tradeoffs || "（未回報）"}`,
      ].join("\n\n"),
  },
  review: {
    rerunNotAllowed: "只有審閱中或已核准的任務可以重新執行獨立審查。",
    rerunRunning: "這個任務的獨立審查正在重新執行，請等待完成或先停止。",
    nothingToReview: "目前沒有程式碼變更可供審查。",
    rerunRequested: ({ files }) =>
      `要求依目前工作目錄的 ${files} 個變更檔案重新執行獨立審查。`,
    rerunDone: "獨立審查已更新；報告是建議，審閱狀態與核准不變。",
    rerunStopped: "已停止重新審查；原有報告與審閱狀態保留。",
    rerunIncomplete: "重新審查未完成。",
    explanationsTooEarly: "請等待開發完成後再產生變更解說。",
    fileNotFound: "找不到此變更檔案。",
    explanationsStopped: "變更解說產生已停止；已完成的程式碼變更仍保留，可重試。",
    explanationsFailed: "變更解說產生失敗，請重試。",
    explanationsCancelled: "變更解說產生已取消。",
    notesTooEarly: "請等待開發完成後再寫下理解。",
    chatTooEarly: "請等待開發完成後再追問。",
    chatUnavailable: "此檔案目前無法用於追問。",
    feedbackUnpublished: "PR 尚未發布，還沒有維護者回饋可以讀取。",
    feedbackMismatch: "PR 網址與這個專案不一致，無法讀取回饋。",
    githubInvalidJson: "GitHub 回應不是有效的 JSON。",
    feedbackRead: ({ number, items }) =>
      `已讀取 PR #${number} 的維護者回饋：${items} 則。`,
  },
  draft: {
    notForRound:
      "一輪修正只推送新的 commit，不會更新 PR 說明，因此不需要產生草稿建議。",
    cancelled: "PR 草稿產生已取消。",
    stale: "程式碼變更已更新；請重新產生符合目前變更的 PR 草稿建議。",
    applied:
      "模型的建議已放進編輯區。發布前請改成自己的話，並處理核對清單與勾選項目。",
    ready: "PR 草稿建議已準備完成，現有草稿保留；可在 PR 草稿區檢視並套用。",
    stopped:
      "PR 草稿建議產生已停止；現有草稿與已完成變更仍保留，可重新產生。",
    failed: "PR 草稿建議產生失敗，請重試。",
    incomplete: "PR 草稿建議未完成。",
  },
  sync: {
    partlyPublished:
      "先前發布的 commit 可能已在 GitHub，無法再同步或復原同步；請從最新版本建立新任務。",
    unmarkedRun: ({ files }) =>
      `衝突標記無法表示這些檔案的衝突：${list(files)}。一邊刪、一邊改，或兩邊都改了二進位檔。${product.name} 不選邊，任務未變動。請還原任務對它們的修改或刪除，同步後再重做。`,
    unmarkedPr: ({ files, branch }) =>
      `衝突標記無法表示這些檔案的衝突：${list(files)}。一邊刪、一邊改，或兩邊都改了二進位檔。${product.name} 不選邊，PR 未變動。請在本機把 ${branch} 合併進 PR 分支並推送，${product.name} 之後會接續這些 commit。`,
    notAllowed:
      "只有審閱中、已核准或等待計畫核准的任務可以同步到最新目標分支。",
    busy: "這個任務還有 Agent、審查或解說在進行；請等它完成再同步。",
    busyUndo: "這個任務還有 Agent、審查或解說在進行；請等它完成再復原。",
    busyResolve: "這個任務還有 Agent、審查或解說在進行；請等它完成再解衝突。",
    baseMismatch: "任務分支的 commit 和記錄的基準不一致，已停止同步。",
    baseMismatchUndo: "任務分支的 commit 和記錄的基準不一致，已停止復原。",
    upToDate: ({ branch }) => `已確認 ${branch} 沒有新 commit，任務已是最新。`,
    synced: ({ branch, commit, conflicts }) =>
      conflicts.length
        ? `已同步到 ${branch} 最新版本（${commit}），${conflicts.length} 個檔案有衝突需要解決：${list(conflicts)}。`
        : `已同步到 ${branch} 最新版本（${commit}），沒有衝突；改到的檔案需要重新審閱。`,
    prOnly: "只有已發布的 PR 可以同步目標分支。",
    roundOpen: "這個 PR 已有一輪修正在進行；完成或放棄後再同步。",
    prCheckoutDiffers:
      "工作目錄和已推送的 PR 內容不一致；請先還原工作目錄裡的修改再同步。",
    prUpToDate: ({ branch }) => `已確認 PR 已包含 ${branch} 的最新版本。`,
    nothingToMerge: ({ branch }) =>
      `${branch} 已經包含這個 PR 的全部修改，所以沒有同步；可以考慮關閉這個 PR。`,
    prSynced: ({ branch, commit, conflicts }) =>
      conflicts.length
        ? `已把 ${branch} 最新版本（${commit}）合併進 PR，${conflicts.length} 個檔案有衝突需要解決：${list(conflicts)}。`
        : `已把 ${branch} 最新版本（${commit}）合併進 PR，沒有衝突；審閱後會推送一個合併 commit。`,
    nothingToUndo: "目前沒有可以復原的同步。",
    undone: "已復原同步，任務回到同步前的內容與基準。",
    noConflicts: "目前沒有需要解決的同步衝突。",
    conflictsGone: "衝突標記都已解決，不需要再請 Agent 處理。",
    resolveRequested: ({ files }) =>
      `要求 Agent 解決 ${files.length} 個檔案的合併衝突：${list(files)}。`,
    agentCommitted:
      "Agent 自行建立了 commit 或切換了分支；已還原，修改保留在工作目錄供你審閱。",
    resolved: "Agent 已解決合併衝突，請逐檔審閱這些檔案。",
    stillConflicted: ({ files }) =>
      `Agent 處理後仍有衝突標記：${list(files)}；可以自行修改，或再請 Agent 處理。`,
    stopped: "已停止解衝突；已改的檔案保留，可以自行完成，或再請 Agent 處理。",
    failed: ({ reason }) =>
      `${reason.replace(/[.。]+$/u, "")}；已改的檔案保留，可以自行完成，或再請 Agent 處理。`,
    incompleteReason: "解衝突未完成",
    incomplete: "解衝突未完成。",
    conflictsOpen: ({ files }) =>
      `這些檔案還有合併衝突標記：${list(files)}。請先解決衝突（也可以請 Agent 解決）。`,
    mergeFailed: "無法計算合併結果。",
    answerIncomplete: "Agent 回傳的解衝突結果格式不完整",
    heldChangedUpstream: ({ branch, items }) =>
      `在你佔用期間，${branch} 上有 commit 改到你佔用的檔案：${items.join("；")}。`,
    heldChangedUpstreamItem: ({ path, commits }) =>
      `${path}（${commits.join("、")}）`,
  },
  followUp: {
    inProgress: "這個任務已有一輪修正在進行。",
    busy: "這個任務已有一輪修正或獨立審查在進行。",
    notPublished: "只有已發布 PR 的任務可以開始一輪修正。",
    feedbackNotInLatest:
      "選取的回饋不在最近一次讀取的結果中；請重新讀取回饋後再選。",
    inputRequired: "請至少選一則回饋，或寫下這一輪要修正的內容。",
    checkoutDiffers:
      "工作目錄和已推送的 PR 內容不一致；請先還原工作目錄裡的修改再開始修正。",
    requested: ({ feedback, note, round }) =>
      `要求依 ${feedback} 則維護者回饋${note ? "與補充說明" : ""}進行第 ${round} 輪修正。`,
    agentCommitted: followUpAgentCommitted,
    noChanges:
      "Agent 沒有修改任何檔案；請看下方的說明，必要時調整選取的回饋或補充說明再試一次。",
    done: ({ round, agentCommitted }) =>
      `第 ${round} 輪修正完成。請逐檔審閱變更並確認提交訊息，再推送。${agentCommitted ? followUpAgentCommitted : ""}`,
    stoppedReason: "這一輪已停止",
    incompleteReason: "這一輪未完成",
    keptEdits: ({ reason }) =>
      `${reason.replace(/[.。]+$/u, "")}；工作目錄保留了部分修改，可以審閱、寫好提交訊息後推送，或放棄這一輪。`,
    nothingToDiscard: "目前沒有可以放棄的修正。",
    alreadyPushed: `這一輪已推送到 PR；請再按一次推送，讓 ${product.name} 記錄完成。`,
    discarded: "已放棄這一輪，工作目錄回到已推送的 PR 內容。",
    discardedWithoutFiles: "已放棄這一輪；它的修改已隨先前移除的工作檔案一併刪除。",
    answerIncomplete: "Agent 回傳的修正結果格式不完整",
    pushUnknown: "無法確認這一輪是否已推送到 PR。",
    remoteMoved: ({ branch }) =>
      `GitHub 上的 PR 分支 ${branch} 有 ${product.name} 以外的 commit（例如套用建議、維護者推送或 Update branch）。${product.name} 不會覆蓋它們，也無法接續這一輪；請在 GitHub 上處理，或放棄這一輪。`,
    remoteMissing: ({ branch }) =>
      `GitHub 上找不到 PR 分支 ${branch}，無法推送修正。`,
    historyRewritten: ({ branch }) =>
      `GitHub 上的 PR 分支 ${branch} 改寫了 ${product.name} 推送的歷史（例如 force push），無法接續；請在 GitHub 處理。`,
    adoptedReport: ({ commits }) =>
      `接續了 GitHub 上 ${product.name} 以外的 ${commits} 個 commit；這些變更會在下一輪一起審閱。`,
    adopted: ({ branch, commits }) =>
      `已接續 GitHub 上 PR 分支 ${branch} 的 ${commits} 個 commit（例如套用建議或 Update branch），會在下一輪一起審閱。`,
  },
  recovery: {
    unreadableState: ({ path, reason }) =>
      `無法讀取 ${path}：${reason}。請檢查檔案是否為有效 JSON（version 1）。`,
    invalidStateFormat: "狀態檔格式無效",
    draft: "服務重新啟動，PR 草稿建議已停止；現有草稿保留，可重新產生。",
    explanation: "服務重新啟動，變更解說產生已停止；可重試。",
    walkthrough: "服務重新啟動，程式碼解說已停止；可重試。",
    review: "服務重新啟動，重新審查已停止；原有報告保留",
    conflicts:
      "服務重新啟動，解衝突已停止；已改的檔案保留，可以自行完成，或再請 Agent 處理。",
    round:
      "服務重新啟動，這一輪已停止。請審閱工作目錄保留的修改、寫提交訊息後推送，或放棄這一輪。",
    run: "服務重新啟動，任務已停止。工作目錄與差異保留。團隊任務可在任務板重試失敗的子任務，已整合的不重跑。",
    task: "服務重新啟動，子任務已停止；獨立工作目錄保留，重試時會以新快照重新開始。",
  },
  repos: {
    notFound: "找不到專案。",
    importSource: "請輸入 GitHub HTTPS URL 或本機 Repository 的絕對路徑。",
    bare: "請選擇有工作目錄的 Repository。",
    pathMissing: ({ path }) =>
      `${product.name} 所在電腦上沒有 ${path} 資料夾。請檢查路徑；~/ 是執行 ${product.name} 的使用者家目錄。`,
    notGitRepository: ({ path }) =>
      `${path} 不在任何 Git repository 中。請輸入 Git 專案的資料夾，也就是含有 .git 資料夾的那一個。`,
    localNotUpdated:
      `這個專案沒有 GitHub 來源，${product.name} 無法更新副本。請先更新你自己的 repository，再移除專案並重新匯入。`,
    checkoutNotUpdated:
      `這是你本機的 repository，${product.name} 不會更動它；請在終端機自行 git pull 後再重新分析。`,
    cloneChanged: `${product.name} 的專案副本有未預期的修改，已停止更新；請檢查後再試。`,
  },
  split: {
    byHand: "親手學的任務由你逐行撰寫，無法拆分。",
    published: "這個貢獻已經發布，無法拆分。",
    alreadySplit: ({ count }) =>
      `這個貢獻已經拆成 ${count} 個。請開啟其中一個，或再拆其中一個。`,
    followUp: "這個貢獻有一輪修正正在進行，目前無法拆分。",
    unknownPath: ({ path }) => `「${path}」不是這個貢獻有變更的檔案。`,
    duplicatePath: ({ path }) => `「${path}」出現在多個貢獻中；一個檔案只能放進一個貢獻。`,
    heldBack: ({ path }) => `「${path}」已被擋下、不納入審閱，無法移動；請讓它只留在原本那份。`,
    notReproduced:
      "複製出來的檔案與原檔不一致，所以沒有拆分。改寫檔案內容的 Git 設定（例如換行轉換）可能造成這種情況。",
    startedFrom: ({ title }) => `拆分自「${title}」。`,
    wasSplit: ({ count }) => `已拆成 ${count} 個貢獻。`,
    tooManyEdges: ({ limit }) => `這樣拆分會讓一個貢獻建立在超過 ${limit} 個其他貢獻上，請拆成較少的貢獻。`,
  },
  local: {
    overlapWith: ({ title, status, paths }) => `「${title}」（${runStates[status]}）：${list(paths)}`,
    planOverlap: ({ titles }) =>
      `你在這個專案的其他貢獻也改了這個計畫涵蓋的檔案：${list(titles.map((title) => `「${title}」`))}。請先在計畫上查看並確認重疊，再核准一次。`,
    autoOverlap: "這個計畫涵蓋的檔案也被你在這個專案的其他貢獻修改，所以改為等待你核准，不會自動開始。",
    overlapChanged: "確認重疊後，你的其他貢獻或這個計畫有變化。請在計畫上重新確認，再核准。",
    approvedOverlap: ({ titles }) =>
      `已核准；${list(titles.map((title) => `「${title}」`))}也改了其中部分檔案。`,
    publishOverlap:
      "你在此專案的其他貢獻改到部分相同檔案，較晚合併的可能要解衝突。請依想要的合併順序發布，或合併成一個。",
    splitOrder:
      "這部分拆分依賴尚未合併的其他部分。請先發布它們，否則這個 PR 在它們合併前可能通不過檢查。",
    buildsOn: ({ title, prUrl }) =>
      prUrl ? `「${title}」：已發布於 ${prUrl}，尚未看到合併` : `「${title}」：尚未發布`,
    heldByOther:
      "別人佔用了這次變更動到的檔案。請對方釋出或請小組管理員撤銷，或把這些檔案移出變更。",
    heldByOtherItem: ({ path, holder, title, since }) => `${path}：由 ${holder} 為「${title}」佔用（${since} 起）`,
    holdsUnknown: ({ name }) =>
      `小組協作已停止，無法確認檔案佔用狀態。發布前請先在主機修復小組協作並重新啟動 ${name}。`,
    turnHeldByOther: ({ items }) =>
      `Agent 改到別人佔用的檔案，所以這項工作已停止。改動仍留在工作目錄裡。${items.join("；")}。請對方釋出、請小組管理員撤銷佔用，或把這些檔案的改動還原，再試一次。`,
    taskHeldByOther: ({ items }) =>
      `隊友改到別人佔用的檔案，所以這些改動沒有加入這份貢獻。${items.join("；")}。請對方釋出，或請小組管理員撤銷佔用，再試一次。`,
    planHeldByOther: ({ items }) =>
      `計畫涵蓋別人佔用的檔案，無法核准。${items.join("；")}。請附上意見退回，或等對方釋出。`,
    autoHeld: "這個計畫涵蓋小組裡別人佔用的檔案，所以改為等待你核准，不會自動開始。",
    agentsHoldsUnknown: ({ name }) =>
      `小組協作已停止，無法確認檔案佔用，Agent 不能修改檔案。請在主機修復小組協作後重新啟動 ${name}，或不帶 --group 啟動 ${name}。`,
    heldChangedUpstream: ({ branch }) =>
      `在你佔用期間，${branch} 上有 commit 改到你佔用的檔案。發布前請先確認這些變更。`,
    heldChangedUpstreamItem: ({ path, commits }) =>
      `${path}（${commits.join("、")}）`,
    holdRecoveryNotAllowed:
      "只有已完成且尚未合併 PR 的任務，才能還原佔用檔案或重新檢查佔用狀態。",
    holdRecoveryBusy:
      "這個任務還有作業在進行；請等完成後再還原佔用檔案或重新檢查。",
    holdRecoveryCheckoutMissing: "找不到這個任務的工作目錄或基準 commit。",
    heldPathsRestored: ({ files }) =>
      files.length
        ? `已將 ${files.length} 個佔用檔案還原到任務基準：${list([...files])}。`
        : "沒有佔用檔案與任務基準不同。",
    heldPathsRechecked: "已重新檢查檔案佔用：目前改到的檔案都沒有被其他人佔用。",
    dependencyWarning:
      "這次變更改到的檔案與小組裡其他人正在佔用的檔案有相依關係。發布前請先與對方確認協調。",
    dependencyWarningItem: ({ path, peer, holder, title }) =>
      `${path} ⇄ ${peer}：由 ${holder} 為「${title}」佔用`,
    teamRecordLimit: "這個任務的團隊變更說明或待辦協調項目已達 200 則上限。",
    teamOpenTodos: ({ count }) =>
      `這份貢獻還有 ${count} 項尚未完成的團隊協調待辦事項。請先完成，或確認仍要直接發布。`,
    teamOpenTodoItem: ({ text, filePath, assignee, author }) =>
      `${filePath ? `[${filePath}] ` : ""}${text}（${assignee ? `交辦 ${assignee}，` : ""}由 ${author} 標註）`,
  },
  publish: {
    heldByOther: ({ items }) =>
      `變更動到別人佔用的檔案，未發布。${items.join("；")}。請對方釋出，或請小組管理員撤銷佔用。`,
    holdsUnknown: ({ name }) =>
      `小組協作已停止，無法確認檔案佔用，所以未發布。請在主機修復小組協作後重新啟動 ${name}，或不帶 --group 啟動 ${name}。`,
    recoveryStale: "未完成的發布紀錄已變更；請重新載入後再恢復。",
    recoveryNotAllowed: "只能恢復尚未記錄推送目標或 PR 的未完成發布。",
    recoveryBusy: "這個任務仍有作業進行中；請等完成後再恢復發布。",
    recoveryCheckout: "本機分支或已儲存的 commit 與這個任務不符；已停止恢復，工作目錄沒有變更。",
    recoveryUnknown: "無法確認兩個 GitHub Repository 都沒有對應分支或 PR；已停止恢復，請待 Repository 可以讀取後重試。",
    recoveryRemoteBranch: ({ repository, branch }) => `GitHub 分支 ${repository}:${branch} 已存在；未完成的發布紀錄已保留，請先檢查。`,
    recoveryPrExists: ({ branch }) => `分支 ${branch} 已有 PR，包括已關閉或合併的 PR；未完成的發布紀錄已保留，請先檢查。`,
    recovered: ({ commit }) => `已恢復未完成的發布；commit ${commit} 已保留在本機恢復參照，請重新審閱與核准目前草稿後再發布。`,

    commitMessageInvalid: "提交訊息只能包含文字與換行。",
    invalidBranch:
      "GitHub 分支名稱只能用英數字與 . _ - /，不能有 ..，也不能以 . 或 .lock 結尾。",
    notEditable: "請等待任務完成後再審閱與編輯。",
    roundKeepsPrText:
      "一輪修正只推送新的 commit，PR 標題與說明維持原樣，不能在這裡修改。",
    branchIsTarget: ({ branch }) =>
      `GitHub 分支不能是目標分支 ${branch}，否則會直接推送到目標分支而不是建立 PR；請用新的分支名稱。`,
    branchLocked: ({ branch }) =>
      `先前發布已推送到 GitHub 分支 ${branch}，現在改名會另開 PR。請還原分支名稱，或建立新任務。`,
    fileChanged: "檔案差異已更新；請重新載入並審閱最新內容，再標記為已審閱。",
    draftChanged: "PR 草稿已更新；請重新載入並確認最新標題與內容，再重新核准。",
    reviewAllFirst: "請先審閱每個變更檔案的最新版本、標記為已審閱，並移除被擋下的檔案。",
    prTextRequired: "請先填寫 PR 標題與內容。",
    roundMessageRequired: "請填好這一輪的提交訊息，不要留下待填寫的內容。",
    approvalStale: "核准版本已更新或失效；請重新載入、審閱並核准。",
    approveFirst: "請先完成審閱並核准 PR。",
    noGithubOrigin: "這個專案沒有 GitHub 來源，無法發布。",
    diffChanged: "變更內容和你核准時不同，請重新審閱與核准。",
    notAllReviewed: "請先審閱每個變更檔案的最新版本、標記為已審閱，並移除被擋下的檔案。",
    understandingRequired:
      "核准或發布前，請先用自己的話講一遍：完成最新變更的理解檢查。可在「設定 → 學習」關閉；未經檢查就核准的任務會標記。",
    prAlreadySent:
      "這個 PR 已經發布；要推送新的修改，請從維護者回饋開始一輪修正。",
    branchIsTargetReapprove: ({ branch }) =>
      `GitHub 分支不能是目標分支 ${branch}；請修改分支名稱並重新核准。`,
    branchLockedPublish: ({ branch }) =>
      `先前發布已推送到 GitHub 分支 ${branch}；請還原分支名稱，或建立新任務。`,
    confirmFirst: ({ items }) => `發布前請在預覽視窗逐項確認：${items.join(" ")}`,
    githubUserInvalid: "GitHub 使用者資訊不正確。",
    defaultBranchChanged: "遠端預設分支已變更，請從最新分支建立新任務。",
    targetMoved:
      "目標分支已有新 commit；請先在 PR 草稿頁按「同步到最新目標分支」，審閱後再發布。",
    targetMovedAfterCommit:
      "目標分支已有新 commit，但先前發布的 commit 可能已在 GitHub，無法再同步；請從最新版本建立新任務。",
    branchChanged: "任務分支已改變，已停止發布。",
    priorCommitDiffers:
      "先前發布已建立不同的 commit。若 PR 草稿頁顯示「恢復未完成的發布」，請按下；否則請檢查先前分支或建立新任務。",
    priorMessageDiffers:
      "先前發布的 commit 提交訊息不同，推送後無法更改。若 PR 草稿頁顯示「恢復未完成的發布」，請按下；否則請還原訊息或建立新任務。",
    notAFork: "同名 Repository 不是目標專案的 fork，請先處理 GitHub fork。",
    noPrUrl: "GitHub 未回傳 PR URL，請先到 GitHub 確認，避免重複發布。",
    prCreated: "已建立 GitHub Draft PR。",
    failed: "發布失敗。",
    failedAfterPush: ({ error }) =>
      `${error} 若推送已完成，分支會保留在 GitHub；重試前請確認遠端狀態。`,
    roundReverts: ({ files }) =>
      `這一輪把已推送的檔案改回原版或刪除：${list(files)}。這類修改無法逐檔審閱，不推送；請還原這些檔案或放棄這一輪。`,
    roundMessageMissing: "請填寫這一輪的提交訊息。",
    roundMessagePlaceholders: "提交訊息還有待填寫的內容，請改好再推送。",
    roundNoPushTarget: "找不到這個 PR 的推送位置，無法推送修正。",
    roundPushed: ({ round, branch, commit }) =>
      `已把第 ${round} 輪修正推送到 PR 分支 ${branch}（${commit}）。`,
    branchChangedPush: "任務分支已改變，已停止推送。",
    commitChangedPush: "任務分支的 commit 已改變，已停止推送。",
    prMerged: "這個 PR 已合併，不能再推送修正。",
    prClosed: "這個 PR 已關閉，不能再推送修正。",
    roundEmpty: "這一輪沒有新的修改可以推送；可以放棄這一輪。",
    roundCommitDiffers:
      "這一輪先前已建立不同內容的 commit；請還原修改與提交訊息後再推送，或放棄這一輪。",
    pushFailed: "推送失敗。",
    stagedFilesDiffer: "準備提交的檔案與已核准差異不同。",
    fileChangedWhileStaging: ({ path }) => `${path} 在準備提交時變更，請重新審閱。`,
    filesChangedWhilePublishing: "檔案在發布準備期間變更，請重新審閱。",
  },
};
export default m;
