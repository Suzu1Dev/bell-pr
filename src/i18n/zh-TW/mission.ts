/**
 * The project overview, the contribution direction and model form, and the
 * project analysis state (Traditional Chinese, Taiwan).
 */
import { formatters, type Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/mission";

const fmt = formatters("zh-TW");
const n = (value: number) => fmt.number(value);
const version = (sha?: string) => (sha ? `分析版本 ${sha}` : "分析版本");

const m: Translation<typeof en> = {
  overview: {
    kicker: "PROJECT CONTEXT",
    title: "先看懂專案，再決定怎麼改。",
    lead: "從使用者的角度，理解每一次貢獻的理由。",
    update: "更新到最新版本",
    updating: "正在更新…",
    updateHelp: ({ branch, updatedAt }) =>
      `從 GitHub 取得 ${branch} 的最新版本，專案全貌與分析會以它為準；新的貢獻本來就從最新版本開始。${updatedAt ? ` 上次更新：${updatedAt}` : ""}`,
    analyze: "分析專案全貌",
    reanalyze: "重新分析",
    analyzing: "正在分析專案…",
  },
  empty: {
    loadingTitle: "正在把程式碼，整理成專案全貌。",
    title: "你的下一個貢獻，從理解開始。",
    loadingLead:
      "Agent 會閱讀專案文件與主要模組，整理用途、使用流程，以及有依據的改善建議。",
    lead: "讓 Agent 閱讀這個 repository，先回答三個問題，再決定值得投入的方向。",
    questions: {
      problem: "它解決什麼問題？",
      users: "誰會使用它？",
      improve: "哪裡值得改善？",
    },
    start: "開始專案分析",
    note: "分析完成前，不會推測這個專案的用途或推薦改動。",
  },
  project: {
    sourceDemo: "示範分析",
    sourceAi: "AI 專案分析",
    audience: "主要使用者",
    updatedAt: ({ date }) => `更新於 ${date}`,
    version: "版本",
    demoNote: "預寫範例，未呼叫 AI",
    coverage: ({ sampled, tracked, kilobytes, truncated }) =>
      `讀取 ${n(sampled)} / ${n(tracked)} 個追蹤檔（約 ${n(kilobytes)} KB${truncated > 0 ? `，${n(truncated)} 檔節錄` : ""}），推論仍需確認`,
    coverageUnknown: "抽樣範圍未記錄，重新分析後顯示，推論仍需確認",
    usageTitle: "這次專案分析用量",
  },
  stale: {
    unknown:
      "專案內容已更新。這份分析來自先前版本，無法列出變更明細；重新分析後再確認貢獻方向。",
    sameContent:
      "版本已變更，但分析引用的檔案內容相同；全貌仍可能受其他變更影響，重新分析後再確認貢獻方向。",
    uncited: ({ changed, sha }) =>
      `自${version(sha)}後有至少 ${n(changed)} 個檔案變動。分析引用的檔案未變動，但全貌仍可能受其他變更影響，重新分析後再確認貢獻方向。`,
    cited: ({ changed, sha, cited, capped, files }) =>
      `自${version(sha)}後有至少 ${n(changed)} 個檔案變動，其中 ${n(cited)} 個${capped ? "以上" : ""}是本份分析引用的檔案：${files}。重新分析後再確認貢獻方向。`,
  },
  journey: {
    kicker: "THE USER JOURNEY",
    title: "使用者如何用到這個專案？",
  },
  reading: {
    kicker: "WHERE TO START READING",
    title: "第一次讀這個專案，建議這樣讀",
    lead: "依 Agent 讀過的抽樣檔案排出順序；每一步說明為什麼先看它、看什麼。",
    flow: "模組怎麼串起來",
    unsampled: "未抽樣，內容未讀",
    lookFor: "看什麼",
    context: "這個檔案在分析中的其他說明",
  },
  details: {
    modules: "主要模組怎麼分工？",
    moduleCount: ({ count }) => `${n(count)} 個模組`,
    sources: "分析的來源與依據",
    sourceCount: ({ count }) => `${n(count)} 份來源`,
  },
  fields: {
    modules: "模組分工",
    readingPath: "閱讀順序",
    evidence: "分析依據",
  },
  brief: {
    kicker: "THIS CONTRIBUTION",
    title: "這次改動，會帶來什麼不同？",
    problem: "這次想解決的問題",
    motivation: "為什麼值得現在改善",
    beneficiaries: "受益對象",
    before: "BEFORE",
    beforeCaption: "目前的體驗",
    after: "AFTER",
    afterCaption: "希望帶來的改善",
    impactNote:
      "以上是這次貢獻的目標；是否達成，仍需根據實作與驗證結果確認。",
    validation: "如何知道改動有用？",
    risks: "一起留意的取捨",
    request: "你提出的需求",
    pending:
      "尚未產生這次貢獻的使用者影響分析。先保留原始需求，完成分析後再連結到具體動機與驗收方式。",
  },
  evidence: {
    none: "尚無檔案依據，開始前需確認。",
    filesLabel: "參考檔案",
    quotes: "查看原文依據",
    quotesNote: "原文支持觀察；建議做法與使用者影響仍需確認。",
    why: "為什麼引用這段",
  },
  ideas: {
    kicker: "WHERE YOU CAN HELP",
    title: "值得探索的貢獻方向",
    lead: "先看問題與使用者價值，再決定要不要交給團隊。",
    sampleCount: ({ count }) => `${n(count)} 個示範`,
    recommendationCount: ({ count }) => `${n(count)} 個建議`,
    more: ({ count }) => `產出 ${n(count)} 個新建議`,
    generating: ({ count }) => `正在產出 ${n(count)} 個新建議…`,
    limitReached: "建議數量已達上限",
    moreDemo:
      "示範內容使用預寫建議。匯入真實專案後，即可請 Agent 產出更多貢獻方向。",
    moreStale: "專案版本已更新，請先重新分析專案，再產出更多建議。",
    moreLimit: ({ max }) =>
      `已累積 ${n(max)} 個建議，達到這份分析的上限。可先挑選方向，或重新分析專案。`,
    moreHint:
      "Agent 會沿用這個專案已儲存的模型設定，尋找不同的改善問題與使用者價值。既有建議會保留，由你決定何時開始開發。",
    generatingStatus:
      "正在閱讀專案、避開既有方向，你可以繼續閱讀下方建議。",
    viewAdded: ({ added, requested }) =>
      `查看本輪新增 ${n(added)}${requested !== undefined ? ` / ${n(requested)}` : ""} 個建議`,
    addedHidden: ({ added, requested }) =>
      `本輪新增 ${n(added)}${requested !== undefined ? ` / ${n(requested)}` : ""} 個建議，目前皆已隱藏。`,
    addedNone: ({ requested }) => `本輪新增 0 / ${n(requested)} 個建議。`,
    noneAdded: "本輪沒有新增不同且有足夠依據的建議，既有清單保持不變。",
    shortfall: "未補足本輪目標數量；既有清單保留。",
    provenance: "最近一次追加分析的模型與用量",
    generatedAt: ({ date }) => `產生於 ${date}`,
    usageTitle: "這次追加建議用量",
    retry: "重試產出",
    savingPreferences: "正在儲存排列與顯示設定…",
    hiddenCount: ({ count }) => `已隱藏 ${n(count)} 個建議`,
    restore: "恢復顯示",
    restoreLabel: ({ title }) => `恢復顯示：${title}`,
    droppedIdeas: ({ count }) =>
      `引文核對未通過，已略過 ${n(count)} 個建議`,
    droppedIdeasNote:
      "這些建議引用的原文不在送進模型的節錄中，因此只保留標題與原因；其餘分析結果照常儲存，可再「產出新建議」補足。",
    droppedPaths: ({ count }) =>
      `因引用未抽樣／不存在的檔案而略過 ${n(count)} 項說明`,
    droppedPathsNote:
      "模型只讀過抽樣檔案的內容，其餘路徑只知道存在；依據必須來自讀過的檔案，不在清單中的路徑則無法核對。其餘分析結果照常儲存。",
    rounds: {
      analysis: "專案分析",
      expansion: "最近一次追加",
    },
    navigationHint: "左右滑動，或聚焦清單後按方向鍵",
    showing: ({ first, last, total }) =>
      `顯示 ${n(first)}${last > first ? `–${n(last)}` : ""} / ${n(total)} 個顯示中的建議`,
    previous: "上一個建議",
    next: "下一個建議",
    railLabel: "貢獻建議橫向清單",
    manageLabel: ({ title }) => `管理建議：${title}`,
    dragLabel: ({ title }) =>
      `拖曳排序：${title}；也可使用向左或向右移動按鈕`,
    dragTitle: "拖曳排序，或使用旁邊的左右按鈕",
    moveLeft: "向左移動",
    moveLeftLabel: ({ title }) => `向左移動：${title}`,
    moveRight: "向右移動",
    moveRightLabel: ({ title }) => `向右移動：${title}`,
    hide: "隱藏",
    hideLabel: ({ title }) => `隱藏：${title}`,
    hideTitle: "隱藏此建議，可稍後恢復",
    newBadge: "本輪新增",
    userImpact: "對使用者的幫助",
    approach: "看建議做法與驗收方式",
    choose: "以此方向開始",
    allHidden: ({ count }) =>
      `你已隱藏全部 ${n(count)} 個建議。展開上方「已隱藏」清單，就能選擇恢復顯示。`,
    none: "這次分析尚未提出有足夠依據的建議。你可以指定想改善的方向，再讓團隊確認範圍。",
  },
  effort: {
    small: "小型範圍",
    medium: "中型範圍",
    large: "大型範圍",
  },
  confidence: {
    high: "依據較充分",
    medium: "需進一步確認",
    low: "初步構想",
  },
  nextStep: {
    codeTitle: "帶著理解，回到程式碼。",
    codeLead: "把預期的使用者改善，和每一段實際變更對照。",
    codeAction: "檢閱程式碼變更",
    ideaTitle: "有自己的想法，也可以從這裡開始。",
    ideaLead: "指定受益對象、期待的結果與開發界線。",
    ideaAction: "指定貢獻方向",
  },
  directions: {
    bugfix: { label: "修復問題", hint: "讓原本的行為正常運作" },
    feature: { label: "新增功能", hint: "讓使用者能完成新任務" },
    performance: { label: "改善效能", hint: "減少等待與資源耗用" },
    ux: { label: "使用體驗", hint: "讓操作更直覺、更順暢" },
    testing: { label: "補足測試", hint: "保護重要行為與邊界" },
    docs: { label: "完善文件", hint: "讓理解與上手更容易" },
    maintenance: { label: "維護整理", hint: "降低後續修改的負擔" },
  },
  settings: {
    directionLegend: "這次想從哪個方向貢獻？",
    directionNote: "選一個主要方向，讓團隊圍繞同一個目標工作。",
    optional: "選填",
    targetUser: {
      label: "誰會因此受益？",
      placeholder: "例如：用這個 SDK 建立儀表板的前端開發者",
    },
    outcome: {
      label: "完成後，使用者會有什麼不同？",
      placeholder:
        "例如：短暫網路中斷時，列表能自動重試載入，不需要手動重新整理。",
    },
    constraints: {
      label: "開發界線",
      placeholder: "例如：維持既有 API 相容；只處理 GET；不新增套件。",
      help: "寫下不能改動的行為、相容性或範圍限制。",
    },
    acceptance: {
      label: "怎樣算完成？",
      placeholder:
        "例如：\n暫時性失敗可重試成功\n401 不重試\n既有測試全部通過",
      help: "以可觀察的結果或測試描述，一行一項。",
    },
    issue: {
      label: "相關 issue 連結",
      help: "只接受 GitHub issue 頁面網址。填了之後，PR 草稿才可以寫 Fixes／Refs #編號並連回這個 issue；送出前請先在 issue 留言表明要處理。",
    },
    model: {
      heading: "模型與思考方式",
      note: "所有專案與 Agents 共用此設定。新任務會記錄自己的設定，後續修改不會影響已建立的任務。",
      agent: "Agent",
      providerHelp: {
        codex: "使用你已安裝並登入的 Codex CLI。",
        claude:
          "使用你已安裝並登入的 Claude Code CLI（Claude 方案或 Anthropic API 金鑰皆可）。用量計入你自己的帳號，可用模型依你的方案而定。",
      },
      model: "執行模型",
      providerDefault: ({ provider, model }) =>
        `${provider} 預設${model ? ` · ${model}` : ""}`,
      unconfirmed: ({ value }) => `${value} · 已儲存，待確認`,
      loading: ({ provider }) => `正在讀取本機 ${provider} 可用模型…`,
      unknownModel: "目前無法驗證這個已儲存的模型，請重新選擇或載入清單。",
      defaultModelHelp: ({ provider }) => `沿用本機 ${provider} 的預設模型。`,
      effort: "思考強度",
      proOption: ({ label }) => `${label} · Pro`,
      modelDefault: ({ effort }) => `模型預設${effort ? ` · ${effort}` : ""}`,
      unknownEffort: "已儲存的強度未在此模型的清單中，請重新選擇。",
      effortHelp: `只列出所選模型支援的強度；較高的強度每回合需要更久、用量也較多，${product.name} 會為 Claude Code 以及 xhigh、max 強度延長等待時間。`,
      webAccess: "允許 Agent 上網搜尋與讀取網頁",
      webAccessHelp:
        "套用到 Lead、Teammates、Reviewer、Test analyst 與追問導師；專案分析與探索貢獻維持離線。網頁內容視為不可信資料；Claude Code 的 curl、wget 仍被拒絕。",
      error: ({ message }) => `${message} 已儲存的選擇會保留。`,
      loadFailed: ({ provider }) => `暫時無法讀取 ${provider} 模型清單。`,
      reload: "重新載入",
    },
    ponytail: {
      label: "Ponytail 開發方式",
      modes: {
        lite: "輕量 · 預設",
        full: "完整",
        off: "關閉",
      },
      help: "輕量：以精簡規則減少過度開發。完整：套用更多規則，優先重用現有程式與原生功能。關閉：方便比較不同方式的成果與用量。",
      link: "查看 Ponytail",
    },
    team: {
      legend: "協作規模",
      teammates: "位隊友",
      note: "設定團隊上限，實際分工由任務計畫決定。",
      clampNotice: ({ free, pro }) =>
        `免費方案最多 ${n(free)} 位隊友，所以這個專案會使用 ${n(free)} 位。Pro 最多 ${n(pro)} 位。`,
    },
    planApproval: {
      label: "開發前，先讓我確認計畫",
      help: "先看分工、範圍與驗收方式，確認後再進入實作。",
    },
  },
  insights: {
    loadFailed: "無法讀取專案分析，請重試。",
    demoAnalysis:
      "示範專案使用預寫分析。匯入你的 repository 後，即可請 AI 閱讀真實原始碼。",
    demoMore: "匯入真實專案後，即可產出更多貢獻建議。",
    reanalyzeFirst: "請先重新分析專案，再產出更多建議。",
    limit: ({ max }) => `這份分析已累積 ${n(max)} 個建議。`,
    preferencesReverted: ({ reason }) =>
      `未儲存顯示與排序設定，已還原：${reason}`,
    preferencesRevertedRetry: "未儲存顯示與排序設定，已還原。請再試一次。",
    moreFailed: "尚未產出更多建議，原有清單已保留。請重試。",
    analysisFailed: "專案分析未完成，請重試。",
  },
};

export default m;
