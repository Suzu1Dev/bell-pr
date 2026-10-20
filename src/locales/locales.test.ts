import assert from "node:assert/strict";
import test from "node:test";
import type { Locale } from "../../shared/i18n/locale";
import { getDemo } from "../demo";
import zhTWDemo from "../demo/zh-TW";
import { addLocaleResource, loadLocale } from "../i18n";
import zhTW from "../i18n/zh-TW";
import { loadDemo } from "./index";

test("a locale's file carries its dictionary and the sample's text", async () => {
  const file = await import("./zh-TW");
  assert.equal(file.messages, zhTW);
  assert.equal(file.demo, zhTWDemo);
});

test("loadDemo makes the sample's text in a locale available to getDemo", async () => {
  await loadDemo("zh-TW");
  assert.equal(getDemo("zh-TW"), zhTWDemo);
  // English comes with the app.
  await loadDemo("en");
  assert.equal(getDemo("en").repo.id, getDemo("zh-TW").repo.id);
  await assert.rejects(loadDemo("fr" as Locale), /Unsupported locale: fr/);
});

test("loadLocale waits for what addLocaleResource added, in every locale", async () => {
  const done: Locale[] = [];
  addLocaleResource(async (locale) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    done.push(locale);
  });
  await loadLocale("zh-TW");
  await loadLocale("en");
  assert.deepEqual(done, ["zh-TW", "en"]);
  await assert.rejects(loadLocale("fr" as Locale), /Unsupported locale: fr/);
  assert.deepEqual(done, ["zh-TW", "en"]);
});
