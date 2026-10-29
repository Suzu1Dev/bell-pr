import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PairPage, takePairCode } from "./PairPage";
import { adoptApiToken } from "./api";
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
// Store it and drop it from the address before the router reads the hash.
adoptApiToken(window);
const isPairPage = window.location.pathname === "/pair";
const pairCode = isPairPage ? takePairCode(window) : "";

const root = ReactDOM.createRoot(document.getElementById("root")!);

function render(locale: Locale) {
  root.render(
    <React.StrictMode>
      <LocaleProvider locale={locale}>
        {isPairPage ? <PairPage initialCode={pairCode} /> : <App />}
      </LocaleProvider>
    </React.StrictMode>,
  );
}

// An address an upstream BELL build wrote (?run=…&tab=…, ?project=…,
// ?page=…) opens the same place through the hash route.
if (!isPairPage) adoptViewSearch(window);

// The sample project's text in a locale loads with its dictionary.
addLocaleResource(loadDemo);

// The dictionary loads before the first render, so the UI never flashes in
// another language. If it cannot load, the app still starts in English.
// A locale= flag in the address (presentation and capture) wins over the
// saved choice and the browser language, and is never saved.
const locale =
  parsePresentationFlags(window.location.hash).locale ?? initialLocale();
void loadLocale(locale).then(
  () => locale,
  (error: unknown) => {
    console.error("[BELL-PR] Could not load the dictionary for", locale, error);
    return defaultLocale;
  },
).then(render);
