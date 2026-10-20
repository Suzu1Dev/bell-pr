import { ArrowUpRight, MessageCircle } from "lucide-react";
import type { PrFeedbackItem } from "../../shared/pr-feedback";
import { useT } from "../i18n";

/** Thread comments on the current file, shown as plain text: other people's words, not Markdown to trust. */
export function MaintainerFeedback({ items }: { items: PrFeedbackItem[] }) {
  const t = useT("review");
  if (!items.length) return null;
  return (
    <section className="explain-card explain-card-report">
      <h3>
        <MessageCircle size={15} />
        {t.feedback.title}
        <span className="explain-report-author">
          {t.feedback.count({ count: items.length })}
        </span>
      </h3>
      <p className="explain-report-meta">
        <span className="explain-report-badge">{t.feedback.badge}</span>
        <span>{t.feedback.replyNote}</span>
      </p>
      <ul className="explain-feedback-list">
        {items.map((item) => (
          <li key={item.url}>
            <div className="explain-feedback-head">
              <strong>{item.author}</strong>
              <span>{item.authorAssociation}</span>
              {typeof item.line === "number" && (
                <span>{t.feedback.line({ line: item.line })}</span>
              )}
              {item.isResolved && <span>{t.feedback.resolved}</span>}
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                {t.feedback.open}
                <ArrowUpRight size={12} />
              </a>
            </div>
            <p>{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
