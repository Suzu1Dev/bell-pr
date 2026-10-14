import {
  Activity,
  Code2,
  ListTree,
  MessageSquare,
  Play,
  ShieldCheck,
} from "lucide-react";
import { useT } from "../i18n";

/** How the agent team splits, builds, reviews and tests a contribution. */
export function TeamPage({
  beginContribution,
}: {
  beginContribution: () => void;
}) {
  const t = useT("pages").team;
  return (
    <section className="page-content">
      <div className="page-title">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h1 tabIndex={-1}>{t.title}</h1>
          <p>{t.intro}</p>
        </div>
        <button
          className="button primary"
          onClick={() => beginContribution()}
        >
          <Play size={15} />
          {t.assign}
        </button>
      </div>
      <div className="team-pipeline">
        {[
          { id: "lead", ...t.roles.lead, icon: ListTree },
          { id: "teammates", ...t.roles.teammates, icon: Code2 },
          { id: "inbox", ...t.roles.inbox, icon: MessageSquare },
          { id: "review", ...t.roles.review, icon: Activity },
        ].map((agent, index) => (
          <article key={agent.id} className="team-role">
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
          <strong>{t.noteTitle}</strong>
          <p>{t.noteText}</p>
        </div>
      </div>
    </section>
  );
}
