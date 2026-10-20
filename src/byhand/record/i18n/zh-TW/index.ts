import type { Translation } from "../../../../../shared/i18n/locale";
import { product } from "../../../../../shared/product";
import type en from "../en";

const m: Translation<typeof en> = {
  title: "親手學紀錄",
  badge: "親手學",
  claim: `${product.name} 的 agent 沒有寫入權限，也沒有給你這份變更的任何程式碼。`,
  quotes: "嚮導只顯示專案程式碼和你自己修改內容的引文。",
  claimed: ({ claim, quotes }) => `${claim}${quotes}`,
  unclean: ({ reason }) => `${product.name} 不為這個工作做親手學的聲明：${reason}。`,
  reasons: {
    "agent-writes": "有 agent 試圖修改檔案",
    agents: "嚮導、審查者和測試分析師以外的 agent 參與過",
    tasks: "它曾被規劃成團隊任務",
    rounds: "跑過 AI 後續修改",
    resolutions: "有 agent 解決過它的合併衝突",
  },
  removed: ({ count }) => `${product.name} 在你看到之前，從 ${count} 則回答中移除了程式碼。`,
  kinds: { explain: "解說", answer: "回答", plan: "規劃協助", review: "審查", test: "測試協助" },
  helps: ({ list }) => `你用過的協助：${list}。`,
  helpCount: ({ kind, count }) => `${kind}（${count}）`,
  noHelp: "嚮導沒有提供協助。",
  tests: ({ runs, more, right, judged }) =>
    `${product.name} 幫你跑了${more ? "至少 " : " "}${runs} 次測試${judged ? `；每次修改後你的第一個預測，${judged} 次中對了 ${right} 次` : ""}。`,
  fitted: ({ kinds }) => `這個工作開始時就依專案規範調整過：嚮導只提供${kinds}。`,
  otherTools: `${product.name} 看不到你用過的其他工具，例如編輯器的自動完成或其他聊天工具。`,
  forYou: "這份紀錄是給你自己看的，不能證明程式碼是誰寫的。",
  helpers: `你自己的話：${product.name} 不會替親手學的 PR 起草。`,
  template: "從專案的範本開始",
  templateChoice: "範本",
  facts: `寫 AI 說明時可參考的事實；${product.name} 絕不會把它們放進描述`,
  cli: ({ cli, model }) => `嚮導用的是 ${cli}；${model ? `CLI 回報的模型是 ${model}` : "CLI 沒有回報它的模型"}。`,
  rule: ({ path, line, quote }) => `專案要求揭露：${path}:${line}：「${quote}」`,
  ownWords: "請用你自己的話寫 AI 說明。",
  unchecked: `${product.name} 無法依專案規範檢查這份草稿，所以還不能送出。`,
};

export default m;
