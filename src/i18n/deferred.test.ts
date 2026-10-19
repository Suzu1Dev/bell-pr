import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

// The source files of src/ (tests aside), with the modules each imports
// for its values and the deferred namespaces it reads through useT().
const src = fileURLToPath(new URL("..", import.meta.url));
const deferredNames = Object.keys(deferred);
function sources(directory = src, found = new Map<string, string>()) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) sources(file, found);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      found.set(file, readFileSync(file, "utf8"));
  }
  return found;
}
const files = sources();
function resolve(from: string, specifier: string) {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(from), specifier);
  return [".ts", ".tsx", "/index.ts", "/index.tsx", ""]
    .map((ending) => base + ending)
    .find((file) => files.has(file) && existsSync(file));
}
function closure(file: string | undefined, seen = new Set<string>()) {
  if (!file || seen.has(file)) return seen;
  seen.add(file);
  const text = files.get(file)!;
  const imports = /^(?:import|export)\s+(?!type\b)(?:[^;]*?\sfrom\s+)?"([^"]+)"/gms;
  for (const [, specifier] of text.matchAll(imports))
    closure(resolve(file, specifier), seen);
  return seen;
}
const readsDeferred = (file: string) =>
  deferredNames.filter((name) => files.get(file)!.includes(`useT("${name}")`));

test("no module the app loads at startup reads a deferred namespace", () => {
  const startup = closure(path.join(src, "main.tsx"));
  assert.ok(startup.size > 50);
  assert.deepEqual([...startup].filter((file) => readsDeferred(file).length), []);
});

test("a lazily loaded view that reads deferred namespaces loads them with its code", () => {
  const startup = closure(path.join(src, "main.tsx"));
  const missing: string[] = [];
  let wrapped = 0;
  for (const [file, text] of files)
    for (const [call, before, specifier] of text.matchAll(/lazy\(\s*\(\)\s*=>\s*([\s\S]{0,40}?)import\("([^"]+)"\)/g)) {
      const view = [...closure(resolve(file, specifier))].filter(
        (module) => !startup.has(module) && readsDeferred(module).length,
      );
      if (!view.length) continue;
      if (before.includes("withMessages(")) wrapped++;
      else missing.push(`${path.relative(src, file)}: ${call}`);
    }
  assert.deepEqual(missing, []);
  assert.ok(wrapped >= 10);
});
