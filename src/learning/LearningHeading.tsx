import { useT } from "../i18n";

/** The learning page's heading, with what the page keeps and who wrote it. */
export function LearningHeading() {
  const t = useT("learning");
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{t.eyebrow}</span>
        <h1 tabIndex={-1}>{t.title}</h1>
        <p>{t.intro}</p>
        <p className="learning-ai-note">{t.aiNote}</p>
      </div>
    </div>
  );
}
