import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { api, send } from "../../api";
import { useT } from "../../i18n";
import {
  currentRoute,
  currentRouteHash,
  hashQuery,
  navigate,
  useHashRoute,
} from "../../navigation/route";
import type { AppSettingsView } from "../../../shared/app-settings";
import type {
  FileAttemptInput,
  MaintainerForecastInput,
  UnderstandingAnswersInput,
  UnderstandingGradesInput,
  UnderstandingView,
} from "../../../shared/understanding";
import type { DiffFile, Run } from "../../types";
import type { CheckQuestions } from "./understandingDemo";

// The Explain-it-back check in the workspace: whether it is on, where the
// run stands, and the writes. A real run's check lives on the server (the
// authority); the sample's lives on its run in this browser and follows
// the same rules (understandingDemo.ts). The setting and the open panel are
// small stores here, so the footer, the Changes tab, the Draft tab, the
// publish dialog and the approve action read the same state.

const runPath = (id: string) => `/runs/${encodeURIComponent(id)}`;

let settingsView: AppSettingsView | undefined;
let settingsRequest: Promise<void> | undefined;
const settingsListeners = new Set<() => void>();
const subscribeSettings = (listener: () => void) => {
  settingsListeners.add(listener);
  return () => void settingsListeners.delete(listener);
};

/**
 * Reads the app settings again (GET /api/app-settings), as the settings
 * page does. A failed read leaves the check on: absent means required.
 */
export function refreshCheckSettings(): Promise<void> {
  settingsRequest ??= api<AppSettingsView>("/app-settings")
    .then((view) => {
      settingsView = view;
      for (const listener of [...settingsListeners]) listener();
    })
    .catch(() => undefined)
    .finally(() => {
      settingsRequest = undefined;
    });
  return settingsRequest;
}

/** The check settings as last read; for tests, `view` replaces them. */
export function checkSettings(view: AppSettingsView | undefined = settingsView) {
  const values = view?.settings ?? {};
  return {
    /** The person turned the understanding check off (Settings → Learning). */
    off: values.skipUnderstandingCheck === true,
    /** The environment variable that keeps the check on, if one does. */
    lockedBy: view?.lockedBy?.skipUnderstandingCheck,
    /** The try-first prompts during review (on unless hidden). */
    tryFirst: values.hideTryFirst !== true,
  };
}

/** Sets the settings the stores hold; tests use it in place of a server. */
export function setCheckSettingsForTests(view: AppSettingsView | undefined) {
  settingsView = view;
  for (const listener of [...settingsListeners]) listener();
}

/** The check settings; each new user reads them again, so a change in Settings shows. */
export function useCheckSettings() {
  const view = useSyncExternalStore(
    subscribeSettings,
    () => settingsView,
    () => settingsView,
  );
  useEffect(() => {
    void refreshCheckSettings();
  }, []);
  return checkSettings(view);
}

/** "check" is the whole check; "forecast" is its last step alone, while the check is off. */
export type CheckPanelMode = "check" | "forecast";

let panel: { runId: string; mode: CheckPanelMode } | null = null;
const panelListeners = new Set<() => void>();
const openedAt = new Map<string, string>();
const subscribePanel = (listener: () => void) => {
  panelListeners.add(listener);
  return () => void panelListeners.delete(listener);
};
function setPanel(value: typeof panel) {
  panel = value;
  for (const listener of [...panelListeners]) listener();
}

/**
 * Opens the check next to the diff of run `runId`: the Changes tab, with
 * its file kept. The first opening in this page session is when the check
 * started (sent with the answers).
 */
export function openCheckPanel(
  runId: string,
  mode: CheckPanelMode = "check",
  options: { replace?: boolean } = {},
) {
  if (!openedAt.has(runId)) openedAt.set(runId, new Date().toISOString());
  setPanel({ runId, mode });
  const route = currentRoute();
  // `panel=check` only asks for the panel; it does not stay in the address.
  const { panel: _panel, file: _file, ...flags } = hashQuery(currentRouteHash());
  const file = route?.name === "run" && route.runId === runId ? route.file : undefined;
  navigate(
    { name: "run", runId, tab: "changes", ...(file ? { file } : {}), flags },
    options,
  );
}

export function closeCheckPanel() {
  setPanel(null);
}

