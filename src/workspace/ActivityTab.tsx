import type { Dispatch, SetStateAction } from "react";
import {
  Bot,
  Circle,
  CircleCheck,
  GitBranch,
  Loader2,
  ShieldCheck,
  Square,
} from "lucide-react";
import { useFormat, useT } from "../i18n";
import type { Run } from "../types";
import { FailureText } from "../FailureText";
import { TeamBoard } from "../team/TeamBoard";
import type { RunActions } from "../app/hooks/useRunActions";

interface ActivityTabProps {
  run: Run;
  demo: boolean;
  busy: boolean;
  active: boolean;
  reviewRerunning: boolean;
  /** Agent id the run log is filtered by, or "all". */
  logFilter: string;
  setLogFilter: Dispatch<SetStateAction<string>>;
  actions: Pick<
    RunActions,
    | "approveTeamPlan"
    | "reviseTeamPlan"
    | "sendTeamMessage"
    | "retryTeam"
    | "cancel"
  >;
}

/** The agent team's board, the run log and the mission brief. */
export function ActivityTab({
  run,
  demo,
  busy,
  active,
  reviewRerunning,
  logFilter,
  setLogFilter,
  actions,
}: ActivityTabProps) {
  const t = useT("workspace").activity;
  const fmt = useFormat();
  const {
    approveTeamPlan,
    reviseTeamPlan,
    sendTeamMessage,
    retryTeam,
    cancel,
  } = actions;
  const activeLogFilter = run.agents.some((agent) => agent.id === logFilter)
    ? logFilter
    : "all";
  const visibleLogs =
    activeLogFilter === "all"
      ? run.logs
      : run.logs.filter((log) => log.agent === activeLogFilter);
  return (
    <>
      <TeamBoard
        key={run.id}
        run={run}
        demo={demo}
        onApprove={approveTeamPlan}
        onRevise={reviseTeamPlan}
        onMessage={sendTeamMessage}
        onRetry={retryTeam}
        busy={busy}
      />
      <div className="activity-layout">
        <div className="activity-main">
          <div className="section-heading">
            {run.team ? (
              <div>
                <h2>{t.runTitle}</h2>
                <p>{t.runText}</p>
              </div>
            ) : (
              <div>
                <h2>{t.teamTitle}</h2>
                <p>{t.teamText}</p>
              </div>
            )}
            {(active || reviewRerunning) && (
              <button className="button secondary" onClick={cancel}>
                <Square size={14} />
                {reviewRerunning ? t.stopReview : t.stopTask}
              </button>
            )}
          </div>
          {!run.team && (
            <div className="agent-grid">
              {run.agents.map((agent, index) => (
                <div
                  className={`agent-card ${agent.status}`}
                  key={agent.id}
                >
                  <div className={`agent-avatar color-${index}`}>
                    <Bot size={22} />
                  </div>
                  <div>
                    <strong>{agent.name}</strong>
                    <span>{agent.role}</span>
                  </div>
                  <span className="agent-state">
                    {agent.status === "complete" ? (
                      <CircleCheck size={17} />
                    ) : agent.status === "running" ? (
                      <Loader2 className="spin" size={17} />
                    ) : (
                      <Circle size={17} />
                    )}
                  </span>
                  <p>{agent.detail}</p>
                </div>
              ))}
            </div>
          )}
          <div className="activity-log-heading">
            <h3>{t.log}</h3>
            <span>{demo ? t.demoLog : active ? t.live : t.taskLog}</span>
          </div>
          {run.agents.length > 0 && run.logs.length > 0 && (
            <div
              className="log-filters"
              role="group"
              aria-label={t.filterLabel}
            >
              {[
                { id: "all", label: t.all },
                ...run.agents.map((agent) => ({
                  id: agent.id,
                  label: agent.id,
                })),
              ].map((chip) => (
                <button
                  key={chip.id}
                  className={`log-filter-chip ${activeLogFilter === chip.id ? "is-on" : ""}`}
                  aria-pressed={activeLogFilter === chip.id}
                  onClick={() => setLogFilter(chip.id)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}
          <div className="activity-log">
            {visibleLogs.map((log, index) => (
              <div
                className={`log-line ${log.kind ? `log-${log.kind}` : ""}`}
                key={index}
              >
                <span className="log-time">
                  {fmt.time(log.time, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span className="log-agent">{log.agent}</span>
                {log.kind === "command" ? (
                  // The command the CLI reported, with its exit code; no output was captured.
                  <p>
                    <code className="log-command">{log.message}</code>
                    {log.detail && (
                      <span className="log-detail">{log.detail}</span>
                    )}
                  </p>
                ) : (
                  <p>{log.message}</p>
                )}
              </div>
            ))}
            {!run.logs.length && (
              <p className="muted">{t.emptyLog}</p>
            )}
            {run.logs.length > 0 && !visibleLogs.length && (
              <p className="muted">{t.emptyFilter}</p>
            )}
          </div>
          {run.error && (
            <p className="inline-error">
              <FailureText text={run.error} />
            </p>
          )}
        </div>
        <aside className="task-brief">
          <span className="eyebrow">{t.eyebrow}</span>
          <h3>{t.goal}</h3>
          <p>{run.prompt}</p>
          <div className="brief-meta">
            <GitBranch size={16} />
            <span>{run.branch}</span>
          </div>
          <div className="callout">
            <ShieldCheck size={18} />
            <p>{t.isolation}</p>
          </div>
        </aside>
      </div>
    </>
  );
}
