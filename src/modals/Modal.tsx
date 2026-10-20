import { useEffect, useRef, type ReactNode } from "react";
import { GitPullRequest, X } from "lucide-react";
import { useT } from "../i18n";

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  mark,
  focusTitle = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** The picture above the title; a pull request icon by default. */
  mark?: ReactNode;
  /** Opens on the title instead of the first field, when what comes before that field must be read first. */
  focusTitle?: boolean;
}) {
  const t = useT("modals");
  const panel = useRef<HTMLDivElement>(null);
  // The latest onClose, so a parent that passes a new function on every
  // render does not move the focus back to the first field each time.
  const close = useRef(onClose);
  close.current = onClose;
  // Read once, when the dialog opens.
  const titleFirst = useRef(focusTitle);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    // Land on the first real field or action; the close button is the
    // panel's first <button>, so it is only the fallback.
    const first = titleFirst.current ? panel.current?.querySelector<HTMLElement>("#modal-title") :
      panel.current?.querySelector<HTMLElement>(
        "input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(.modal-close):not(:disabled), a[href]",
      ) ?? panel.current?.querySelector<HTMLElement>(".modal-close");
    first?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") close.current();
      if (event.key === "Tab") {
        const nodes = panel.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input, textarea, select, a[href]",
        );
        if (!nodes?.length) return;
        if (event.shiftKey && document.activeElement === nodes[0]) {
          event.preventDefault();
          nodes[nodes.length - 1].focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === nodes[nodes.length - 1]
        ) {
          event.preventDefault();
          nodes[0].focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`modal ${wide ? "modal-wide" : ""}`}
      >
        <button
          className="icon-button modal-close"
          aria-label={t.close}
          onClick={onClose}
        >
          <X size={19} />
        </button>
        <div className="modal-mark">
          {mark ?? <GitPullRequest size={23} />}
        </div>
        <h2 id="modal-title" tabIndex={focusTitle ? -1 : undefined}>{title}</h2>
        {subtitle && <p className="modal-subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
