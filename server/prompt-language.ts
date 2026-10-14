/**
 * The language agents write in. Prompts stay in English; these helpers are
 * the only place that names the output language, so every prompt follows
 * the run's or the request's locale the same way. PR titles and bodies
 * follow the target project's rules instead (English unless they say
 * otherwise), so they do not use these helpers.
 */
import type { Locale } from "../shared/i18n/locale.js";

const languages: Record<Locale, string> = {
  en: "English",
  "zh-TW": "Traditional Chinese (Taiwan usage)",
};

/** The output language's name as prompts use it. */
export function outputLanguage(locale: Locale): string {
  return languages[locale];
}

/** The directive that asks an agent to answer in `locale`'s language. */
export function respondIn(locale: Locale): string {
  return `Respond in ${outputLanguage(locale)}.`;
}

const lengthHints: Record<
  Locale,
  (limits: { words: number; chars: number }) => string
> = {
  en: ({ words }) => `at most ${words} ${words === 1 ? "word" : "words"}`,
  "zh-TW": ({ chars }) =>
    `at most ${chars} Chinese ${chars === 1 ? "character" : "characters"}`,
};

/**
 * A length limit for a short field, counted the way the language is
 * written: words in English, characters in Chinese. For example
 * `lengthHint(locale, {words: 8, chars: 25})`.
 */
export function lengthHint(
  locale: Locale,
  limits: { words: number; chars: number },
): string {
  return lengthHints[locale](limits);
}

const parentheticalTerms: Record<Locale, string> = {
  en: "",
  "zh-TW": " (English terms in parentheses)",
};

/**
 * Asks for the English technical term in parentheses after a translated
 * one, which only matters outside English. The clause starts with a space
 * and is empty in English, so append it directly after the noun it
 * qualifies: `keywords${termsInParentheses(locale)}`.
 */
export function termsInParentheses(locale: Locale): string {
  return parentheticalTerms[locale];
}
