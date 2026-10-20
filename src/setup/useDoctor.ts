import { useCallback, useEffect, useRef, useState } from "react";
import type { DoctorReport } from "../../shared/doctor";
import { api } from "../api";
import { useLocale } from "../i18n";

/** What useDoctor returns; SetupChecklist takes the same fields. */
export interface DoctorState {
  /** The last report; null until the first one arrives. */
  report: DoctorReport | null;
  /** A request is on its way (the first load or a re-check). */
  checking: boolean;
  /** Why the last request failed, in the UI language; "" when it did not. */
  error: string;
  /** Probes the environment again now (GET /api/doctor?refresh=1). */
  refresh: () => Promise<void>;
}

/** How often the environment is checked again while a required check fails. */
export const recheckIntervalMs = 5000;

/** Whether a required check failed, so the app is not ready to work. */
export function requiredCheckFails(report: DoctorReport | null): boolean {
  return (
    !!report &&
    report.checks.some((check) => check.required && check.status === "fail")
  );
}

/**
 * The environment report from GET /api/doctor. It loads when the
 * component mounts and again when the UI language changes (the server
 * words the details), and while a required check fails it probes again
 * every 5 seconds, so a fix shows up without a click. With
 * `enabled: false` (the demo, presentations) it asks for nothing.
 */
export function useDoctor(options: { enabled?: boolean } = {}): DoctorState {
  const enabled = options.enabled ?? true;
  const [locale] = useLocale();
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [checking, setChecking] = useState(enabled);
  const [error, setError] = useState("");
  // Only the latest request may update the state; one probe at a time.
  const latest = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(async (force: boolean) => {
    const request = ++latest.current;
    inFlight.current = true;
    setChecking(true);
    try {
      const next = await api<DoctorReport>(force ? "/doctor?refresh=1" : "/doctor");
      if (request !== latest.current) return;
      setReport(next);
      setError("");
    } catch (failure) {
      if (request !== latest.current) return;
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (request === latest.current) {
        inFlight.current = false;
        setChecking(false);
      }
    }
  }, []);

  useEffect(() => {
    if (enabled) void load(false);
  }, [enabled, locale, load]);

  const failing = requiredCheckFails(report);
  useEffect(() => {
    if (!enabled || !failing) return;
    const timer = setInterval(() => {
      if (!inFlight.current) void load(true);
    }, recheckIntervalMs);
    return () => clearInterval(timer);
  }, [enabled, failing, load]);

  // Answers that arrive after unmounting are dropped.
  useEffect(
    () => () => {
      latest.current++;
    },
    [],
  );

  const refresh = useCallback(() => load(true), [load]);
  return { report, checking: enabled && checking, error, refresh };
}
