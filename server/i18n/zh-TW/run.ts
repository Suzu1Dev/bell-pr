import { formatters, type Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/run.js";

const list = (items: readonly string[]) =>
  formatters("zh-TW").list(items, { type: "unit" });
const followUpAgentCommitted =
  "Agent 自行建立了 commit 或切換了分支；已還原到已推送的 PR，修改保留在工作目錄供你審閱。";

const m: Translation<typeof en> = {
  unsandboxedNotice:
    "這個 Claude Agent 未在作業系統沙箱中執行，因為已允許不使用沙箱的 Claude Agent（在設定中，或以 BELLPR_ALLOW_UNSANDBOXED_AGENTS=1 啟動）。",
  agents: {
    lead: "分析專案與拆解需求",
    reviewer: "獨立審查正確性與維護性",
    tester: "檢查測試證據與回歸風險",
    member: "等待認領共享任務，使用獨立工作目錄",
    memberRetry: "等待重新認領任務，使用新的獨立工作目錄",
    running: ({ cli }) => `正在執行 ${cli}…`,
    waitingForSlot: ({ queued }) => `等待其他 Agent 完成（${queued} 個排隊中）`,
    complete: "已完成，報告可供審閱",
    failed: "執行中斷或失敗",
    rerunWaiting: "等待重新審查…",
    sync: "解決同步後的合併衝突",
    syncResolved: "衝突已解決，等待審閱",
    syncUnresolved: "仍有衝突或已中斷",
    followUp: "依維護者回饋修正",
    followUpDone: "修正完成，等待審閱",
    followUpStoppedKept: "修正中斷，修改保留待審閱",
    followUpStopped: "修正中斷或沒有修改",
  },
  queue: {
    runNotFound: "找不到工作。",
    claudeMissing: "尚未安裝 Claude Code CLI。請先安裝並執行 claude auth login。",
    claudeSignedOut: "Claude Code 尚未登入。請先在終端機執行 claude auth login。",
    codexMissing: "尚未安裝 Codex CLI。請先安裝並執行 codex login。",
    codexSignedOut: "Codex 尚未登入。請先在終端機執行 codex login。",
    full: ({ max }) => `最多可同時排入 ${max} 個工作；請等待現有工作完成。`,
    teamStopped: "團隊已停止工作，請使用程式碼追問功能。",
    noPlanToApprove: "目前沒有等待核准的團隊計畫。",
    planApproved: "已核准任務分工與檔案範圍，團隊進入開發佇列。",
    feedbackLength: "退回意見必須介於 1 至 4000 字。",
    revisionLimit: ({ max }) =>
      `已重擬 ${max} 次，請核准目前計畫，或取消後調整需求再建立新工作。`,
    planSentBack: ({ revision, max }) =>
      `已退回計畫並補充意見（第 ${revision}/${max} 次），Lead 將依意見重新規劃。`,
    cancelNotAllowed: "只有排隊、等待計畫核准或執行中的工作可取消。",
    cancelRequested:
      "已要求取消；失敗或取消任務的隔離工作目錄保留，已整合任務的目錄已自動移除。可用「重試失敗的子任務」接續。",
  },
  team: {
    guideName: "嚮導",
    started: ({ name, cli, model, effort, web, timeout, inbox }) =>
      `${name} 開始工作。模型：${model ?? `${cli} CLI 預設（未記錄模型）`}；推理：${effort ?? "模型預設"}${web ? "；已允許上網" : ""}${timeout ? `；${timeout}` : ""}。${inbox ? ` 已在回合起點收到 ${inbox} 則團隊訊息。` : ""}`,
    waitingForSlot: ({ queued }) => `等待其他 Agent 完成（${queued} 個排隊中）。`,
    structuredResult: "結構化結果已回傳，正在驗證來源與內容。",
    checkFinished: ({ outcome }) => `執行檢查完成（${outcome}）。`,
    fileUpdated: ({ path }) => `已更新 ${path}。`,
    filesUpdated: "已更新工作目錄中的檔案。",
    webSearch: ({ detail }) => `搜尋網路：${detail}`,
    webFetch: ({ detail }) => `讀取網頁：${detail}`,
    reportedModel: ({ cli, model, requested, version }) =>
      `${cli} 回報實際模型：${model}（${requested ? `--model 傳入 ${requested}` : "未傳入 --model"}${version ? `，CLI ${version}` : ""}）。`,
    noReport: ({ cli }) => `${cli} 沒有回傳工作報告。`,
    noTeam: "此工作沒有 Agent Team。",
    messageTargetClosed: "此成員或任務已完成，無法再排入訊息；請傳給 Lead。",
    messageLength: "團隊訊息必須介於 1 至 4000 字。",
    messageLimit: "此工作的團隊訊息已達 200 則上限。",
    messageQueued: ({ to }) =>
      `已排入給 ${to} 的團隊訊息，將在下一回合起點送達。`,
    taskClaimed: ({ title }) =>
      `領取任務 ${title}；獨立工作目錄與檔案範圍已建立。`,
    messageNotQueued: ({ reason }) => `協調訊息未排入：${reason}`,
    turnLimit:
      "已達每個任務 3 回合上限；尚未送達的訊息保留在團隊收件匣，交由 Lead 在整合時檢視。",
    taskIntegrated: ({ title, files }) =>
      `${title} 完成，${files.length} 個檔案通過範圍檢查並整合${files.length ? `：${list(files)}` : ""}。`,
    checkoutRemoved: ({ owner }) =>
      `整合後的差異已在本次工作的 worktree，${owner} 的獨立 checkout 已不需保留，已移除。`,
    checkoutNotRemoved: ({ task, reason }) =>
      `無法移除 ${task} 的隔離工作目錄，可手動清理：${reason}`,
    taskFailed: "任務失敗。",
    stuck: "任務依賴或檔案分工阻止團隊繼續，請檢視共享任務清單。",
    creatingWorktree: "建立獨立 Git worktree。",
    legacyRun: "舊工作無法重新派工，請建立新的 Agent Team 工作。",
    planCreated: ({ tasks, max }) =>
      `已建立 ${tasks} 個有依賴與檔案範圍的任務，最多 ${max} 位 teammate 同時工作。`,
    awaitingApproval: "等待你核准計畫；尚未開始修改程式碼。",
    noChanges: "Agent Team 沒有產生程式碼差異。請檢查任務報告或調整方向。",
    done: ({ files }) =>
      `團隊開發與獨立審查完成，共 ${files} 個變更檔案，等待逐檔審閱。`,
    draftIncomplete: "PR 草稿建議未完成，請重試。",
    runFailed: "工作失敗。",
    retryNotAllowed: "只有已失敗或已取消、且 Lead 已建立計畫的團隊工作可以重試。",
    stillStopping: "此工作仍在收尾，請稍後再重試。",
    retryAwaitingApproval: "要求重試；計畫尚未核准，先回到等待核准。",
    retryTasks: ({ kept, retried }) =>
      `重試失敗的子任務：${kept} 個已完成任務不重跑，${retried} 個任務以新快照重新開始。`,
    retryIntegration: "重試：所有子任務都已完成，直接重跑整合與獨立審查。",
    retryPending: "重試：繼續執行尚未開始的子任務。",
  },
  agentCli: {
    commandSucceeded: "成功",
    commandFailed: "失敗",
    commandUnverified: ({ outcome }) =>
      `${outcome}，未經確認：一起執行的其他指令可能掩蓋失敗`,
    codexTurnFailed: "Codex 工作回合失敗。",
    codexError: "Codex 回報執行錯誤。",
    claudeTurnFailed: ({ subtype }) => `Claude Code 工作回合失敗（${subtype}）。`,
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
      return `Claude 額度${state}${details.length ? `（${details.join("；")}）` : ""}。`;
    },
    deniedTool: ({ tool, reason }) =>
      `工具 ${tool} 被權限設定拒絕${reason ? `：${reason}` : "。"}`,
    authRetry: ({ seconds, attempt, total }) =>
      `Claude Code 正在更新登入憑證（其他行程持有更新鎖），${seconds} 秒後重試（第 ${attempt}/${total} 次）。`,
    timeoutLimit: ({ minutes }) => `最多等待 ${minutes} 分鐘`,
    timedOut: ({ executable, minutes }) =>
      `${executable} 執行逾時（已等待 ${minutes} 分鐘）。較高的思考強度或大型專案需要更久；可降低思考強度、改用較快的模型，或提高 BELLPR_AGENT_TIMEOUT_SCALE。`,
  },
  command: {
    timedOut: ({ executable }) => `${executable} 執行逾時。`,
    outputTooLarge: ({ executable }) =>
      `${executable} 輸出超過安全上限；請縮小工作範圍。`,
    spawnFailed: ({ executable, reason }) => `${executable} 無法啟動：${reason}`,
    failed: ({ executable, output }) => `${executable} 執行失敗：${output}`,
  },
  diff: {
    unparsable: "無法解析 Git 差異。",
    renameFirst: "檔案名稱包含不支援的字元，請先重新命名。",
    unsupportedName: "檔案名稱包含不支援的字元。",
    tooManyFiles: "差異超過 150 個檔案，請縮小任務後重新執行。",
    outsideWorktree: "檔案超出工作目錄。",
    tooLarge: "差異超過 2 MB，請拆成較小的工作。",
    blocked: {
      sensitive: "敏感檔案或產物不會被加入 PR；請先從本次變更移除。",
      notRegularFile: "新檔案必須是一般檔案；符號連結需要手動處理。",
      newFileTooLarge: "新檔案超過 512 KB，請手動檢視或拆分。",
      binary: "二進位檔案需要另外人工檢視，無法透過此工作流程發佈。",
      credentials: "發佈前會擋下常見格式的 token 與私鑰。",
    },
    heldBack: ({ reason }) => `此檔案已暫停發佈：${reason}`,
  },
  context: {
    notAFile: "子模組或特殊項目沒有可展開的程式碼。",
    tooLarge: "檔案超過 512 KB，無法展開周圍的程式碼。",
    binary: "二進位檔案無法展開周圍的程式碼。",
    credentials: "發佈前會擋下常見格式的 token 與私鑰。",
    blocked: "這個檔案目前無法審閱，也不會顯示周圍的程式碼。",
    stale: "檔案差異已更新，請重新整理差異。",
    baseMoved: "工作的基準已更新，請重新整理差異。",
    wholeFile: "新增或刪除的檔案已經完整顯示。",
    unreadable: "檔案無法讀取或超過 512 KB。",
  },
  commits: {
    notFound: "找不到這個貢獻的 commit。",
    unsupportedName: "檔案名稱包含不支援的字元。",
    sensitive: "敏感檔案或產物，不顯示內容。",
    binary: "二進位檔案，不顯示內容。",
    tooLarge: "差異超過 600 KB，不顯示內容。",
    credentials: "發佈前會擋下常見格式的 token 與私鑰。",
  },
  premise: {
    tooEarly: "請等待開發完成後再查核前提。",
    busy: "這個工作還有 Agent、審查或解說在進行；請等它完成再查核前提。",
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
      `這次修改超過 ${limit} 個程式檔，只為前 ${limit} 個自動產生程式碼解說；其他檔案可以在「追問 Agent」詢問。`,
    incomplete: "Agent 回傳的程式碼解說格式不完整。",
    tooEarly: "請等待開發完成後再產生程式碼解說。",
    stopped: "程式碼解說已中斷，可以重試。",
    failed: "程式碼解說產生失敗，請重試。",
    notFinished: ({ path, reason }) => `${path} 的程式碼解說未完成：${reason}`,
    lineName: ({ line }) => `第 ${line} 行`,
  },
  integration: {
    snapshotBlocked: "整合快照含有無法審閱的檔案，已停止派工。",
    noWorktree: "任務缺少隔離工作目錄。",
    gitStateChanged: "Teammate 改動 Git 提交狀態，已停止整合。",
    outOfScope: ({ path }) =>
      `Teammate 修改了未分配的檔案 ${path}；差異保留在其隔離工作目錄，未整合。`,
    needsManualHandling: ({ path }) => `Teammate 的 ${path} 需要人工處理，未整合。`,
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
    notJson: "Lead 未回傳有效的任務計畫 JSON，請調整需求後重試。",
    invalid: ({ problem }) =>
      `Lead 回傳的計畫不符合格式（${problem}）；請調整需求後重試。`,
    duplicateIds: "Lead 計畫包含重複或保留的任務 ID。",
    invalidDependency: "Lead 計畫包含無效的任務依賴。",
    invalidScope: ({ scope }) => `Lead 計畫的檔案範圍無效：${scope}`,
    cycle: "Lead 計畫的任務依賴形成循環。",
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
    rerunNotAllowed: "只有審閱中或已核准的工作可以重新執行審查。",
    rerunRunning: "這個工作的審查正在重新執行，請等待完成或先停止。",
    nothingToReview: "目前沒有程式碼差異可供審查。",
    rerunRequested: ({ files }) =>
      `要求依目前工作目錄的 ${files} 個變更檔案重新執行獨立審查。`,
    rerunDone: "獨立審查已更新；報告是建議，審閱狀態與核准不變。",
    rerunStopped: "已停止重新審查；原有報告與審閱狀態保留。",
    rerunIncomplete: "重新審查未完成。",
    explanationsTooEarly: "請等待開發完成後再產生變更解說。",
    fileNotFound: "找不到此差異檔案。",
    explanationsStopped: "解說產生已中斷；已完成的程式碼變更仍保留，可重試解說。",
    explanationsFailed: "變更解說產生失敗，請重試。",
    explanationsCancelled: "解說產生已取消。",
    notesTooEarly: "請等待開發完成後再寫下理解。",
    chatTooEarly: "請等待開發完成後再追問。",
    chatUnavailable: "此檔案目前無法用於追問。",
    feedbackUnpublished: "PR 尚未送出，還沒有維護者回饋可以讀取。",
    feedbackMismatch: "PR 網址與此 Repository 不一致，無法讀取回饋。",
    githubInvalidJson: "GitHub 回應不是有效的 JSON。",
    feedbackRead: ({ number, items }) =>
      `已讀取 PR #${number} 的維護者回饋：${items} 則。`,
  },
  draft: {
    notForRound:
      "這輪修正只推送新的 commit，不會更新 PR 說明，因此不需要產生草稿建議。",
    cancelled: "PR 草稿產生已取消。",
    stale: "程式碼差異已更新；請重新產生符合目前變更的 PR 草稿建議。",
    applied:
      "已把 PR 草稿建議放進編輯區。這是模型寫的原文，送出前請用自己的話確認內容，並處理核對清單與勾選項目。",
    ready: "PR 草稿建議已準備完成，現有草稿保留；可在 PR 草稿區檢視並套用。",
    stopped:
      "PR 草稿建議產生已中斷；現有草稿與已完成變更仍保留，可重新產生。",
    failed: "PR 草稿建議產生失敗，請重試。",
    incomplete: "PR 草稿建議未完成。",
  },
  sync: {
    partlyPublished:
      "先前的發佈已建立提交，可能已推送到 GitHub，因此不能再同步或復原同步；請從最新版本建立新工作。",
    unmarkedRun: ({ files }) =>
      `這些檔案的衝突無法用衝突標記表示（一邊刪除、另一邊修改，或兩邊都改了二進位檔），${product.name} 不會替你選邊：${list(files)}。工作沒有變動；可以先把這次對它們的修改或刪除還原，同步後再重做。`,
    unmarkedPr: ({ files, branch }) =>
      `這些檔案的衝突無法用衝突標記表示（一邊刪除、另一邊修改，或兩邊都改了二進位檔），${product.name} 不會替你選邊：${list(files)}。PR 沒有變動；請在本機用 git 把 ${branch} 合併進 PR 分支並推送，${product.name} 之後會接續這些提交。`,
    notAllowed:
      "只有審閱中、已核准或等待計畫核准的工作可以同步到最新目標分支。",
    busy: "這個工作還有 Agent、審查或解說在進行；請等它完成再同步。",
    busyUndo: "這個工作還有 Agent、審查或解說在進行；請等它完成再復原。",
    busyResolve: "這個工作還有 Agent、審查或解說在進行；請等它完成再解衝突。",
    baseMismatch: "工作分支的提交和記錄的基準不一致，已停止同步。",
    baseMismatchUndo: "工作分支的提交和記錄的基準不一致，已停止復原。",
    upToDate: ({ branch }) => `已確認 ${branch} 沒有新提交，工作已是最新。`,
    synced: ({ branch, commit, conflicts }) =>
      conflicts.length
        ? `已同步到 ${branch} 最新版本（${commit}），${conflicts.length} 個檔案有衝突需要解決：${list(conflicts)}。`
        : `已同步到 ${branch} 最新版本（${commit}），沒有衝突；改到的檔案需要重新審閱。`,
    prOnly: "只有已送出的 PR 可以同步目標分支。",
    roundOpen: "這個 PR 已有一輪修正在進行；完成或放棄後再同步。",
    prCheckoutDiffers:
      "工作目錄和已推送的 PR 內容不一致；請先還原工作目錄裡的修改再同步。",
    prUpToDate: ({ branch }) => `已確認 PR 已包含 ${branch} 的最新版本。`,
    nothingToMerge: ({ branch }) =>
      `${branch} 已經包含這個 PR 的全部修改，合併後沒有差異，所以沒有同步；PR 沒有變動，可以考慮關閉它。`,
    prSynced: ({ branch, commit, conflicts }) =>
      conflicts.length
        ? `已把 ${branch} 最新版本（${commit}）合併進 PR，${conflicts.length} 個檔案有衝突需要解決：${list(conflicts)}。`
        : `已把 ${branch} 最新版本（${commit}）合併進 PR，沒有衝突；審閱後會推送一個合併 commit。`,
    nothingToUndo: "目前沒有可以復原的同步。",
    undone: "已復原同步，工作回到同步前的內容與基準。",
    noConflicts: "目前沒有需要解決的同步衝突。",
    conflictsGone: "衝突標記都已解決，不需要再請 Agent 處理。",
    resolveRequested: ({ files }) =>
      `要求 Agent 解決 ${files.length} 個檔案的合併衝突：${list(files)}。`,
    agentCommitted:
      "Agent 自行建立了 commit 或切換了分支；已還原，修改保留在工作目錄供你審閱。",
    markersLeft: ({ files }) => `仍有衝突標記：${list(files)}。`,
    resolved: "Agent 已解決合併衝突，請逐檔審閱這些檔案。",
    stillConflicted: ({ files }) =>
      `Agent 處理後仍有衝突標記：${list(files)}；可以自行修改，或再請 Agent 處理。`,
    stopped: "已停止解衝突；已改的檔案保留，可以自行完成，或再請 Agent 處理。",
    failed: ({ reason }) =>
      `${reason}；已改的檔案保留，可以自行完成，或再請 Agent 處理。`,
    incompleteReason: "解衝突未完成",
    incomplete: "解衝突未完成。",
    conflictsOpen: ({ files }) =>
      `這些檔案還有合併衝突標記：${list(files)}。請先解決衝突（也可以請 Agent 解決）。`,
    mergeFailed: "無法計算合併結果。",
    answerIncomplete: "Agent 回傳的解衝突結果格式不完整",
  },
  followUp: {
    inProgress: "這個工作已有一輪修正在進行。",
    busy: "這個工作已有一輪修正或審查在進行。",
    notPublished: "只有已送出 PR 的工作可以依 review 繼續修正。",
    feedbackNotInLatest:
      "選取的回饋不在最近一次讀取的結果中；請重新讀取回饋後再選。",
    inputRequired: "請至少選一則回饋，或寫下這輪要修正的內容。",
    checkoutDiffers:
      "工作目錄和已推送的 PR 內容不一致；請先還原工作目錄裡的修改再開始修正。",
    requested: ({ feedback, note, round }) =>
      `要求依 ${feedback} 則維護者回饋${note ? "與補充說明" : ""}進行第 ${round} 輪修正。`,
    agentCommitted: followUpAgentCommitted,
    noChanges:
      "Agent 沒有修改任何檔案；請看下方的說明，必要時調整選取的回饋或補充說明再試一次。",
    done: ({ round, agentCommitted }) =>
      `第 ${round} 輪修正完成，請逐檔審閱這輪改到的檔案，確認提交訊息後再推送。${agentCommitted ? followUpAgentCommitted : ""}`,
    stoppedReason: "這輪修正已停止",
    incompleteReason: "這輪修正未完成",
    keptEdits: ({ reason }) =>
      `${reason}；工作目錄保留了部分修改，可以審閱、寫好提交訊息後推送，或放棄這輪修正。`,
    nothingToDiscard: "目前沒有可以放棄的修正。",
    alreadyPushed: `這輪修正已推送到 PR；請再按一次推送，讓 ${product.name} 記錄完成。`,
    discarded: "已放棄這輪修正，工作目錄回到已推送的 PR 內容。",
    discardedWithoutFiles: "已放棄這輪修正；它的修改已隨先前移除的工作檔案一併刪除。",
    answerIncomplete: "Agent 回傳的修正結果格式不完整",
    pushUnknown: "無法確認這輪修正是否已推送到 PR。",
    remoteMoved: ({ branch }) =>
      `GitHub 上的 PR 分支 ${branch} 已有 ${product.name} 以外的提交（例如在 GitHub 上套用建議、維護者推送或更新分支），${product.name} 不會覆蓋，也無法接續修正；請在 GitHub 上處理，或放棄這輪修正。`,
    remoteMissing: ({ branch }) =>
      `GitHub 上找不到 PR 分支 ${branch}，無法推送修正。`,
    historyRewritten: ({ branch }) =>
      `GitHub 上的 PR 分支 ${branch} 改寫了 ${product.name} 推送過的歷史（例如 force push），${product.name} 無法接續；請在 GitHub 上處理。`,
    adoptedReport: ({ commits }) =>
      `接續了 GitHub 上 ${product.name} 以外的 ${commits} 個提交；這些改動會在下一輪一起審閱。`,
    adopted: ({ branch, commits }) =>
      `已接續 GitHub 上 PR 分支 ${branch} 的 ${commits} 個提交（例如在 GitHub 上套用建議或 Update branch）；這些改動會在下一輪一起審閱。`,
  },
  recovery: {
    unreadableState: ({ path, reason }) =>
      `無法讀取 ${path}：${reason}。請檢查檔案是否為有效 JSON（version 1）。`,
    invalidStateFormat: "狀態檔格式無效",
    draft: "服務重新啟動，PR 草稿建議已中斷；現有草稿保留，可重新產生。",
    explanation: "服務重新啟動，解說產生已中斷；可重試產生解說。",
    walkthrough: "服務重新啟動，程式碼解說已中斷；可重試。",
    review: "服務重新啟動，重新審查已中斷；原有報告保留",
    conflicts:
      "服務重新啟動，解衝突已中斷；已改的檔案保留，可以自行完成，或再請 Agent 處理。",
    round:
      "服務重新啟動，這輪修正已中斷；工作目錄保留的修改可以審閱、寫好提交訊息後推送，或放棄這輪修正。",
    run: "服務重新啟動，先前工作已中斷。工作目錄仍保留，可檢視差異；團隊工作可在任務板重試失敗的子任務，已整合的子任務不會重跑。",
    task: "服務重新啟動，任務已中斷；隔離工作目錄保留，重試時會以新快照重新開始。",
  },
  repos: {
    notFound: "找不到 Repository。",
    importSource: "請輸入 GitHub HTTPS URL 或本機 Repository 的絕對路徑。",
    bare: "請選擇有工作目錄的 Repository。",
    pathMissing: ({ path }) =>
      `${product.name} 執行的電腦上沒有 ${path} 這個資料夾。請檢查路徑；~/ 代表執行 ${product.name} 的使用者的家目錄。`,
    notGitRepository: ({ path }) =>
      `${path} 不在任何 Git repository 中。請輸入 Git 專案的資料夾，也就是含有 .git 資料夾的那一個。`,
    localNotUpdated:
      `這個專案沒有 GitHub 來源，${product.name} 無從更新它的副本。若要使用較新的程式碼，請先更新你自己的 repository，再在這裡移除專案並重新匯入。`,
    checkoutNotUpdated:
      `這是你本機的 repository，${product.name} 不會更動它；請在終端機自行 git pull 後再重新分析。`,
    cloneChanged: `${product.name} 的專案副本有未預期的修改，已停止更新；請檢查後再試。`,
  },
  split: {
    byHand: "親手學的工作由你逐行撰寫，無法拆分。",
    published: "這個貢獻已經發布，無法拆分。",
    alreadySplit: ({ count }) =>
      `這個貢獻已經拆成 ${count} 個。請開啟其中一個，或再拆其中一個。`,
    followUp: "這個貢獻有一輪修正正在進行，目前無法拆分。",
    unknownPath: ({ path }) => `「${path}」不是這個貢獻有變更的檔案。`,
    duplicatePath: ({ path }) => `「${path}」出現在多個貢獻中；一個檔案只能放進一個貢獻。`,
    heldBack: ({ path }) => `「${path}」已被擋下、不納入審閱，無法移動；請選擇不移動。`,
    notReproduced:
      "複製出來的檔案與原檔不一致，所以沒有拆分。改寫檔案內容的 Git 設定（例如換行轉換）可能造成這種情況。",
    startedFrom: ({ title }) => `拆分自「${title}」。`,
    wasSplit: ({ count }) => `已拆成 ${count} 個貢獻。`,
  },
  publish: {
    commitMessageInvalid: "提交訊息只能包含文字與換行。",
    invalidBranch:
      "GitHub 分支名稱只能用英數字與 . _ - /，不能有 ..，也不能以 . 或 .lock 結尾。",
    notEditable: "請等待工作完成後再審閱與編輯。",
    roundKeepsPrText:
      "這輪修正只推送新的 commit，PR 標題與說明維持原樣，不能在這裡修改。",
    branchIsTarget: ({ branch }) =>
      `GitHub 分支不能是目標分支 ${branch}，否則會直接推送到目標分支而不是建立 PR；請用新的分支名稱。`,
    branchLocked: ({ branch }) =>
      `先前發佈已推送到 GitHub 分支 ${branch}，推送後不能改分支，以免重複建立 PR。請還原分支名稱，或建立新工作。`,
    fileChanged: "檔案差異已更新；請重新載入並審閱最新內容，再標記為已審閱。",
    draftChanged: "PR 草稿已更新；請重新載入並確認最新標題與內容，再重新核准。",
    reviewAllFirst: "請先審閱所有最新差異，並移除被擋下的檔案。",
    prTextRequired: "請先填寫 PR 標題與內容。",
    roundMessageRequired: "請填好這輪修正的提交訊息，不要留下待填寫的內容。",
    approvalStale: "核准版本已更新或失效；請重新載入、審閱並核准，再送出 PR。",
    approveFirst: "請先完成審閱並核准 PR。",
    noGithubOrigin: "此 Repository 尚未連結 GitHub origin，無法發佈。",
    diffChanged: "差異已變更，請重新審閱與核准。",
    notAllReviewed: "最新差異尚未全部審閱。",
    understandingRequired:
      "核准或發布前，請先用自己的話講一遍：完成最新版本變更的理解檢查。你可以在「設定 → 學習」關閉這項檢查；未經檢查就核准的工作會被標記。",
    prAlreadySent:
      "這個 PR 已經送出；要推送新的修改，請從維護者回饋開始一輪修正。",
    branchIsTargetReapprove: ({ branch }) =>
      `GitHub 分支不能是目標分支 ${branch}；請修改分支名稱並重新核准。`,
    branchLockedPublish: ({ branch }) =>
      `先前發佈已推送到 GitHub 分支 ${branch}；請還原分支名稱，或建立新工作。`,
    confirmFirst: ({ items }) => `送出前請在預覽視窗逐項確認：${items.join(" ")}`,
    githubUserInvalid: "GitHub 使用者資訊不正確。",
    defaultBranchChanged: "遠端預設分支已變更，請從最新分支建立新工作。",
    targetMoved:
      "目標分支已有新提交；請先在 PR 草稿頁按「同步到最新目標分支」，審閱後再送出。",
    targetMovedAfterCommit:
      "目標分支已有新提交；先前的發佈已建立提交，可能已推送到 GitHub，因此不能再同步或復原同步；請從最新版本建立新工作。",
    branchChanged: "工作分支已改變，已停止發佈。",
    priorCommitDiffers:
      "先前發佈已建立不同的提交。請建立新工作，以避免覆寫可能已推送的分支。",
    priorMessageDiffers:
      "先前發佈的提交已帶有不同的提交訊息，推送後無法更改。請還原提交訊息，或建立新工作。",
    notAFork: "同名 Repository 不是目標專案的 fork，請先處理 GitHub fork。",
    noPrUrl: "GitHub 未回傳 PR URL，請先到 GitHub 確認，避免重複發佈。",
    prCreated: "已建立 GitHub Draft PR。",
    failed: "發佈失敗。",
    failedAfterPush: ({ error }) =>
      `${error} 若推送已完成，分支會保留在 GitHub；重試前請確認遠端狀態。`,
    roundReverts: ({ files }) =>
      `這輪修正把已推送的檔案改回原始版本或刪除：${list(files)}。這類修改無法在 ${product.name} 逐檔審閱，因此不會推送；請還原這些檔案或放棄這輪修正。`,
    roundMessageMissing: "請填寫這輪修正的提交訊息。",
    roundMessagePlaceholders: "提交訊息還有待填寫的內容，請改好再推送。",
    roundNoPushTarget: "找不到這個 PR 的推送位置，無法推送修正。",
    roundPushed: ({ round, branch, commit }) =>
      `已把第 ${round} 輪修正推送到 PR 分支 ${branch}（${commit}）。`,
    branchChangedPush: "工作分支已改變，已停止推送。",
    commitChangedPush: "工作分支的提交已改變，已停止推送。",
    prMerged: "這個 PR 已合併，不能再推送修正。",
    prClosed: "這個 PR 已關閉，不能再推送修正。",
    roundEmpty: "這輪沒有新的修改可以推送；可以放棄這輪修正。",
    roundCommitDiffers:
      "這輪修正先前已建立不同內容的 commit；請還原修改與提交訊息後再推送，或放棄這輪修正。",
    pushFailed: "推送失敗。",
    stagedFilesDiffer: "準備提交的檔案與已核准差異不同。",
    fileChangedWhileStaging: ({ path }) => `${path} 在準備提交時變更，請重新審閱。`,
    filesChangedWhilePublishing: "檔案在發佈準備期間變更，請重新審閱。",
  },
};
export default m;
