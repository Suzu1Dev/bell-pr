import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PairPage, takePairHash } from "./PairPage";
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
import { initTheme } from "./theme/useTheme";
import "./styles.css";
import "./workspace-v2.css";

initTheme(window);

// The address from `bell-pr open` carries the API token in the fragment.
// Store it and drop it from the address before the router reads the hash.
adoptApiToken(window);
const hasRootInvite =
  window.location.pathname === "/" && /(?:^|[#&])invite=bpi_[A-Za-z0-9_-]{43}/.test(window.location.hash);
const isPairPage = window.location.pathname === "/pair" || hasRootInvite;
const pairHash = isPairPage ? takePairHash(window) : { code: "", invite: "" };

const root = ReactDOM.createRoot(document.getElementById("root")!);

function render(locale: Locale) {
  root.render(
    <React.StrictMode>
      <LocaleProvider locale={locale}>
        {isPairPage ? (
          <PairPage initialCode={pairHash.code} initialInvite={pairHash.invite} />
        ) : (
          <App />
        )}
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
