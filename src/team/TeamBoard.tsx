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
  ShieldCheck,
  Users,
} from "lucide-react";
import type { AgentTeam, TeamTask } from "../../shared/team";
import type { Run } from "../types";
import { EfficiencySummary } from "../efficiency/EfficiencySummary";
import { ModelSummary } from "../models/ModelSummary";
import { providerLabels } from "../../shared/models";
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
export function TeamBoard({
  run,
  demo,
  onApprove,
  onMessage,
  busy,
}: {
  run: Run;
  demo: boolean;
  onApprove: () => void;
  onMessage: (to: string, content: string) => Promise<void>;
  busy: boolean;
}) {
  const [recipient, setRecipient] = useState("all");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
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
  const groups: { label: string; states: TeamTask["status"][] }[] = [
    { label: "待處理", states: ["pending", "ready", "blocked"] },
    { label: "進行中", states: ["running"] },
    { label: "已完成", states: ["complete", "failed"] },
  ];
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
          {team.planSummary || "正在閱讀專案並建立有明確範圍與相依關係的計畫。"}
        </p>
        {team.phase === "awaiting_approval" && (
          <div className="team-plan-action">
            <span>先查看各任務的檔案範圍與相依，再允許寫入程式碼。</span>
            <button
              className="button primary"
              onClick={onApprove}
              disabled={busy}
            >
              {busy ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Play size={15} />
              )}
              確認計畫並開始開發
            </button>
          </div>
        )}
      </div>
      <div className="team-board-content">
        <div className="team-kanban">
          {groups.map((group) => (
            <section className="team-lane" key={group.label}>
              <h3>
                {group.label}
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
                      <span>獨立 worktree</span>
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
                    {(task.report || task.error) && (
                      <>
                        <button
                          className="team-report-toggle"
                          aria-expanded={expanded === task.id}
                          onClick={() =>
                            setExpanded(expanded === task.id ? null : task.id)
                          }
                        >
                          查看工作報告 <ChevronDown size={13} />
                        </button>
                        {expanded === task.id && (
                          <pre className="team-task-report">
                            {task.error || task.report}
                          </pre>
                        )}
                      </>
                    )}
                  </article>
                ))}
              {!team.tasks.some((task) =>
                group.states.includes(task.status),
              ) && (
                <div className="team-lane-empty">
                  {group.label === "進行中"
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
                ? "Lead 會在下一次整合回合讀取訊息；開發指示請傳給全體成員或指定隊友。"
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
export const demoTeam: AgentTeam = {
  config: {
    maxTeammates: 3,
    requirePlanApproval: true,
    provider: "codex",
    protocol: "bell-shared-tasks",
    messageDelivery: "between-turns",
  },
  phase: "complete",
  planSummary:
    "將重試策略、HTTP client 整合與驗證拆成明確範圍。先建立共用型別，再讓 client 與文件分頭作業；最後整合測試並交叉審閱，確認重試只套用在可恢復的 GET 失敗。",
  tasks: [
    {
      id: "task-1",
      title: "定義重試策略與型別",
      description: "建立退避、jitter 與可重試條件，維持泛型回傳型別。",
      owner: "member-1",
      files: ["src/utils/retry.ts", "src/types.ts"],
      dependsOn: [],
      status: "complete",
      report:
        "示範報告：新增可配置的重試策略與型別。實際執行證據請以真實任務報告為準。",
    },
    {
      id: "task-2",
      title: "接進使用者的 GET 請求",
      description: "保留 HTTP 錯誤資訊，區分暫時性失敗與無法重試的狀態。",
      owner: "member-2",
      files: ["src/client.ts"],
      dependsOn: ["task-1"],
      status: "complete",
      report: "示範報告：只有 GET 請求採用重試，沒有自動重送付款等寫入操作。",
    },
    {
      id: "task-3",
      title: "補齊使用範例與限制",
      description: "向 SDK 使用者說明怎麼設定，以及重試不適用的情境。",
      owner: "member-3",
      files: ["README.md"],
      dependsOn: ["task-1"],
      status: "complete",
      report: "示範報告：說明預設值、錯誤分類與相容性。",
    },
    {
      id: "task-4",
      title: "驗證邊界與整合行為",
      description: "檢查重試上限、不可重試錯誤與最後一次失敗的回傳行為。",
      owner: "member-1",
      files: ["tests/retry.test.ts"],
      dependsOn: ["task-2", "task-3"],
      status: "complete",
      report: "此為示範測試計畫，未執行真實 repository 的測試。",
    },
  ],
  messages: [
    {
      id: "m1",
      from: "lead",
      to: "all",
      content:
        "這次的目標是讓短暫網路失敗有機會恢復。請只調整 GET 行為，保留既有介面。",
      createdAt: "2026-10-03T01:20:00+08:00",
      status: "delivered",
      recipients: ["task-1", "task-2", "task-3", "task-4"],
      deliveredTo: ["task-1", "task-2", "task-3", "task-4"],
    },
    {
      id: "m2",
      from: "member-1",
      to: "task-2",
      content:
        "RetryOptions 已準備好。client 請透過 shouldRetry 傳入 HTTP 分類，不要在重試工具內耦合 HTTP。",
      createdAt: "2026-10-03T01:24:00+08:00",
      status: "delivered",
      recipients: ["task-2"],
      deliveredTo: ["task-2"],
    },
  ],
};
