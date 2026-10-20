import { Copy } from "lucide-react";
import { useT } from "../../i18n";

/** A `path:line` (or a folder) to read in the person's own editor, with a copy button. */
export function CopyRef({ text, shown = true }: { text: string; shown?: boolean }) {
  const copy = useT("common").actions.copy;
  return (
    <span className="by-hand-ref">
      {shown && <code>{text}</code>}
      <button
        type="button"
        className="icon-button"
        aria-label={copy}
        title={copy}
        onClick={() => void navigator.clipboard?.writeText(text).catch(() => undefined)}
      >
        <Copy size={12} aria-hidden="true" />
      </button>
    </span>
  );
}
