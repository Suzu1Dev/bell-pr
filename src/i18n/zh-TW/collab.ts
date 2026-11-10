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
  repository: "Repository",
  addARepository: "新增 Repository",
  addRepository: "新增 Repository",
  adding: "新增中…大型 Repository 可能需要幾分鐘。",
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
  free: "在 BELL 檢查的範圍內，目前沒有人佔用這些路徑",
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
  release: "釋出",
  revoke: "撤銷",
  releaseHold: ({ title }) => `釋出「${title}」`,
  revokeHold: ({ title }) => `撤銷「${title}」`,
  revokeQuestion: ({ name, title }) =>
    `要撤銷 ${name} 的佔用「${title}」嗎？撤銷後，任何人都可以佔用這些路徑。`,
  keep: "保留",
  nothingHeld: ({ time }) => `截至 ${time}，沒有任何路徑被佔用。`,
  honesty:
    "BELL 會拒絕彼此重疊的佔用。它不會阻止工具、編輯器或 push 寫入佔用範圍以外的地方。",
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
    "佔用的對象是某個 Repository 裡的路徑。請為這個小組選擇第一個 Repository。",
  nothingToAdd: "還沒有可以新增的 Repository。請先在「Repositories」頁面匯入。",
  noRepository: "這個小組還沒有 Repository，要由管理員新增。",
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
    adminHelp: "可以邀請組員、新增 Repository、撤銷別人的佔用。",
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
    sentence: ({ text }) => `${text}。`,
  },
};

export default m;
