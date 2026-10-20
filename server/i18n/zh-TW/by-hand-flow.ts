import { formatters, type Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/by-hand-flow.js";

const list = (items: readonly string[]) => formatters("zh-TW").list(items, { type: "unit" });

const flow: Translation<typeof en> = {
  yourTurn: "換你寫：動手改程式吧。",
  stepFirst: "請先寫下至少一個你自己計畫的步驟。",
  reviseRefused: "在親手學裡，計畫是你的：改寫你的步驟，或請嚮導「看看我的計畫」。",
  draftRefused: `在親手學裡，Pull Request 的文字由你來寫；${product.name} 不會替你起草。`,
  changed: "你打開這裡之後，變更又更新了。請再看一次，然後標成可以審查了。",
  guideRead: "嚮導讀過這個專案了。請先寫下你自己計畫的步驟。",
  planClosed: "在你確認計畫之前，以及動手寫、還沒把變更標成可以審查了的時候，都可以修改計畫。",
  noOutline: "嚮導的大綱還沒準備好。",
  noStep: "你的計畫裡已經沒有這個步驟了。",
  notWriting: "這要在你確認計畫之後、動手寫變更的時候才能用。",
  noOption: "請從嚮導在這個步驟給的做法裡選一個。",
  nothingReady: "請先動手修改：目前還沒有可以標成可以審查了的變更。",
  oneFile: "請一次只問一個檔案。",
  answerFirst: "請先在「用自己的話講一遍」回答這個檔案的問題，之後才能看讀者會怎麼看你的變更。",
  testsRunning: "請等測試跑完，或先停止它們，再核准。",
  readyMarked: "你把變更標成可以審查了。",
  readyReview: "你把變更標成可以審查了，並請嚮導審查。",
  left: "你把這個任務交給 agent 團隊了。這個工作會維持原樣。",
  review: {
    done: "嚮導審查完你的變更了。",
    stopped: "嚮導的審查已停止。",
    failed: ({ reason }) => `嚮導的審查沒有完成：${reason}`,
  },
  takeover: {
    pushFirst: `請先推送你的 commit；它們出現在 Pull Request 的分支上之後，${product.name} 就會接手。`,
    commitFirst: "請先在這個工作的資料夾提交或捨棄你的修改。",
    switchBack: ({ branch }) => `這個工作的資料夾目前不在它的分支 ${branch} 上。請先切換回這個分支；${product.name} 只接手這個分支上的 commit。`,
    pullFirst: `Pull Request 的分支上有這個工作的資料夾還沒有的 commit。請先把它們拉進這個工作的資料夾；資料夾和分支一致之後，${product.name} 就會接手你的 commit。`,
    adopted: ({ commits }) => `已接手你從這個工作的資料夾推送到 Pull Request 分支的 ${commits} 個 commit。`,
  },
  discard: {
    committed: "這一輪開始之後，你在這個工作的資料夾建立了 commit；放棄這一輪會讓這些 commit 消失。請保留這一輪，或先用你自己的 Git 把這些 commit 移出這個工作的分支。",
    ownFiles: ({ files }) => `這個工作的資料夾裡有不屬於這一輪的檔案：${list(files)}。${product.name} 不會刪除它們；請先把它們移出這個工作的資料夾，再放棄這一輪。`,
  },
};

export default flow;
