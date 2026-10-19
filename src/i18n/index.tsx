/**
 * The client i18n runtime: the active locale and its dictionary, React hooks
 * to read them, and module getters for code outside React (the API client).
 *
 * English is bundled and is the default everywhere, including renders without
 * a provider. Other locales are loaded on demand with `loadLocale`. Messages
 * are plain strings or functions of one parameter object; the zh-TW
 * dictionary is typed against the English one, so `tsc` reports a missing key
 * or a mismatched parameter.
 *
 * Only the English namespaces the startup chunk uses (`./en/core`) are
 * bundled. The ones only lazily loaded views use (`./en/deferred`: Settings,
 * discovery, the learning page, onboarding, About...) load the first time
 * `useT` asks for one; the view waits for them like for its own code,
 * inside the Suspense boundary that loads it. zh-TW loads as one chunk:
 * split the same way, its text would compress worse by more than the
 * deferred part weighs.
 */
import {
  createContext,
  use,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  defaultLocale,
  formatters,
  htmlLang,
  parseLocale,
  type Formatters,
  type Locale,
  type Translation,
} from "../../shared/i18n/locale";
import type en from "./en";
import englishCore from "./en/core";

export type Messages = Translation<typeof en>;
export type Namespace = keyof Messages;

/** localStorage key that remembers the person's choice. */
export const localeStorageKey = "bellpr-locale";
/** Window event sent after the active locale changed; `detail.locale` is the new one. */
export const localeChangedEvent = "bellpr:locale-changed";

export interface LocaleChangedDetail {
  locale: Locale;
}

declare global {
  interface WindowEventMap {
    "bellpr:locale-changed": CustomEvent<LocaleChangedDetail>;
  }
}

export interface LocaleState {
  locale: Locale;
  messages: Messages;
}

// English as bundled: the core namespaces. loadDeferred() adds the deferred
// ones to this same object, so every holder of it sees them.
const english = { ...englishCore } as Messages;

/** Without a provider, components render English. */
export const LocaleContext = createContext<LocaleState>({
  locale: defaultLocale,
  messages: english,
});

// Dictionaries that are ready to use. English is bundled with the app.
const loaded = new Map<Locale, Messages>([["en", english]]);
const loaders: Record<Exclude<Locale, "en">, () => Promise<Messages>> = {
  "zh-TW": () => import("./zh-TW/index").then((module) => module.default),
};
// The deferred namespaces of a locale whose dictionary comes without them.
const deferredLoaders: Partial<
  Record<Locale, () => Promise<{ default: Partial<Messages> }>>
> = {
  en: () => import("./en/deferred"),
};
// One load of the deferred namespaces per locale; a failed one is forgotten,
// so the next render tries again.
const deferredLoads = new Map<Locale, Promise<void>>();

// The active locale for module getters and for app-mode providers. Replaced,
// never mutated, so the object itself is the store snapshot.
let active: LocaleState = { locale: defaultLocale, messages: english };
const listeners = new Set<() => void>();
// Only the latest locale change applies when loads finish out of order.
let latestChange = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return active;
}

/** Makes an already loaded locale active; returns false if it is not loaded. */
function activate(locale: Locale) {
  const messages = loaded.get(locale);
  if (!messages) return false;
  if (active.locale !== locale || active.messages !== messages) {
    active = { locale, messages };
    for (const listener of listeners) listener();
  }
  return true;
}

/** The active locale, for code outside React such as the API client. */
export function getCurrentLocale(): Locale {
  return active.locale;
}

/**
 * The active dictionary, for code outside React such as the API client. Its
 * deferred namespaces (`./en/deferred`) are there only once a view needed
 * them; code outside React reads core namespaces only.
 */
export function getCurrentMessages(): Messages {
  return active.messages;
}

/**
 * Loads a locale's dictionary so it can be shown; English is always loaded.
 * It does not change the active locale.
 */
export async function loadLocale(locale: Locale): Promise<void> {
  if (loaded.has(locale)) return;
  const load = loaders[locale as Exclude<Locale, "en">];
  if (!load) throw new Error(`Unsupported locale: ${String(locale)}`);
  loaded.set(locale, await load());
}

/**
 * Adds the deferred namespaces (`./en/deferred`) to a locale's dictionary;
 * zh-TW's comes with them. `useT` calls it for a view that needs one of
 * them; a locale change waits for it once a view did.
 */
function loadDeferred(locale: Locale): Promise<void> {
  let load = deferredLoads.get(locale);
  if (!load) {
    const deferred = deferredLoaders[locale];
    load = Promise.all([loadLocale(locale), deferred?.()]).then(
      ([, module]) => {
        if (module) Object.assign(loaded.get(locale)!, module.default);
      },
    );
    load.catch(() => deferredLoads.delete(locale));
    deferredLoads.set(locale, load);
  }
  return load;
}

