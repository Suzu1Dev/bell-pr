/** Learning record export copy (Traditional Chinese, Taiwan); typed against the English copy. */
import type { Translation } from "./locale.js";
import type en from "./learning-export.en.js";

const messages: Translation<typeof en> = {
  title: ({ title }) => `# 學習紀錄：${title}`,
  disclaimer:
    "> 本紀錄的解說、問答與審查內容由 agent 產生，可能有誤；程式碼與結論仍需自行驗證。",
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
};

export default messages;
