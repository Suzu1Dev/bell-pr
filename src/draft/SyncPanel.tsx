import {
  CircleAlert,
  CircleCheck,
  GitMerge,
  LoaderCircle,
  Undo2,
  Wand2,
} from "lucide-react";
import { activeFollowUp } from "../../shared/followups";
import { useFormat, useT } from "../i18n";
import type { Run } from "../types";
import { rich } from "./rich";
import "./rounds.css";

interface Props {
  run: Run;
  /** A request of this page is in flight. */
  busy: boolean;
  onSync: () => void;
  onResolve: () => void;
  onUndo: () => void;
}

const short = (commit?: string) => commit?.slice(0, 7) ?? "";

// The labels the server writes into the conflict markers; they name the
// sides in the files themselves, so they stay as written.
const sideLabels = {
  published: "this pull request",
  unpublished: "this contribution",
};

/**
 * Where the contribution stands against its target branch, and the way to
 * catch up: an unpublished run moves onto the latest base, a published PR
 * takes it in as a reviewed merge commit. Conflicts are listed until the
 * files no longer hold markers, which the server checks before approval.
 */
export function SyncPanel({ run, busy, onSync, onResolve, onUndo }: Props) {
  const t = useT("draft").sync;
  const fmt = useFormat();
  const published = !!run.prUrl;
  const round = activeFollowUp(run.followUps);
  const syncRound = round?.kind === "sync" ? round : undefined;
  const holder = published ? syncRound : run.sync;
  const conflicts = holder?.conflicts ?? [];
  // Read by the server whenever the diff is; until then every conflict is open.
  const open = holder?.unresolved ?? conflicts;
  // Only the conflict agent; a run's team can also be running after a sync.
  const running = !!holder?.resolving;
  const syncable = ["review", "approved", "awaiting_plan"].includes(run.status);
  const canSync =
    !busy &&
    !run.publishing &&
    (published
      ? run.status === "published" && !round
      : // The server refuses a new sync while the last one's conflicts are open.
        syncable && !open.length);
  // Why an unpublished run cannot sync, unless the conflict agent is at work.
  const waitNote =
    published || running
      ? ""
      : open.length
        ? t.waitConflicts
        : syncable
          ? ""
          : t.waitStatus;
  const canUndo =
    !published &&
    !!run.sync &&
    !busy &&
    ["review", "approved", "awaiting_plan"].includes(run.status);
  const canResolve =
    open.length > 0 && !busy && ["review", "approved"].includes(run.status);
  return (
    <section className="sync-panel" aria-labelledby="sync-panel-title">
      <div className="sync-panel-head">
        <div>
          <h2 id="sync-panel-title">
            <GitMerge size={16} aria-hidden="true" />
            {t.title}
          </h2>
          <p>
            {rich(published ? t.intro.published : t.intro.unpublished, {
              branch: <code>{run.baseBranch}</code>,
              commit: <code>{short(run.baseSha)}</code>,
            })}
          </p>
          {!published && run.sync && (
            <p className="sync-panel-meta">
              {rich(t.lastSync, {
                from: <code>{short(run.sync.from)}</code>,
                to: <code>{short(run.sync.to)}</code>,
                date: fmt.dateTime(run.sync.at),
              })}
            </p>
          )}
          {waitNote && <p className="sync-panel-meta">{waitNote}</p>}
          {published && round && !syncRound && (
            <p className="sync-panel-meta">{t.roundOpen}</p>
          )}
        </div>
        <div className="sync-panel-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onSync}
            disabled={!canSync}
          >
            <GitMerge size={15} /> {t.sync}
          </button>
          {canUndo && (
            <button type="button" className="button secondary" onClick={onUndo}>
              <Undo2 size={15} /> {t.undo}
            </button>
          )}
        </div>
      </div>
      {conflicts.length > 0 && (
        <div className="sync-conflicts">
          <strong>{t.conflicts}</strong>
          {/* Each file's state is written out; the colors only repeat it. */}
          <p className="sync-conflict-count" role="status">
            {open.length
              ? t.openCount({ open: open.length, total: conflicts.length })
              : t.allResolved}
          </p>
          <ul className="sync-conflict-files">
            {conflicts.map((file) => {
              const unresolved = open.includes(file);
              return (
                <li key={file}>
                  <code>{file}</code>
                  <span
                    className={`sync-conflict-state ${unresolved ? "is-open" : "is-resolved"}`}
                  >
                    {unresolved ? (
                      <CircleAlert size={12} aria-hidden="true" />
                    ) : (
                      <CircleCheck size={12} aria-hidden="true" />
                    )}
                    {unresolved ? t.unresolved : t.resolved}
                  </span>
                </li>
              );
            })}
          </ul>
          {open.length > 0 && (
            <p>
              {rich(
                published
                  ? t.conflictHelp.published
                  : t.conflictHelp.unpublished,
                {
                  latest: <code>latest {run.baseBranch}</code>,
                  ours: (
                    <code>
                      {published
                        ? sideLabels.published
                        : sideLabels.unpublished}
                    </code>
                  ),
                },
              )}
            </p>
          )}
          {holder?.report && <p className="sync-report">{holder.report}</p>}
          {!!holder?.resolutions?.length && (
            <ul className="sync-resolutions">
              {holder.resolutions.map((entry) => (
                <li key={entry.path}>
                  <code>{entry.path}</code> {entry.resolution}
                </li>
              ))}
            </ul>
          )}
          {(open.length > 0 || running) && (
            <button
              type="button"
              className="button primary"
              onClick={onResolve}
              disabled={!canResolve || running}
            >
              {running ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Wand2 size={15} />
              )}
              {running ? t.resolving : t.resolve}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
