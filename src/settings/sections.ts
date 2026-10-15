/**
 * The sections of the Settings page, in the order the page lists them.
 * Each one has its own address, `#/settings/<section>`.
 */
export const settingsSections = [
  "general",
  "provider",
  "safety",
  "learning",
  "performance",
  "environment",
  "data",
  "license",
  "about",
] as const;

export type SettingsSection = (typeof settingsSections)[number];

/** The section an address names; `#/settings` and unknown names show General. */
export function parseSection(value: string | undefined): SettingsSection {
  return settingsSections.find((section) => section === value) ?? "general";
}
