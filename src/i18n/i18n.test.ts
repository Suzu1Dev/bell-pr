import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  parseLocale,
  type Locale,
  type Translation,
} from "../../shared/i18n/locale";
import { assertNoHan } from "../test-utils/render";
import en from "./en";
import {
  LocaleProvider,
  getCurrentLocale,
  getCurrentMessages,
  initialLocale,
  loadLocale,
  localeChangedEvent,
  localeStorageKey,
  setLocale,
  useFormat,
  useLocale,
  useT,
  type LocaleChangedDetail,
} from "./index";
import { LanguageSwitcher } from "./LanguageSwitcher";
import zhTW from "./zh-TW";

// Browser globals are absent under node; each test installs what it needs
// and the afterEach hook puts the originals back.
const restores: (() => void)[] = [];

function stubGlobal(name: string, descriptor: PropertyDescriptor) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, ...descriptor });
  restores.push(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

const stubValue = (name: string, value: unknown) =>
  stubGlobal(name, { value, writable: true });

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const blocked = () => {
  throw new Error("SecurityError: storage is disabled");
};
const throwingStorage = { getItem: blocked, setItem: blocked };

function browser() {
  const target = new EventTarget();
  const events: LocaleChangedDetail[] = [];
  target.addEventListener(localeChangedEvent, (event) =>
    events.push((event as CustomEvent<LocaleChangedDetail>).detail),
  );
  const document = {
    documentElement: { lang: "en" },
    title: "BELL PR",
  };
  stubValue("window", target);
  stubValue("document", document);
  return { target, events, document };
}

afterEach(async () => {
  // Back to English with no browser globals, so tests stay independent.
  await setLocale("en");
  while (restores.length) restores.pop()!();
});

function Probe() {
  const t = useT("common");
  const [locale] = useLocale();
  const fmt = useFormat();
  return createElement(
    "p",
    { lang: locale },
    `${t.runStatus.review} | ${t.actions.cancel} | ${fmt.list(["a", "b"])}`,
  );
}

// Runs first, while zh-TW has not been loaded through loadLocale yet.
test(
  "a provider whose locale is not loaded yet starts in English and switches once it loads",
  { timeout: 10_000 },
  async () => {
    const storage = memoryStorage();
    stubValue("localStorage", storage);
    const { target, events, document } = browser();
    const changed = new Promise((resolve) =>
      target.addEventListener(localeChangedEvent, resolve, { once: true }),
    );
    const html = renderToStaticMarkup(
      createElement(LocaleProvider, { locale: "zh-TW" }, createElement(Probe)),
    );
    assert.equal(
      html,
      '<p lang="en">Ready for your review | Cancel | a and b</p>',
    );
    await changed;
    assert.equal(getCurrentLocale(), "zh-TW");
    assert.equal(document.documentElement.lang, "zh-Hant-TW");
    assert.deepEqual(events, [{ locale: "zh-TW" }]);
    // The start locale is not the person's choice, so it is not remembered.
    assert.equal(storage.items.size, 0);
  },
);

test("components render English without a provider", () => {
  assert.equal(
    renderToStaticMarkup(createElement(Probe)),
    '<p lang="en">Ready for your review | Cancel | a and b</p>',
  );
  assert.equal(getCurrentLocale(), "en");
  assert.equal(
    getCurrentMessages().common.errors.generic,
    "Something went wrong. Please try again.",
  );
});

test("a zh-TW provider renders the zh-TW dictionary and formatters", async () => {
  await loadLocale("zh-TW");
  const html = renderToStaticMarkup(
    createElement(LocaleProvider, { locale: "zh-TW" }, createElement(Probe)),
  );
  assert.equal(html, '<p lang="zh-TW">等待你的審查 | 取消 | a和b</p>');
  // The app's provider makes its locale the active one for code outside React.
  assert.equal(getCurrentLocale(), "zh-TW");
  assert.equal(getCurrentMessages().common.actions.cancel, "取消");
});

test("a provider with its own dictionary leaves the active locale alone", () => {
  const html = renderToStaticMarkup(
    createElement(
      LocaleProvider,
      { locale: "zh-TW", messages: zhTW },
      createElement(Probe),
    ),
  );
  assert.equal(html, '<p lang="zh-TW">等待你的審查 | 取消 | a和b</p>');
  assert.equal(getCurrentLocale(), "en");
});

test("setLocale switches the active locale, the document and remembers the choice", async () => {
  const storage = memoryStorage();
  stubValue("localStorage", storage);
  const { events, document } = browser();

  await setLocale("zh-TW");
  assert.equal(getCurrentLocale(), "zh-TW");
  assert.equal(getCurrentMessages().common.language.label, "語言");
  assert.equal(storage.items.get(localeStorageKey), "zh-TW");
  assert.equal(document.documentElement.lang, "zh-Hant-TW");
  // The title is the app shell's, which names the page; the runtime leaves it.
  assert.equal(document.title, "BELL PR");
  assert.deepEqual(events, [{ locale: "zh-TW" }]);

  // Choosing the active locale again changes nothing and announces nothing.
  await setLocale("zh-TW");
  assert.deepEqual(events, [{ locale: "zh-TW" }]);

  await setLocale("en");
  assert.equal(storage.items.get(localeStorageKey), "en");
  assert.equal(document.documentElement.lang, "en");
  assert.deepEqual(events, [{ locale: "zh-TW" }, { locale: "en" }]);
});

test("setLocale works when localStorage throws", async () => {
  stubValue("localStorage", throwingStorage);
  const { events, document } = browser();
  await setLocale("zh-TW");
  assert.equal(getCurrentLocale(), "zh-TW");
  assert.equal(document.documentElement.lang, "zh-Hant-TW");
  assert.deepEqual(events, [{ locale: "zh-TW" }]);
});

test("setLocale works when reading localStorage itself throws", async () => {
  stubGlobal("localStorage", { get: blocked });
  browser();
  await setLocale("zh-TW");
  assert.equal(getCurrentLocale(), "zh-TW");
});

test("when setLocale calls overlap, the last one wins", async () => {
  await loadLocale("zh-TW");
  await Promise.all([setLocale("zh-TW"), setLocale("en")]);
  assert.equal(getCurrentLocale(), "en");
  await Promise.all([setLocale("en"), setLocale("zh-TW")]);
  assert.equal(getCurrentLocale(), "zh-TW");
});

test("loadLocale rejects a locale that does not exist", async () => {
  await assert.rejects(loadLocale("fr" as Locale), /Unsupported locale: fr/);
  await assert.rejects(setLocale("fr" as Locale), /Unsupported locale: fr/);
  assert.equal(getCurrentLocale(), "en");
});

const navigatorCases: [string | undefined, Locale][] = [
  ["zh-TW", "zh-TW"],
  ["zh-tw", "zh-TW"],
  ["zh-Hant", "zh-TW"],
  ["zh-Hant-TW", "zh-TW"],
  ["zh-Hant-HK", "zh-TW"],
  ["zh-HK", "zh-TW"],
  ["zh-MO", "zh-TW"],
  ["zh-CN", "en"],
  ["zh-Hans", "en"],
  ["zh-SG", "en"],
  ["zh", "en"],
  ["ja-JP", "en"],
  ["fr", "en"],
  ["en-GB", "en"],
  ["en-US", "en"],
  ["", "en"],
  [undefined, "en"],
];

test("parseLocale and initialLocale read navigator.language values", () => {
  for (const [language, expected] of navigatorCases) {
    assert.equal(parseLocale(language) ?? "en", expected, String(language));
    stubValue("navigator", { language });
    assert.equal(initialLocale(), expected, String(language));
  }
  stubValue("navigator", undefined);
  assert.equal(initialLocale(), "en");
});

test("initialLocale prefers the stored choice over the browser language", () => {
  stubValue("navigator", { language: "en-US" });
  stubValue("localStorage", memoryStorage({ [localeStorageKey]: "zh-TW" }));
  assert.equal(initialLocale(), "zh-TW");

  stubValue("navigator", { language: "zh-TW" });
  stubValue("localStorage", memoryStorage({ [localeStorageKey]: "en" }));
  assert.equal(initialLocale(), "en");
});

test("initialLocale falls back to the browser language when storage is absent, invalid or unreadable", () => {
  stubValue("navigator", { language: "zh-HK" });
  stubValue("localStorage", memoryStorage());
  assert.equal(initialLocale(), "zh-TW", "absent");
  stubValue("localStorage", memoryStorage({ [localeStorageKey]: "fr" }));
  assert.equal(initialLocale(), "zh-TW", "invalid");
  stubValue("localStorage", throwingStorage);
  assert.equal(initialLocale(), "zh-TW", "getItem throws");
  stubGlobal("localStorage", { get: blocked });
  assert.equal(initialLocale(), "zh-TW", "localStorage throws");
  stubValue("localStorage", undefined);
  assert.equal(initialLocale(), "zh-TW", "no localStorage");
  stubValue("navigator", { language: "en-US" });
  assert.equal(initialLocale(), "en");
});

test("the language switcher is labelled and lists each language by its own name", () => {
  const english = renderToStaticMarkup(createElement(LanguageSwitcher));
  assert.match(english, /^<select aria-label="Language">/);
  assert.match(
    english,
    /<option value="en" lang="en" selected="">English<\/option>/,
  );
  assert.match(
    english,
    /<option value="zh-TW" lang="zh-Hant-TW">繁體中文<\/option>/,
  );
  const chinese = renderToStaticMarkup(
    createElement(
      LocaleProvider,
      { locale: "zh-TW", messages: zhTW },
      createElement(LanguageSwitcher, { id: "language" }),
    ),
  );
  assert.match(chinese, /^<select id="language" aria-label="語言">/);
  assert.match(chinese, /<option value="en" lang="en">English<\/option>/);
  assert.match(
    chinese,
    /<option value="zh-TW" lang="zh-Hant-TW" selected="">繁體中文<\/option>/,
  );
});

const namespaces = [
  "common",
  "app",
  "workspace",
  "repos",
  "pages",
  "modals",
  "settings",
  "mission",
  "review",
  "team",
  "draft",
  "discovery",
  "learning",
  "efficiency",
  "models",
  "setup",
  "onboarding",
  "home",
  "about",
  "legal",
];

// The shape of a dictionary: nested keys, with each message's kind.
function shape(value: unknown): unknown {
  if (typeof value === "function") return "function";
  if (typeof value === "string") return "string";
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, shape(item)]),
    );
  return typeof value;
}

