import type { Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/by-hand-guide.js";

const guide: Translation<typeof en> = {
  aboutYourChange: "這是關於你的變更；下一步請用「提示」。",
  rungTooHigh: "請依序一階一階地要這個步驟的提示。",
  canBeWrong: "嚮導也可能出錯。請拿程式碼與你的測試核對它指出的地方。",
  notNow: "嚮導會在你寫變更的期間給提示、回答問題；工作在規劃或發布時不會。",
  planOnly: "嚮導會在你確認計畫之前問你計畫的事。",
  planFirst: "請先儲存至少一個你自己計畫裡的步驟；嚮導問的是你的計畫，不是它自己的。",
  planQuestionsUsed: "這個工作裡，嚮導已經問過你的計畫三次了。",
  pickStep: "請為這個提示選一個你計畫裡的步驟。",
  noFailure: "沒有失敗的測試可以解說。請先跑一次測試。",
  testsRunning: "你的測試正在跑。等它跑完再問嚮導。",
  noRungLeft: ({ kind }) =>
    `這個工作裡，嚮導對這個步驟已經沒有更多提示了：它所配合的專案文字沒有提到${kind}。請改走其他出口：問人、把這個步驟切小，或說說看。`,
  lastRungGiven: "「專案裡的例子」之後就沒有提示了。請改走其他出口：問人、把這個步驟切小，或說說看。",
  nothingLeft: `${product.name} 從這個回答裡移除了程式碼，之後什麼都不剩。請換個說法再問一次，或要下一階提示。`,
  removedFromAnswer: `${product.name} 在你看到這個回答之前，從裡面移除了程式碼。`,
  fromBase: ({ place }) => `出自專案原本的程式碼，${place}：`,
  fromChange: ({ place }) => `出自你的變更，${place}：`,
  review: {
    verified: "嚮導先確認的事",
    checked: "它看過的地方",
    findings: "發現",
    noFindings: "沒有發現。",
    evidence: {
      test: "測試結果",
      rule: "專案規範",
      pattern: "既有程式碼",
    },
    why: "為什麼重要",
    question: "問題",
    mayBeWrong: "這點我可能說錯了；由你的測試決定。",
    advice: "嚮導的審查只是建議，也可能出錯；測試才是裁判。它什麼都沒有修改。",
  },
};

export default guide;
