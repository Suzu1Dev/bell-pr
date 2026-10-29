import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { adoptApiToken, currentApiToken, establishBrowserSession, renewBrowserSession } from "./api";
import { parsePresentationFlags } from "./app/presentation";
import {
  addLocaleResource,
  LocaleProvider,
  initialLocale,
  loadLocale,
} from "./i18n";
import { loadDemo } from "./locales";
import { adoptViewSearch } from "./navigation/view-url";
import { defaultLocale, type Locale } from "../shared/i18n/locale";
import "./styles.css";
import "./workspace-v2.css";

// The address from `bell-pr open` carries the API token in the fragment.
// Drop it from the address, then exchange it for a browser session before
// mounting the app. Older tabs' stored tokens are upgraded the same way.
const pageToken = adoptApiToken(window);
const hasLaunchToken = Boolean(pageToken ?? currentApiToken());
const browserSession = establishBrowserSession(pageToken).then(
  () => hasLaunchToken,
  () => false, // The app's first API requests show connection/access errors.
);

const root = ReactDOM.createRoot(document.getElementById("root")!);

function render(locale: Locale) {
  root.render(
    <React.StrictMode>
      <LocaleProvider locale={locale}>
        <App />
      </LocaleProvider>
    </React.StrictMode>,
  );
}

// An address an upstream BELL build wrote (?run=…&tab=…, ?project=…,
// ?page=…) opens the same place through the hash route.
adoptViewSearch(window);

// The sample project's text in a locale loads with its dictionary.
addLocaleResource(loadDemo);

// The dictionary loads before the first render, so the UI never flashes in
// another language. If it cannot load, the app still starts in English.
// A locale= flag in the address (presentation and capture) wins over the
// saved choice and the browser language, and is never saved.
const locale =
  parsePresentationFlags(window.location.hash).locale ?? initialLocale();
void Promise.all([
  loadLocale(locale).then(
    () => locale,
    (error: unknown) => {
      console.error("[BELL-PR] Could not load the dictionary for", locale, error);
      return defaultLocale;
    },
  ),
  browserSession,
]).then(([readyLocale, renewedAtLaunch]) => {
  render(readyLocale);
  const hour = 60 * 60 * 1000;
  let lastRenewal = renewedAtLaunch ? Date.now() : 0;
  const renewWhenVisible = () => {
    if (document.visibilityState !== "visible" || Date.now() - lastRenewal < hour) return;
    lastRenewal = Date.now();
    // Session changes share a browser lock so renewal cannot undo sign-out.
    // The regular app requests already handle offline or expired access.
    void renewBrowserSession().catch(() => {});
  };
  renewWhenVisible();
  window.setInterval(renewWhenVisible, hour);
  document.addEventListener("visibilitychange", renewWhenVisible);
});
