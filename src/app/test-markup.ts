/**
 * Helpers for UI tests that check a whole English render for untranslated
 * text with `assertNoHan`. Only tests import this module.
 */

/**
 * Drops elements tagged with another language, such as the language
 * switcher's own-script language names, which every locale shows as they are.
 */
export function withoutOtherLanguages(html: string): string {
  return html.replace(
    /<(\w+)\b[^>]*\slang="(?!en["-])[^"]*"[^>]*>[^<]*<\/\1>/g,
    "",
  );
}
