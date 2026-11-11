import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { activeFollowUp } from "../../shared/followups";
import { product } from "../../shared/product";
import { ApiError } from "../api";
import type { RunActions } from "../app/hooks/useRunActions";
import { useFormat, useT } from "../i18n";
import { Modal } from "../modals/Modal";
import type { Run } from "../types";

export function canRecoverHeldPaths(run: Run, busy: boolean) {
  if (!run.heldPaths?.length || busy || run.workspaceRemovedAt || run.publishing || run.session?.running)
    return false;
  if (
    run.prFeedback?.merged === true ||
    run.prFeedback?.prState?.toUpperCase() === "MERGED" ||
    (!run.prUrl && run.publishCommit)
  )
    return false;
  if (["review", "approved", "failed"].includes(run.status)) return true;
  return run.status === "published" && activeFollowUp(run.followUps)?.status === "review";
}

export function HoldRecoveryNotice({
  run,
  busy,
  actions,
}: {
  run: Run;
  busy: boolean;
  actions: Pick<RunActions, "restoreHeldPaths" | "recheckHeldPaths" | "notify">;
}) {
  const t = useT("workspace");
  const fmt = useFormat();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<"restore" | "recheck">();
  const [conflicts, setConflicts] = useState<Awaited<ReturnType<RunActions["recheckHeldPaths"]>>>([]);
  useEffect(() => {
    setConfirming(false);
    setPending(undefined);
    setConflicts([]);
  }, [run.id]);
  if (!canRecoverHeldPaths(run, busy)) return null;

  const paths = run.heldPaths!;
  const count = paths.length;
  const byPath = new Map(conflicts.map((conflict) => [conflict.path, conflict]));
  const restore = async () => {
    if (pending) return;
    setPending("restore");
    try {
      const result = await actions.restoreHeldPaths();
      setConfirming(false);
      setConflicts([]);
      if (result.refreshError) actions.notify(result.refreshError.message, "error");
      else actions.notify(t.notices.heldFilesRestored({
        count: result.restored,
        keptOtherChanges: result.files?.some((file) => !file.blocked) ?? true,
      }), "success");
    } catch (error) {
      actions.notify(
        error instanceof ApiError && error.status === 409 && error.details.reason === "stale"
          ? t.holdStop.restoreStale
          : t.holdStop.restoreFailed,
        "error",
      );
    } finally {
      setPending(undefined);
    }
  };
  const recheck = async () => {
    if (pending) return;
    setPending("recheck");
    try {
      const current = await actions.recheckHeldPaths();
      setConflicts(current);
      if (!current.length) {
        actions.notify(t.notices.holdCleared, "success");
        return;
      }
      const heldPaths = [...new Set(current.map((conflict) => conflict.path))];
      const holders = [...new Set(current.map((conflict) => conflict.holder))];
      const listedPaths = fmt.list(heldPaths, { type: "unit" });
      actions.notify(
        holders.length === 1
          ? t.notices.holdStillActiveBy({ who: holders[0], paths: listedPaths, pathCount: heldPaths.length })
          : t.notices.holdStillActiveMulti({
              count: heldPaths.length,
              holders: fmt.list(holders),
              paths: listedPaths,
            }),
        "error",
      );
    } catch {
      actions.notify(t.holdStop.recheckFailed({ name: product.name }), "error");
    } finally {
      setPending(undefined);
    }
  };

  return (
    <div className="run-notices hold-stop-container">
      <section className="run-notice hold-stop-notice" aria-labelledby={`hold-stop-${run.id}`}>
        <TriangleAlert size={16} aria-hidden="true" />
        <div className="run-notice-body">
          <h2 id={`hold-stop-${run.id}`}>{t.holdStop.heading({ count })}</h2>
          <p>{t.holdStop.body}</p>
          <ul className="hold-stop-list">
            {paths.map((path) => {
              const conflict = byPath.get(path);
              return (
                <li key={path}>
                  {conflict ? (
                    <>
                      <code>{path}</code>
                      <small>{t.holdStop.itemMeta({
                        holder: conflict.holder,
                        title: conflict.title,
                        since: fmt.dateTime(conflict.since),
                      })}</small>
                    </>
                  ) : (
                    <code>{t.holdStop.itemPathOnly({ path })}</code>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="hold-stop-actions">
            <button type="button" className="button primary" disabled={!!pending}
              aria-busy={pending === "restore"} onClick={() => setConfirming(true)}>
              {pending === "restore" ? t.holdStop.restoringAction : t.holdStop.restoreAction({ count })}
            </button>
            <button type="button" className="button secondary" disabled={!!pending}
              aria-busy={pending === "recheck"} onClick={() => void recheck()}>
              {pending === "recheck" ? t.holdStop.recheckingAction : t.holdStop.recheckAction}
            </button>
          </div>
        </div>
      </section>
      {confirming && (
        <Modal title={t.holdStop.restoreConfirmTitle}
          subtitle={t.holdStop.restoreConfirmBody({ count })}
          onClose={() => setConfirming(false)}>
          <div className="modal-actions">
            <button type="button" className="button secondary" disabled={!!pending}
              onClick={() => setConfirming(false)}>
              {t.holdStop.restoreCancelAction}
            </button>
            <button type="button" className="button primary" disabled={!!pending}
              aria-busy={pending === "restore"} onClick={() => void restore()}>
              {pending === "restore" ? t.holdStop.restoringAction : t.holdStop.restoreConfirmAction}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
