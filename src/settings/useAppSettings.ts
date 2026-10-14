import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings, AppSettingsView } from "../../shared/app-settings";
import { api, send } from "../api";

/** What PUT /api/app-settings takes: any of the settings; null removes a saved value. */
export type AppSettingsPatch = {
  [K in keyof AppSettings]?: AppSettings[K] | null;
};

export interface AppSettingsState {
  /** GET /api/app-settings; null until it arrives. */
  view: AppSettingsView | null;
  /** Why loading failed, in the UI language; "" when it did not. */
  error: string;
  /**
   * Saves `patch` and keeps the answer. Send only the settings the person
   * changed: the server refuses any setting an environment variable locks
   * (409), even with its current value. Rejects with the server's error.
   */
  save(patch: AppSettingsPatch): Promise<AppSettingsView>;
  /** Loads the settings again. */
  reload(): Promise<void>;
}

/**
 * The fields of `next` whose value differs from `current`, leaving out the
 * ones an environment variable locks.
 */
export function changedSettings(
  current: AppSettings,
  next: AppSettingsPatch,
  lockedBy: AppSettingsView["lockedBy"] = {},
): AppSettingsPatch {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next) as [
    keyof AppSettings,
    unknown,
  ][]) {
    if (value === undefined || lockedBy[key]) continue;
    if (value === null ? current[key] !== undefined : current[key] !== value)
      patch[key] = value;
  }
  return patch as AppSettingsPatch;
}

/** The app settings with the environment locks, and a way to change them. */
export function useAppSettings(): AppSettingsState {
  const [view, setView] = useState<AppSettingsView | null>(null);
  const [error, setError] = useState("");
  // An answer to an older request never replaces a newer one.
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const next = await api<AppSettingsView>("/app-settings");
      if (request !== latest.current) return;
      setView(next);
      setError("");
    } catch (failure) {
      if (request === latest.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  // Answers that arrive after unmounting are dropped.
  useEffect(
    () => () => {
      latest.current++;
    },
    [],
  );

  const save = useCallback(async (patch: AppSettingsPatch) => {
    const request = ++latest.current;
    const next = await api<AppSettingsView>("/app-settings", send("PUT", patch));
    if (request === latest.current) {
      setView(next);
      setError("");
    }
    return next;
  }, []);

  return { view, error, save, reload };
}
