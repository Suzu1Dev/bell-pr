/**
 * "Your words in the PR" (DESIGN F3): inserts the person's own explanation
 * at the start of the description and their not-tested answer under the
 * Testing heading, only when they click. Text with Han, Kana or Hangul is
 * shown beside the editor instead, unless the project's rules ask for
 * another language than English.
 *
 * L1 stub with the final props; L2F fills it in.
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

export default function YourWordsCard(_props: YourWordsCardProps) {
  return null;
}
