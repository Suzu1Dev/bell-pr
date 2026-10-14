import { htmlLang, locales, parseLocale } from "../../shared/i18n/locale";
import { useLocale, useT } from "./index";

/**
 * Chooses the UI language. Each option shows the language's own name and is
 * tagged with that language for screen readers. Switching takes effect
 * without a reload and is remembered (see `setLocale`).
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
        if (next && next !== locale) setLocale(next);
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
