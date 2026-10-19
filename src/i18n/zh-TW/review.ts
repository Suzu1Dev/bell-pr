/** The review surface (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/review";

/** 「第 9 行」或「第 8–9 行」。 */
const lineSpan = ({ first, last }: { first: number; last: number }) =>
  first === last ? `第 ${first} 行` : `第 ${first}–${last} 行`;

const m: Translation<typeof en> = {
  diff: {
    regionLabel: ({ path }) => `${path} 的程式碼差異`,
    lineLabel: {
      added: ({ line, text }) => `新增，第 ${line} 行：${text}`,
      removed: ({ line, text }) => `刪除，第 ${line} 行：${text}`,
      context: ({ line, text }) => `未變更，第 ${line} 行：${text}`,
    },
    blankLine: "空白行",
    listLabel: "差異的各行",
    keyboardHint: ({ button }) =>
      `用方向鍵在各行之間移動，按住 Shift 再按方向鍵可選取多行；按 Enter 前往選取範圍的「${button}」，按 Esc 清除選取。`,
    hunkLabel: ({ oldLine, newLine }) =>
      `從舊版第 ${oldLine} 行、新版第 ${newLine} 行起的變更`,
    hunkLabelIn: ({ oldLine, newLine, context }) =>
      `${context} 中，從舊版第 ${oldLine} 行、新版第 ${newLine} 行起的變更`,
    lineTitle: "點選行以追問，按住 Shift 可選取多行",
    noteHint: "還沒寫下你的理解",
    reviewed: "已審閱",
    blockedTitle: "這個檔案目前無法審閱",
    noTextTitle: "這個檔案沒有可顯示的文字差異",
    noTextBody: "二進位檔案或沒有文字變更的檔案，無法逐行呈現。",
    before: "變更前",
    after: "變更後",
    selectedLines: ({ count }) => `已選取 ${count} 行`,
    idleHint: "點選任何一行，讓 Agent 為你解說",
    shiftKey: "Shift",
    shiftHint: ({ key }) => `${key} 可多行選取`,
    clearSelection: "清除選取",
    gap: {
      showBelow: ({ count }) => `顯示上一段變更下方的 ${count} 行`,
      showAbove: ({ count }) => `顯示這段變更上方的 ${count} 行`,
      showAll: ({ count }) => `顯示這裡全部 ${count} 行`,
      showToEnd: "顯示到檔案結尾",
      hidden: ({ count }) => `${count} 行未變更`,
      toEnd: "檔案後面還有未變更的程式碼",
      endLabel: "最後一段變更之後的未變更程式碼",
      wholeFile: "完整檔案",
      wholeFileTitle: "在變更之間顯示整個檔案",
      loadFailed: "無法讀取周圍的程式碼。",
    },
    askSelection: "解說這段程式碼",
  },
  selection: {
    question: ({ path, count }) =>
      `請用白話解釋 ${path} 中選取的 ${count} 行程式碼，說明它們的用途、變更原因與需要注意的地方。`,
    lines: ({ path, oldLines, newLines }) =>
      oldLines && newLines
        ? `${path}，舊版${lineSpan(oldLines)}，新版${lineSpan(newLines)}：`
        : oldLines
          ? `${path}，舊版${lineSpan(oldLines)}：`
          : `${path}，新版${lineSpan(newLines!)}：`,
    truncated:
      "[內容已節錄] 選取範圍較長，下方僅附部分內容，請優先解釋這段節錄。",
  },
  provenance: {
    ai: "AI 生成 · 內容可能有誤",
    sample: "示範 · 預寫內容，未呼叫 AI",
    otherLanguage: ({ language }) => `這些解說是以${language}產生的。`,
    languages: {
      en: "英文",
      "zh-TW": "繁體中文",
    },
  },
  markdown: {
    imageOmitted: "圖片已省略",
    imageOmittedWithAlt: ({ alt }) => `圖片已省略：${alt}`,
    tableLabel: "解說表格",
  },
  panel: {
    label: "程式碼學習助手",
    title: "讀懂每一次改變",
    subtitle: "從發生什麼，到為什麼這樣做",
    demoBadge: "示範",
    liveBadge: "AI",
    tabsLabel: "學習面板",
    tabs: {
      explain: "變更解說",
      walkthrough: "程式碼解說",
      reports: "審查者怎麼看",
      chat: "追問 Agent",
    },
    module: ({ path, purpose }) => `所在模組 ${path}：${purpose}`,
    askAboutChange: "針對這份變更追問",
  },
  explain: {
    unavailableTitle: "目前無法解說此檔案",
    unavailableBody: "這份變更目前沒有可供解說的文字差異。",
    testFileHint:
      "測試就是行為規格：先讀 it/test 描述，再對照 expect 看它保護哪個邊界。",
    cards: {
      example: "白話文舉例",
      summary: "這段改了什麼？",
      reason: "為什麼這樣改？",
      concept: "帶走一個開發觀念",
      tip: "審閱時，多想一步",
      alternatives: "如果換個做法？",
      selfCheck: "考考自己",
    },
    exampleIntro: "先用一個情境，看懂修改前後的差別。",
    exampleScenario: "想像這個情境",
    exampleBefore: "修改前",
    exampleAfter: "修改後",
    exampleFailed: "白話例子尚未整理完成，其他解說可以繼續閱讀。",
    retryBusy: "其他解說整理中…",
    retryExample: "重新整理白話例子",
    examplePending: "正在補上白話例子",
    examplePendingBody: "完成後會自動放在這裡，你可以先閱讀下方解說。",
    lookup: "可以查：",
    showAnswer: "看答案",
    hideAnswer: "收起答案",
    evidenceDemo: "示範內容不是即時 AI 推論，也不代表測試結果。",
    evidenceLive: "解說以目前差異為依據；實際行為請搭配原始碼與測試確認。",
    failedTitle: "這份解說尚未整理完成",
    failedBody: "產生解說時發生問題，變更內容仍可正常審閱。",
    retry: "重新整理解說",
    failedNote: "完成後會直接出現在這裡",
    generatingTitle: "正在把變更整理成白話",
    generatingBody: "對照實際 diff，整理具體情境、設計原因與審閱重點。",
    pendingTitle: "解說會自動準備好",
    pendingBody: "Agents 完成變更後，就會在這裡整理解說。",
  },
  note: {
    label: "我的理解",
    staleBadge: "diff 已更新",
    intro:
      "用自己的話寫下這份變更做了什麼、為什麼；筆記會和寫下時的 diff 版本一起保存。",
    placeholder: "例如：這次把固定等待改成指數退避，是為了……",
    stale:
      "這段筆記寫於較早的 diff 版本，文字已保留；確認後重新儲存即可更新。",
    demo: "示範模式的筆記不會保存，重新整理後會消失",
    saved: ({ time }) => `已儲存 · ${time}`,
    unsaved: "尚未儲存",
    saving: "儲存中…",
    save: "儲存筆記",
  },
  reports: {
    sections: {
      implementer: { title: "Lead 整合摘要", author: "Atlas · Team lead" },
      reviewer: { title: "程式審查", author: "Lens · Reviewer" },
      tester: { title: "測試分析", author: "Scout · Test analyst" },
    },
    rerun: "重新執行審查",
    rerunBusy: "正在重新審查…",
    rerunNote:
      "依工作目錄目前的差異重新執行 Reviewer 與 Test analyst（唯讀，會使用 CLI 用量）。報告只是建議，不會改變已審閱與核准狀態。",
    emptyTitle: "這次工作還沒有審查報告",
    emptyBody:
      "Lead 整合、Reviewer 與 Test analyst 完成後，報告全文會放在這裡。",
    intro:
      "這些是獨立靜態審查，不是執行結果；每份報告保留全文，並標示提到目前檔案的段落數。",
    orderTitle: "Lead 建議的閱讀順序",
    orderIntro:
      "常見的讀法是先看定義與介面、再看呼叫端，測試放最前或最後；Lead 在整合摘要中說明了這次為何這樣排。左側檔案清單可切換「依建議順序」。",
    staticBadge: "獨立靜態審查，非執行結果",
    mentions: ({ count }) => `本報告提到此檔 ${count} 處`,
    noMentions: "此報告未直接提到本檔",
    evidenceDemo: "示範報告不是即時 AI 推論，也不代表測試結果。",
    evidenceLive:
      "報告內容由各角色靜態檢視產生；實測結果以報告中明確列出的指令與輸出為準。",
  },
  feedback: {
    title: "維護者對此檔的留言",
    count: ({ count }) => `${count} 則`,
    badge: "來自 GitHub，唯讀",
    replyNote: `回覆請到 PR 頁面；${product.name} 不會代你留言。`,
    line: ({ line }) => `第 ${line} 行`,
    resolved: "已解決",
    open: "開啟",
  },
  presets: {
    why: "為什麼要這樣改？",
    risks: "有哪些需要注意的風險？",
    test: "要怎麼測試這段程式碼？",
    elsewhere: "這個觀念在專案其他地方還能用在哪？",
    alternatives: "如果不這樣改，還有哪些做法？各有什麼取捨？",
    testFile: "這個測試在保護什麼行為？",
    feedback: "維護者這個意見對應 diff 哪幾行？有哪些回應方式與取捨？",
  },
  chat: {
    welcomeTitle: "讓理解，更進一步",
    welcomeBody: "問設計原因、測試方式，或在左側選取一段程式碼深入討論。",
    assistant: "學習助手",
    failed: "回答失敗",
    you: "你",
    stale: "針對較舊版本",
    loading: "正在閱讀變更…",
    inputLabel: "向 Agent 提問",
    placeholder: "想更深入了解哪個部分？",
    placeholderBlocked: "此檔案目前無法提供解說",
    contextAttached: "已附上檔案 diff",
    contextBlocked: "無法附上檔案上下文",
    send: "送出問題",
    disclaimerDemo: "示範回覆為預寫內容，未呼叫 AI 模型",
    disclaimerLive: "Enter 送出 · Shift + Enter 換行",
  },
  tryFirst: {
    badge: "先試著答",
    confidences: { sure: "確定", think: "大概", guess: "用猜的" },
    grades: { got: "答對", partly: "部分對", missed: "沒答到" },
    gradeHints: {
      got: "你說出了一樣的原因和結果。",
      partly: "你答對了一部分。",
      missed: "答案是別的。",
    },
    fill: "填入示範答案",
    saving: "儲存中…",
    fileChanged:
      "這次沒有存下：在你開啟後，這個檔案、你已存的作答或這次工作有了變動。這裡顯示的是最新版本。",
    quiz: {
      answerLabel: "你的答案",
      answerPlaceholder: "用自己的話寫一兩句",
      confidenceLabel: "你有多確定？",
      confidenceHint: "選一下你有多確定，這個答案才能算進理解檢查。",
      reveal: "看答案",
      dontKnow: "我不知道",
      yourAnswer: "你的答案",
      skipped: "你跳過了這一題，所以沒有要評分的答案。",
      dontKnowAnswer: "你選了「我不知道」。",
      reference: "參考答案",
      referenceLabel: "AI 撰寫；以 diff 為準",
      referenceLabelDemo: "AI 撰寫答案的示範；以 diff 為準",
      gradeLabel: "和參考答案比起來，你答得如何？",
      graded: {
        got: "你的評分：答對。",
        partly: "你的評分：部分對。",
        missed: "你的評分：沒答到。",
      },
      confidentMiss: "這是最有價值的一種答錯：它會回到你的練習卡組。",
    },
    road: {
      guessLabel: "先別看：這件事還能怎麼做？",
      guessPlaceholder: "選填，一行即可",
      reveal: "看另一種做法",
      yourGuess: "你的猜想",
      choiceLabel: "以這個專案來說，你會選哪一種？",
      choices: { keep: "維持這個做法", switch: "偏好另一種", depends: "看情況" },
      whyLabel: "為什麼？（選填，一行）",
      saveWhy: "儲存",
      saved: "已儲存",
    },
  },
  walkthrough: {
    lines: ({ start, end }) =>
      start === end ? `第 ${start} 行` : `第 ${start}–${end} 行`,
    none: "沒有找到。",
    unavailableTitle: "這個檔案沒有程式碼解說",
    demoOnly: "示範資料只為部分檔案準備了程式碼解說。",
    failedTitle: "程式碼解說尚未完成",
    failedBody: "產生程式碼解說時發生問題，變更內容仍可正常審閱。",
    retry: "重新產生程式碼解說",
    busy: "其他程式碼解說整理中…",
    generatingTitle: "正在閱讀這個檔案和它的呼叫端",
    generatingBody: "找出包住每段變更的函式，逐步拆解原本的運作方式。",
    pendingTitle: "程式碼解說會自動準備好",
    pendingBody: "會依序為每個修改過的程式檔產生，先從你正在看的檔案開始。",
    onlyNewTitle: "這個檔案的變更都是新增的程式碼",
    noneTitle: "沒有找到包住這些變更的函式",
    noneBody: "這些變更可能在頂層設定或宣告裡；可以展開周圍的程式碼，或在「追問 Agent」詢問。",
    readyDemo: "示範解說 · 預先整理的學習內容",
    readyLive: "已讀過目前的檔案與它的呼叫端",
    locate: "在程式碼中標示這個範圍",
    locateStep: "在程式碼中標示這幾行",
    change: "這次修改與它的關係",
    steps: "逐步拆解",
    callers: "誰呼叫它",
    callees: "它呼叫什麼",
    analogy: "換個方式想",
    selfCheck: ({ question }) => `考考自己：${question}`,
    newUnits: ({ names }) =>
      `這次新增的程式碼沒有原本的邏輯可以拆解：${names}，請看「變更解說」。`,
  },
  commits: {
    title: "Commit 歷程",
    sources: {
      initial: "初次送出",
      review: ({ round }) => `依 review 修正第 ${round} 輪`,
      sync: "同步目標分支",
      adopted: "接續 GitHub 上的提交",
      other: "其他提交",
    },
    files: ({ count }) => `${count} 個檔案`,
    mergeNote: "合併 commit：下面是相對於 PR 前一版的差異，包含目標分支帶進來的改動。",
    show: "查看改了什麼",
    hide: "收起",
    loadingDetail: "讀取這個 commit 的改動…",
    omitted: ({ count }) => `另外 ${count} 個檔案超過顯示上限，請到 GitHub 查看完整差異。`,
    unpublished:
      "這個貢獻還沒送出 PR。BELL 在送出前把修改保留為未提交的變更，送出時才建立第一個 commit；之後每一輪依 review 修正、同步目標分支，都會在這裡多一個 commit。",
    unpublishedDemo:
      "示範資料還沒有送出 PR，所以還沒有 commit。下面是示範 PR 在初次送出、一輪依 review 修正與同步目標分支之後的歷程。",
    publishedDemo: "示範 PR 的 commit：初次送出、一輪依 review 修正與同步目標分支。沒有送出任何內容到 GitHub。",
    loading: "讀取 commit 歷程…",
    intro: ({ count }) => `PR 分支上的 ${count} 個 commit，依時間順序；標籤說明它在 BELL 裡的來源。`,
  },
};

export default m;
