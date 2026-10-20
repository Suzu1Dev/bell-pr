import { useRef } from "react";
import { Gauge, ArrowUpRight, Info } from "lucide-react";
import {
  ponytailSource,
  ponytailVersion,
  type EfficiencyMetrics,
  type PonytailMode,
  type RoleEfficiency,
} from "../../shared/efficiency";
import { useFormat, useT, type Messages } from "../i18n";
import "./efficiency.css";

type RoleGroup = keyof Messages["efficiency"]["roles"];
/** Display order of the role groups; member-N teammates collapse into one row. */
const roleOrder: readonly string[] = [
  "lead",
  "member",
  "reviewer",
  "tester",
  "draft",
  "explanations",
  "guide",
  "walkthrough",
  "premise",
  "followup",
  "sync",
] satisfies RoleGroup[];
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
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const rank = (key: string) =>
        roleOrder.includes(key) ? roleOrder.indexOf(key) : roleOrder.length;
      return rank(a) - rank(b) || a.localeCompare(b);
    })
    .map(([key, entry]) => ({ key, ...entry }));
}

/**
 * The efficiency mode and the provider-reported AI usage of a run, an
 * analysis or a discovery. Without measured calls it folds into one line.
 * The mode chip opens the credit to Ponytail, which the modes build on.
 */
export function EfficiencySummary({
  metrics,
  mode,
  demo = false,
  title,
}: {
  metrics?: EfficiencyMetrics;
  mode?: PonytailMode;
  demo?: boolean;
  /** Heading and accessible name; the team usage title by default. */
  title?: string;
}) {
  const t = useT("efficiency");
  const fmt = useFormat();
  const heading = title ?? t.title;
  const data = demo ? undefined : metrics;
  // The sample's counts are never shown, but its recorded mode is, unless
  // the person chose another one for the replay.
  const recordedMode = data?.mode ?? mode ?? (demo ? metrics?.mode : undefined);
  const measured = !!data?.measuredCalls;
  const tokens = (value: number | undefined) =>
    measured && value !== undefined ? fmt.number(value) : t.notReported;
  const seconds = (ms: number) => t.seconds({ seconds: ms / 1000 });
  const roleLabel = (key: string) =>
    Object.hasOwn(t.roles, key) ? t.roles[key as RoleGroup] : key;
  const rows = data?.byRole ? groupByRole(data.byRole) : [];
  const credit = t.credit.text({ version: ponytailVersion });
  const toggletip = useRef<HTMLDetailsElement>(null);
  const closeCredit = (focusChip: boolean) => {
    const details = toggletip.current;
    if (!details?.open) return;
    details.open = false;
    if (focusChip) details.querySelector("summary")?.focus();
  };
  return (
    <section
      className={`efficiency-summary ${data?.calls ? "" : "is-empty"}`}
      aria-label={heading}
    >
      <div className="efficiency-heading">
        <span>
          <Gauge size={15} aria-hidden="true" />
          <strong>{heading}</strong>
        </span>
        {demo && <span className="efficiency-sample">{t.sample}</span>}
        {recordedMode && (
          // A toggletip: the chip shows the credit on hover and opens it,
          // with the upstream link, on click or Enter.
          // Escape or moving focus away closes it again.
          <details
            className="efficiency-mode"
            ref={toggletip}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !toggletip.current?.open) return;
              event.stopPropagation();
              closeCredit(true);
            }}
            onBlur={(event) => {
              if (!toggletip.current?.contains(event.relatedTarget as Node | null))
                closeCredit(false);
            }}
          >
            <summary title={credit}>
              {t.modeLabel({ mode: t.modes[recordedMode] })}
              <Info size={12} aria-hidden="true" />
            </summary>
            {/* Focusable, so selecting its text does not close it. */}
            <div className="efficiency-credit" role="note" tabIndex={-1}>
              <p>{credit}</p>
              <a href={ponytailSource} target="_blank" rel="noreferrer">
                {t.credit.link}
                <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            </div>
          </details>
        )}
      </div>
      {data?.calls ? (
        <>
          <dl className="efficiency-metrics">
            <div>
              <dt>{t.inputTokens}</dt>
              <dd>{tokens(data.inputTokens)}</dd>
            </div>
            <div>
              <dt>{t.cachedInputTokens}</dt>
              <dd>{tokens(data.cachedInputTokens)}</dd>
            </div>
            <div>
              <dt>{t.outputTokens}</dt>
              <dd>{tokens(data.outputTokens)}</dd>
            </div>
            <div>
              <dt>{t.agentTime}</dt>
              <dd>
                {data.completedCalls + data.failedCalls > 0
                  ? seconds(data.durationMs)
                  : t.running}
              </dd>
            </div>
          </dl>
          <p className="efficiency-note">
            {t.usageNote({ calls: data.calls, measured: data.measuredCalls })}
          </p>
          {rows.length > 0 && (
            <details className="efficiency-roles">
              <summary>{t.byRole({ count: rows.length })}</summary>
              <div className="efficiency-roles-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t.columns.role}</th>
                      <th scope="col">{t.columns.calls}</th>
                      <th scope="col">{t.columns.inputTokens}</th>
                      <th scope="col">{t.columns.cachedInputTokens}</th>
                      <th scope="col">{t.columns.outputTokens}</th>
                      <th scope="col">{t.columns.time}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const value = (count: number) =>
                        row.measuredCalls ? fmt.number(count) : t.notReported;
                      return (
                        <tr key={row.key}>
                          <th scope="row">{roleLabel(row.key)}</th>
                          <td>
                            {row.measuredCalls < row.calls
                              ? t.partialCalls({
                                  calls: row.calls,
                                  measured: row.measuredCalls,
                                })
                              : fmt.number(row.calls)}
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
              <p className="efficiency-note">{t.byRoleNote}</p>
            </details>
          )}
        </>
      ) : (
        <p className="efficiency-note">
          {demo ? t.noMeasurementSample : t.noMeasurement}
        </p>
      )}
    </section>
  );
}
