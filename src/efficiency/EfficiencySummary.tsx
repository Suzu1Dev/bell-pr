import { Gauge, ArrowUpRight } from "lucide-react";
import {
  ponytailSource,
  ponytailVersion,
  type EfficiencyMetrics,
  type PonytailMode,
} from "../../shared/efficiency";
import "./efficiency.css";

const modeLabels = { lite: "輕量", full: "完整", off: "關閉" };

export function EfficiencySummary({
  metrics,
  mode,
  demo = false,
  title = "團隊 AI 用量",
}: {
  metrics?: EfficiencyMetrics;
  mode?: PonytailMode;
  demo?: boolean;
  title?: string;
}) {
  const data = demo ? undefined : metrics;
  const recordedMode = data?.mode ?? mode;
  const measured = !!data?.measuredCalls;
  const tokens = (value: number | undefined) =>
    measured && value !== undefined ? value.toLocaleString("zh-TW") : "未回報";
  return (
    <section className="efficiency-summary" aria-label={title}>
      <div className="efficiency-heading">
        <span>
          <Gauge size={15} aria-hidden="true" />
          <strong>{title}</strong>
        </span>
        {recordedMode && (
          <span className="efficiency-mode">
            Ponytail · {modeLabels[recordedMode]}
          </span>
        )}
        <a
          href={ponytailSource}
          target="_blank"
          rel="noreferrer"
          title={`Ponytail ${ponytailVersion} 原始專案`}
        >
          Ponytail {ponytailVersion}
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </div>
      {data?.calls ? (
        <>
          <dl className="efficiency-metrics">
            <div>
              <dt>輸入 tokens</dt>
              <dd>{tokens(data.inputTokens)}</dd>
            </div>
            <div>
              <dt>其中快取命中</dt>
              <dd>{tokens(data.cachedInputTokens)}</dd>
            </div>
            <div>
              <dt>輸出 tokens</dt>
              <dd>{tokens(data.outputTokens)}</dd>
            </div>
            <div>
              <dt>累計 Agent 時間</dt>
              <dd>
                {data.completedCalls + data.failedCalls > 0
                  ? `${(data.durationMs / 1000).toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 秒`
                  : "執行中"}
              </dd>
            </div>
          </dl>
          <p className="efficiency-note">
            {data.calls} 次呼叫 · 用量回報 {data.measuredCalls} / {data.calls}{" "}
            次{data.measuredCalls < data.calls ? "，僅加總已回報部分。" : "。"}
            快取已包含於輸入；時間為各次執行加總，並非等待時間。
          </p>
        </>
      ) : (
        <p className="efficiency-note">
          尚無實測
          {demo
            ? "；示範內容未呼叫 AI。"
            : "；執行後會顯示已回報的用量與時間。"}
        </p>
      )}
    </section>
  );
}