test("both locales register every namespace with the same keys", () => {
  assert.deepEqual(Object.keys(en).sort(), [...namespaces].sort());
  assert.deepEqual(shape(zhTW), shape(en));
  for (const value of Object.values(zhTW.common.runStatus))
    assert.ok(value.trim());
});

test("the English dictionary has no Han text except language names", () => {
  const { languageNames, ...common } = en.common;
  assertNoHan(JSON.stringify({ ...en, common }));
  assert.deepEqual(languageNames, { en: "English", "zh-TW": "繁體中文" });
  assert.deepEqual(zhTW.common.languageNames, languageNames);
});

test("a translation missing a key or taking other parameters does not compile", () => {
  const sample = {
    title: "Changes",
    changed: ({ count }: { count: number }) => `${count} files changed`,
  };
  const complete: Translation<typeof sample> = {
    title: "變更",
    changed: ({ count }) => `${count} 個檔案有變更`,
  };
  // @ts-expect-error a translation must have every key
  const missing: Translation<typeof sample> = { title: "變更" };
  const otherParameter: Translation<typeof sample> = {
    title: "變更",
    // @ts-expect-error a message takes the same parameters in every locale
    changed: ({ count }: { count: string }) => count,
  };
  assert.equal(sample.changed({ count: 2 }), "2 files changed");
  assert.equal(complete.changed({ count: 2 }), "2 個檔案有變更");
  assert.ok(missing && otherParameter);
});
