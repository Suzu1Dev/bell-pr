import type { Locale } from "../../../shared/i18n/locale";
import { useLocale } from "../../i18n";
import en from "./en";
import zhTW from "./zh-TW";

const dictionaries: Record<Locale, typeof en> = { en, "zh-TW": zhTW };

/** The review panel's module-local strings (./en.ts) in the current locale. */
export function usePanelStrings() {
  return dictionaries[useLocale()[0]];
}