/** How the check panel is open for run `runId`, or undefined when it is not. */
export function useCheckPanel(runId: string): CheckPanelMode | undefined {
  const value = useSyncExternalStore(subscribePanel, () => panel, () => panel);
  return value?.runId === runId ? value.mode : undefined;
}

/** A run outside review keeps its record; it takes no check now. */
function recordView(run: Run, required: boolean): UnderstandingView {
  const record = run.understanding;
  return {
    required,
    passed: !!record?.passedAt,
    stale: false,
    plan: [],
    ...(record ? { record } : {}),
    missing: [],
    changeFingerprint: "",
  };
}

type DemoRules = typeof import("./understandingDemo");

/**
 * The sample's approval gate, the same rule the server applies: whether
 * the check is required now and whether it passed for `files`. Until the
 * rules have loaded (a moment after the sample opens), nothing passes.
 */
export function useSampleGate(demo: boolean) {
  const rules = useRef<DemoRules>(undefined);
  useEffect(() => {
    if (demo && !rules.current)
      void import("./understandingDemo").then((module) => {
        rules.current = module;
      });
  }, [demo]);
  return (run: Run, files: readonly DiffFile[]) => {
    const required = !checkSettings().off;
    return rules.current?.demoGate(run, files, required) ?? { required, passed: false };
  };
}

/**
 * `run` approved under `gate`: marked "Check off" when it was approved
 * without passing the check, unmarked once approved with a pass (the
 * server does the same in approve()).
 */
export function markCheckOff(run: Run, gate: { passed: boolean }): Run {
  const { understandingCheckOff: _mark, ...rest } = run;
  return gate.passed ? rest : { ...rest, understandingCheckOff: true };
}

interface Saved {
  run: Run;
  understanding?: UnderstandingView;
}

export interface UnderstandingOptions {
  demo: boolean;
  setRun: Dispatch<SetStateAction<Run>>;
}

/**
 * The Explain-it-back check of `run` for its current `files`. On a real
 * run it reads GET /api/runs/:id/understanding again when the diff or the
 * run's state changes and after each write; the sample computes it here.
 * Each write rejects with a message to show when it fails.
 */
