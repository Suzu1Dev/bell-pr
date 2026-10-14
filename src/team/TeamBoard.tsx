import { useState } from "react";
import {
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  GitBranch,
  GitMerge,
  Layers3,
  ListChecks,
  Loader2,
  MessageSquare,
  Play,
  RotateCcw,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  maxPlanRevisions,
  type TeamTask,
} from "../../shared/team";
import type { Run } from "../types";
import { EfficiencySummary } from "../efficiency/EfficiencySummary";
import { useFormat, useT } from "../i18n";
import { ModelSummary } from "../models/ModelSummary";
import { providerLabels } from "../../shared/models";
import { teamLanes } from "./lanes";
import "./team.css";

export function TeamBoard({
  run,
  demo,
  onApprove,
  onRevise,
  onMessage,
  onRetry,
  busy,
}: {
  run: Run;
  demo: boolean;
  onApprove: () => void;
  /** Sends the plan back to the lead with feedback; rejects with the server's message. */
  onRevise: (feedback: string) => Promise<void>;
  onMessage: (to: string, content: string) => Promise<void>;
  onRetry?: (message: string) => Promise<void>;
  busy: boolean;
}) {
  const t = useT("team");
  const taskLabels = useT("common").teamTaskStatus;
  const fmt = useFormat();
  const [recipient, setRecipient] = useState("all");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [revising, setRevising] = useState(false);
  const [reviseError, setReviseError] = useState("");
  const [retryMessage, setRetryMessage] = useState("");
  const [retryError, setRetryError] = useState("");
  // Explicit toggles win; otherwise a failed task shows its reason right away.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isExpanded = (task: TeamTask) =>
    toggled[task.id] ?? (task.status === "failed" && !!task.error);
  const team = run.team;
  if (!team)
    return (
      <div className="team-board">
        <ModelSummary execution={run.modelExecution} demo={demo} />
        <div className="team-legacy">
          <Users size={24} />
          <div>
            <h3>{t.legacy.title}</h3>
            <p>{t.legacy.body}</p>
          </div>
        </div>
      </div>
    );
  const finished = ["complete", "failed", "cancelled"].includes(team.phase);
  const canReceive = (task: TeamTask) =>
    ["pending", "ready", "running"].includes(task.status) &&
    task.acceptsMessages !== false;
  const unavailableRecipient =
    !demo &&
    !["all", "lead"].includes(recipient) &&
    !team.tasks.some((task) => task.id === recipient && canReceive(task));
  const messagingDisabled = !demo && (finished || team.phase === "planning");
  const done = team.tasks.filter((task) => task.status === "complete").length;
  const revisions = team.planRevisions ?? [];
  const revisionsLeft = revisions.length < maxPlanRevisions;
  const retryable =
    !demo &&
    !!onRetry &&
    ["failed", "cancelled"].includes(team.phase) &&
    team.tasks.length > 0 &&
    ["failed", "cancelled"].includes(run.status);
  const retriedCount = team.tasks.filter((task) =>
    ["failed", "blocked"].includes(task.status),
  ).length;
  return (
    <section className="team-board" aria-label={t.boardLabel}>
      <div className="team-board-header">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h2>{t.title}</h2>
          <p>{t.intro}</p>
        </div>
        <div className="team-runtime-badge">
          <Bot size={16} />
          <span>
            {demo
              ? t.runtime.demo
              : t.runtime.engine({
                  provider: providerLabels[team.config.provider],
                })}
            <small>
              {t.runtime.capacity({ count: team.config.maxTeammates })}
            </small>
          </span>
        </div>
      </div>
      <ModelSummary execution={run.modelExecution} demo={demo} />
      <EfficiencySummary
        metrics={run.efficiency}
        mode={run.contributionSettings?.ponytailMode}
        demo={demo}
      />
      <div className="team-flow">
        <span>
          <ListChecks size={18} />
          {t.flow.plan}
        </span>
        <i />
        <span>
          <ShieldCheck size={18} />
          {team.config.requirePlanApproval
            ? t.flow.approve
            : t.flow.autoApprove}
        </span>
        <i />
        <span>
          <Users size={18} />
          {t.flow.parallel}
        </span>
        <i />
        <span>
          <GitMerge size={18} />
          {t.flow.integrate}
        </span>
      </div>
      <div
        className={`team-plan ${team.phase === "awaiting_approval" ? "needs-approval" : ""}`}
      >
        <div className="team-plan-heading">
          <h3>
            <Layers3 size={18} />
            {t.phase[team.phase]}
          </h3>
          <span>{t.progress({ done, total: team.tasks.length })}</span>
        </div>
        <p>
          {team.planSummary ||
            (revisions.length ? t.plan.replanning : t.plan.reading)}
        </p>
        {revisions.length > 0 && (
          <ol className="team-plan-revisions" aria-label={t.revisions.label}>
            {revisions.map((revision, index) => (
              <li key={revision.createdAt}>
                <strong>{t.revisions.title({ number: index + 1 })}</strong>
                <span>
                  {t.revisions.previousTasks({
                    count: revision.previousTasks.length,
                    titles: fmt.list(
                      revision.previousTasks.map((task) => task.title),
                      { type: "unit" },
                    ),
                  })}
                </span>
                <p>
                  <b>{t.revisions.feedback}</b>
                  {revision.feedback}
                </p>
                <p>
                  <b>{t.revisions.notes}</b>
                  {revision.revisionNotes ??
                    (index === revisions.length - 1 &&
                    team.phase === "planning"
                      ? t.revisions.replanning
                      : t.revisions.noNotes)}
                </p>
              </li>
            ))}
          </ol>
        )}
        {team.phase === "awaiting_approval" && (
          <>
            <div className="team-plan-action">
              <span>{t.approval.hint}</span>
              <button
                className="button primary"
                onClick={onApprove}
                disabled={busy || revising}
              >
                {busy ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Play size={15} />
                )}
                {t.approval.approve}
              </button>
            </div>
            <form
              className="team-plan-revise"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!feedback.trim() || !revisionsLeft || demo) return;
                setRevising(true);
                setReviseError("");
                try {
                  await onRevise(feedback.trim());
                  setFeedback("");
                } catch (cause) {
                  setReviseError((cause as Error).message);
                } finally {
                  setRevising(false);
                }
              }}
            >
              <label>
                {t.revise.action}
                <small>{t.revise.hint}</small>
                <textarea
                  aria-label={t.revise.label}
                  value={feedback}
                  maxLength={4000}
                  rows={3}
                  placeholder={
                    revisionsLeft
                      ? t.revise.placeholder
                      : t.revise.limitReached
                  }
                  onChange={(e) => setFeedback(e.target.value)}
                  disabled={!revisionsLeft || revising || busy || demo}
                />
              </label>
              <div>
                <small>
                  {t.revise.counter({
                    count: revisions.length,
                    max: maxPlanRevisions,
                  })}
                </small>
                <button
                  type="submit"
                  className="button secondary"
                  disabled={
                    !feedback.trim() ||
                    !revisionsLeft ||
                    revising ||
                    busy ||
                    demo
                  }
                >
                  {revising ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <RotateCcw size={15} />
                  )}
                  {t.revise.action}
                </button>
              </div>
              {reviseError && (
                <p className="inline-error" role="alert">
                  {reviseError}
                </p>
              )}
            </form>
          </>
        )}
        {retryable && (
          <form
            className="team-plan-retry"
            onSubmit={async (e) => {
              e.preventDefault();
              setRetryError("");
              try {
                await onRetry!(retryMessage.trim());
                setRetryMessage("");
              } catch (cause) {
                setRetryError((cause as Error).message);
              }
            }}
          >
            <span>
              {retriedCount
                ? t.retry.partial({ kept: done, retried: retriedCount })
                : done === team.tasks.length
                  ? t.retry.integrationOnly
                  : t.retry.notStarted}
            </span>
            <input
              type="text"
              aria-label={t.retry.label}
              placeholder={t.retry.placeholder}
              value={retryMessage}
              maxLength={4000}
              onChange={(e) => setRetryMessage(e.target.value)}
              disabled={busy}
            />
            <button className="button primary" disabled={busy}>
              {busy ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <RotateCcw size={15} />
              )}
              {t.retry.action}
            </button>
            {retryError && (
              <p className="inline-error" role="alert">
                {retryError}
              </p>
            )}
          </form>
        )}
      </div>
      <div className="team-board-content">
        <div className="team-kanban">
          {teamLanes.map((group) => (
            <section className="team-lane" key={group.id}>
              <h3>
                {t.lanes[group.id]}
                <span>
                  {
                    team.tasks.filter((task) =>
                      group.states.includes(task.status),
                    ).length
                  }
                </span>
              </h3>
              {team.tasks
                .filter((task) => group.states.includes(task.status))
                .map((task) => (
                  <article
                    key={task.id}
                    className={`team-task task-${task.status}`}
                  >
                    <div className="team-task-label">
                      <span>{task.id}</span>
                      <span>
                        {task.status === "running" ? (
                          <Loader2 className="spin" size={13} />
                        ) : task.status === "complete" ? (
                          <CheckCircle2 size={13} />
                        ) : (
                          <Circle size={12} />
                        )}{" "}
                        {taskLabels[task.status]}
                      </span>
                    </div>
                    <h4>{task.title}</h4>
                    <p>{task.description}</p>
                    <div className="team-task-owner">
                      <Bot size={13} />
                      {task.owner}
                      <span>
                        {task.worktreeRemoved
                          ? t.task.worktreeRemoved
                          : t.task.worktree}
                      </span>
                    </div>
                    <div className="team-task-files">
                      <GitBranch size={13} />
                      <span>
                        {fmt.list(task.files, { type: "unit" }) ||
                          t.task.filesPending}
                      </span>
                    </div>
                    {task.dependsOn.length > 0 && (
                      <div className="team-task-deps">
                        {t.task.dependsOn({
                          tasks: fmt.list(task.dependsOn, { type: "unit" }),
                        })}
                      </div>
                    )}
                    {task.integratedFiles && task.integratedFiles.length > 0 && (
                      <div className="team-task-files team-task-integrated">
                        <GitMerge size={13} />
                        <span>
                          {t.task.integrated({
                            files: fmt.list(task.integratedFiles, {
                              type: "unit",
                            }),
                          })}
                        </span>
                      </div>
                    )}
                    {(task.report || task.error) && (
                      <>
                        <button
                          className="team-report-toggle"
                          aria-expanded={isExpanded(task)}
                          onClick={() =>
                            setToggled({
                              ...toggled,
                              [task.id]: !isExpanded(task),
                            })
                          }
                        >
                          {task.error ? t.task.showError : t.task.showReport}{" "}
                          <ChevronDown size={13} />
                        </button>
                        {isExpanded(task) && (
                          <pre className="team-task-report">
                            {task.error || task.report}
                          </pre>
                        )}
                      </>
                    )}
                    {task.checks && task.checks.length > 0 && (
                      // What BELL saw the CLI run, to compare with the checks the report claims; exit codes only.
                      <details className="team-task-checks">
                        <summary>
                          {t.task.checks({ count: task.checks.length })}
                        </summary>
                        <ul>
                          {task.checks.map((check, index) => (
                            <li key={index}>
                              <code>{check.command}</code>
                              <span>{check.outcome}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </article>
                ))}
              {!team.tasks.some((task) =>
                group.states.includes(task.status),
              ) && (
                <div className="team-lane-empty">
                  {group.id === "running"
                    ? t.laneEmpty.running
                    : t.laneEmpty.other}
                </div>
              )}
            </section>
          ))}
        </div>
        <aside className="team-mailbox">
          <div className="team-mailbox-heading">
            <h3>
              <MessageSquare size={17} />
              {t.mailbox.title}
            </h3>
            <span>{team.messages.length}</span>
          </div>
          <p className="team-delivery-note">
            {team.phase === "planning"
              ? t.mailbox.delivery.planning
              : recipient === "lead"
                ? team.phase === "awaiting_approval"
                  ? t.mailbox.delivery.leadDuringApproval({
                      action: t.revise.action,
                    })
                  : t.mailbox.delivery.lead
                : t.mailbox.delivery.members}
          </p>
          <div className="team-messages" aria-live="polite">
            {team.messages.map((item) => (
              <article
                key={item.id}
                className={`team-message from-${item.from === "user" ? "user" : "agent"}`}
              >
                <div>
                  <strong>
                    {item.from === "user" ? t.mailbox.you : item.from}
                  </strong>
                  <span>
                    → {item.to === "all" ? t.mailbox.everyone : item.to}
                  </span>
                  <time dateTime={item.createdAt}>
                    {fmt.time(item.createdAt)}
                  </time>
                </div>
                <p>{item.content}</p>
                <small>
                  {item.status === "queued" ? (
                    <Clock3 size={11} />
                  ) : (
                    <Check size={11} />
                  )}{" "}
                  {item.status === "queued"
                    ? t.mailbox.queued
                    : t.mailbox.delivered}
                  {demo ? ` · ${t.mailbox.sample}` : ""}
                </small>
              </article>
            ))}
            {!team.messages.length && (
              <p className="team-messages-empty">{t.mailbox.empty}</p>
            )}
          </div>
          <form
            className="team-message-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!message.trim() || unavailableRecipient || messagingDisabled)
                return;
              setSending(true);
              setError("");
              try {
                await onMessage(recipient, message.trim());
                setMessage("");
              } catch (cause) {
                setError((cause as Error).message);
              } finally {
                setSending(false);
              }
            }}
          >
            <label>
              {t.mailbox.sendTo}
              <select
                aria-label={t.mailbox.recipientLabel}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                disabled={messagingDisabled}
              >
                <option value="lead">{t.mailbox.teamLead}</option>
                <option value="all">{t.mailbox.everyone}</option>
                {team.tasks.map((task) => (
                  <option
                    value={task.id}
                    key={task.id}
                    disabled={!demo && !canReceive(task)}
                  >
                    {!demo && !canReceive(task)
                      ? t.mailbox.closedRecipient({
                          name: `${task.owner} · ${task.title}`,
                        })
                      : `${task.owner} · ${task.title}`}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              aria-label={t.mailbox.messageLabel}
              placeholder={
                finished && !demo
                  ? t.mailbox.finishedPlaceholder
                  : t.mailbox.placeholder
              }
              value={message}
              maxLength={4000}
              rows={3}
              onChange={(e) => setMessage(e.target.value)}
              disabled={messagingDisabled}
            />
            <div>
              <small>
                {demo ? t.mailbox.demoHint : t.mailbox.hint}
              </small>
              <button
                className="button primary"
                disabled={
                  sending ||
                  !message.trim() ||
                  unavailableRecipient ||
                  messagingDisabled
                }
                aria-label={t.mailbox.send}
              >
                {sending ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <ArrowUp size={16} />
                )}
              </button>
            </div>
            {unavailableRecipient && (
              <p className="inline-error" role="status">
                {t.mailbox.unavailable}
              </p>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </aside>
      </div>
      <p className="team-protocol-note">
        <ShieldCheck size={14} />
        {t.protocolNote({ provider: providerLabels[team.config.provider] })}
      </p>
    </section>
  );
}
export { demoTeam } from "../demo";
