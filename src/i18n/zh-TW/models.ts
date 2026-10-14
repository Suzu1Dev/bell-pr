import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/models";

const m: Translation<typeof en> = {
  heading: { run: "執行模型", analysis: "分析模型" },
  regionLabel: {
    run: "這次任務的模型設定",
    analysis: "這次分析的模型設定",
  },
  sample: "示範內容，尚未執行模型。",
  sampleChip: "示範",
  notRecorded: {
    run: "舊任務未記錄模型。",
    analysis: "此分析未記錄模型。",
  },
  agent: "Agent",
  model: "模型",
  modelsUsed: "本次執行呼叫過的模型",
  reasoningEffort: "思考強度",
  network: "網路",
  webAccessAllowed: "已允許上網",
  defaultModelUnreported: ({ provider }) => `${provider} 預設（型號未回報）`,
  passedAndReported: ({ passed, reported }) =>
    `傳入 ${passed} → 回報 ${reported}`,
  defaultAndReported: ({ reported }) => `未傳入 --model → 回報 ${reported}`,
  withCliVersion: ({ model, version }) => `${model}（CLI ${version}）`,
  providerDefault: ({ provider }) => `${provider} 預設`,
  sourceReported: ({ provider }) =>
    `這是 ${product.name} 傳入 ${provider} 的設定與 ${provider} CLI 回報的實際模型；回報值來自 CLI 事件，不是供應端帳單。`,
  sourceUnreported: ({ provider }) =>
    `這是 ${product.name} 傳入 ${provider} 的設定；服務端實際使用的模型未另外回報。`,
};

export default m;
