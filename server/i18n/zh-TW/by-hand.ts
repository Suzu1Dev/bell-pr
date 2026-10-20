import type { Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/by-hand.js";
import flow from "./by-hand-flow.js";
import guide from "./by-hand-guide.js";
import tests from "./by-hand-tests.js";

const byHand: Translation<typeof en> = {
  flow,
  guide,
  tests,
  noWriteTurn: `在親手學的工作裡，${product.name} 的 agent 沒有寫入權限，所以 ${product.name} 沒有開始這一輪。`,
  agentWrite: `${product.name} 在親手學的工作裡攔下了一個想修改檔案的 agent。`,
  notYet: "這個版本還沒有親手學的這個部分。",
  notByHand: "這只適用於親手學的工作。",
  retryRefused: "親手學的工作是從你自己的修改接著做，沒有 agent 的工作可以重試。要從頭開始，請建立新的工作。",
  backToPlan: "回到你的計畫：在你確認之前，什麼都不會執行。",
  followUpRefused: `在親手學裡，後續的 commit 請在這個工作的資料夾用你自己的 Git 推送；${product.name} 會在下次讀取回饋時接手。`,
  resolveByHand: `在親手學裡，請在這個工作的資料夾親手解決衝突標記；${product.name} 每次讀取變更時都會找出還沒解決的。`,
  notReady: "請先把你的變更標成可以審查了。",
  busy: "嚮導正在處理這個工作。請等它完成，或先停止它。",
  attemptFirst: "先試試看：改一下程式、跑一次測試，或說說你試了什麼。",
  whyFirst: "標成完成之前，請用一句話說明你在這個步驟的修改為什麼可行。",
  testFirst: "請先在這個版本上跑一次測試；測試才是裁判。",
  fitUnavailable: ({ reason }) =>
    `${product.name} 已經無法讓這個工作配合專案的規範：${reason}。請重新檢查規範，或改用所有種類的協助開始。`,
  fitNothing: "專案的規範裡沒有可以讓嚮導配合的 AI 規則",
  helpOutsideFit: ({ kind }) => `這個工作不提供：它所配合的專案文字沒有提到${kind}。`,
  helpKinds: {
    explain: "解說",
    answer: "回答問題",
    plan: "規劃上的協助",
    review: "審查",
    test: "解說測試失敗",
  },
};

export default byHand;
