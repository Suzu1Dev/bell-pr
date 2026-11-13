import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  AudioLines,
  CalendarRange,
  ChevronDown,
  Highlighter,
  Share2,
  Sun,
} from "lucide-react";
import type { SuiteLinks, SuiteSiblingId } from "../../shared/suite";
import { useT } from "../i18n";
import { safeLink } from "../review/MarkdownContent";
import { currentRouteHash } from "../navigation/route";
import { buildPrOutgoingHandoff } from "./handoff";
import "./suite-handoff.css";

interface SuiteHandoffMenuProps {
  links?: SuiteLinks;
  title?: string;
  text: string;
  className?: string;
}

const TARGET_ICONS: Record<SuiteSiblingId, typeof Sun> = {
  personal: Sun,
  explain: AudioLines,
  reader: Highlighter,
  campaign: CalendarRange,
};

/** Dropdown button sending the current context (overview, diff or task) to a sibling BELL tool. */
export function SuiteHandoffMenu({ links, title, text, className = "" }: SuiteHandoffMenuProps) {
  const t = useT("app").suite;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const targets = (["explain", "personal", "reader", "campaign"] as const).flatMap((id) => {
    const origin = safeLink(links?.[id]);
    if (!origin) return [];
    return [
      {
        id,
        label: t.sendTargets[id],
        href: buildPrOutgoingHandoff({
          target: id,
          origin,
          title,
          text,
          back: currentRouteHash(),
        }),
      },
    ];
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!targets.length || !text.trim()) return null;

  return (
    <div ref={rootRef} className={`suite-handoff-menu ${className}`.trim()}>
      <button
        type="button"
        className="suite-handoff-trigger"
        aria-label={t.sendToSuite}
        title={t.sendToSuite}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Share2 size={13} aria-hidden="true" />
        <span>{t.sendToSuite}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="suite-handoff-popover">
          {targets.map((target) => {
            const Icon = TARGET_ICONS[target.id];
            return (
              <a
                key={target.id}
                role="menuitem"
                className="suite-handoff-item"
                href={target.href}
                onClick={() => setOpen(false)}
              >
                <span className="suite-handoff-item-left">
                  <Icon size={14} aria-hidden="true" />
                  <span>{target.label}</span>
                </span>
                <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
