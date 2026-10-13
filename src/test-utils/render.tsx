/**
 * Render helpers for UI unit tests (node:test). They render to static HTML
 * through a LocaleProvider with a fixed dictionary, so a test picks its locale
 * explicitly and never depends on, or changes, the app's active locale.
 */
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "../../shared/i18n/locale";
import { LocaleProvider, type Messages } from "../i18n";
import en from "../i18n/en";
import zhTW from "../i18n/zh-TW";

const dictionaries: Record<Locale, Messages> = { en, "zh-TW": zhTW };

/** Renders `element` in `locale`, synchronously. */
export function renderWith(locale: Locale, element: ReactElement): string {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} messages={dictionaries[locale]}>
      {element}
    </LocaleProvider>,
  );
}

/** Renders in zh-TW, which keeps the legacy zh-TW assertions valid. */
export function renderZh(element: ReactElement): string {
  return renderWith("zh-TW", element);
}

/** Renders in English; pair it with `assertNoHan` for new or changed UI. */
export function renderEn(element: ReactElement): string {
  return renderWith("en", element);
}

// The same characters scripts/check-i18n.mjs reports: Han (by script
// extension, so marks such as the ideographic comma count) and the CJK
// punctuation and full-width blocks, U+3000-303F and U+FF00-FFEF.
const cjk = /[\p{Script_Extensions=Han}\u3000-\u303F\uFF00-\uFFEF]/u;

/**
 * Fails when `text` contains Han characters or CJK punctuation, which means
 * that untranslated zh-TW text reached an English render. The message shows
 * where the first one is.
 */
export function assertNoHan(text: string): void {
  const match = cjk.exec(text);
  if (!match) return;
  const start = Math.max(0, match.index - 40);
  const context = text.slice(start, match.index + 40).replace(/\s+/g, " ");
  const codePoint = match[0].codePointAt(0)!.toString(16).toUpperCase();
  assert.fail(
    `Expected no Han characters or CJK punctuation, found "${match[0]}" (U+${codePoint.padStart(4, "0")}) at index ${match.index}: …${context}…`,
  );
}
