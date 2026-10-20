import { useT } from "../i18n";

/**
 * The learning page's heading. Above the notes it also says what the page
 * keeps and who wrote it; the other views introduce themselves.
 */
export function LearningHeading({ notes = true }: { notes?: boolean }) {
  const t = useT("learning");
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{t.eyebrow}</span>
        <h1 tabIndex={-1}>{t.title}</h1>
        {notes && (
          <>
            <p>{t.intro}</p>
            <p className="learning-ai-note">{t.aiNote}</p>
          </>
        )}
      </div>
    </div>
  );
}
