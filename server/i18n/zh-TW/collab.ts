import type { Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/collab.js";

const name = product.name;

/** 小組協作：共用同一個執行中 BELL PR 的人（collab-host.ts、routes/collab.ts）。 */
const m: Translation<typeof en> = {
  notSetUp: `這個 ${name} 尚未設定小組協作。`,
  stopped: `小組協作已停止。請在主機上重新啟動 ${name}。不會把任何路徑當作沒有人佔用。`,
  hostOnly: `只有執行 ${name} 的那台電腦可以設定小組協作。`,
  notJoined: "你在這台裝置上尚未加入這個小組，或已被移出。",
  adminOnly: "只有小組管理員可以執行這個動作。",
  invalidCode: "這組邀請碼不正確、已過期或已使用過。",
  joinLocked: ({ minutes }) => `邀請碼輸入錯誤次數過多，請在 ${minutes} 分鐘後再試。`,
  tooManyInvites: "目前已有 20 組邀請碼尚未使用。請等其中一組被使用或過期（10 分鐘）。",
  removeSelf: "你不能把自己移出小組。",
  unknownPerson: "這個小組裡沒有這個 id 的人。",
};
export default m;
