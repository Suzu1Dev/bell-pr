import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  Cpu,
  Gauge,
  GraduationCap,
  HardDrive,
  Info,
  KeyRound,
  Languages,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { AppSettingsView } from "../../shared/app-settings";
import type { LicenseSummary } from "../../shared/plans";
import { api } from "../api";
import type { Page, Tab } from "../app/AppShell";
import type { Status } from "../app/hooks/useAppData";
import { usePresentation } from "../app/presentation";
import { useT } from "../i18n";
import { useEntitlements } from "../license/useEntitlements";
import { serializeRoute, useHashRoute, type RouteFlags } from "../navigation/route";
import type { DoctorState } from "../setup/useDoctor";
import { AboutSection } from "./AboutSection";
import { DataSection } from "./DataSection";
import { EnvironmentSection } from "./EnvironmentSection";
import { GeneralSection } from "./GeneralSection";
import { LearningSection } from "./LearningSection";
import { LicenseSection } from "./LicenseSection";
import { PerformanceSection, type StatusLimits } from "./PerformanceSection";
import { ProviderSection } from "./ProviderSection";
import { SafetySection } from "./SafetySection";
import { parseSection, settingsSections, type SettingsSection } from "./sections";
import { useAppSettings } from "./useAppSettings";
import "./settings.css";

interface SettingsPageProps {
  status: Status | null;
  setStatus: Dispatch<SetStateAction<Status | null>>;
  setApiError: Dispatch<SetStateAction<string>>;
  setTab: Dispatch<SetStateAction<Tab>>;
  navigate: (value: Page) => void;
  /**
   * The shell's environment report, which the readiness pill also shows,
   * so a re-check here updates both. The shell probes it again while the
   * environment section shows.
   */
  doctor: DoctorState;
  /**
   * Receives the app settings after a section saved them, so a copy kept
   * elsewhere (the shell's, for the sample project) can follow.
   */
  onAppSettingsSaved?: (view: AppSettingsView) => void;
}

/** What GET /api/status also reports besides the `Status` fields. */
type SettingsStatus = Status & { license?: LicenseSummary; limits?: StatusLimits };

const icons: Record<SettingsSection, LucideIcon> = {
  general: Languages,
  provider: Cpu,
  safety: ShieldCheck,
  learning: GraduationCap,
  performance: Gauge,
  environment: Wrench,
  data: HardDrive,
  license: KeyRound,
  about: Info,
};

/** The address of a settings section, keeping the presentation flags. */
export function sectionHref(section: SettingsSection, flags?: RouteFlags): string {
  return serializeRoute({ name: "settings", section, ...(flags ? { flags } : {}) });
}

/**
 * The Settings page: a list of sections, each at `#/settings/<section>`
 * (General when the address names none), and the section it shows. The
 * environment report (the shell's) and the app settings are shared by the
 * sections; while presenting (`present=1`), the GitHub login, account
 * details, the licensee and paths are masked.
 */
export function SettingsPage({
  status,
  setStatus,
  setApiError,
  setTab,
  navigate,
  doctor,
  onAppSettingsSaved,
}: SettingsPageProps) {
  const t = useT("settings");
  const route = useHashRoute();
  const flags = route?.flags;
  const section = parseSection(route?.name === "settings" ? route.section : undefined);
  const { maskUser, maskPath } = usePresentation();
  const settings = useAppSettings(onAppSettingsSaved);
  const full = status as SettingsStatus | null;
  const { entitlements, locked } = useEntitlements(full);
  const { refresh } = doctor;

  // The sidebar and the run limits read GET /api/status, which shares the
  // doctor's latest probe.
  const reloadStatus = useCallback(async () => {
    try {
      setStatus(await api<Status>("/status"));
      setApiError("");
    } catch {
      // The connection banner and the checklist report failures already.
    }
  }, [setStatus, setApiError]);
  const recheck = useCallback(async () => {
    await refresh();
    await reloadStatus();
  }, [refresh, reloadStatus]);
  const showCurrentRun = useCallback(() => {
    setTab("activity");
    navigate("workspace");
  }, [setTab, navigate]);

  let content;
  switch (section) {
    case "provider":
      content = (
        <ProviderSection
          doctor={doctor}
          maskUser={maskUser}
          maskPath={maskPath}
          showCurrentRun={showCurrentRun}
        />
      );
      break;
    case "safety":
      content = (
        <SafetySection
          doctor={doctor}
          settings={settings}
          maskUser={maskUser}
          webAccessLocked={locked("webAccess")}
          providerHref={sectionHref("provider", flags)}
        />
      );
      break;
    case "learning":
      content = <LearningSection settings={settings} />;
      break;
    case "performance":
      content = (
        <PerformanceSection
          settings={settings}
          limits={full?.limits}
          entitlements={entitlements}
          onSaved={() => void reloadStatus()}
        />
      );
      break;
    case "environment":
      content = (
        <EnvironmentSection
          doctor={doctor}
          refresh={recheck}
          maskUser={maskUser}
          maskPath={maskPath}
        />
      );
      break;
    case "data":
      content = <DataSection doctor={doctor} settings={settings} maskPath={maskPath} />;
      break;
    case "license":
      content = <LicenseSection status={full} maskUser={maskUser} maskPath={maskPath} />;
      break;
    case "about":
      content = (
        <AboutSection aboutHref={serializeRoute({ name: "about", ...(flags ? { flags } : {}) })} />
      );
      break;
    default:
      content = <GeneralSection settings={settings} />;
  }

  return (
    <section className="page-content settings-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h1 tabIndex={-1}>{t.title}</h1>
          <p>{t.intro}</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t.nav.label}>
          <ul>
            {settingsSections.map((id) => {
              const Icon = icons[id];
              return (
                <li key={id}>
                  <a
                    href={sectionHref(id, flags)}
                    aria-current={id === section ? "page" : undefined}
                    data-section={id}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span>{t.sections[id]}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="settings-panel">
          {settings.error && !settings.view && (
            <div className="settings-load-error" role="alert">
              <p>{t.state.loadFailed({ message: settings.error })}</p>
              <button
                type="button"
                className="button secondary"
                onClick={() => void settings.reload()}
              >
                {t.state.retry}
              </button>
            </div>
          )}
          {content}
        </div>
      </div>
    </section>
  );
}
