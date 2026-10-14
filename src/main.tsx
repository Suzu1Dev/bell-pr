import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LocaleProvider, initialLocale, loadLocale } from "./i18n";
import { defaultLocale, type Locale } from "../shared/i18n/locale";
import "./styles.css";
import "./workspace-v2.css";

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

// The dictionary loads before the first render, so the UI never flashes in
// another language. If it cannot load, the app still starts in English.
const locale = initialLocale();
void loadLocale(locale).then(
  () => render(locale),
  (error: unknown) => {
    console.error("[BELL-PR] Could not load the dictionary for", locale, error);
    render(defaultLocale);
  },
);
