import { GitPullRequest } from "lucide-react";
import type { DoctorReport } from "../../shared/doctor";
import { productLink } from "../../shared/product";
import { useT } from "../i18n";
import { SetupChecklist } from "../setup/SetupChecklist";
import type { DoctorState } from "../setup/useDoctor";
import { SettingsGroup, SettingsSectionFrame, StatusChip } from "./controls";
import type { CliState } from "./ProviderSection";

/** The GitHub CLI's state and the account it is signed in to. */
export function githubState(report: DoctorReport | null): {
  state: Exclude<CliState, "ready"> | "connected";
  login?: string;
} {
  if (!report) return { state: "checking" };
  const gh = report.checks.find((check) => check.id === "gh");
  const auth = report.checks.find((check) => check.id === "gh-auth");
  // The doctor reports a missing GitHub CLI as a warning, not a skip.
  if (!gh || gh.status === "skip" || gh.reason === "missing")
    return { state: "missing" };
  if (gh.status !== "ok") return { state: "notWorking" };
  if (auth?.status !== "ok") return { state: "signedOut" };
  const login = auth.params?.login ?? auth.detail;
  return { state: "connected", ...(login ? { login: String(login) } : {}) };
}

/**
 * Environment: the GitHub connection, the full environment checklist with
 * the fixes of the checks that need them, and the environment variables
 * that fix settings, under an Advanced disclosure.
 */
export function EnvironmentSection({
  doctor,
  refresh,
  maskUser,
  maskPath,
}: {
  doctor: DoctorState;
  /** Probes again (GET /api/doctor?refresh=1) and reloads the status. */
  refresh: () => unknown;
  maskUser: (value: string) => string;
  maskPath: (value: string) => string;
}) {
  const t = useT("settings");
  const e = t.environment;
  const docsUrl = productLink("docsUrl");
  const github = githubState(doctor.report);
  return (
    <SettingsSectionFrame section="environment" title={e.title} intro={e.intro}>
      <SettingsGroup className="settings-github">
        <div className="settings-service">
          <div className="service-icon">
            <GitPullRequest size={24} aria-hidden="true" />
          </div>
          <div>
            <h3>{e.github.title}</h3>
            <p>
              {github.login
                ? e.github.connectedAs({ user: maskUser(github.login) })
                : e.github.description}
            </p>
          </div>
          <StatusChip
            text={github.state === "connected" ? t.status.connected : t.status[github.state]}
            good={github.state === "connected"}
          />
        </div>
      </SettingsGroup>
      <SettingsGroup>
        <SetupChecklist
          report={doctor.report}
          checking={doctor.checking}
          error={doctor.error}
          refresh={refresh}
          maskUser={maskUser}
          maskPath={maskPath}
        />
      </SettingsGroup>
      <details className="settings-advanced">
        <summary>{e.advanced.summary}</summary>
        <p>
          {e.advanced.text}
          {docsUrl && (
            <>
              {" "}
              <a href={docsUrl} target="_blank" rel="noreferrer">
                {e.advanced.documentation}
              </a>
            </>
          )}
        </p>
        <dl>
          {Object.entries(e.advanced.variables).map(([variable, text]) => (
            <div key={variable}>
              <dt>
                <code>{variable}</code>
              </dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </details>
    </SettingsSectionFrame>
  );
}
