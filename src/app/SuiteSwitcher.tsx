import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowUpRight,
  AudioLines,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronsUpDown,
  GitPullRequest,
  Highlighter,
  Search,
  Sun,
  X,
} from "lucide-react";
import { product } from "../../shared/product";
import type { SuiteAppId, SuiteLinks } from "../../shared/suite";
import { Logo } from "../brand/Logo";
import { useT } from "../i18n";
import { safeLink } from "../review/MarkdownContent";
import "./suite-switcher.css";

/** Compact product switcher button for the mobile topbar breadcrumb. */
export function SuiteTrigger({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const t = useT("app").suite;
  return (
    <button
      type="button"
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
 * Direction C ("Precise") sidebar brand button for the BELL Suite edition:
 * 24px emerald brand tile + BELL PR wordmark + ChevronsUpDown switcher affordance.
 */
export function SuiteBrandButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const t = useT("app").suite;
  return (
    <button
      type="button"
      className="suite-brand-btn suite-trigger"
      aria-label={t.open}
      title={t.open}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
    >
      <span className="suite-brand-tile" aria-hidden="true">
        <Logo variant="mark" size={15} title="" className="suite-tile-mark" />
      </span>
      <span className="suite-brand-wordmark">{product.name}</span>
      <ChevronsUpDown size={14} className="suite-brand-chevrons" aria-hidden="true" />
    </button>
  );
}

const APP_ICONS: Record<SuiteAppId, typeof Sun> = {
  personal: Sun,
  explain: AudioLines,
  pr: GitPullRequest,
  reader: Highlighter,
  campaign: CalendarRange,
};

/**
 * Searchable 5-product BELL Suite switcher dialog: links to every configured
 * BELL product, marks BELL PR as current, supports instant text filtering and
 * Ctrl/Cmd+1..5 shortcuts, and keeps keyboard focus trapped cleanly inside `<dialog>`.
 */
export function SuiteSwitcher({ links, onClose }: { links: SuiteLinks; onClose: () => void }) {
  const t = useT("app").suite;
  const close = useT("common").actions.close;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState("");

  const rows: {
    id: SuiteAppId;
    name: string;
    summary: string;
    href: string;
    current: boolean;
    shortcut: number;
  }[] = [
    { id: "personal", ...t.personal, href: safeLink(links.personal), current: false, shortcut: 1 },
    { id: "explain", ...t.explain, href: safeLink(links.explain), current: false, shortcut: 2 },
    { id: "pr", name: product.name, summary: t.prSummary, href: "", current: true, shortcut: 3 },
    { id: "reader", ...t.reader, href: safeLink(links.reader), current: false, shortcut: 4 },
    { id: "campaign", ...t.campaign, href: safeLink(links.campaign), current: false, shortcut: 5 },
  ];

  const normalized = query.trim().toLowerCase();
  const visibleRows = normalized
    ? rows.filter(
        (row) =>
          row.name.toLowerCase().includes(normalized) ||
          row.summary.toLowerCase().includes(normalized) ||
          row.id.includes(normalized),
      )
    : rows;

  useEffect(() => {
    const panel = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel?.showModal();
    (panel?.querySelector("a") ?? panel?.querySelector("input"))?.focus();
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
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && ["1", "2", "3", "4", "5"].includes(event.key)) {
          const target = rows[Number(event.key) - 1];
          if (target?.href) {
            event.preventDefault();
            window.location.href = target.href;
          } else if (target?.current) {
            event.preventDefault();
            onClose();
          }
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          onClose();
        }
      }}
    >
      <header>
        <h2 id={titleId}>{t.title}</h2>
        <button type="button" className="icon-button" aria-label={close} onClick={onClose}>
          <X size={17} aria-hidden="true" />
        </button>
      </header>
      <div className="suite-switcher-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchPlaceholder}
        />
      </div>
      <ul>
        {visibleRows.length === 0 ? (
          <li className="suite-switcher-empty">{t.noMatch}</li>
        ) : (
          visibleRows.map((row) => {
            const Icon = APP_ICONS[row.id];
            const inner = (
              <>
                <span className={`suite-app-icon suite-app-${row.id}`} aria-hidden="true">
                  <Icon size={15} />
                </span>
                <span className="suite-app-copy">
                  <strong>{row.name}</strong>
                  <small>{row.summary}</small>
                </span>
              </>
            );
            return (
              <li key={row.id}>
                {row.href ? (
                  <a href={row.href}>
                    {inner}
                    <span
                      className="suite-row-end"
                      data-shortcut={`⌃${row.shortcut}`}
                      aria-hidden="true"
                    >
                      <ArrowUpRight size={14} />
                    </span>
                  </a>
                ) : (
                  <div
                    className={row.current ? "is-current" : "is-unlinked"}
                    aria-current={row.current || undefined}
                  >
                    {inner}
                    <em
                      className={row.current ? "suite-current-pill" : "suite-unlinked-label"}
                      data-shortcut={`⌃${row.shortcut}`}
                    >
                      {row.current && <Check size={11} aria-hidden="true" />}
                      {row.current ? t.current : t.notLinked}
                    </em>
                  </div>
                )}
              </li>
            );
          })
        )}
      </ul>
      <footer className="suite-switcher-footer" aria-hidden="true">
        <span>{t.footerNavigate}</span>
        <span>{t.footerOpen}</span>
        <span>{t.footerClose}</span>
      </footer>
    </dialog>
  );
}