/**
 * Loads a lazily loaded view's code together with the deferred namespaces
 * it reads, so the view shows in one step:
 * `lazy(() => withMessages(import("./View")).then(...))`. Without it the
 * view would wait a second time, for its copy, and React reveals each wait
 * on a timer, which a paused clock (captures, some e2e tests) never runs.
 */
export function withMessages<T>(load: Promise<T>): Promise<T> {
  return Promise.all([load, loadDeferred(active.locale)]).then(
    ([module]) => module,
  );
}

function readStoredLocale(): Locale | undefined {
  try {
    return parseLocale(globalThis.localStorage?.getItem(localeStorageKey));
  } catch {
    // Storage can be blocked by the browser; fall back to the next source.
    return undefined;
  }
}

function storeLocale(locale: Locale) {
  try {
    globalThis.localStorage?.setItem(localeStorageKey, locale);
  } catch {
    // Storage can be blocked or full; the choice then lasts until a reload.
  }
}

/**
 * The locale to start with: the saved choice, else zh-TW when the browser
 * language is zh-TW, zh-Hant*, zh-HK or zh-MO, else English.
 */
export function initialLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) return stored;
  const browser = parseLocale(globalThis.navigator?.language);
  return browser === "zh-TW" ? "zh-TW" : defaultLocale;
}

/**
 * `<html lang>`. The document title is the app shell's: it names the page
 * in the active language (AppShell, `titleFor`).
 */
function applyToDocument({ locale }: LocaleState) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = htmlLang(locale);
}

async function changeLocale(locale: Locale, remember: boolean) {
  const change = ++latestChange;
  await loadLocale(locale);
  // A view that needed the deferred namespaces may still show; it keeps
  // them in the new locale instead of waiting for them again.
  if (deferredLoads.size) await loadDeferred(locale);
  if (change !== latestChange) return;
  const previous = active.locale;
  activate(locale);
  if (remember) storeLocale(locale);
  applyToDocument(active);
  if (previous !== locale && typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent<LocaleChangedDetail>(localeChangedEvent, {
        detail: { locale },
      }),
    );
}

/**
 * Switches the app to `locale`: loads its dictionary, makes it active,
 * remembers the choice in localStorage (when storage is available), updates
 * `<html lang>` and the title, and sends `bellpr:locale-changed` when the
 * locale differs from the previous one. Rejects when the dictionary cannot be
 * loaded; the previous locale then stays active. When calls overlap, the
 * last one wins.
 */
export function setLocale(locale: Locale): Promise<void> {
  return changeLocale(locale, true);
}

function reportLoadFailure(locale: Locale) {
  return (error: unknown) => {
    console.error("[BELL-PR] Could not load the dictionary for", locale, error);
  };
}

function requestLocale(locale: Locale) {
  setLocale(locale).catch(reportLoadFailure(locale));
}

/**
 * Provides the locale and dictionary to the components below it.
 *
 * - With `messages`, it renders exactly that dictionary for `locale` (default
 *   English) and changes no global state. Tests and previews use this form.
 * - Without `messages`, it shows the app's active locale and follows
 *   `setLocale`. `locale` is the locale to start with; load it with
 *   `loadLocale` before the first render. It becomes active while this
 *   provider first renders, so module getters such as `getCurrentLocale()`
 *   already agree with the UI when the components' first effects send
 *   requests. The provider also keeps `<html lang>` and the title in sync.
 */
export function LocaleProvider({
  locale,
  messages,
  children,
}: {
  locale?: Locale;
  messages?: Messages;
  children?: ReactNode;
}) {
  const fixed = messages !== undefined;
  // Runs once per mount; activating the active locale again is a no-op. A
  // locale that was not loaded yet becomes active once it has loaded, and is
  // not remembered as the person's choice.
  useState(() => {
    if (!fixed && locale && !activate(locale))
      changeLocale(locale, false).catch(reportLoadFailure(locale));
  });
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!fixed) applyToDocument(current);
  }, [fixed, current]);
  const fixedValue = useMemo<LocaleState | undefined>(
    () =>
      messages === undefined
        ? undefined
        : { locale: locale ?? defaultLocale, messages },
    [locale, messages],
  );
  return (
    <LocaleContext.Provider value={fixedValue ?? current}>
      {children}
    </LocaleContext.Provider>
  );
}

/** The locale shown and a setter that switches the app (see `setLocale`). */
export function useLocale(): [Locale, (locale: Locale) => void] {
  return [useContext(LocaleContext).locale, requestLocale];
}

/**
 * The messages of one namespace in the current locale. A deferred namespace
 * that has not loaded yet suspends the view until it has.
 */
export function useT<NS extends Namespace>(ns: NS): Messages[NS] {
  const { locale, messages } = useContext(LocaleContext);
  if (!(ns in messages)) use(loadDeferred(locale));
  return messages[ns];
}

/** Number, date, list and plural formatters for the current locale. */
export function useFormat(): Formatters {
  return formatters(useContext(LocaleContext).locale);
}
