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
import { ModelSummary } from "../models/ModelSummary";
import { providerLabels } from "../../shared/models";
import { teamLanes, type TeamLaneId } from "./lanes";
import "./team.css";

const taskLabels = {
  pending: "等待相依",
  ready: "可認領",
  running: "進行中",
  complete: "已整合",
  failed: "失敗",
  blocked: "已阻擋",
};
const phaseLabels = {
  planning: "Lead 正在規劃",
  awaiting_approval: "等待你確認開發計畫",
  developing: "Teammates 協作中",
  integrating: "Lead 整合中",
  reviewing: "交叉審查中",
  complete: "團隊工作已完成",
  failed: "需要處理執行問題",
  cancelled: "團隊已停止",
};
const laneLabels: Record<TeamLaneId, string> = {
  todo: "待處理",
  running: "進行中",
  done: "已完成",
};
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
            <h3>這是舊版流程的任務</h3>
            <p>
              新建立的任務會使用共享任務板、相依排程與獨立 teammate
              工作目錄。以下保留原本的執行紀錄。
            </p>
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
    <section className="team-board" aria-label="共享任務與團隊訊息">
      <div className="team-board-header">
        <div>
          <span className="eyebrow">SHARED TASKS · INDEPENDENT CONTEXTS</span>
          <h2>一起開發，有分工也有對話。</h2>
          <p>Lead 拆解與整合，每位 teammate 有自己的工作目錄與上下文。</p>
        </div>
        <div className="team-runtime-badge">
          <Bot size={16} />
          <span>
            {demo
              ? "團隊協作示範"
              : `${providerLabels[team.config.provider]} · BELL 協作引擎`}
            <small>最多 {team.config.maxTeammates} 位成員同時工作</small>
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
          Lead 規劃
        </span>
        <i />
        <span>
          <ShieldCheck size={18} />
          {team.config.requirePlanApproval ? "你確認計畫" : "自動執行計畫"}
        </span>
        <i />
        <span>
          <Users size={18} />
          Teammates 並行
        </span>
        <i />
        <span>
          <GitMerge size={18} />
          整合與審查
        </span>
      </div>
      <div
        className={`team-plan ${team.phase === "awaiting_approval" ? "needs-approval" : ""}`}
      >
        <div className="team-plan-heading">
          <h3>
            <Layers3 size={18} />
            {phaseLabels[team.phase]}
          </h3>
          <span>
            {done} / {team.tasks.length} 子任務完成
          </span>
        </div>
        <p>
          {team.planSummary ||
            (revisions.length
              ? "Lead 正依你的意見重新規劃。"
              : "正在閱讀專案並建立有明確範圍與相依關係的計畫。")}
        </p>
        {revisions.length > 0 && (
          <ol className="team-plan-revisions" aria-label="計畫重擬紀錄">
            {revisions.map((revision, index) => (
              <li key={revision.createdAt}>
                <strong>第 {index + 1} 次退回</strong>
                <span>
                  上一版有 {revision.previousTasks.length} 個任務：
                  {revision.previousTasks.map((task) => task.title).join("、")}
                </span>
                <p>
                  <b>你的意見：</b>
                  {revision.feedback}
                </p>
                <p>
                  <b>Lead 的調整說明：</b>
                  {revision.revisionNotes ??
                    (index === revisions.length - 1 &&
                    team.phase === "planning"
                      ? "重新規劃中…"
                      : "Lead 未說明調整內容；請直接比對新舊任務。")}
                </p>
              </li>
            ))}
          </ol>
        )}
        {team.phase === "awaiting_approval" && (
          <>
            <div className="team-plan-action">
              <span>先查看各任務的檔案範圍與相依，再允許寫入程式碼。</span>
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
                確認計畫並開始開發
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
                退回並補充意見
                <small>
                  拆解不合理、範圍太大、少了測試任務或相依奇怪時，寫下原因讓
                  Lead 重擬；這是練習「怎麼拆任務」的機會。
                </small>
                <textarea
                  aria-label="退回計畫的意見"
                  value={feedback}
                  maxLength={4000}
                  rows={3}
                  placeholder={
                    revisionsLeft
                      ? "例如：把 API 與 UI 拆成兩個任務，並加一個只負責測試的任務。"
                      : "已達重擬上限，請核准目前計畫或取消工作。"
                  }
                  onChange={(e) => setFeedback(e.target.value)}
                  disabled={!revisionsLeft || revising || busy || demo}
                />
              </label>
              <div>
                <small>
                  已重擬 {revisions.length}/{maxPlanRevisions}
                  ；每次重擬是一次 Lead 唯讀規劃回合
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
                  退回並補充意見
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
                ? `${done} 個已整合的子任務不會重跑；${retriedCount} 個失敗或被阻擋的子任務會丟棄舊的隔離目錄，從新的快照重新開始。`
                : done === team.tasks.length
                  ? "所有子任務都已整合；重試只會重新執行 Lead 整合與獨立審查。"
                  : "尚有未開始的子任務；若計畫尚未核准，重試會先回到等待核准。"}
            </span>
            <input
              type="text"
              aria-label="給重試任務的補充說明"
              placeholder="選填：給重試成員的補充說明，會在第一回合送達"
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
              重試失敗的子任務
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
                {laneLabels[group.id]}
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
                          ? "獨立 worktree 已清理"
                          : "獨立 worktree"}
                      </span>
                    </div>
                    <div className="team-task-files">
                      <GitBranch size={13} />
                      <span>{task.files.join("、") || "規劃中"}</span>
                    </div>
                    {task.dependsOn.length > 0 && (
                      <div className="team-task-deps">
                        先完成 {task.dependsOn.join("、")}
                      </div>
                    )}
                    {task.integratedFiles && task.integratedFiles.length > 0 && (
                      <div className="team-task-files team-task-integrated">
                        <GitMerge size={13} />
                        <span>已整合：{task.integratedFiles.join("、")}</span>
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
                          {task.error ? "查看失敗原因" : "查看工作報告"}{" "}
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
                          應用程式觀察到 {task.checks.length} 次指令執行（只有結束碼，未擷取輸出；可與報告自述的檢查對照）
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
                    ? "目前沒有正在執行的子任務"
                    : "目前沒有任務"}
                </div>
              )}
            </section>
          ))}
        </div>
        <aside className="team-mailbox">
          <div className="team-mailbox-heading">
            <h3>
              <MessageSquare size={17} />
              團隊對話
            </h3>
            <span>{team.messages.length}</span>
          </div>
          <p className="team-delivery-note">
            {team.phase === "planning"
              ? "Lead 正在規劃。計畫產生後，即可向成員補充指示。"
              : recipient === "lead"
                ? team.phase === "awaiting_approval"
                  ? "要調整計畫，請用上方「退回並補充意見」讓 Lead 重擬；這裡的訊息只會在整合回合被讀到。"
                  : "Lead 會在下一次整合回合讀取訊息，不會重排計畫；開發指示請傳給全體成員或指定隊友。"
                : "訊息在下一個工作回合送達；執行中的回合不會即時中斷。"}
          </p>
          <div className="team-messages" aria-live="polite">
            {team.messages.map((item) => (
              <article
                key={item.id}
                className={`team-message from-${item.from === "user" ? "user" : "agent"}`}
              >
                <div>
                  <strong>{item.from === "user" ? "你" : item.from}</strong>
                  <span>→ {item.to === "all" ? "全體成員" : item.to}</span>
                  <time>
                    {new Date(item.createdAt).toLocaleTimeString("zh-TW", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <p>{item.content}</p>
                <small>
                  {item.status === "queued" ? (
                    <Clock3 size={11} />
                  ) : (
                    <Check size={11} />
                  )}{" "}
                  {item.status === "queued" ? "等待下一回合" : "已送達"}
                  {demo ? " · 示範" : ""}
                </small>
              </article>
            ))}
            {!team.messages.length && (
              <p className="team-messages-empty">
                補充限制、詢問設計，或提醒成員注意相依變更。
              </p>
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
              傳送給
              <select
                aria-label="團隊訊息收件人"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                disabled={messagingDisabled}
              >
                <option value="lead">Team lead</option>
                <option value="all">全體成員</option>
                {team.tasks.map((task) => (
                  <option
                    value={task.id}
                    key={task.id}
                    disabled={!demo && !canReceive(task)}
                  >
                    {task.owner} · {task.title}
                    {!demo && !canReceive(task) ? "（已停止收件）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              aria-label="團隊訊息"
              placeholder={
                finished && !demo
                  ? "此團隊已結束，可在程式碼閱讀區追問。"
                  : "例如：請保留目前的 API 相容性…"
              }
              value={message}
              maxLength={4000}
              rows={3}
              onChange={(e) => setMessage(e.target.value)}
              disabled={messagingDisabled}
            />
            <div>
              <small>
                {demo ? "示範訊息僅保留在畫面" : "傳送會留存在任務記錄"}
              </small>
              <button
                className="button primary"
                disabled={
                  sending ||
                  !message.trim() ||
                  unavailableRecipient ||
                  messagingDisabled
                }
                aria-label="傳送團隊訊息"
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
                這個任務已停止收件，請選擇 Lead 或其他成員。
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
        BELL 使用共享任務、獨立工作目錄及回合間訊息協作。這是由{" "}
        {providerLabels[team.config.provider]} 逐回合驅動的 BELL
        實作，並非 Claude Code 原生 Agent Teams。
      </p>
    </section>
  );
}
export { demoTeam } from "../demo";
