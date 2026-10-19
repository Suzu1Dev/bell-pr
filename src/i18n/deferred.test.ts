import assert from "node:assert/strict";
import test from "node:test";
import { createElement, Suspense } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import en from "./en";
import core from "./en/core";
import deferred from "./en/deferred";
import {
  LocaleProvider,
  getCurrentMessages,
  setLocale,
  useT,
} from "./index";
import zhTW from "./zh-TW";
import zhTWCore from "./zh-TW/core";
import zhTWDeferred from "./zh-TW/deferred";

/** The HTML once every Suspense boundary has resolved, without React's boundary markers. */
async function prerender(element: ReturnType<typeof createElement>) {
  const { prelude } = await prerenderToNodeStream(element);
  let html = "";
  for await (const chunk of prelude) html += String(chunk);
  return html.replace(/<!--\/?\$-->/g, "");
}

function SettingsTitle() {
  return createElement("h1", null, useT("settings").title);
}

test("every namespace is in core or deferred, never in both, in both locales", () => {
  const names = (value: object) => Object.keys(value).sort();
  for (const [all, first, later] of [
    [en, core, deferred],
    [zhTW, zhTWCore, zhTWDeferred],
  ] as const) {
    assert.deepEqual(names(all), [...names(first), ...names(later)].sort());
    assert.equal(names(first).filter((name) => name in later).length, 0);
  }
});

// Runs first in this file, while the deferred namespaces have not loaded.
test("a view that needs a deferred namespace waits for it, then shows it", async () => {
  assert.equal("settings" in getCurrentMessages(), false);
  const html = await prerender(
    createElement(
      LocaleProvider,
      { locale: "en" },
      createElement(
        Suspense,
        { fallback: createElement("p", null, "loading") },
        createElement(SettingsTitle),
      ),
    ),
  );
  assert.equal(html, `<h1>${en.settings.title}</h1>`);
  assert.equal(getCurrentMessages().settings.title, en.settings.title);
});

test("a locale change keeps the deferred namespaces a view already loaded", async () => {
  await setLocale("zh-TW");
  assert.equal(getCurrentMessages().settings.title, zhTW.settings.title);
  await setLocale("en");
  assert.equal(getCurrentMessages().settings.title, en.settings.title);
});
