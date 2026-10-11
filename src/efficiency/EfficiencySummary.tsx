import { Gauge, ArrowUpRight } from "lucide-react";
import {
  ponytailSource,
  ponytailVersion,
  type EfficiencyMetrics,
  type PonytailMode,
  type RoleEfficiency,
} from "../../shared/efficiency";
import "./efficiency.css";

const modeLabels = { lite: "輕量", full: "完整", off: "關閉" };
/** Display order and zh-TW labels for the raw role keys; member-N teammates collapse into one row. */
const roleLabels: Record<string, string> = {
  lead: "Lead（規劃與整合）",
  member: "Teammates",
  reviewer: "Reviewer",
  tester: "Tester",
  draft: "PR 草稿",
  explanations: "解說",
  guide: "追問",
  followup: "Review 修正",
};
const roleGroup = (role: string) =>
  /^member-\d+$/.test(role) ? "member" : role;

/** Sums byRole entries per display group, keeping the fixed order first and unknown keys after. */
export function groupByRole(byRole: Record<string, RoleEfficiency>) {
  const groups = new Map<string, RoleEfficiency>();
  for (const [role, entry] of Object.entries(byRole)) {
    const key = roleGroup(role);
    const total = groups.get(key);
    groups.set(
      key,
      total
        ? {
            calls: total.calls + entry.calls,
            measuredCalls: total.measuredCalls + entry.measuredCalls,
            inputTokens: total.inputTokens + entry.inputTokens,
            cachedInputTokens:
              total.cachedInputTokens + entry.cachedInputTokens,
            outputTokens: total.outputTokens + entry.outputTokens,
            durationMs: total.durationMs + entry.durationMs,
          }
        : { ...entry },
    );
  }
  const known = Object.keys(roleLabels);
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const rank = (key: string) =>
        known.includes(key) ? known.indexOf(key) : known.length;
      return rank(a) - rank(b) || a.localeCompare(b);
    })
    .map(([key, entry]) => ({ key, label: roleLabels[key] ?? key, ...entry }));
}

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
  const seconds = (ms: number) =>
    `${(ms / 1000).toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 秒`;
  const rows = data?.byRole ? groupByRole(data.byRole) : [];
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
                  ? seconds(data.durationMs)
                  : "執行中"}
              </dd>
            </div>
          </dl>
          <p className="efficiency-note">
            {data.calls} 次呼叫 · 用量回報 {data.measuredCalls} / {data.calls}{" "}
            次{data.measuredCalls < data.calls ? "，僅加總已回報部分。" : "。"}
            快取已包含於輸入；時間為各次執行加總，並非等待時間。
          </p>
          {rows.length > 0 && (
            <details className="efficiency-roles">
              <summary>依角色分項（{rows.length} 類）</summary>
              <div className="efficiency-roles-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">角色</th>
                      <th scope="col">呼叫</th>
                      <th scope="col">輸入 tokens</th>
                      <th scope="col">其中快取</th>
                      <th scope="col">輸出 tokens</th>
                      <th scope="col">時間</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const value = (count: number) =>
                        row.measuredCalls
                          ? count.toLocaleString("zh-TW")
                          : "未回報";
                      return (
                        <tr key={row.key}>
                          <th scope="row">{row.label}</th>
                          <td>
                            {row.calls}
                            {row.measuredCalls < row.calls
                              ? `（回報 ${row.measuredCalls}）`
                              : ""}
                          </td>
                          <td>{value(row.inputTokens)}</td>
                          <td>{value(row.cachedInputTokens)}</td>
                          <td>{value(row.outputTokens)}</td>
                          <td>{seconds(row.durationMs)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="efficiency-note">
                同樣只列 CLI 回報的 tokens 與呼叫次數；Teammates
                為所有成員合計。
              </p>
            </details>
          )}
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
