import {
  htmlLang,
  locales,
  parseLocale,
  type Locale,
} from "../../shared/i18n/locale";
import { api, send } from "../api";
import { currentRoute, navigate } from "../navigation/route";
import { useLocale, useT } from "./index";

/**
 * Saves `locale` in the app settings, so work the server does on its own
 * (recovery, queued runs, cleanup, the command line) uses it too. Saving is
 * best effort: a failure (the demo, before sign-in) changes nothing.
 */
export function saveLocale(locale: Locale) {
  api("/app-settings", send("PUT", { locale })).catch(() => {
    // The UI language is what the person sees either way.
  });
}

/**
 * Switches the UI to `next` with `change` (the setter from useLocale), then
 * saves it in the app settings (see `saveLocale`). A `locale=` flag in the
 * address (from a shared or presentation link) goes, so a reload keeps the
 * language the person chose; the other flags stay.
 */
export function chooseLocale(next: Locale, change: (locale: Locale) => void) {
  change(next);
  saveLocale(next);
  const route = currentRoute();
  if (route?.flags && "locale" in route.flags) {
    const { locale: _flag, ...flags } = route.flags;
    navigate({ ...route, flags }, { replace: true });
  }
}

/**
 * Chooses the UI language. Each option shows the language's own name and is
 * tagged with that language for screen readers. Switching takes effect
 * without a reload, is remembered (see `setLocale`) and is saved in the app
 * settings (see `chooseLocale`).
 */
export function LanguageSwitcher({
  id,
  className,
}: {
  id?: string;
  className?: string;
}) {
  const [locale, setLocale] = useLocale();
  const t = useT("common");
  return (
    <select
      id={id}
      className={className}
      aria-label={t.language.label}
      value={locale}
      onChange={(event) => {
        const next = parseLocale(event.target.value);
        if (next && next !== locale) chooseLocale(next, setLocale);
      }}
    >
      {locales.map((option) => (
        <option key={option} value={option} lang={htmlLang(option)}>
          {t.languageNames[option]}
        </option>
      ))}
    </select>
  );
}