export function useUnderstanding(
  run: Run,
  files: DiffFile[],
  { demo, setRun }: UnderstandingOptions,
) {
  const t = useT("workspace").check;
  const settings = useCheckSettings();
  const route = useHashRoute();
  const openRun = useRef(run.id);
  openRun.current = run.id;
  const [served, setServed] = useState<{ runId: string; view?: UnderstandingView; error?: string }>();
  const [rules, setRules] = useState<DemoRules>();
  const [version, setVersion] = useState(0);
  const open = ["review", "approved"].includes(run.status) && !run.publishing;
  const questions: CheckQuestions = useMemo(
    () => ({ fallback: (path) => t.fallbackQuestion({ path }), untested: t.untestedQuestion }),
    [t],
  );
  const changes = files
    .map((file) => `${file.path}:${file.fingerprint ?? ""}:${file.explanationStatus ?? ""}`)
    .join("\n");

  // The deep link #/runs/:id/changes?panel=check opens the check.
  useEffect(() => {
    if (route?.name !== "run" || route.runId !== run.id) return;
    if (hashQuery(currentRouteHash()).panel === "check")
      openCheckPanel(run.id, "check", { replace: true });
  }, [route, run.id]);
  useEffect(() => {
    if (!demo || rules) return;
    let cancelled = false;
    void import("./understandingDemo").then((module) => {
      if (!cancelled) setRules(module);
    });
    return () => {
      cancelled = true;
    };
  }, [demo, rules]);
  useEffect(() => {
    if (demo || !open) return;
    let cancelled = false;
    const id = run.id;
    api<{ understanding: UnderstandingView }>(`${runPath(id)}/understanding`).then(
      ({ understanding }) => {
        if (!cancelled) setServed({ runId: id, view: understanding });
      },
      (error: Error) => {
        if (!cancelled) setServed({ runId: id, error: error.message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [demo, open, run.id, run.status, changes, version]);

  // The server's answer decides for a real run; until it arrives, the setting.
  const required =
    !demo && served?.runId === run.id && served.view
      ? served.view.required
      : !settings.off;
  const view = useMemo(() => {
    if (demo) return rules?.demoUnderstandingView(run, files, { required, questions });
    if (!open) return recordView(run, required);
    return served?.runId === run.id ? served.view : undefined;
  }, [demo, rules, run, files, required, questions, open, served]);

  /** Shows a real run's answer when it is still the open run. */
  function accept({ run: updated, understanding }: Saved) {
    if (openRun.current !== updated.id) return;
    setRun(updated);
    setServed((previous) =>
      understanding
        ? { runId: updated.id, view: understanding }
        : previous?.view && previous.runId === updated.id
          ? { ...previous, view: { ...previous.view, record: updated.understanding } }
          : previous,
    );
  }
  /** Keeps the sample's new record on its run (and, with it, in this browser). */
  function keep(change: (previous: Run) => Partial<Run>) {
    setRun((previous) =>
      previous.id === run.id ? { ...previous, ...change(previous) } : previous,
    );
  }
  const demoRules = () => {
    if (!rules) throw new Error(t.loading);
    return rules;
  };
  const now = () => new Date().toISOString();
  const write = (method: string, suffix: string, body?: unknown) =>
    api<Saved>(`${runPath(run.id)}${suffix}`, send(method, body)).then(accept);

  return {
    view,
    /** The check must pass before approval: the setting is on, or a variable keeps it on. */
    required,
    passed: view?.passed ?? false,
    /** The person turned the check off; approval needs the reviewed ticks only. */
    off: !required,
    lockedBy: view?.lockedBy ?? settings.lockedBy,
    tryFirst: settings.tryFirst,
    error: !demo && served?.runId === run.id ? served.error : undefined,
    /** Reads the check and the settings again. */
    refresh() {
      setVersion((value) => value + 1);
      void refreshCheckSettings();
    },
    /** "Lock my answers": the summary (unless one is recorded) and the open answers. */
    async saveAnswers(input: Pick<UnderstandingAnswersInput, "summary" | "items">) {
      const opened = openedAt.get(run.id);
      if (demo) {
        const record = demoRules().demoLockAnswers(run, files, { ...input, ...(opened ? { openedAt: opened } : {}) }, questions, now());
        keep(() => ({ understanding: record }));
        return;
      }
      await write("PUT", "/understanding/answers", {
        ...input,
        changeFingerprint: view?.changeFingerprint ?? "",
        ...(opened ? { openedAt: opened } : {}),
      });
    },
    /** Grades and corrections, with the optional forecast. */
    async saveGrades(input: UnderstandingGradesInput) {
      if (demo) {
        const record = demoRules().demoSaveGrades(run, files, input, questions, now());
        keep(() => ({ understanding: record }));
        return;
      }
      await write("PUT", "/understanding/grades", input);
    },
    /** "Still accurate" (no text), or an edited summary, after the change moved. */
    async confirmSummary(text?: string) {
      if (demo) {
        const record = demoRules().demoConfirmSummary(run, files, text, questions, now());
        keep(() => ({ understanding: record }));
        return;
      }
      await write("POST", "/understanding/summary", {
        changeFingerprint: view?.changeFingerprint ?? "",
        ...(text !== undefined ? { text } : {}),
      });
    },
    /** Start over; passed checks stay in history. */
    async restart() {
      if (demo) {
        const record = demoRules().demoRestart(run);
        keep(() => ({ understanding: record }));
        return;
      }
      await write("DELETE", "/understanding");
    },
    /** The forecast alone (PUT /api/runs/:id/forecast). */
    async saveForecast(input: MaintainerForecastInput) {
      if (demo) {
        const record = demoRules().demoSaveForecast(run, input, now());
        keep(() => ({ understanding: record }));
        return;
      }
      await write("PUT", "/forecast", input);
    },
    /**
     * A try-first attempt on `file` (PATCH /api/runs/:id/attempts). It never
     * changes the review; a credited answer can change the check's plan.
     */
    async saveAttempt(file: DiffFile, input: Pick<FileAttemptInput, "quiz" | "road">) {
      if (demo) {
        const attempts = demoRules().demoSaveAttempt(run, file, input, now());
        keep(() => ({ attempts }));
        return;
      }
      try {
        await write("PATCH", "/attempts", {
          filePath: file.path,
          fingerprint: file.fingerprint,
          ...input,
        });
      } finally {
        setVersion((value) => value + 1);
      }
    },
  };
}

export type Understanding = ReturnType<typeof useUnderstanding>;
