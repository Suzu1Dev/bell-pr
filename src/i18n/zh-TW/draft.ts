/** The PR draft tab's panels (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import type en from "../en/draft";

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
