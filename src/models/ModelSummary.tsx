import { Cpu } from "lucide-react";
import {
  providerLabels,
  type ModelExecution,
  type ReasoningEffort,
} from "../../shared/models";
import "./models.css";

export const reasoningLabels: Record<ReasoningEffort, string> = {
  none: "不啟用",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "很高",
  max: "最高",
  ultra: "極高",
};

export function ModelSummary({
  execution,
  demo = false,
  analysis = false,
}: {
  execution?: ModelExecution;
  demo?: boolean;
  analysis?: boolean;
}) {
  const label = providerLabels[execution?.provider ?? "codex"];
  return (
    <section
      className="model-summary"
      aria-label={analysis ? "這次分析的模型設定" : "這次任務的模型設定"}
    >
      <div className="model-summary-heading">
        <Cpu size={16} aria-hidden="true" />
        <strong>{analysis ? "分析模型" : "執行模型"}</strong>
      </div>
      {demo ? (
        <p>示範內容，尚未執行模型。</p>
      ) : !execution ? (
        <p>{analysis ? "此分析未記錄模型。" : "舊任務未記錄模型。"}</p>
      ) : (
        <>
          <dl>
            <div>
              <dt>Agent</dt>
              <dd>{label}</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{execution.model || `${label} 預設（型號未回報）`}</dd>
            </div>
            <div>
              <dt>思考強度</dt>
              <dd>
                {execution.reasoningEffort
                  ? `${reasoningLabels[execution.reasoningEffort]} · ${execution.reasoningEffort}`
                  : `${label} 預設`}
              </dd>
            </div>
          </dl>
          <p>這是 BELL 傳入 {label} 的設定；服務端實際使用的模型未另外回報。</p>
        </>
      )}
    </section>
  );
}
