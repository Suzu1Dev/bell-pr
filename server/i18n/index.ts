/**
 * Server messages in the locale in effect. Each request runs under its own
 * locale (the middleware in app.ts reads X-Bell-Locale, then ?locale=), and
 * background work runs under `withLocale(run.locale ?? currentLocale(), ...)`.
 * Code reads text through `sm()` and never branches on it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  defaultLocale,
  parseLocale,
  type Locale,
  type Translation,
} from "../../shared/i18n/locale.js";
import en from "./en/index.js";
import zhTW from "./zh-TW/index.js";

/**
 * Every server message by namespace, as both dictionaries satisfy it:
 * strings, and message functions that return a string.
 */
export type ServerMessages = Translation<typeof en>;

const dictionaries: Record<Locale, ServerMessages> = { en, "zh-TW": zhTW };

const scopedLocale = new AsyncLocalStorage<Locale>();
let defaultLocaleSource: (() => Locale | undefined) | undefined;

/** Runs `fn`, and all async work it starts, under `locale`. */
export function withLocale<T>(locale: Locale, fn: () => T): T {
  return scopedLocale.run(locale, fn);
}

/**
 * Sets where the default locale comes from when no request or job chose
 * one, such as the language saved in the app settings. Call it without an
 * argument to remove the source.
 */
export function setDefaultLocaleSource(fn?: () => Locale | undefined): void {
  defaultLocaleSource = fn;
}

function sourcedLocale(): Locale | undefined {
  try {
    return parseLocale(defaultLocaleSource?.());
  } catch {
    // An unreadable setting must not break every message; use the next source.
    return undefined;
  }
}

/**
 * The locale in effect. First match wins: the `withLocale` scope (the
 * request's locale), the default-locale source, `BELLPR_LOCALE`, then en.
 */
export function currentLocale(): Locale {
  return (
    scopedLocale.getStore() ??
    sourcedLocale() ??
    parseLocale(process.env.BELLPR_LOCALE) ??
    defaultLocale
  );
}

/** The server messages for `currentLocale()`. */
export function sm(): ServerMessages {
  return dictionaries[currentLocale()];
}

/** The message for cancelled work, used with status 409. */
export function cancelled(): string {
  return sm().common.cancelled;
}

/** The message for work refused while the server shuts down, used with 503. */
export function shuttingDown(): string {
  return sm().common.shuttingDown;
}
