import type { AppSettings } from "../../shared/app-settings";
import { eulaVersion } from "../../shared/product";

/**
 * Whether the person still has to accept the current license agreement:
 * never accepted, or accepted an older version (`eulaVersion` changed).
 */
export function needsEulaAcceptance(
  settings: Pick<AppSettings, "eulaAcceptedVersion"> | null | undefined,
): boolean {
  return settings?.eulaAcceptedVersion !== eulaVersion;
}
