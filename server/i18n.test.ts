import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { Locale } from "../shared/i18n/locale.js";
import {
  cancelled,
  currentLocale,
  setDefaultLocaleSource,
  shuttingDown,
  sm,
  withLocale,
} from "./i18n/index.js";
import en from "./i18n/en/index.js";
import zhTW from "./i18n/zh-TW/index.js";

const han = /\p{Script_Extensions=Han}/u;

/**
 * Runs `fn` with BELLPR_LOCALE set to `value` (removed when undefined), then
 * restores the variable and clears any default-locale source.
 */
async function withEnvLocale(
  value: string | undefined,
  fn: () => void | Promise<void>,
) {
  const saved = process.env.BELLPR_LOCALE;
  if (value === undefined) delete process.env.BELLPR_LOCALE;
  else process.env.BELLPR_LOCALE = value;
  try {
    await fn();
  } finally {
    if (saved === undefined) delete process.env.BELLPR_LOCALE;
    else process.env.BELLPR_LOCALE = saved;
    setDefaultLocaleSource();
  }
}

test("currentLocale falls back from the scope to the default source, BELLPR_LOCALE and en", async () => {
  await withEnvLocale(undefined, () => {
    assert.equal(currentLocale(), "en");
    assert.equal(withLocale("zh-TW", currentLocale), "zh-TW");
  });
  await withEnvLocale("zh_TW.UTF-8", () => {
    assert.equal(currentLocale(), "zh-TW");
  });
  await withEnvLocale("fr", () => {
    assert.equal(currentLocale(), "en");
  });
  await withEnvLocale("en", () => {
    setDefaultLocaleSource(() => "zh-TW");
    assert.equal(currentLocale(), "zh-TW");
    // The request's own locale still wins over the default source.
    assert.equal(withLocale("en", currentLocale), "en");
    setDefaultLocaleSource(() => undefined);
    assert.equal(currentLocale(), "en");
  });
  await withEnvLocale("zh-TW", () => {
    setDefaultLocaleSource(() => undefined);
    assert.equal(currentLocale(), "zh-TW");
    setDefaultLocaleSource(() => "en");
    assert.equal(currentLocale(), "en");
    setDefaultLocaleSource(() => {
      throw new Error("settings unreadable");
    });
    assert.equal(currentLocale(), "zh-TW");
    setDefaultLocaleSource();
    assert.equal(currentLocale(), "zh-TW");
  });
});

test("withLocale keeps each async flow on its own locale", async () => {
  const locales: Locale[] = ["en", "zh-TW", "en", "zh-TW"];
  const seen = await Promise.all(
    locales.map((locale, index) =>
      withLocale(locale, async () => {
        const before = currentLocale();
        // Interleave the flows so each resumes while the others are active.
        await delay(12 - index * 3);
        const nested = await withLocale(
          locale === "en" ? "zh-TW" : "en",
          async () => {
            await delay(1);
            return currentLocale();
          },
        );
        await new Promise((resolve) => setImmediate(resolve));
        return { before, nested, after: currentLocale() };
      }),
    ),
  );
  assert.deepEqual(
    seen,
    locales.map((locale) => ({
      before: locale,
      nested: locale === "en" ? "zh-TW" : "en",
      after: locale,
    })),
  );
  await withEnvLocale(undefined, () => {
    assert.equal(currentLocale(), "en");
  });
});

test("sm() and the shared helpers return the current locale's messages", () => {
  assert.equal(withLocale("en", sm), en);
  assert.equal(withLocale("zh-TW", sm), zhTW);
  assert.equal(withLocale("en", cancelled), en.common.cancelled);
  assert.equal(withLocale("en", shuttingDown), en.common.shuttingDown);
  assert.equal(withLocale("zh-TW", cancelled), "工作已取消。");
  assert.equal(withLocale("zh-TW", shuttingDown), "服務正在關閉，請稍後重試。");
  assert.equal(withLocale("zh-TW", () => sm().common.notFound), "找不到 API。");
  for (const message of Object.values(en.common)) {
    if (typeof message === "string") assert.doesNotMatch(message, han);
  }
});

test("every server namespace is registered for both locales", () => {
  const namespaces = [
    "analysis",
    "cli",
    "common",
    "license",
    "run",
    "security",
    "setup",
    "storage",
  ];
  assert.deepEqual(Object.keys(en).sort(), namespaces);
  assert.deepEqual(Object.keys(zhTW).sort(), namespaces);
});
