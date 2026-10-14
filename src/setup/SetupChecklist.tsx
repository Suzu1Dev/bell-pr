import type { ReactNode } from "react";
import {
  CircleCheck,
  CircleMinus,
  CircleX,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import {
  doctorCheckIds,
  type DoctorCheck,
  type DoctorCheckId,
  type DoctorCheckStatus,
  type DoctorReport,
} from "../../shared/doctor";
import { useFormat, useT } from "../i18n";
import { CopyCommand } from "./CopyCommand";
import "./setup.css";

/** Checks whose detail names the person (account, plan, name and e-mail). */
const userDetails: readonly DoctorCheckId[] = [
  "gh-auth",
  "claude-auth",
  "codex-auth",
  "git-identity",
];

const icons: Record<DoctorCheckStatus, ReactNode> = {
  ok: <CircleCheck size={18} aria-hidden="true" />,
  warn: <TriangleAlert size={18} aria-hidden="true" />,
  fail: <CircleX size={18} aria-hidden="true" />,
  skip: <CircleMinus size={18} aria-hidden="true" />,
};

const identity = (value: string) => value;

export interface SetupChecklistProps {
  /** The environment report; null while the first one loads. */
  report: DoctorReport | null;
  /** A request is on its way: the rows and the button say so. */
  checking?: boolean;
  /** Why the last request failed, shown above the rows. */
  error?: string;
  /** Probes again; without it there is no Re-check button. */
  refresh?: () => unknown;
  /** Masks the GitHub login, the agent CLIs' account details and the Git identity. */
  maskUser?: (value: string) => string;
  /** Masks the data directory's path. */
  maskPath?: (value: string) => string;
  /**
   * "full" lists every check; "summary" says whether everything is ready
   * and lists only the checks that need attention, without fixes.
   */
  variant?: "full" | "summary";
  /** Fix commands on the checks that need attention (default), or on every check that has them. */
  fixes?: "problems" | "all";
  /** summary: a link to the full checklist. */
  detailsHref?: string;
}

const needsAttention = (check: DoctorCheck) =>
  check.status === "fail" || check.status === "warn";

/**
 * The environment checklist: a row per check with its state, what it found
 * and the commands that fix it, and a Re-check button. Pass the fields of
 * useDoctor(); the maskers hide personal details in presentations.
 */
export function SetupChecklist({
  report,
  checking = false,
  error,
  refresh,
  maskUser = identity,
  maskPath = identity,
  variant = "full",
  fixes = "problems",
  detailsHref,
}: SetupChecklistProps) {
  const t = useT("setup").checklist;
  const format = useFormat();
  const summary = variant === "summary";

  const recheck = refresh && (
    <button
      type="button"
      className="button secondary setup-recheck"
      onClick={() => void refresh()}
      disabled={checking}
    >
      {checking ? (
        <LoaderCircle size={15} aria-hidden="true" className="setup-spin" />
      ) : (
        <RefreshCw size={15} aria-hidden="true" />
      )}
      {checking ? t.rechecking : t.recheck}
    </button>
  );

  const row = (check: DoctorCheck) => {
    const label = t.labels[check.id];
    const detail =
      check.detail && userDetails.includes(check.id)
        ? maskUser(check.detail)
        : check.detail;
    const folder =
      check.id === "data-dir" && typeof check.params?.path === "string"
        ? maskPath(check.params.path)
        : undefined;
    const shown =
      !summary && (fixes === "all" || needsAttention(check)) ? (check.fixes ?? []) : [];
    return (
      <li
        key={check.id}
        className={`setup-check setup-check-${check.status}`}
        data-check={check.id}
      >
        <span className="setup-check-icon">{icons[check.status]}</span>
        <div className="setup-check-body">
          <div className="setup-check-head">
            <strong>{label}</strong>
            {check.required && !summary && (
              <span className="setup-check-required">{t.required}</span>
            )}
            {check.version && !summary && (
              <code className="setup-check-version">{check.version}</code>
            )}
            <span className="setup-check-status">{t.status[check.status]}</span>
          </div>
          {detail && <p className="setup-check-detail">{detail}</p>}
          {folder && !summary && (
            <p className="setup-check-detail">{t.dataDir({ path: folder })}</p>
          )}
          {shown.length > 0 && (
            <div className="setup-check-fixes">
              <span>{t.fixesTitle}</span>
              {shown.map((fix) => (
                <CopyCommand
                  key={`${fix.label}\n${fix.command}`}
                  label={fix.label}
                  command={fix.command}
                />
              ))}
            </div>
          )}
        </div>
      </li>
    );
  };

  const loadingRows = doctorCheckIds.map((id) => (
    <li key={id} className="setup-check setup-check-checking" data-check={id}>
      <span className="setup-check-icon">
        <LoaderCircle size={18} aria-hidden="true" className="setup-spin" />
      </span>
      <div className="setup-check-body">
        <div className="setup-check-head">
          <strong>{t.labels[id]}</strong>
          <span className="setup-check-status">{t.rechecking}</span>
        </div>
      </div>
    </li>
  ));

  const failing = report
    ? report.checks.filter((check) => check.required && check.status === "fail")
    : [];
  const attention = report ? report.checks.filter(needsAttention) : [];
  const overall = !report
    ? t.checking
    : failing.length
      ? t.summaryNotReady({ count: failing.length })
      : attention.length
        ? t.summaryWarnings({ count: attention.length })
        : t.summaryReady;

  return (
    <section
      className={`setup-checklist${summary ? " setup-checklist-summary" : ""}`}
      aria-busy={checking || !report}
    >
      <div className="setup-checklist-head">
        <p
          className={`setup-checklist-overall${report && !report.ready ? " not-ready" : ""}`}
          role="status"
          aria-live="polite"
        >
          {overall}
        </p>
        {recheck}
      </div>
      {error && (
        <p className="setup-checklist-error" role="alert">
          {t.loadFailed({ message: error })}
        </p>
      )}
      {(!summary || attention.length > 0 || !report) && (
        <ul className="setup-checks">
          {report
            ? (summary ? attention : report.checks).map(row)
            : summary
              ? null
              : loadingRows}
        </ul>
      )}
      {report && !summary && (
        <p className="setup-checklist-time">
          {t.checkedAt({ time: format.time(report.checkedAt) })}
        </p>
      )}
      {summary && detailsHref && (
        <a className="setup-checklist-link" href={detailsHref}>
          {t.openDetails}
        </a>
      )}
    </section>
  );
}
