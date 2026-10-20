import type { Locale } from "../shared/i18n/locale.js";
import { buildLearningExport } from "../shared/learning-export.js";
import { currentLocale } from "./i18n/index.js";
import type { Repository, Run } from "./types.js";

/**
 * The Markdown learning record for one run; see shared/learning-export.ts.
 * The export route calls it without a locale, so the record's headings
 * follow the request's locale (`X-Bell-Locale`, then `?locale=`).
 */
export function learningExport(
  run: Run,
  repo?: Repository,
  locale: Locale = currentLocale(),
): string {
  return buildLearningExport(run, repo, locale);
}
