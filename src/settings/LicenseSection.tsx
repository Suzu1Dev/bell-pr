import type { LicenseSummary } from "../../shared/plans";
import { useT } from "../i18n";
import { LicenseCard } from "../license/LicenseCard";
import { SettingsSectionFrame } from "./controls";

/**
 * License: the plan, the licensee and the key or trial controls. The
 * licensee's name and e-mail are masked while presenting.
 */
export function LicenseSection({
  status,
  maskUser,
  maskPath,
}: {
  status: { license?: LicenseSummary } | null;
  maskUser: (value: string) => string;
  maskPath: (value: string) => string;
}) {
  const t = useT("settings").license;
  return (
    <SettingsSectionFrame section="license" title={t.title} intro={t.intro}>
      <LicenseCard status={status} maskUser={maskUser} maskPath={maskPath} />
    </SettingsSectionFrame>
  );
}
