import type { Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/collab.js";

const name = product.name;
const bin = product.binNames[0];

/** 小組協作：共用同一個執行中 BELL PR 的人（collab-host.ts、routes/collab.ts）。 */
const m: Translation<typeof en> = {
  notSetUp: `這個 ${name} 尚未設定小組協作。`,
  stopped: `小組協作已停止。請先在主機上排除原因（\`${bin} group status\` 或主機的記錄會顯示原因），再重新啟動 ${name}。`,
  hostOnly: `只有執行 ${name} 的那台電腦可以設定小組協作。`,
  notJoined: "你在這台裝置上尚未加入這個小組，或已被移出。",
  adminOnly: "只有小組管理員可以執行這個動作。",
  invalidCode: "這組邀請碼不正確、已過期或已使用過。",
  joinLocked: ({ minutes }) => `邀請碼輸入錯誤次數過多，請在 ${minutes} 分鐘後再試。`,
  tooManyInvites: ({ max, minutes }) =>
    `目前已有 ${max} 組邀請碼尚未使用。請等其中一組被使用或過期（${minutes} 分鐘）。`,
  removeSelf: "你不能把自己移出小組。",
  unknownPerson: "這個小組裡沒有這個 id 的人。",
  unknownRepository: `這個 ${name} 沒有這個 id 的 repository。`,
  alreadyAdded: "這個 repository 已經是小組的 repository。",
  cloneFailed: `${name} 無法為小組複製這個 repository，詳細原因在主機的記錄裡。`,
  unknownProject: "小組沒有這個 id 的 repository。",
  tooManyWaiters: "目前開著小組看板的頁面太多。請關掉其中一個再試。",
  slowDown: ({ seconds }) => `短時間內的請求太多，請在 ${seconds} 秒後再試。`,
  invalidScope: ({ max }) =>
    `請至少指定一個 repository 裡的檔案或資料夾，每個路徑最多 ${max} 個字元。有些路徑無法佔用，例如 repository 以外的路徑或含有特殊字元的路徑。`,
  tooManyScopes: ({ max }) => `一次佔用最多 ${max} 個路徑。`,
  conflict: "已經有人佔用了和你重疊的路徑，所以這次沒有佔用任何路徑。",
  dependencyUnknown: "這個任務相依的任務不在這個 repository 裡，所以這次沒有佔用任何路徑。",
  dependencyPending: "這個任務相依的任務還沒完成，所以這次沒有佔用任何路徑。",
  tooManyDependencies: ({ max }) => `一項工作最多相依 ${max} 個任務。`,
  full: "小組的紀錄已滿。請主機的使用者重設小組的儲存空間。",
  unknownClaim: "這個 repository 沒有這個 id 的佔用。",
  ended: "這項佔用已經結束。",
  doneNotSaved:
    "這項佔用已經結束，但它的任務無法標記為完成，之後也不能再標記。相依它的工作需要改為相依其他任務。詳細原因在主機的記錄裡。",
  notHolder: "只有佔用這些路徑的人可以釋出它們。",
  staleFence: "這項佔用在看板讀取之後有了變更。請重新載入看板再試。",
  invalidCredentials: "帳號或密碼不正確，或這個帳號已被停用。",
  usernameTaken: "這個小組裡已經有人使用這個帳號名稱。",
  invalidAccountInput:
    "請輸入 2 至 32 個英數字、點號、底線或連字號組成的帳號名稱，以及 8 至 128 個字元的密碼。",
  tailscaleUnavailable:
    "這個連線未提供已驗證的 Tailscale 身分。請透過啟用 --tailscale-auth 的 Tailscale Serve 連線，或改用帳號密碼登入。",
  tailscaleUnlinked: ({ login }) =>
    `尚未有小組帳號綁定 Tailscale 使用者 ${login}。請輸入一次邀請碼完成綁定，或請小組管理員設定綁定。`,
  lastAdmin: "小組至少需要保留一位啟用中的管理員。",
  dependencyBlocked: "已經有人佔用了與你路徑標記為阻擋相依的檔案，所以這次沒有佔用任何路徑。",
  unknownDependency: "這個 repository 沒有這個 id 的檔案相依規則。",
  atHostName: "主機管理員",
  soloAuthorName: "開發者",
  refused: "小組協作拒絕了這個請求。",
  failed: "小組協作無法完成這個動作，詳細原因在主機的記錄裡。",
};
export default m;
