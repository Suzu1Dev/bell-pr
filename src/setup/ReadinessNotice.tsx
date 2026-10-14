import { useEffect } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import type { DoctorCheck, DoctorCheckId, DoctorReport } from "../../shared/doctor";
import type { Fix } from "../../shared/errors";
import { useT } from "../i18n";
import { CopyCommand } from "./CopyCommand";
import { useDoctor, type DoctorState } from "./useDoctor";
import "./setup.css";

/** What an action can require of the environment. */
export type Requirement = "provider" | "gh" | "git-identity";

/** The checks behind each requirement, and the states that satisfy them. */
const requirementChecks: Record<
  Requirement,
  { id: DoctorCheckId; ready: (check: DoctorCheck) => boolean }[]
> = {
  provider: [{ id: "provider-ready", ready: (check) => check.status === "ok" }],
  gh: [
    { id: "gh", ready: (check) => check.status === "ok" },
    { id: "gh-auth", ready: (check) => check.status === "ok" },
    // An unknown scope set (fine-grained token) is not a refusal.
    { id: "gh-scopes", ready: (check) => check.status !== "fail" },
  ],
  // A guessed e-mail address still commits; the checklist warns about it.
  "git-identity": [
    {
      id: "git-identity",
      ready: (check) => check.status === "ok" || check.status === "warn",
    },
  ],
};

export interface Readiness {
  /** Every requirement is met. False while the report is loading. */
  ready: boolean;
  /** No report yet. */
  checking: boolean;
  /** The requirements that are not met, each with the checks that fail it. */
  missing: { requirement: Requirement; checks: DoctorCheck[] }[];
}

/** Whether `report` meets `requires`; demo actions skip this with `bypass`. */
export function readinessOf(
  report: DoctorReport | null,
  requires: readonly Requirement[],
): Readiness {
  if (!report) return { ready: false, checking: true, missing: [] };
  const missing = requires.flatMap((requirement) => {
    const failing = requirementChecks[requirement].flatMap(({ id, ready }) => {
      const check = report.checks.find((value) => value.id === id);
      // A check the server does not report blocks nothing.
      return !check || ready(check) ? [] : [check];
    });
    return failing.length ? [{ requirement, checks: failing }] : [];
  });
  return { ready: !missing.length, checking: false, missing };
}

/** The fixes of the failing checks, without repeats. */
function fixesOf(checks: DoctorCheck[]): Fix[] {
  const seen = new Set<string>();
  return checks
    .flatMap((check) => check.fixes ?? [])
    .filter((fix) => {
      const key = `${fix.label}\n${fix.command}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export interface ReadinessNoticeProps {
  requires: readonly Requirement[];
  /**
   * Skips the check: renders nothing and reports ready. Demo actions pass
   * `bypass={isDemo}`, since the sample project needs no tools.
   */
  bypass?: boolean;
  /** A useDoctor() state to share; the notice loads its own otherwise. */
  doctor?: DoctorState;
  /** Told whether the requirements are met, for example to disable a button. */
  onReadyChange?: (ready: boolean) => void;
  /** Masks the account names that check details may contain. */
  maskUser?: (value: string) => string;
}

/**
 * Says why an action is unavailable and how to fix it, inline next to the
 * action: the requirement, what the environment check found and the
 * commands to run. Renders nothing when everything is ready.
 */
export function ReadinessNotice({
  requires,
  bypass = false,
  doctor,
  onReadyChange,
  maskUser = (value) => value,
}: ReadinessNoticeProps) {
  const own = useDoctor({ enabled: !bypass && !doctor });
  const state = doctor ?? own;
  const readiness = bypass
    ? { ready: true, checking: false, missing: [] }
    : readinessOf(state.report, requires);
  useEffect(() => {
    onReadyChange?.(readiness.ready);
  }, [onReadyChange, readiness.ready]);
  return (
    <ReadinessMessage
      readiness={readiness}
      error={bypass ? "" : state.error}
      maskUser={maskUser}
    />
  );
}

/** The notice for a computed readiness; ReadinessNotice renders it. */
export function ReadinessMessage({
  readiness,
  error = "",
  maskUser = (value) => value,
}: {
  readiness: Readiness;
  error?: string;
  maskUser?: (value: string) => string;
}) {
  const t = useT("setup");
  if (readiness.ready) return null;
  if (readiness.checking)
    return (
      <div className="readiness-notice readiness-checking" role="status">
        <LoaderCircle size={16} aria-hidden="true" className="setup-spin" />
        <span>{error ? t.checklist.loadFailed({ message: error }) : t.readiness.checking}</span>
      </div>
    );
  return (
    <div className="readiness-notice" role="status">
      <TriangleAlert size={16} aria-hidden="true" />
      <div className="readiness-body">
        {readiness.missing.map(({ requirement, checks }) => (
          <div key={requirement} className="readiness-item">
            <p className="readiness-reason">
              <strong>{t.readiness[requirement]}</strong>
              <span>{t.readiness.unavailable}</span>
            </p>
            {checks
              .filter((check) => check.detail)
              .map((check) => (
                <p key={check.id} className="readiness-detail">
                  {t.readiness.detail({
                    check: t.checklist.labels[check.id],
                    detail:
                      check.id === "gh-auth" || check.id === "git-identity"
                        ? maskUser(check.detail!)
                        : check.detail!,
                  })}
                </p>
              ))}
            {fixesOf(checks).map((fix) => (
              <CopyCommand
                key={`${fix.label}\n${fix.command}`}
                label={fix.label}
                command={fix.command}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
