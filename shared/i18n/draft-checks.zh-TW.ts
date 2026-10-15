/** PR text check messages (Traditional Chinese, Taiwan); typed against the English copy. */
import { product } from "../product.js";
import { formatters, type Translation } from "./locale.js";
import type en from "./draft-checks.en.js";

const fmt = formatters("zh-TW");

const messages: Translation<typeof en> = {
  placeholder: ({ count }) =>
    `PR 說明還有 ${count} 處待填寫的內容。這段文字會原樣送到 GitHub；請改成目前的事實或刪除，待辦事項留在核對清單。若是在描述 TODO 註解或檔案本身，請用反引號包起來，例如 \`TODO\`。`,
  placeholderLine: ({ line, text }) => `第 ${line} 行：「${text}」`,
  unchecked:
    "這些段落的勾選項目全部沒有勾，會原樣送出。專案的範本或自動檢查可能要求勾選；只勾你真正完成或確認的項目。",
  uncheckedSection: ({ heading, count }) => `${heading}：${count} 項都未勾`,
  noHeading: "（無標題）",
  issue: "專案規範要求 PR 連結既有的 issue，這份說明沒有引用任何 issue。",
  ruleQuote: ({ label, quote }) => `${label}：「${quote}」`,
  brevityUnrevised:
    `這份說明仍是未改寫的 ${product.name} 建議原文，而專案要求用自己的話寫簡短的說明。`,
  brevityOver: ({ words, budget }) =>
    `這份說明約 ${words} 字，超過 ${product.name} 建議的 ${budget} 字；專案要求簡短的說明。`,
  respect: {
    why: {
      prClosed: "誰能開 Pull Request 由維護者決定；就算送出，GitHub 也會拒絕。",
      aiBan: "這些維護者已表明不審查 AI 協助完成的貢獻；硬是送出，等於違背他們的意願占用他們的時間。",
      aiDisclosure: "要求揭露的維護者，會依此決定審查這份變更要多仔細。",
      ownWords: "用自己的話寫的說明，能讓維護者看出你理解了什麼；建議文字做不到這點。",
      issueClosed: "針對已關閉 issue 的修改，通常是重複的修正，或違背維護者已做的決定。",
      issueHasPr: "同一個 issue 有兩個 Pull Request 會分散維護者的審查時間；審查或測試已開的那一個，往往更有幫助。",
      areaReserved: "維護者把這類 issue 留給想透過親手實作來學習貢獻的人。",
      testsWeakened: "維護者靠測試抓出回歸問題，所以被跳過、刪除或放寬的測試，需要一個他們能檢查的理由。",
      pacingMax: "每個開著的 Pull Request 都在等維護者的時間，先回應手上的，再開新的。",
      projectRules: `${product.name} 原文引用這些規範；這些規範如何適用於這份變更，只有你能判斷。`,
      issueState: "維護者在 issue 上協調工作；略過別人的認領或尚未定案的討論，會耗掉大家的時間。",
      reviewability: "小而聚焦、附有測試的變更，維護者能一次看懂，也比較快得到審查。",
      pacing: "回應你已收到的審查，比再開一個 Pull Request 更能幫上維護者。",
      factsUnknown: `${product.name} 從不把未知當成通過；發布前請自己到 GitHub 確認這些事實。`,
    },
    prClosed: `這個 repository 目前不接受你開的 Pull Request，所以 ${product.name} 不會發布這一份。你仍可以在本機繼續練習這份變更。`,
    aiBan: `專案規範不接受 AI 協助完成的貢獻，而這份變更是由 AI agent 撰寫的。${product.name} 不會發布它；你仍可以在本機繼續練習。`,
    aiDisclosure: "專案要求貢獻者揭露 AI 協助，但說明裡還沒有提到。請用自己的話寫，或打開 AI 協助說明那一行。",
    ownWordsRequired: `專案要求用貢獻者自己的話寫說明，而這份仍是 ${product.name} 的建議文字。發布前請改寫。`,
    ownWords: `這份說明仍是 ${product.name} 建議的文字。許多專案要求用貢獻者自己的話寫說明。`,
    issueClosed: "連結的 issue 已關閉。請連結一個開著的 issue；如果你的變更處理的是別的事，請移除這個連結。",
    issueHasPr: "別人開著的 Pull Request 已經會關閉這個 issue。可以改去審查或測試對方的 Pull Request，或寫下你仍要發布的理由。",
    areaReserved: `專案把這類 issue 留給不靠 AI、想學著貢獻的人。${product.name} 不會發布這份變更；你可以在本機練習，或親手寫一份。`,
    testsWeakened: ({ count }) =>
      `這份變更在 ${count} 處削弱了測試。發布前請為每一處寫一行理由。`,
    pacingMax: ({ open, budget }) =>
      `你在這個 repository 已經有 ${open} 個開著的 Pull Request，至少是 ${product.name} 為你在這裡設定的上限 ${budget} 的兩倍。請先完成或關閉一個，再開新的。`,
    projectRules: "專案規範中有發布前應該讀的內容。",
    issueState: "連結的 issue 可能還不適合由你送出 Pull Request。",
    reviewability: "這份變更可能不容易審查。",
    pacing: "開新的 Pull Request 之前，請先回應你在這裡開著的那些。",
    factsUnknown: `${product.name} 無法在 GitHub 上確認部分事實。`,
    quote: ({ path, line, quote }) => `${path}:${line}：「${quote}」`,
    githubField: ({ field, value }) => `GitHub ${field}：${value}`,
    otherPr: ({ number, author }) =>
      `GitHub closedByPullRequestsReferences：@${author} 的 #${number}`,
    learningLabels: ({ labels }) => `GitHub 標籤：${fmt.list(labels)}`,
    weakenedFile: ({ path }) => `${path}：刪除了測試檔`,
    weakenedLine: ({ path, line, text, removed }) =>
      `${path}:${line} ${removed ? "刪除" : "新增"}：${text}`,
    pacingCounts: ({ open, merged, budget }) =>
      `GitHub 搜尋：你在這裡有 ${open} 個開著、${merged} 個已合併的 Pull Request。上限：同時開著 ${budget} 個（${product.name} 預設：在一個 repository 第一次被合併前為 1，之後為 2；所有方案都一樣）。`,
    atBudget: ({ open, budget }) =>
      open > budget
        ? `你在這裡有 ${open} 個開著的 Pull Request，超過上限 ${budget}。`
        : `你在這裡有 ${open} 個開著的 Pull Request，已達上限 ${budget}。`,
    waiting: ({ count }) =>
      `維護者在 7 天多前要求修改你在這裡的 ${count} 個 Pull Request，請先回應那些審查。`,
    ambiguousBan: ({ path, line, quote }) =>
      `${path}:${line}：「${quote}」（可能涵蓋 AI 協助的貢獻，請自行判斷是否適用）`,
    understandOff: ({ path, line, quote }) =>
      `${path}:${line}：「${quote}」（你的理解檢查已關閉）`,
    agent: ({ path, line, quote }) =>
      `${path}:${line}：「${quote}」（寫給 AI agent 的話；作者是你，請自行判斷是否適用）`,
    issueFirst: ({ path, line, quote }) =>
      `${path}:${line}：「${quote}」（這份工作沒有連結 issue）`,
    assigned: ({ names }) =>
      `已指派給 ${fmt.list(names.map((name) => `@${name}`))}。`,
    claimed: ({ author, date, bot }) =>
      bot
        ? `@${author}（機器人）在 ${date} 認領了這個 issue。`
        : `@${author} 在 ${date} 認領了這個 issue。`,
    notReady: ({ labels }) =>
      `標籤為 ${fmt.list(labels)}：維護者可能還沒準備好接受修正。`,
    locked: "這個 issue 已鎖定。",
    closedPr: ({ number, author }) =>
      `這個 issue 的 Pull Request（@${author} 的 #${number}）未合併就被關閉了。發布前請先讀讀原因。`,
    sayHello: "專案要求先有 issue，而你還沒在這個 issue 留言。發布前請先在 issue 上打個招呼。",
    split: ({ lines, files }) =>
      `${files} 個檔案共 ${lines} 行變更，超過 ${product.name} 預設的 1,000 行或 20 個檔案。能不能拆成幾份獨立的變更？`,
    noTests: "程式碼有變更，但測試沒有。",
    outsidePlan: ({ files }) => `不在計畫任何任務範圍內的檔案：${fmt.list(files)}。`,
    whitespace: ({ files }) => `只改了空白的變更：${fmt.list(files)}。`,
    dependencies: ({ names }) => `新增的相依套件：${fmt.list(names)}。`,
    mergedSizes: ({ sizes }) =>
      `對照：專案最近合併的 Pull Request 分別變更了 ${fmt.list(sizes.map((size) => fmt.number(size)))} 行。`,
    unknownPart: ({ part, reason }) => {
      const what = {
        door: "是否接受你開的 Pull Request",
        issue: "連結的 issue",
        pacing: "你在這裡開著的 Pull Request",
        rules: "專案的規則",
        orgDefaults: "帳號預設的貢獻檔案",
        other: "一項 GitHub 資料",
      }[part];
      return reason ? `無法確認${what}：${reason}` : `無法確認${what}。`;
    },
    rulesUnread: `無法確認專案的規則：${product.name} 還沒讀過它們。`,
    reasons: {
      "gh-missing": "沒有安裝 GitHub CLI（gh）。",
      "signed-out": "GitHub CLI 還沒登入。請執行 gh auth login，再檢查一次。",
      timeout: "GitHub 沒有及時回應。",
      "rate-limited": "已達 GitHub 的速率上限。請等幾分鐘，再檢查一次。",
      "not-found": "GitHub 找不到它，或你的帳號看不到它。",
      forbidden: "GitHub 拒絕了你的帳號的這個請求。",
      "github-error": "GitHub 回應了錯誤。",
      "invalid-answer": "無法讀取 GitHub 的回應。",
      "no-github-origin": "這個專案沒有 GitHub 來源，所以沒有可以在 GitHub 上檢查的事。",
      "not-an-issue": "這個連結不是 GitHub issue。",
      "files-unreadable": "無法在專案目前的 commit 讀取它的檔案。",
      "folder-import": "從資料夾匯入專案時不會讀取這項資料。按「再確認一次」即可從 GitHub 讀取。",
    },
  },
};

export default messages;
