import { useId } from "react";
import { ArrowDownToLine, Check, PenLine } from "lucide-react";
import { useT } from "../i18n";
import { CopyButton } from "./CopyButton";
import { hasCjk, includesText, insertSummary, insertUntested } from "./your-words";
import "./drafts.css";

/**
 * "Your words in the PR" (DESIGN F3): inserts the person's own explanation
 * at the start of the description and their not-tested answer under the
 * Testing heading, only when they click. Text with Han, Kana or Hangul is
 * shown beside the editor instead, unless the project's rules ask for
 * another language than English.
 */
export interface YourWordsCardProps {
  /** The Explain-it-back summary, when the check has one. */
  summary?: string;
  /** The answer to "What did you not test, and why?". */
  untested?: string;
  /** The description in the editor. */
  body: string;
  /** The project's rules ask for a language other than English. */
  projectLanguageAllowed: boolean;
  /** Receives the description with the text inserted. */
  onInsert(next: string): void;
  disabled?: boolean;
}

export default function YourWordsCard({
  summary,
  untested,
  body,
  projectLanguageAllowed,
  onInsert,
  disabled = false,
}: YourWordsCardProps) {
  const t = useT("draft").yourWords;
  const id = useId().replaceAll(":", "");
  // Without a summary the check was not taken: there is nothing of the
  // person's own to offer.
  if (!summary?.trim()) return null;
  const parts = [
    {
      key: "summary",
      label: t.summary,
      text: summary.trim(),
      action: t.useExplanation,
      insert: () => onInsert(insertSummary(body, summary)),
    },
    ...(untested?.trim()
      ? [
          {
            key: "untested",
            label: t.untested,
            text: untested.trim(),
            action: t.addUntested,
            insert: () => onInsert(insertUntested(body, untested)),
          },
        ]
      : []),
  ];
  return (
    <section className="your-words" aria-labelledby={`your-words-${id}`}>
      <h3 id={`your-words-${id}`}>
        <PenLine size={16} aria-hidden="true" /> {t.title}
      </h3>
      <p className="your-words-lead">{t.lead}</p>
      {parts.map((part) => {
        const inserted = includesText(body, part.text);
        // Product rule 2: the PR text stays English unless the project
        // asks for another language, so CJK text is a reference to write from.
        const reference = hasCjk(part.text) && !projectLanguageAllowed;
        return (
          <div key={part.key} className="your-words-part">
            <h4>{part.label}</h4>
            <blockquote>{part.text}</blockquote>
            {reference ? (
              <div className="your-words-reference">
                <p>{t.english}</p>
                <CopyButton text={part.text} label={t.copy} />
              </div>
            ) : (
              <button
                type="button"
                className="button secondary"
                disabled={disabled || inserted}
                onClick={part.insert}
              >
                {inserted ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <ArrowDownToLine size={14} aria-hidden="true" />
                )}
                {inserted ? t.inserted : part.action}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
