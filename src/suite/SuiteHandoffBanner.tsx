import { ArrowLeft, X } from "lucide-react";
import { useT } from "../i18n";
import { safeLink } from "../review/MarkdownContent";
import type { StoredPrHandoff } from "./handoff";
import "./suite-handoff.css";

interface SuiteHandoffBannerProps {
  handoff: StoredPrHandoff;
  onApply: (handoff: StoredPrHandoff) => void;
  onDismiss: () => void;
}

/** Zero-write confirmation banner for a draft sent into BELL PR from another BELL app. */
export function SuiteHandoffBanner({ handoff, onApply, onDismiss }: SuiteHandoffBannerProps) {
  const appT = useT("app");
  const t = appT.suite;
  const sourceName = t[handoff.from].name;
  const backHref = safeLink(handoff.backUrl);

  return (
    <section className="suite-handoff-banner" aria-label={t.handoffFrom({ app: sourceName })}>
      <div className="suite-handoff-banner-body">
        <div className="suite-handoff-banner-meta">
          <span>{t.handoffFrom({ app: sourceName })}</span>
          {handoff.truncated && <span>· {t.handoffTruncated}</span>}
          {backHref && (
            <a className="suite-handoff-back" href={backHref}>
              <ArrowLeft size={12} aria-hidden="true" />
              <span>{t.handoffBack({ app: sourceName })}</span>
            </a>
          )}
        </div>
        <p className="suite-handoff-preview">
          {handoff.title ? `${handoff.title} — ${handoff.text}` : handoff.text}
        </p>
      </div>
      <div className="suite-handoff-actions">
        <button
          type="button"
          className="suite-handoff-apply"
          onClick={() => onApply(handoff)}
        >
          {t.handoffApply}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={appT.dismissNotice}
          onClick={onDismiss}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
