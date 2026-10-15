/** The PR draft tab's panels (Traditional Chinese, Taiwan). */
import { formatters, type Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/draft";

const fmt = formatters("zh-TW");

const m: Translation<typeof en> = {
  guidance: {
    eyebrow: "CONTRIBUTION GUIDE",
    title: "寫出維護者容易理解的 PR",
    intro: "先看投稿規範與範本，再把這次貢獻整理成清楚的草稿。",
    status: {
      generating:
        "正在閱讀貢獻規範與 PR 範本，並對照本次變更整理建議。你可以繼續編輯下方草稿。",
      failed: "這次未能整理草稿，請稍後重試。下方編輯內容已保留。",
      stale:
        "變更內容已更新，這份建議需要重新整理。請產生新版建議後再套用。",
    },
    generate: {
      generating: "正在整理…",
      retry: "重新嘗試",
      refresh: "重新整理建議",
      demo: "查看草稿建議示範",
      first: "依專案規範產生建議草稿",
    },
    demoBadge: "示範資料",
    policy: {
      repository: "依專案規範",
      linux: "Linux 原則 · PR 調整版",
    },
    empty: {
      rules: "核對規範與範本",
      sources: "每個建議附上依據",
      choice: "由你選擇套用",
      demo: "使用示範文件體驗完整流程，不會讀取或修改遠端專案。",
      real: "適用於已完成變更的任務；舊任務也可以在這裡補上草稿建議。",
    },
    warnings: "閱讀範圍與待確認事項",
    rules: {
      title: "這份草稿的撰寫依據",
      defaultTitle: "預設寫作原則",
      noSource: "未附可核對的來源",
      quote: "查看原文依據",
      linuxPrinciples: [
        "具體簡潔的標題，直接說明變更。",
        "交代問題與對使用者的影響。",
        "說明修改理由、設計取捨與限制。",
        "如實記錄驗證結果與未完成事項。",
      ],
      template: ({ template }) =>
        `依照「${template}」整理段落。此範本未附額外寫作規範，請核對每個段落是否符合本次變更。`,
      noRules: "未附額外寫作規範，請對照來源文件確認草稿段落。",
    },
    checks: {
      title: "送出前由你確認",
      intro: "以下是核對提醒，尚未代表完成檢查。",
    },
    preview: "預覽建議草稿",
    apply: {
      appliedNote:
        "下方編輯區就是這份建議的原文。說明會原樣送到 GitHub，請用自己的話確認後再送出。",
      note: "套用後仍可編輯，儲存後才更新草稿。",
      applied: "已套用",
      apply: "套用建議草稿",
    },
    commit: {
      title: "提交訊息建議",
      sources: "依據：",
      code: {
        typeScope: "type(scope)",
        subject: "type(scope): 說明",
        signOff: "Signed-off-by: 姓名 <email>",
      },
      why: ({ typeScope, subject, signOff }) =>
        `為什麼專案會要求 ${typeScope} 或 sign-off？採用 Conventional Commits 的專案靠主旨的 ${subject} 自動產生變更日誌並決定版本號，commitlint 會在 CI 擋下不符格式的提交；採用 DCO 的專案要求每個 commit 附上 ${signOff}，表示你有權以該授權貢獻這段程式碼，DCO bot 檢查的是 commit trailer，不是 PR 說明。這份建議只整理規範要求的格式；簽署是你本人的聲明，請在「提交訊息」欄位自行輸入，模型不會代填。`,
    },
    meta: {
      base: ({ commit }) => `基準版本 ${commit}`,
      checked: ({ time }) => `查閱 ${time}`,
    },
    sources: {
      title: "查閱來源文件",
      count: ({ count }) => `${count} 份`,
      kinds: {
        contributing: "貢獻規範",
        template: "PR 範本",
        documentation: "專案文件",
        maintainer: "維護者指引",
        example: "參考案例",
        automation: "自動檢查",
      },
      usedTemplate: "本次採用範本",
      open: "開啟來源文件",
      textLabel: ({ label }) => `${label}原文`,
    },
    etiquette: {
      title: "送出前，先和社群打個招呼",
      intro:
        "開源社群重視這兩件事，是因為 maintainer 的時間有限：事先留言能避免兩個人改同一個問題，也讓對方在你投入前就能說「這個方向可以」或「我們不收這類變更」。這裡的勾選只是給自己的提醒，不會儲存，也不會阻擋送出。",
      reminders: {
        claimed: {
          text: "是否已在 issue 留言表明要處理？",
          why: "避免和別人做重複的工作，也讓 maintainer 知道有人接手。",
        },
        discussed: {
          text: "專案是否要求先開 issue 討論？",
          why: "有些專案希望先確認方向與 AI 協作是否可接受，再收 PR；先問一句，可以省下雙方審閱一份不會被接受的 PR 的時間。",
        },
      },
      rule: "這個專案的規範：",
      quote: ({ quote }) => `「${quote}」`,
      ruleSource: ({ source }) =>
        `來源：${source}。沒有連結 issue 時，送出前會請你再確認一次。`,
      openIssue: "開啟你填寫的 issue",
    },
    linux: {
      note: ({ guide }) =>
        `以 ${guide} 中的動機、變更與驗證原則作為備用依據，調整成 GitHub PR 格式。Signed-off-by 等簽署資訊需由本人確認，不會自動填入。`,
      guide: "Linux 官方提交指引",
    },
    readOnly: "這個 PR 已發布，以下指引保留供參考。",
    disclosure: {
      title: "AI 協助揭露",
      label: "在 PR 說明加入 AI 協助聲明",
      on: "開",
      off: "關",
      lineOn: ({ line }) =>
        `PR 說明最後會加上這一行：「${line}」你可以在說明中像其他文字一樣改寫它。`,
      lineOff: "PR 說明不會提到 AI。要不要揭露 AI 協助，由你決定。",
      setting: "因為你開啟了「我的 PR 一律加入 AI 協助聲明」設定，預設為開。",
      rule: "這個專案要求揭露：",
      quote: ({ quote }) => `「${quote}」`,
      ruleSource: ({ source }) => `來源：${source}`,
      applyHint: "下方預覽會依這個選擇顯示，套用建議時也會一併放入編輯器；記得儲存草稿。",
    },
    preflight: {
      title: "發布前檢查",
      intro: "發布時會對已儲存的草稿執行相同檢查。阻擋項目修正前無法發布；其他項目需要你確認。",
      block: "阻擋發布",
      confirm: "發布前需確認",
      clear: "已儲存的草稿沒有需要處理的檢查項目。",
    },
  },
  yourWords: {
    title: "PR 裡用你自己的話",
    lead: "這是你在理解檢查中寫的說明。按下按鈕之前，不會放進 PR 說明；放進去之後，你可以繼續修改。",
    summary: "你的說明",
    untested: "你沒有測試的部分與原因",
    useExplanation: "使用我的說明",
    addUntested: "把我沒測試的部分加到 Testing",
    inserted: "已在說明中",
    english: "PR 說明使用英文；請參考你的說明，用英文寫。",
    copy: "複製",
    copied: "已複製",
    copyFailed: "無法複製，請自行選取文字複製。",
  },
  reviewability: {
    title: "這份變更好審查嗎？",
    bands: {
      small: "小",
      medium: "中",
      large: "大",
      "very-large": "非常大",
    },
    band: ({ band }) => `${band} · ${product.name} 預設`,
    bandHelp: `${product.name} 的規模分級是參考 Google 小型變更指引的預設值，不是這個專案的規範：小為 100 行以內，中為 400 行以內，大為 1,000 行以內，超過 1,000 行或 20 個檔案為非常大。專案自己最近合併的 Pull Request 才是真正的參考。`,
    lines: "變更行數",
    files: "檔案",
    tests: "有變更的測試檔",
    dependencies: "新增的相依套件",
    outsidePlan: "不在計畫範圍內",
    whitespace: "只改空白",
    linesNote: "不計入 lockfile 與自動產生的檔案。",
    merged: "專案最近合併的 Pull Request",
    mergedSize: ({ number, additions, deletions, files }) =>
      `#${number}：${fmt.number(files)} 個檔案 +${fmt.number(additions)} −${fmt.number(deletions)}`,
    mergedNone: "沒有讀到專案最近合併的 Pull Request 規模。",
    split: "這是一個合乎邏輯的單一變更嗎？",
    splitLead: "維護者能一次看完的變更，會比較快得到審查。如果這份變更做了好幾件事，可以問 agent 怎麼拆開。",
    askSplit: "問問怎麼拆開",
    weakened: "被削弱的測試",
    weakenedLead: "每一個被跳過、刪除或放寬的測試，發布前都需要一行理由：為什麼這樣改是對的？",
    weakenedCount: ({ count }) => `有 ${fmt.number(count)} 處被削弱的測試需要理由。`,
    deleted: ({ path }) => `${path}：刪除了測試檔`,
    added: ({ path, line }) => `${path}:${line}，新增`,
    removed: ({ path, line }) => `${path}:${line}，刪除`,
    reason: "你的理由",
    reasonHint: "至少 3 個字。",
    save: "儲存理由",
    saving: "正在儲存…",
    saved: "可以放進你的 Testing 段落",
    copy: "複製到 Testing 段落",
    saveFailed: ({ reason }) => `理由沒有儲存：${reason}`,
  },
  forecast: {
    title: "你的預測與維護者的回饋",
    yours: "你的預測",
    none: "沒有預測",
    theirs: "維護者說了什麼",
    noFeedback: "維護者還沒有回應。",
    readFirst: "讀取回饋後，就能和你的預測對照。",
    dimensions: {
      scope: "範圍",
      simplicity: "簡潔",
      naming: "命名",
      conventions: "專案慣例",
      tests: "測試",
      risk: "風險",
      description: "說明",
      worth: "值得花審查時間",
    },
    dimension: ({ author }) => `@${author} 提出的重點`,
    predicted: ({ author }) => `你有預料到 @${author} 的意見嗎？`,
    sawIt: "有預料到",
    surprised: "出乎意料",
    lesson: "給下次的提醒",
    lessonHint: ({ max }) => `${fmt.number(max)} 個字元以內。`,
    saveLesson: "儲存提醒",
    line: ({ path, line }) => (line === undefined ? path : `${path}:${line}`),
    open: "在 GitHub 開啟",
    outcome: "結果",
    outcomes: {
      merged: "已合併",
      changes: "要求修改",
      closed: "未合併就關閉",
      approved: "已核准，尚未合併",
      commented: "維護者留了言，還沒有決定",
    },
    waiting: ({ days }) =>
      days === undefined ? "還沒有回應" : `還沒有回應（${fmt.number(days)} 天）`,
    locked: "把你的預測和維護者的回饋對照，是 Pro 的功能。",
    seePro: "看看 Pro 多了什麼",
  },
  sync: {
    title: "目標分支",
    intro: {
      published: ({ branch, commit }) =>
        `這個貢獻以 ${branch} 的 ${commit} 為基準。同步會把最新版本合併進 PR：審閱後推送一個合併 commit，不會 force push，PR 說明也不變。`,
      unpublished: ({ branch, commit }) =>
        `這個貢獻以 ${branch} 的 ${commit} 為基準。同步會把這次的修改移到最新版本上；目標分支改過的檔案需要重新審閱，可以復原。`,
    },
    lastSync: ({ from, to, date }) => `上次同步：${from} 到 ${to}，${date}`,
    waitConflicts: "上一次同步的衝突解決前不能再同步。",
    waitStatus:
      "只有審閱中、已核准或等待計畫核准的工作可以同步到最新目標分支。",
    roundOpen: "這個 PR 有一輪修正在進行；完成或放棄後才能同步。",
    sync: "同步到最新目標分支",
    undo: "復原同步",
    conflicts: "合併衝突",
    resolved: "已解決",
    unresolved: "仍有衝突標記",
    openCount: ({ open, total }) =>
      open === total
        ? total === 1
          ? "這個檔案仍有衝突標記。"
          : `${total} 個檔案都仍有衝突標記。`
        : `${total} 個檔案中有 ${open} 個仍有衝突標記。`,
    conflictHelp: {
      published: ({ latest, ours }) =>
        `檔案裡標示 ${latest} 的一邊是目標分支現在的內容，標示 ${ours} 的一邊是這個 PR。衝突標記全部移除前不能核准；可以在工作目錄自己改，改完到「程式碼變更」重新整理差異，或請 Agent 解決。改過的檔案仍要逐檔審閱。`,
      unpublished: ({ latest, ours }) =>
        `檔案裡標示 ${latest} 的一邊是目標分支現在的內容，標示 ${ours} 的一邊是這次的貢獻。衝突標記全部移除前不能核准；可以在工作目錄自己改，改完到「程式碼變更」重新整理差異，或請 Agent 解決。改過的檔案仍要逐檔審閱。`,
    },
    allResolved: "衝突標記都已移除；改過的檔案仍要逐檔審閱。",
    resolving: "Agent 正在解衝突…",
    resolve: "請 Agent 解決衝突",
  },
  followUps: {
    title: "依 review 修正的紀錄",
    intro:
      "每一輪經你審閱、核准後，會成為 PR 分支上的一個新 commit；PR 標題與說明維持原樣，回覆 reviewer 仍由你在 GitHub 上處理。",
    status: {
      running: "修正中",
      review: "等待審閱與推送",
      published: "已推送",
      failed: "沒有完成",
      cancelled: "已停止",
      discarded: "已放棄",
    },
    round: ({ number }) => `第 ${number} 輪`,
    adopted: "接續 GitHub 上的提交",
    syncRound: "同步目標分支",
    yourNote: "你的補充說明",
    feedback: "回饋",
    note: ({ note }) => `補充說明：${note}`,
    conflicts: "合併衝突",
    addressed: "已處理",
    notAddressed: "沒有修改，需要你判斷",
    checks: "實際執行的指令",
    pushed: ({ commit, date }) => `${commit} 已推送 ${date}`,
    notPushed: ({ commit }) => `${commit} 已建立，尚未確認推送`,
    discard: "放棄這輪修改",
  },
};

export default m;
