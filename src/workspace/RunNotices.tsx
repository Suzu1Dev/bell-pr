import { useState } from "react";
import { Archive, Clock3, ShieldAlert } from "lucide-react";
import { useT } from "../i18n";
import { ProBadge } from "../license/ProBadge";
import { requestUpgrade } from "../license/useEntitlements";
import { navigate } from "../navigation/route";
import type { Run } from "../types";

/**
 * A persistent warning on a run whose Claude Code agent ran without the
 * operating system's sandbox (`run.unsandboxed`). It links to the setting
 * that allowed it; the tooltip says what it means and shows on hover and
 * on keyboard focus, until Escape dismisses it.
 */
export function UnsandboxedBadge() {
  const t = useT("workspace").unsandboxed;
  const [dismissed, setDismissed] = useState(false);
  // The tooltip opens toward the side with room for it.
  const [toLeft, setToLeft] = useState(false);
  const place = (badge: HTMLElement) => {
    const width = Math.min(320, window.innerWidth * 0.7);
    setToLeft(badge.getBoundingClientRect().left + width > window.innerWidth - 16);
  };
  return (
    <span
      className={`unsandboxed-badge${dismissed ? " is-dismissed" : ""}${toLeft ? " opens-left" : ""}`}
      onMouseEnter={(event) => place(event.currentTarget)}
      onFocus={(event) => place(event.currentTarget)}
      onMouseLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setDismissed(true);
      }}
    >
      <a
        href="#/settings/safety"
        aria-describedby="unsandboxed-help"
        onClick={(event) => {
          // Through the router, so presentation flags stay in the address.
          event.preventDefault();
          navigate({ name: "settings", section: "safety" });
        }}
      >
        <ShieldAlert size={14} aria-hidden="true" />
        {t.label}
      </a>
      <span id="unsandboxed-help" className="unsandboxed-help" role="tooltip">
        {t.tooltip}
      </span>
    </span>
  );
}

/**
 * What the workspace says about a run beyond its status: that it waits
 * for the one run Free executes at a time, and that its working files were
 * cleaned up while its reports and notes stay.
 */
export function RunNotices({
  run,
  queuedOnFree,
}: {
  run: Run;
  /** The run is queued behind another one because Free runs one at a time. */
  queuedOnFree: boolean;
}) {
  const t = useT("workspace").runNotices;
  if (!queuedOnFree && !run.workspaceRemovedAt) return null;
  return (
    <div className="run-notices">
      {queuedOnFree && (
        <p className="run-notice" role="status">
          <Clock3 size={15} aria-hidden="true" />
          <span>{t.queuedFree}</span>
          <ProBadge />
          <button
            type="button"
            className="run-notice-link"
            onClick={() => requestUpgrade("parallelRuns")}
          >
            {t.queuedUpgrade}
          </button>
        </p>
      )}
      {run.workspaceRemovedAt && (
        <p className="run-notice" role="status">
          <Archive size={15} aria-hidden="true" />
          <span>{t.workspaceRemoved}</span>
        </p>
      )}
    </div>
  );
}
