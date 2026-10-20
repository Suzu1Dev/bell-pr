/** Learning record export copy (Traditional Chinese, Taiwan); typed against the English copy. */
import { formatters, type Translation } from "./locale.js";
import type en from "./learning-export.en.js";
import type { byHand as enByHand } from "./learning-export.en.js";
import { product } from "../product.js";

const fmt = formatters("zh-TW");

const messages: Translation<typeof en> = {
  title: ({ title }) => `# 學習紀錄：${title}`,
  disclaimer:
    "> 本紀錄的解說、問答中的回答與審查內容由 agent 產生，可能有誤；標示為「你的」的部分是你自己寫的。程式碼與結論仍需自行驗證。",
  repository: ({ fullName }) => `- Repository：${fullName}`,
  branch: ({ branch, baseBranch }) => `- 分支：${branch} → ${baseBranch}`,
  createdAt: ({ createdAt }) => `- 建立時間：${createdAt}`,
  status: ({ status }) => `- 狀態：${status}`,
  sections: {
    task: "任務描述",
    plan: "團隊計畫",
    explanations: "檔案解說",
    conversations: "問答紀錄",
    pullRequest: "Pull Request",
    usage: "Agent 用量",
    notes: "你的筆記",
    explainBack: "用自己的話講一遍",
    roads: "做法選擇",
    forecast: "你的預測",
    feedbackTags: "你標記的維護者回饋",
    overrides: "你略過的檢查與理由",
  },
  noPullRequest: "尚未送出 PR。",
  noExplanations: "尚未產生解說。",
  explanationStatus: ({ status }) => `解說狀態：${status}`,
  explanationStatusWithError: ({ status, error }) =>
    `解說狀態：${status}（${error}）`,
  example: ({ scenario, before, after }) =>
    `**白話文舉例**\n\n- 情境：${scenario}\n- 修改前：${before}\n- 修改後：${after}`,
  fields: {
    summary: "改了什麼",
    reason: "為什麼改",
    concept: "開發觀念",
    tip: "審閱提醒",
    alternatives: "其他做法",
    lookup: "可以查",
  },
  selfCheck: ({ question, answer }) =>
    `**考考自己**\n\n問題：${question}\n\n答案：${answer}`,
  noConversations: "沒有問答紀錄。",
  you: "你",
  assistant: "學習助手",
  turn: ({ author }) => `**${author}：**`,
  staleTurn: ({ author }) => `**${author}（針對較舊版本）：**`,
  noUsage: "沒有用量紀錄。",
  calls: ({ calls, completed, failed }) =>
    `- 呼叫次數：${calls}（完成 ${completed}、失敗 ${failed}）`,
  measured: ({ measured, calls }) => `- 用量回報：${measured} / ${calls} 次`,
  inputTokens: ({ input, cached }) =>
    `- 輸入 tokens：${input}（含快取讀取 ${cached}）`,
  outputTokens: ({ output }) => `- 輸出 tokens：${output}`,
  duration: ({ seconds }) => `- Agent 執行時間：${seconds} 秒`,
  mode: ({ mode, policyVersion }) => `- Ponytail 模式：${mode}（${policyVersion}）`,
  unmeasured:
    "- 注意：有呼叫未回報用量，上述 tokens 只加總已回報部分；未回報的用量為未知，不是 0。",
  checkOff: "在理解檢查關閉時核准。",
  summary: ({ summary }) => `**你的說明**\n\n${summary}`,
  question: ({ question }) => `**問題：**${question}`,
  answer: ({ answer, confidence }) => `**你的答案**（${confidence}）：${answer}`,
  dontKnow: ({ confidence }) => `**你的答案**（${confidence}）：我不知道`,
  grade: ({ grade }) => `**你的評分：**${grade}`,
  correction: ({ correction }) => `**你哪裡想錯了：**${correction}`,
  passed: ({ passedAt, questions, misses }) =>
    `- ${passedAt} 通過：${questions} 題，沒答到 ${misses} 題`,
  roadGuess: ({ guess }) => `**其他做法（你的猜想）：**${guess}`,
  roadChoice: ({ choice }) => `**你的選擇：**${choice}`,
  roadWhy: ({ why }) => `**理由：**${why}`,
  forecastDimension: ({ dimension }) => `**維護者可能質疑的地方：**${dimension}`,
  tag: ({ url, facts }) =>
    facts.length ? `- ${url}：${fmt.list(facts, { type: "unit" })}` : `- ${url}`,
  sawItComing: "早就料到",
  surprised: "出乎意料",
  lesson: ({ lesson }) => `下次的心得：${lesson}`,
  override: ({ check, reason, at }) => `- ${check}（${at}）：${reason}`,
  confidences: { sure: "確定", think: "大概", guess: "用猜的" },
  grades: { got: "答對", partly: "部分對", missed: "沒答到" },
  roadChoices: { keep: "維持這個做法", switch: "偏好另一種", depends: "看情況" },
  dimensions: {
    scope: "範圍",
    simplicity: "簡潔",
    naming: "命名",
    conventions: "專案慣例",
    tests: "測試",
    risk: "風險",
    description: "說明",
    worth: "值得花審查時間",
  },
  overrideChecks: { "issue-has-pr": "別人的 Pull Request 已經會關閉這個 issue" },
};

export default messages;

export const byHand: Translation<typeof enByHand> = {
  title: "親手學",
  claim: `${product.name} 的 agent 沒有寫入權限，也沒有給你這份變更的任何程式碼。`,
  withdrawn: `${product.name} 在這個工作裡看到 agent 修改過檔案，所以不為它做親手學的聲明。`,
  fitted: ({ kinds }) => `開始時就配合了專案的規範：嚮導只提供${kinds}。`,
  helps: ({ helps }) => `- 嚮導的協助：${helps}`,
  predictions: ({ right, judged, unsure }) => `- 每次修改後的第一個預測，${judged} 次中對了 ${right} 次；不確定 ${unsure} 次`,
  removed: ({ count }) => `- ${product.name} 在你看到之前，從 ${count} 則回答中移除了程式碼`,
  kinds: {
    explain: "解說",
    answer: "回答",
    plan: "規劃協助",
    review: "審查",
    test: "測試協助",
  },
  notProof: `${product.name} 看不到你用過的其他工具，例如編輯器的自動完成。這份紀錄是給你自己看的，不能證明程式碼是誰寫的。`,
};
