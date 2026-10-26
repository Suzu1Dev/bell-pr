import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { HardDrive, RefreshCw, Trash2 } from "lucide-react";
import type { AppSettingsView } from "../../shared/app-settings";
import type { RunStatus } from "../../shared/types";
import { api, send } from "../api";
import { useFormat, useT } from "../i18n";
import { CopyCommand } from "../setup/CopyCommand";
import type { DoctorState } from "../setup/useDoctor";
import type { Run } from "../types";
import {
  Feedback,
  NumberField,
  SettingsGroup,
  SettingsSectionFrame,
  messageOf,
  reloadPage,
} from "./controls";
import { formatSize } from "./format";
import { changedSettings, type AppSettingsState } from "./useAppSettings";

/** GET /api/storage (server/cleanup.ts StorageReport): sizes, never paths. */
export interface StorageReport {
  measuredAt: string;
  retentionDays: number;
  totalBytes: number;
  logsBytes: number;
  insightsBytes: number;
  repos: { id: string; fullName: string; managed: boolean; bytes: number | null }[];
  runs: StorageRun[];
}

export interface StorageRun {
  id: string;
  repoId: string;
  title: string;
  status: RunStatus;
  createdAt: string;
  /** null when the worktree is outside the data directory. */
  bytes: number | null;
  workspaceRemovedAt?: string;
  workspaceBytes?: number;
  /** DELETE /api/runs/:id/workspace would succeed now. */
  removable: boolean;
}

/** The retention period while nothing sets one (server/cleanup.ts). */
const defaultRetentionDays = 14;

/** The text the erase confirmation needs, as the server checks it. */
export const eraseWord = "ERASE";

/**
 * Runs that still have files (or a worktree outside the data directory),
 * biggest first, published ones apart.
 */
export function runsWithFiles(runs: StorageRun[]) {
  const kept = runs
    .filter((run) => !run.workspaceRemovedAt && run.bytes !== 0)
    .sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1));
  return {
    published: kept.filter((run) => run.status === "published"),
    others: kept.filter((run) => run.status !== "published"),
  };
}

/** The data directory's full path, with a copy button. */
function DataDirectory({
  doctor,
  maskPath,
}: {
  doctor: DoctorState;
  maskPath: (value: string) => string;
}) {
  const t = useT("settings");
  const check = doctor.report?.checks.find((value) => value.id === "data-dir");
  const path = typeof check?.params?.path === "string" ? check.params.path : "";
  // Copies what is shown: while presenting, the masked path.
  const shown = path && maskPath(path);
  return (
    <SettingsGroup title={t.data.dataDir.title} className="settings-data-dir">
      {shown ? (
        <CopyCommand command={shown} copyLabel={t.data.dataDir.copyLabel} />
      ) : (
        <p className="settings-help" role="status">
          {doctor.report ? "" : t.status.checking}
        </p>
      )}
    </SettingsGroup>
  );
}

/** One run's files, with "Free space" behind a confirmation. */
function RunFiles({
  run,
  onFreed,
  onRunFreed,
}: {
  run: StorageRun;
  /** Settles once the report is measured again, which drops this row. */
  onFreed: (message: string) => Promise<void>;
  onRunFreed?: (run: Run) => void;
}) {
  const settingsT = useT("settings");
  const t = settingsT.data.storage;
  const statusLabels = useT("common").runStatus;
  const format = useFormat();
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const freeButton = useRef<HTMLButtonElement>(null);
  const free = async () => {
    setBusy(true);
    setError("");
    try {
      const { run: freed } = await api<{ run: Run }>(
        `/runs/${encodeURIComponent(run.id)}/workspace`,
        send("DELETE", {}),
      );
      onRunFreed?.(freed);
      await onFreed(t.freed({ size: formatSize(freed.workspaceBytes ?? run.bytes ?? 0, format) }));
    } catch (failure) {
      setError(messageOf(failure));
      // The confirmation goes with the focused button; the toggle is
      // disabled until this render lands.
      window.requestAnimationFrame(() => freeButton.current?.focus());
    } finally {
      // Still here after a free when the report did not load again.
      setBusy(false);
      setConfirming(false);
    }
  };
  return (
    <li className="settings-run" data-run={run.id}>
      <div className="settings-run-head">
        <div className="settings-run-name">
          <strong>{run.title}</strong>
          <span>
            {t.runMeta({
              status: statusLabels[run.status],
              date: format.date(run.createdAt),
            })}
          </span>
        </div>
        <span className="settings-run-size">
          {run.bytes === null ? t.outside : formatSize(run.bytes, format)}
        </span>
        {run.removable ? (
          <button
            ref={freeButton}
            type="button"
            className="button secondary"
            aria-label={t.freeLabel({ title: run.title })}
            aria-expanded={confirming}
            aria-controls={confirming ? id : undefined}
            disabled={busy}
            onClick={() => setConfirming((open) => !open)}
          >
            {busy ? t.freeing : t.free}
          </button>
        ) : (
          run.bytes !== null && <span className="settings-help">{t.busy}</span>
        )}
      </div>
      {confirming && (
        <div id={id} className="settings-confirm" role="group" aria-label={t.free}>
          <p>{run.status === "published" ? t.confirmPublished : t.confirmFree}</p>
          <div className="settings-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                freeButton.current?.focus();
              }}
            >
              {settingsT.state.cancel}
            </button>
            <button
              type="button"
              className="button primary settings-danger-button"
              disabled={busy}
              onClick={() => void free()}
            >
              {busy ? t.freeing : t.free}
            </button>
          </div>
        </div>
      )}
      <Feedback error={error} />
    </li>
  );
}

