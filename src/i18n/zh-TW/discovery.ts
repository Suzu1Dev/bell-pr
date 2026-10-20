import { formatters, type Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/discovery";

const fmt = formatters("zh-TW");

const m: Translation<typeof en> = {
  eyebrow: "FIND YOUR NEXT CONTRIBUTION",
  title: {
    lead: "找到值得投入的",
    emphasis: "下一個貢獻。",
  },
  intro: {
    lead: "從真實的使用者需求出發，讓 AI 幫你讀懂規範、評估門檻，",
    rest: "找到適合學習，也能帶來改變的開發機會。",
  },
  heroCaption: "GitHub → 你的下一步",
  form: {
    heading: "你想從哪裡開始？",
    hint: "留白也可以，我們先幫你找方向",
    interests: "感興趣的領域",
    interestsPlaceholder: "例如：accessibility、developer tools",
    interestsHint: "以 GitHub 關鍵字搜尋；多個詞會一起篩選。",
    language: "程式語言",
    languagePlaceholder: "不限，例如 TypeScript",
    difficulty: "可接受的難度",
    difficulties: {
      beginner: "適合初學者",
      intermediate: "中等以下",
      any: "不限難度",
    },
    sort: "搜尋排序",
    sortHint:
      "最近更新：反映近期活動，但結果隨專案更新而變動。相關度：GitHub best match，可能含久未維護的專案，已排除封存專案並顯示最近推送時間。星數：知名度高，競爭與審查門檻也較高。",
    minStars: "最低星數",
    advanced: "模型與效率設定",
    agent: "Agent",
    model: "分析模型",
    defaultModel: ({ provider }) => `使用 ${provider} 預設模型`,
    modelNotInCatalog: ({ model }) => `${model}（目錄未提供）`,
    reasoningEffort: "思考強度",
    modelDefault: "模型預設",
    effortNotInCatalog: ({ effort }) => `${effort}（已儲存，目錄未提供）`,
    ponytailMode: "效率模式",
    ponytailCredit: "效率模式以 DietrichGebert 的 Ponytail（MIT）為基礎。",
    ponytailModes: {
      lite: "輕量 · 預設",
      full: "完整",
      off: "關閉",
    },
    accountHint: ({ provider }) =>
      `分析會沿用你的 ${provider} 登入，使用模型用量。模型目錄不代表帳號具有所有模型的使用權限。`,
    publicDataOnly: "查閱公開資料，選定項目後再開始規劃。",
    submit: "推薦貢獻項目",
  },
  sorts: {
    updated: "最近更新",
    relevance: "相關度",
    stars: "星數",
  },
  locked: {
    body: "即時探索會搜尋 GitHub，並請你的 AI 服務評估每個專案，屬於 Pro 功能；你已有的結果仍可閱讀。",
    startTrial: ({ days }) => `開始 ${fmt.number(days)} 天試用`,
    upgrade: "升級到 Pro",
  },
  sample: {
    title: "示範結果，非即時資料",
    body: "這些虛構專案用來示範探索會找到什麼；內容並非來自 GitHub 或 AI，也無法匯入。",
  },
  languages: {
    en: "英文",
    "zh-TW": "繁體中文",
  },
  localeNotice: {
    writtenIn: ({ language }) => `這些結果以${language}撰寫。`,
    searchAgain: ({ language, current }) =>
      `這些結果以${language}撰寫。重新搜尋即可取得${current}的結果。`,
  },
  reload: "重新讀取狀態",
  loading: "正在讀取探索紀錄…",
  progress: {
    label: "探索進度",
    eyebrow: "RESEARCH IN PROGRESS",
    stop: "停止探索",
    phases: {
      searching: {
        title: "搜尋專案",
        detail: "公開專案與活躍 issues",
      },
      screening: {
        title: "核對規範與需求",
        detail: "貢獻文件、認領與維護者回應",
      },
      analyzing: {
        title: "AI 整理推薦",
        detail: "可行性、使用者價值與第一步",
      },
    },
  },
  searchedAt: ({ date }) => `查詢時間 ${date ?? "未提供"}`,
  limitations: ({ count }) => `這次搜尋的範圍與限制 · ${fmt.number(count)}`,
  empty: {
    title: "好的貢獻，從理解需求開始。",
    body: "按下推薦後，我們會查閱 GitHub 公開專案與 issues，再從這四個角度整理機會。",
    retryTitle: "換個條件，找找下一個機會。",
    retryBody:
      "目前沒有足夠證據支持適合的項目。試著減少關鍵字、放寬難度，或降低最低星數。",
    angles: {
      rules: { title: "專案規範", detail: "先理解怎麼參與" },
      activity: { title: "熱度與活動", detail: "看見持續維護的訊號" },
      needs: { title: "使用者需求", detail: "確認改動能幫助誰" },
      barrier: { title: "投入門檻", detail: "找到做得到的第一步" },
    },
  },
  results: {
    label: "推薦貢獻清單",
    eyebrow: "YOUR CONTRIBUTION SHORTLIST",
    previousEyebrow: "PREVIOUS RESULTS",
    title: "從這些機會，邁出第一步。",
    previousTitle: "上一份推薦，仍在這裡。",
    note: ({ sort }) =>
      `依你選的「${sort}」排序取 12 個候選、驗證後最多 6 個；順序由分析整理，不是 GitHub 全站排名。實作前仍需確認 issue 最新狀態與維護者意願。`,
    sampleNote: "即時搜尋會依你選的排序取 12 個候選，檢查後最多保留 6 個，結果就像這些示範。",
    previousNote: ({ date }) =>
      date
        ? `這是 ${date} 的結果，未反映本次搜尋。`
        : "這是先前的結果，未反映本次搜尋。",
    count: ({ count }) => `${fmt.number(count)} 個項目`,
  },
  difficulties: {
    beginner: "初學者",
    intermediate: "中等",
    advanced: "進階",
  },
  card: {
    languageUnknown: "未標示語言",
    lastPush: ({ date }) => `最近推送 ${date ?? "未提供"}`,
    whoItHelps: "這次貢獻，可以幫助誰？",
    whyItFits: "為什麼適合投入",
    effort: "預估投入",
    effortNote: "AI 估計，尚未檢視完整程式碼。",
    rulesSummary: "貢獻規範與熱度判讀",
    rules: "參與前，先讀這些規定",
    popularity: "熱度快照",
    planSummary: "第一步、驗收方式與待確認事項",
    firstSteps: "建議從這裡開始",
    acceptanceChecks: "如何確認完成（尚未執行）",
    risks: "投入之前，再確認",
    evidence: ({ count }) => `推薦依據與原文 · ${fmt.number(count)} 則`,
    chooseHint: "選擇後匯入專案，帶入可編輯的任務設定。",
    sampleHint: "示範專案無法選擇；即時探索會找到可匯入的真實專案。",
    choose: "選擇此項目",
    importing: "正在匯入專案…",
    learnByHand: "親手學：這一個請自己寫",
    learnByHandHint:
      "這個 issue 有新手標籤。親手寫修正才是認識專案的方式，所以 agent 團隊不會接手。先讀計畫與來源，再開啟 issue。",
    openIssue: "開啟 issue",
    startByHand: "開始親手學",
    reservedOutput: `這個專案會關閉這類 issue 上由 AI 產生的 Pull Request。只有專案自己的文字點名了嚮導提供的每一種協助，而且你確認過被引用的規範之後，${product.name} 才能為它發布親手學的任務；任務對話框會說明是哪一種情況。`,
  },
  byHand: {
    legend: "誰來寫程式碼？",
    agents: "Agent 團隊來寫",
    hand: "你自己寫（親手學）",
    handText: `嚮導和你一起規劃、給提示，並在你要求時審查你的修改。這個任務裡，${product.name} 的 agent 無法修改你的檔案。送出之前，你要在沒有協助的情況下把修改解釋一遍。`,
    sample: "示範專案只示範 agent 團隊。親手學請用你自己的專案。",
    start: "和嚮導一起規劃",
    fit: "讓嚮導配合專案規範",
    full: "所有協助都要，只在本機練習",
    fullNote: `${product.name} 不會在這裡發布那個任務。`,
    practice: "嚮導仍然提供所有協助。",
    planApproval: "親手學一律開啟：動手寫之前，你要先確認自己的計畫。",
    title: "開始之前",
    practise: "親手寫，在本機練習",
    ban: ({ reach, condition }) =>
      `${product.name} 不會在這裡發布親手學的任務：${reach === "assistance" ? "專案規範限制的是 AI 協助本身，不只是 AI 寫的程式碼" : reach === "output" ? `專案規範不接受 AI 產生的內容，而且${condition}` : `${product.name} 無法從專案規範的原文判斷它涵蓋哪些情況`}。`,
    area: ({ reach, condition }) =>
      reach === "output" || reach === "automate"
        ? `${product.name} 不會為這個 issue 發布親手學的任務：專案會關閉這類 issue 由 AI 產生的 Pull Request，而且${condition}。`
        : `${product.name} 不會為這個 issue 發布親手學的任務：專案把它留給不靠 AI 工具學習的人。`,
    fitted: ({ kinds, quote }) =>
      `只有嚮導始終待在專案原文說可以的範圍內（${kinds}：「${quote}」），而且你確認過專案被引用的規範之後，${product.name} 才能在這裡發布親手學的任務。你的修改是否合適，由維護者決定。`,
    registry: ({ date }) => `出自 ${product.name} 的檢查清單 · 查核於 ${date}`,
    rulesFitted: "這個任務開始時就配合了這條規則，所以發布時可以改為請你確認被引用的規則，而不是直接擋下。你的修改是否合適，由維護者決定。",
    retry: "重試會讓這個任務回到和嚮導一起規劃的階段。",
  },
  runtime: {
    summary: "這次探索使用的模型與用量",
    usageTitle: "探索 AI 用量",
  },
};

export default m;
