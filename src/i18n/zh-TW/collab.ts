/** Group work (#/group): who holds which paths of a repository (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/collab";

const m: Translation<typeof en> = {
  eyebrow: "小組協作",
  title: "誰佔用了哪些路徑？",
  live: "即時",
  polling: "每 10 秒更新",
  reconnecting: "重新連線中",
  asOf: ({ time }) => `截至 ${time}`,
  answerAsOf: ({ time }) => `截至 ${time} · 這個結果會自動更新`,
  repository: "專案",
  addARepository: "新增專案",
  addRepository: "新增專案",
  adding: "新增中…大型專案可能需要幾分鐘。",
  people: "組員",
  viewing: ({ name }) => `${name} · 正在看`,
  you: ({ name }) => `${name}（你）`,
  invite: "邀請",
  startWork: "開始工作",
  holdTitle: "標題",
  shownOnBoard: "會顯示在看板上",
  paths: "路徑",
  onePerLine: "每行一個",
  takeHold: "佔用",
  pathsHelp: "佔用一個資料夾，就包含裡面的所有內容。不分大小寫。",
  free: `在 ${product.name} 檢查的範圍內，目前沒有人佔用這些路徑`,
  holds: ({ name, paths, title, time }) =>
    `${name} ${time ? `自 ${time} 起` : ""}佔用 ${paths}：${title}`,
  youHold: ({ name, paths, title, time }) =>
    `${name}${time ? `自 ${time} 起` : ""}佔用 ${paths}：${title}`,
  notTaken: ({ then }) => `沒有佔用成功。${then}`,
  cannotHold: ({ paths }) => `無法佔用：${paths}`,
  heldNow: "目前佔用中",
  me: "你",
  since: ({ time }) => `自 ${time} 起`,
  gone: "已不再佔用",
  dependsOn: {
    label: "前置任務",
    help: "勾選此專案中需要先完成的任務（最多 50 項），等它們完成後再開始。",
    empty: "此專案目前沒有其他任務，可以直接開始。",
    selectedCount: ({ count }) => `已選 ${count} 項`,
    clear: "清除",
    cardNote: ({ titles }) => `在 ${titles} 完成後開始`,
  },
  release: {
    finish: "完成並釋出",
    finishAria: ({ title }) => `將「${title}」標示為完成並釋出佔用路徑`,
    unfinished: "僅釋出路徑",
    unfinishedAria: ({ title }) => `釋出「${title}」的佔用路徑，但不標示為完成`,
    finishHint: "選擇「完成並釋出」才會解鎖後續任務；「僅釋出路徑」仍會讓後續任務繼續等候。",
  },
  revoke: "撤銷",
  revokeHold: ({ title }) => `撤銷「${title}」`,
  revokeQuestion: ({ name, title }) =>
    `要撤銷 ${name} 的佔用「${title}」嗎？撤銷後，任何人都可以佔用這些路徑。`,
  keep: "保留",
  nothingHeld: ({ time }) => `截至 ${time}，沒有任何路徑被佔用。`,
  honesty:
    `${product.name} 會拒絕重疊佔用、不發布改到他人佔用路徑的變更，Agent 一改到就停止任務（變更留在工作目錄）。它攔不住編輯器、終端機工具或直接 git push。`,
  join: {
    title: "加入這個小組",
    body: "請向這個小組的管理員索取邀請碼。邀請碼只能用一次，10 分鐘內有效。",
    code: "邀請碼",
    submit: "加入",
  },
  host: {
    title: "在這裡開始小組協作",
    body: `這是執行 ${product.name} 的電腦。你會以管理員身分加入，之後可以邀請其他人。`,
    name: "你的名稱",
    submit: "開始小組協作",
  },
  setUpAtHost: `小組協作要在執行 ${product.name} 的那台電腦上設定。`,
  firstRepository:
    "佔用的對象是某個專案裡的路徑。請為這個小組選擇第一個專案。",
  nothingToAdd: "還沒有可以新增的專案。請先在「專案」頁面匯入。",
  noRepository: "這個小組還沒有專案，要由管理員新增。",
  stopped: {
    title: "小組協作已停止。",
    body: `請在主機上重新啟動 ${product.name}。不會把任何路徑當作沒有人佔用。`,
  },
  off: {
    title: `這個 ${product.name} 沒有開啟小組協作。`,
    body: `要開啟，請在執行 ${product.name} 的電腦上用這一行啟動。`,
  },
  inviteDialog: {
    title: "邀請組員",
    name: "名稱",
    admin: "管理員",
    adminHelp: "可以邀請組員、新增專案、撤銷別人的佔用。",
    create: "產生邀請碼",
    codeFor: ({ name }) => `給 ${name} 的邀請碼`,
    member: ({ name, time }) =>
      `請 ${name} 在這個 ${product.name} 的「小組」頁面輸入，就會以組員身分加入。邀請碼只能用一次，${time} 後失效。`,
    asAdmin: ({ name, time }) =>
      `請 ${name} 在這個 ${product.name} 的「小組」頁面輸入，就會以管理員身分加入。邀請碼只能用一次，${time} 後失效。`,
    done: "完成",
    copy: "複製邀請碼",
  },
  spoken: {
    took: ({ name, paths, title }) => `${name} 佔用了 ${paths}：${title}。`,
    youTook: ({ paths, title }) => `你佔用了 ${paths}：${title}。`,
    ended: ({ paths, title }) => `已不再佔用：${paths}（${title}）。`,
    changed: ({ count }) => `看板有變動。目前佔用中：${count}。`,
    finishedAndReleased: ({ title, paths }) =>
      `已完成「${title}」並釋出 ${paths}，等候中的任務現在可以開始。`,
    releasedUnfinished: ({ title, paths }) =>
      `已釋出 ${paths}，「${title}」尚未標示完成，等候中的任務會繼續等待。`,
    sentence: ({ text }) => `${text}。`,
  },
};

export default m;
