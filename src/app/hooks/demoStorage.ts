import type { Locale } from "../../../shared/i18n/locale";
import {
  defaultContributionSettings,
  type ContributionSettings,
} from "../../../shared/insights";
import { getDemo } from "../../demo";
import type { Run } from "../../types";

// The demo keeps the reader's review progress, draft and direction settings
// in this browser, one copy per locale, since the demo's text differs by
// locale. Storage can be blocked or full: every read and write is guarded,
// and the demo then simply starts fresh.

/** localStorage key of the demo run's progress in `locale`. */
export const demoRunKey = (locale: Locale) => `bellpr-demo-run:${locale}`;
/** localStorage key of the demo's direction settings in `locale`. */
export const demoSettingsKey = (locale: Locale) =>
  `bellpr-demo-settings:${locale}`;

function read(key: string): unknown {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(key) || "null");
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered after a reload; the current session still works.
  }
}

/** The demo run in `locale`, with the review progress and draft kept for it. */
export function loadDemo(locale: Locale): Run {
  const { run, team } = getDemo(locale);
  const fresh: Run = { ...run, team: structuredClone(team) };
  const saved = read(demoRunKey(locale)) as Partial<Run> | null;
  if (saved?.id !== run.id) return fresh;
  return {
    ...fresh,
    reviewedFiles: Array.isArray(saved.reviewedFiles) ? saved.reviewedFiles : [],
    draft: saved.draft || run.draft,
    status: saved.status === "approved" ? "approved" : "review",
  };
}

/** Remembers the demo run's progress for `locale`. */
export function saveDemo(locale: Locale, run: Run) {
  write(demoRunKey(locale), run);
}

/** The demo's direction settings in `locale`, over the defaults. */
export function loadDemoSettings(locale: Locale): ContributionSettings {
  const saved = read(demoSettingsKey(locale));
  return {
    ...defaultContributionSettings,
    ...(saved && typeof saved === "object" && !Array.isArray(saved)
      ? saved
      : {}),
  };
}

/** Remembers the demo's direction settings for `locale`. */
export function saveDemoSettings(
  locale: Locale,
  settings: ContributionSettings,
) {
  write(demoSettingsKey(locale), settings);
}
