import { formatters, type Translation } from "../../../shared/i18n/locale";
import type en from "../en/efficiency";

const fmt = formatters("zh-TW");

const m: Translation<typeof en> = {
  title: "團隊 AI 用量",
  modes: { lite: "輕量", full: "完整", off: "關閉" },
  modeLabel: ({ mode }) => `效率模式：${mode}`,
  sample: "示範",
  roles: {
    lead: "Lead（規劃與整合）",
    member: "Teammates",
    reviewer: "Reviewer",
    tester: "Test analyst",
    draft: "PR 草稿",
    explanations: "解說",
    guide: "追問",
    walkthrough: "程式碼解說",
    premise: "前提查核",
    followup: "一輪修正",
    sync: "解衝突",
  },
  credit: {
    text: ({ version }) =>
      `效率模式以 DietrichGebert 的 Ponytail ${version}（MIT 授權）為基礎：輕量給 Agent 精簡改寫的原則，完整給完整規則，關閉都不給。`,
    link: "Ponytail 原始專案",
  },
  inputTokens: "輸入 tokens",
  cachedInputTokens: "其中快取",
  outputTokens: "輸出 tokens",
  agentTime: "累計 Agent 時間",
  running: "執行中",
  notReported: "未回報",
  seconds: ({ seconds }) =>
    `${fmt.number(seconds, { maximumFractionDigits: 1 })} 秒`,
  usageNote: ({ calls, measured }) =>
    `${fmt.number(calls)} 次呼叫 · 用量回報 ${fmt.number(measured)} / ${fmt.number(calls)} 次${
      measured < calls ? "，僅加總已回報部分。" : "。"
    }輸入 tokens 含快取；時間為各呼叫總和，非等待時間。`,
  byRole: ({ count }) => `依角色分項（${fmt.number(count)} 類）`,
  columns: {
    role: "角色",
    calls: "呼叫",
    inputTokens: "輸入 tokens",
    cachedInputTokens: "其中快取",
    outputTokens: "輸出 tokens",
    time: "時間",
  },
  partialCalls: ({ calls, measured }) =>
    `${fmt.number(calls)}（回報 ${fmt.number(measured)}）`,
  byRoleNote: "Teammates 為所有隊友合計。",
  noMeasurement: "尚無實測；執行後會顯示已回報的用量與時間。",
  noMeasurementSample: "尚無實測；示範內容未呼叫 AI。",
};

export default m;
