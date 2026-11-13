import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "bell.theme";

const listeners = new Set<() => void>();
let currentTheme: Theme = "light";

function parseThemeValue(value: string | null | undefined): Theme | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "dark" || normalized === "light") return normalized;
  return undefined;
}

/** Reads `?theme=light|dark` from the page search or hash query without mutating storage. */
export function addressTheme(win: Pick<Window, "location"> | undefined): Theme | undefined {
  if (!win) return undefined;
  const search = new URLSearchParams(win.location.search).get("theme");
  const fromSearch = parseThemeValue(search);
  if (fromSearch) return fromSearch;
  const [, hashQuery = ""] = win.location.hash.replace(/^#/, "").split("?", 2);
  if (!hashQuery) return undefined;
  return parseThemeValue(new URLSearchParams(hashQuery).get("theme"));
}

function applyDocumentTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0b0e0d" : "#1f6d50");
}

/** Synchronously initializes the color theme before React mounts to prevent FOUC. */
export function initTheme(win: Window | undefined = typeof window !== "undefined" ? window : undefined): Theme {
  const override = addressTheme(win);
  if (override) {
    currentTheme = override;
    applyDocumentTheme(currentTheme);
    return currentTheme;
  }
  try {
    const saved = parseThemeValue(win?.localStorage.getItem(THEME_STORAGE_KEY));
    if (saved) currentTheme = saved;
  } catch {
    // Storage may be blocked in private or sandboxed contexts.
  }
  applyDocumentTheme(currentTheme);
  return currentTheme;
}

export function setTheme(next: Theme) {
  currentTheme = next;
  applyDocumentTheme(next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Session theme still applies in memory.
  }
  for (const listener of listeners) listener();
}

export function toggleTheme() {
  setTheme(currentTheme === "dark" ? "light" : "dark");
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): [Theme, (next: Theme) => void, () => void] {
  const theme = useSyncExternalStore(
    subscribe,
    () => currentTheme,
    () => "light" as Theme,
  );
  return [theme, setTheme, toggleTheme];
}
