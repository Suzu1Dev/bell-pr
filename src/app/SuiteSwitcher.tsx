import { useEffect, useId, useRef } from "react";
import { ChevronDown, X } from "lucide-react";
import { product } from "../../shared/product";
import type { SuiteLinks } from "../../shared/suite";
import { Logo } from "../brand/Logo";
import { useT } from "../i18n";
import { safeLink } from "../review/MarkdownContent";
import "./suite-switcher.css";

/** The button that opens the product switcher. */
export function SuiteTrigger({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const t = useT("app").suite;
  return (
    <button
      className="icon-button suite-trigger"
      aria-label={t.open}
      title={t.open}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
    >
      <Logo variant="mark" size={18} title="" className="suite-trigger-mark" />
      <ChevronDown size={15} aria-hidden="true" />
    </button>
  );
}

/**
 * The BELL products as a dialog: a link to each product BELLPR_SUITE_LINKS
 * names, this BELL PR as the current one, and the rest as not linked. A
 * link opens in the same tab and carries no token.
 */
export function SuiteSwitcher({ links, onClose }: { links: SuiteLinks; onClose: () => void }) {
  const t = useT("app").suite;
  const close = useT("common").actions.close;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const rows = [
    { ...t.personal, href: safeLink(links.personal), current: false },
    { ...t.explain, href: safeLink(links.explain), current: false },
    { name: product.name, summary: t.prSummary, href: "", current: true },
    { ...t.reader, href: safeLink(links.reader), current: false },
    { ...t.campaign, href: safeLink(links.campaign), current: false },
  ];

  useEffect(() => {
    const panel = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel?.showModal();
    panel?.querySelector("a")?.focus();
    return () => {
      panel?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="suite-switcher"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{t.title}</h2>
        <button type="button" className="icon-button" aria-label={close} onClick={onClose}>
          <X size={17} aria-hidden="true" />
        </button>
      </header>
      <ul>
        {rows.map((row) => {
          const text = (
            <>
              <strong>{row.name}</strong>
              <small>{row.summary}</small>
            </>
          );
          return (
            <li key={row.name}>
              {row.href ? (
                <a href={row.href}>{text}</a>
              ) : (
                <div aria-current={row.current || undefined}>
                  {text}
                  <em>{row.current ? t.current : t.notLinked}</em>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </dialog>
  );
}