/** Disk use of the data directory, per project clone and per run. */
function StorageUsage({
  report,
  error,
  loading,
  reload,
  onRunFreed,
}: {
  report: StorageReport | null;
  error: string;
  loading: boolean;
  reload: () => Promise<void>;
  onRunFreed?: (run: Run) => void;
}) {
  const t = useT("settings").data.storage;
  const format = useFormat();
  const [message, setMessage] = useState("");
  const refreshButton = useRef<HTMLButtonElement>(null);
  const size = (bytes: number) => formatSize(bytes, format);
  const clones = report?.repos.reduce((sum, repo) => sum + (repo.bytes ?? 0), 0) ?? 0;
  const runs = report ? runsWithFiles(report.runs) : { published: [], others: [] };
  const runBytes = report?.runs.reduce((sum, run) => sum + (run.bytes ?? 0), 0) ?? 0;
  const freed = (text: string) => {
    setMessage(text);
    // The freed run's row goes with the new report, so the keyboard waits
    // on Measure again, which stays focusable while it measures.
    refreshButton.current?.focus();
    return reload();
  };
  const list = (title: string, help: string | undefined, items: StorageRun[]) =>
    items.length > 0 && (
      <div className="settings-runs">
        <h4>{title}</h4>
        {help && <p className="settings-help">{help}</p>}
        <ul>
          {items.map((run) => (
            <RunFiles key={run.id} run={run} onFreed={freed} onRunFreed={onRunFreed} />
          ))}
        </ul>
      </div>
    );
  return (
    <SettingsGroup
      title={t.title}
      aside={
        <button
          ref={refreshButton}
          type="button"
          className="button secondary"
          aria-disabled={loading}
          onClick={() => {
            if (loading) return;
            setMessage("");
            void reload();
          }}
        >
          <RefreshCw size={15} aria-hidden="true" />
          {t.refresh}
        </button>
      }
      className="settings-storage"
    >
      {error && (
        <p className="settings-error" role="alert">
          {t.loadFailed({ message: error })}
        </p>
      )}
      {!report ? (
        !error && (
          <p className="settings-help" role="status">
            {t.loading}
          </p>
        )
      ) : (
        <>
          <dl className="settings-usage">
            <div className="settings-usage-total">
              <dt>
                <HardDrive size={15} aria-hidden="true" />
                {t.total}
              </dt>
              <dd>{size(report.totalBytes)}</dd>
            </div>
            <div>
              <dt>{t.clones}</dt>
              <dd>{size(clones)}</dd>
            </div>
            <div>
              <dt>{t.runs}</dt>
              <dd>{size(runBytes)}</dd>
            </div>
            <div>
              <dt>{t.analyses}</dt>
              <dd>{size(report.insightsBytes)}</dd>
            </div>
            <div>
              <dt>{t.logs}</dt>
              <dd>{size(report.logsBytes)}</dd>
            </div>
          </dl>
          <p className="settings-help">
            {t.measuredAt({ time: format.dateTime(report.measuredAt) })}
          </p>
          <p className="settings-text">{t.runsHelp}</p>
          {runs.published.length + runs.others.length === 0 ? (
            <p className="settings-help">{t.noRuns}</p>
          ) : (
            <>
              {list(t.published, t.publishedHelp, runs.published)}
              {list(t.others, undefined, runs.others)}
            </>
          )}
        </>
      )}
      <Feedback message={message} />
    </SettingsGroup>
  );
}

