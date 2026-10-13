import {
  Activity,
  Code2,
  ListTree,
  MessageSquare,
  Play,
  ShieldCheck,
} from "lucide-react";

/** How the agent team splits, builds, reviews and tests a contribution. */
export function TeamPage({
  beginContribution,
}: {
  beginContribution: () => void;
}) {
  return (
    <section className="page-content">
      <div className="page-title">
        <div>
          <span className="eyebrow">BUILT TO COLLABORATE</span>
          <h1 tabIndex={-1}>一個目標，一支 Agent team。</h1>
          <p>從拆解問題到交叉審查，讓專業分工融入你的開發流程。</p>
        </div>
        <button
          className="button primary"
          onClick={() => beginContribution()}
        >
          <Play size={15} />
          指派新任務
        </button>
      </div>
      <div className="team-pipeline">
        {[
          {
            name: "Team lead",
            role: "共享計畫與相依拆解",
            text: "依貢獻方向建立任務板，明確指定檔案範圍與相依，讓你先確認計畫。",
            scope: "規劃 · 指派 · 整合",
            icon: ListTree,
          },
          {
            name: "Teammates",
            role: "獨立上下文與並行開發",
            text: "每位成員有獨立工作目錄；先完成相依任務，互不衝突的工作可同時執行。",
            scope: "2–4 位 · 共享任務板",
            icon: Code2,
          },
          {
            name: "Team inbox",
            role: "成員之間能交換發現",
            text: "傳送給 Lead、任務成員或全體；訊息在下一個工作回合送達，可追蹤送達狀態。",
            scope: "共享訊息 · 保留記錄",
            icon: MessageSquare,
          },
          {
            name: "Review & tests",
            role: "整合後的獨立審查",
            text: "受檔案範圍約束的變更依序整合，再由獨立審查者與測試分析員檢查結果。",
            scope: "品質檢查 · 人工送出",
            icon: Activity,
          },
        ].map((agent, index) => (
          <article key={agent.name} className="team-role">
            <span className="role-number">0{index + 1}</span>
            <div className={`agent-avatar color-${index}`}>
              <agent.icon size={26} />
            </div>
            <h2>{agent.name}</h2>
            <strong>{agent.role}</strong>
            <p>{agent.text}</p>
            <span className="role-scope">{agent.scope}</span>
          </article>
        ))}
      </div>
      <div className="team-note">
        <ShieldCheck size={25} />
        <div>
          <strong>Agent 負責開發，你保有最後決定權。</strong>
          <p>
            使用本機 Codex 或 Claude Code CLI
            登入狀態。每個任務有獨立分支，完成後進入審查，不會自動建立
            PR。
          </p>
        </div>
      </div>
    </section>
  );
}
