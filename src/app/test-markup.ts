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

/**
 * Drops every element whose opening tag contains `marker`, with everything
 * inside it. Tests use it for a panel that another part of the UI owns and
 * tests in English itself.
 */
export function withoutElement(html: string, marker: string): string {
  let result = html;
  for (let at = result.indexOf(marker); at >= 0; at = result.indexOf(marker)) {
    const start = result.lastIndexOf("<", at);
    const name = /^<(\w+)/.exec(result.slice(start))?.[1];
    if (!name) break;
    const tags = new RegExp(`<(/?)${name}\\b[^>]*>`, "g");
    tags.lastIndex = start;
    let depth = 0;
    let end = -1;
    for (let tag = tags.exec(result); tag; tag = tags.exec(result)) {
      depth += tag[1] ? -1 : 1;
      if (depth === 0) {
        end = tag.index + tag[0].length;
        break;
      }
    }
    if (end < 0) break;
    result = result.slice(0, start) + result.slice(end);
  }
  return result;
}