/** How long cancelled and failed runs keep their files. */
function RetentionForm({
  view,
  save,
}: {
  view: AppSettingsView;
  save: AppSettingsState["save"];
}) {
  const t = useT("settings");
  const r = t.data.retention;
  // The settings carry a saved value or BELLPR_RETENTION_DAYS; else the default applies.
  const current = view.settings.retentionDays ?? defaultRetentionDays;
  const [draft, setDraft] = useState(String(current));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const value = Number(draft.trim());
  const valid = draft.trim() !== "" && Number.isInteger(value) && value >= 1 && value <= 365;
  const lockedBy = view.lockedBy.retentionDays;
  const patch = valid
    ? changedSettings({ retentionDays: current }, { retentionDays: value }, view.lockedBy)
    : {};
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !Object.keys(patch).length) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const next = await save(patch);
      setDraft(String(next.settings.retentionDays ?? value));
      setMessage(t.state.saved);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="settings-retention" noValidate onSubmit={(event) => void submit(event)}>
      <NumberField
        label={r.label}
        help={r.help}
        value={draft}
        min={1}
        max={365}
        step={1}
        error={valid || lockedBy ? "" : t.performance.invalidWhole({ min: 1, max: 365 })}
        lockedBy={lockedBy}
        saving={saving}
        onChange={(next) => {
          setDraft(next);
          setMessage("");
          setError("");
        }}
      />
      <Feedback message={message} error={error} />
      {!lockedBy && (
        <div className="settings-actions">
          <button
            type="submit"
            className="button primary"
            aria-disabled={saving || !Object.keys(patch).length}
          >
            {saving ? t.state.saving : r.save}
          </button>
        </div>
      )}
    </form>
  );
}

/** Deletes all data after the person types ERASE; the page then reloads. */
function EraseData({ reload }: { reload: () => void }) {
  const t = useT("settings").data.erase;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const confirmed = typed.trim() === eraseWord;
  useEffect(() => {
    if (!done) return;
    // Long enough to read and announce the result; every page starts empty.
    const timer = setTimeout(reload, 1500);
    return () => clearTimeout(timer);
  }, [done, reload]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/data/erase", send("POST", { confirm: eraseWord }));
      setDone(true);
    } catch (failure) {
      setError(messageOf(failure));
      setBusy(false);
    }
  };
  return (
    <SettingsGroup title={t.title} text={t.text} className="settings-erase">
      <div className="settings-actions">
        <button
          type="button"
          className="button secondary settings-danger-outline"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
        >
          <Trash2 size={15} aria-hidden="true" />
          {t.open}
        </button>
      </div>
      {open && (
        <form id={id} className="settings-erase-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor={`${id}-input`}>{t.label}</label>
          <input
            id={`${id}-input`}
            className="text-input settings-erase-input"
            value={typed}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            onChange={(event) => setTyped(event.target.value)}
          />
          <div className="settings-actions">
            <button
              type="submit"
              className="button primary settings-danger-button"
              disabled={!confirmed || busy}
            >
              {busy ? t.erasing : t.button}
            </button>
          </div>
        </form>
      )}
      <Feedback message={done ? t.done : ""} error={error} />
    </SettingsGroup>
  );
}

/** What leaves this computer. */
function PrivacySummary() {
  const t = useT("settings").data.privacy;
  return (
    <SettingsGroup title={t.title} className="settings-privacy">
      <ul className="settings-list">
        <li>{t.none}</li>
        <li>{t.ai}</li>
        <li>{t.github}</li>
        <li>{t.web}</li>
        <li>{t.rest}</li>
      </ul>
    </SettingsGroup>
  );
}

/**
 * Data & privacy: where the data lives, how much room it takes (and
 * freeing a run's files), how long finished runs keep their files,
 * deleting everything, and what leaves this computer.
 */
export function DataSection({
  doctor,
  settings,
  maskPath,
  reload = reloadPage,
  onRunFreed,
}: {
  doctor: DoctorState;
  settings: AppSettingsState;
  maskPath: (value: string) => string;
  /** Reloads the page after all data was deleted. */
  reload?: () => void;
  /** Receives a run whose files were freed here, as the server answered. */
  onRunFreed?: (run: Run) => void;
}) {
  const t = useT("settings");
  const [report, setReport] = useState<StorageReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const loads = useRef(0);
  // The first load may take the server's minute-old report; "Measure
  // again" and a freed run ask for a new walk.
  const load = useCallback(async (refresh = false) => {
    const request = ++loads.current;
    setLoading(true);
    try {
      const next = await api<StorageReport>(refresh ? "/storage?refresh=1" : "/storage");
      if (request !== loads.current) return;
      setReport(next);
      setError("");
    } catch (failure) {
      if (request === loads.current) setError(messageOf(failure));
    } finally {
      if (request === loads.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Answers that arrive after unmounting are dropped.
  useEffect(
    () => () => {
      loads.current++;
    },
    [],
  );
  const view = settings.view;
  return (
    <SettingsSectionFrame section="data" title={t.data.title} intro={t.data.intro}>
      <DataDirectory doctor={doctor} maskPath={maskPath} />
      <StorageUsage
        report={report}
        error={error}
        loading={loading}
        reload={() => load(true)}
        onRunFreed={onRunFreed}
      />
      <SettingsGroup title={t.data.retention.title} className="settings-retention-group">
        {view ? (
          <RetentionForm view={view} save={settings.save} />
        ) : (
          <p className="settings-help" role="status">
            {t.state.loading}
          </p>
        )}
      </SettingsGroup>
      <EraseData reload={reload} />
      <PrivacySummary />
    </SettingsSectionFrame>
  );
}
