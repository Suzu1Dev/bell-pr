/**
 * The text a locale needs besides the English that comes with the app,
 * loaded on demand: its dictionary (src/i18n loads it) and the sample
 * project's text, which loadDemo() registers. Each locale's file holds
 * both (./zh-TW.ts), so one request serves them.
 */
import type { Locale } from "../../shared/i18n/locale";
import { registerDemo } from "../demo";

const files: Record<
  Exclude<Locale, "en">,
  () => Promise<typeof import("./zh-TW")>
> = {
  "zh-TW": () => import("./zh-TW"),
};

/**
 * Loads the sample project's text in `locale` (English comes with the
 * app); main.tsx has it run with every locale load.
 */
export async function loadDemo(locale: Locale): Promise<void> {
  if (locale === "en") return;
  const file = files[locale];
  if (!file) throw new Error(`Unsupported locale: ${String(locale)}`);
  registerDemo(locale, (await file()).demo);
}
