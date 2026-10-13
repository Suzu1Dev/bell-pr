/**
 * Supported UI locales and the locale-aware formatting helpers that the
 * client and the server share. Code never hard-codes a locale tag or list
 * punctuation; it asks these helpers instead.
 */

export const locales = ["en", "zh-TW"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

/**
 * Maps a language tag to a supported locale, case-insensitively: `en` and
 * any `en-*` tag give "en"; `zh-TW`, `zh-Hant*`, `zh-HK` and `zh-MO` give
 * "zh-TW". POSIX forms such as `zh_TW.UTF-8` are accepted too. Anything else
 * (zh-CN, zh-Hans, ja, non-strings) gives undefined, so callers fall back to
 * the next source.
 */
export function parseLocale(value: unknown): Locale | undefined {
  if (typeof value !== "string") return undefined;
  const tag = value
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[.@].*$/, "");
  if (/^en(?:-|$)/.test(tag)) return "en";
  if (/^zh-(?:tw|hant|hk|mo)(?:-|$)/.test(tag)) return "zh-TW";
  return undefined;
}

/** The `<html lang>` value: Traditional Chinese is tagged by script. */
export function htmlLang(locale: Locale): string {
  return locale === "zh-TW" ? "zh-Hant-TW" : "en";
}

/** The tag passed to the `Intl` constructors. */
export function intlLocale(locale: Locale): string {
  return locale === "zh-TW" ? "zh-TW" : "en-US";
}

/** A date as a Date, epoch milliseconds or an ISO string. */
export type DateInput = Date | number | string;

export interface Formatters {
  number(value: number, options?: Intl.NumberFormatOptions): string;
  /** Calendar date (medium style by default). */
  date(value: DateInput, options?: Intl.DateTimeFormatOptions): string;
  /** Hours and minutes; 24-hour clock in zh-TW. */
  time(value: DateInput, options?: Intl.DateTimeFormatOptions): string;
  /** Medium date and short time; 24-hour clock in zh-TW. */
  dateTime(value: DateInput, options?: Intl.DateTimeFormatOptions): string;
  /** For example `relative(-1, "day")` is "yesterday". */
  relative(value: number, unit: Intl.RelativeTimeFormatUnit): string;
  /** Joins items with the locale's separators, as in "a, b, and c". */
  list(
    items: readonly string[],
    options?: { type?: "conjunction" | "unit" },
  ): string;
  /** The plural category of `n`, to pick a message variant. */
  plural(n: number): Intl.LDMLPluralRule;
}

const memo = new Map<Locale, Formatters>();

/**
 * Formatters for one locale. Options passed to a date formatter replace its
 * default fields; zh-TW still uses the 24-hour clock unless the options set
 * `hour12` or `hourCycle`. An invalid date returns the raw input (a string
 * or number as given, "" for an invalid Date object), never "Invalid Date".
 */
export function formatters(locale: Locale): Formatters {
  const existing = memo.get(locale);
  if (existing) return existing;
  const tag = intlLocale(locale);
  // Intl objects are costly to build; keep one per kind and options.
  const instances = new Map<string, unknown>();
  function instance<T>(kind: string, options: object, create: () => T): T {
    const key = `${kind}:${JSON.stringify(options)}`;
    if (!instances.has(key)) instances.set(key, create());
    return instances.get(key) as T;
  }
  function clock(options: Intl.DateTimeFormatOptions) {
    const keepCaller =
      locale !== "zh-TW" ||
      options.hour12 !== undefined ||
      options.hourCycle !== undefined;
    return keepCaller ? options : { ...options, hour12: false };
  }
  function formatDate(value: DateInput, options: Intl.DateTimeFormatOptions) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()))
      return value instanceof Date ? "" : String(value);
    const format = instance(
      "date",
      options,
      () => new Intl.DateTimeFormat(tag, options),
    );
    return format.format(date);
  }
  const result: Formatters = {
    number(value, options = {}) {
      const format = instance(
        "number",
        options,
        () => new Intl.NumberFormat(tag, options),
      );
      return format.format(value);
    },
    date(value, options) {
      return formatDate(value, options ?? { dateStyle: "medium" });
    },
    time(value, options) {
      return formatDate(
        value,
        clock(
          options ?? {
            hour: locale === "zh-TW" ? "2-digit" : "numeric",
            minute: "2-digit",
          },
        ),
      );
    },
    dateTime(value, options) {
      return formatDate(
        value,
        clock(options ?? { dateStyle: "medium", timeStyle: "short" }),
      );
    },
    relative(value, unit) {
      const format = instance(
        "relative",
        {},
        () => new Intl.RelativeTimeFormat(tag, { numeric: "auto" }),
      );
      return format.format(value, unit);
    },
    list(items, options = {}) {
      const type = options.type ?? "conjunction";
      const format = instance(
        "list",
        { type },
        () => new Intl.ListFormat(tag, { type, style: "long" }),
      );
      return format.format(items);
    },
    plural(n) {
      return instance("plural", {}, () => new Intl.PluralRules(tag)).select(n);
    },
  };
  memo.set(locale, result);
  return result;
}

/**
 * The type a translation must have to match the English dictionary `T`:
 * strings become `string`, functions keep their parameter types and return a
 * string, and objects are checked key by key. A zh-TW dictionary declared as
 * `const m: Translation<typeof en> = {...}` therefore fails to compile when
 * it misses a key, adds one, or takes different message parameters.
 */
export type Translation<T> = T extends string
  ? string
  : T extends (...args: infer A) => unknown
    ? (...args: A) => string
    : T extends object
      ? { [K in keyof T]: Translation<T[K]> }
      : T;
