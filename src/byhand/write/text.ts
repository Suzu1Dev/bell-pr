import type { Formatters } from "../../../shared/i18n/locale";
import { useLocale } from "../../i18n";
import en from "./i18n/en";
import zhTW from "./i18n/zh-TW";

/** The writing views' copy in the UI language (module-local, DESIGN v1.2 §11.1). */
export const useWriteText = () => (useLocale()[0] === "zh-TW" ? zhTW : en);

/** How long ago `at` was, in minutes, hours or days ("2 minutes ago"). */
export function ago(fmt: Formatters, at: string, now = Date.now()) {
  const minutes = Math.round((Date.parse(at) - now) / 60_000);
  if (Math.abs(minutes) < 60) return fmt.relative(minutes, "minute");
  return Math.abs(minutes) < 1440 ? fmt.relative(Math.round(minutes / 60), "hour") : fmt.relative(Math.round(minutes / 1440), "day");
}
