import { useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { activeFollowUp } from "../../shared/followups";
import { product } from "../../shared/product";
import { ApiError } from "../api";
import { heldConflicts, type HeldConflict, type RunActions } from "../app/hooks/useRunActions";
import { useFormat, useT } from "../i18n";
import { Modal } from "../modals/Modal";
import type { Run } from "../types";

const turnHeldPrefixes = [
  "The agent changed files someone else holds, so the run stopped. The changes are still in the checkout. ",
  // i18n-allow: parser
  "Agent 改到別人佔用的檔案，所以這項工作已停止。改動仍留在工作目錄裡。",
];

function isTurnHeldByOtherText(text: string | undefined): boolean {
  if (!text) return false;
  return turnHeldPrefixes.some((prefix) => text.startsWith(prefix));
}

export function hasLegacyHoldStop(run: Run): boolean {
  const round = activeFollowUp(run.followUps);
  return (
    isTurnHeldByOtherText(run.error) ||
    isTurnHeldByOtherText(round?.error) ||
    isTurnHeldByOtherText(run.sync?.report) ||
    (round?.kind === "sync" && isTurnHeldByOtherText(round.report))
  );
}

export function canRecoverHeldPaths(run: Run, busy: boolean) {
  const hasHeldStop = Boolean(run.heldPaths?.length) || hasLegacyHoldStop(run);
  if (!hasHeldStop || busy || run.workspaceRemovedAt || run.publishing || run.session?.running)
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

interface MinimalElement {
  nodeName: string;
  getAttribute(name: string): string | null;
  focus(): void;
  querySelectorAll?(match: (element: MinimalElement) => boolean): MinimalElement[];
}

function focusWorkspaceHeading() {
  if (typeof document === "undefined") return;
  if (typeof document.querySelector === "function") {
    const found = document.querySelector<HTMLElement>(".workspace-heading h1");
    if (found) {
      found.focus();
      return;
    }
  }
  const root = document.documentElement as unknown as MinimalElement | undefined;
  const heading = root
    ?.querySelectorAll?.((el) => (el.getAttribute("class") ?? "").split(/\s+/).includes("workspace-heading"))[0]
    ?.querySelectorAll?.((el) => el.nodeName === "H1")[0];
  heading?.focus();
}

interface NoticeState {
  runId: string;
  op: number;
  confirming: boolean;
  pending?: "restore" | "recheck";
  conflicts: HeldConflict[];
}

const emptyNoticeState = (runId: string): NoticeState => ({
  runId,
  op: 0,
  confirming: false,
  conflicts: [],
});

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
  const [state, setState] = useState<NoticeState>(() => emptyNoticeState(run.id));
  const current = state.runId === run.id ? state : emptyNoticeState(run.id);
  const activeRunId = useRef(run.id);
  activeRunId.current = run.id;
  const opSeq = useRef(0);
  const mounted = useRef(true);
  const recoverable = canRecoverHeldPaths(run, busy);
  const latestRecoverable = useRef(recoverable);
  latestRecoverable.current = recoverable;
  const focusHeadingForRun = useRef<string | undefined>(undefined);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const pendingRun = focusHeadingForRun.current;
    if (!pendingRun) return;
    focusHeadingForRun.current = undefined;
    if (pendingRun === run.id && !recoverable) {
      focusWorkspaceHeading();
    }
  });

  if (!recoverable) return null;

  const paths = run.heldPaths?.length
    ? run.heldPaths
    : [...new Set(current.conflicts.map((conflict) => conflict.path))];
  const legacy = !run.heldPaths?.length && !paths.length;
  const count = paths.length || 2;
  const byPath = new Map(current.conflicts.map((conflict) => [conflict.path, conflict]));

  const notifyHoldConflicts = (items: readonly HeldConflict[]) => {
    const heldPaths = [...new Set(items.map((conflict) => conflict.path))];
    const holders = [...new Set(items.map((conflict) => conflict.holder))];
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
  };

  /** The card goes once the stop is cleared: focus moves to the run's heading instead of being lost with its button. */
  const focusHeadingOnceGone = (targetRunId: string) => {
    if (latestRecoverable.current) {
      focusHeadingForRun.current = targetRunId;
    } else {
      focusHeadingForRun.current = undefined;
      focusWorkspaceHeading();
    }
  };

  const openConfirm = () => {
    if (current.pending) return;
    const targetRunId = run.id;
    setState((prev) => ({
      ...(prev.runId === targetRunId ? prev : emptyNoticeState(targetRunId)),
      confirming: true,
    }));
  };

  const closeConfirm = () => {
    if (current.pending === "restore") return;
    const targetRunId = run.id;
    setState((prev) =>
      prev.runId === targetRunId && prev.pending !== "restore"
        ? { ...prev, confirming: false }
        : prev,
    );
  };

  const restore = async () => {
    if (current.pending) return;
    const targetRunId = run.id;
    const op = ++opSeq.current;
    setState((prev) => ({
      runId: targetRunId,
      op,
      confirming: prev.runId === targetRunId ? prev.confirming : true,
      pending: "restore",
      conflicts: prev.runId === targetRunId ? prev.conflicts : [],
    }));
    try {
      const result = await actions.restoreHeldPaths();
      if (!mounted.current || activeRunId.current !== targetRunId) return;
      setState((prev) =>
        prev.runId === targetRunId && prev.op === op
          ? { ...prev, confirming: false, pending: undefined, conflicts: [] }
          : prev,
      );
      focusHeadingOnceGone(targetRunId);
      if (result.refreshError) actions.notify(result.refreshError.message, "error");
      else if (result.restored === 0) actions.notify(t.notices.holdCleared, "success");
      else actions.notify(t.notices.heldFilesRestored({
        count: result.restored,
        keptOtherChanges: result.files?.some((file) => !file.blocked) ?? true,
      }), "success");
    } catch (error) {
      if (!mounted.current || activeRunId.current !== targetRunId) return;
      const nextConflicts = heldConflicts(error);
      setState((prev) =>
        prev.runId === targetRunId && prev.op === op
          ? {
              ...prev,
              confirming: nextConflicts ? false : prev.confirming,
              pending: undefined,
              conflicts: nextConflicts ?? prev.conflicts,
            }
          : prev,
      );
      if (nextConflicts) {
        notifyHoldConflicts(nextConflicts);
      } else {
        actions.notify(
          error instanceof ApiError && (error.status === 409 || error.details.reason === "notJoined")
            ? error.message
            : t.holdStop.restoreFailed,
          "error",
        );
      }
    } finally {
      if (mounted.current) {
        setState((prev) =>
          prev.runId === targetRunId && prev.op === op && prev.pending !== undefined
            ? { ...prev, pending: undefined }
            : prev,
        );
      }
    }
  };

  const recheck = async () => {
    if (current.pending) return;
    const targetRunId = run.id;
    const op = ++opSeq.current;
    setState((prev) => ({
      runId: targetRunId,
      op,
      confirming: prev.runId === targetRunId ? prev.confirming : false,
      pending: "recheck",
      conflicts: prev.runId === targetRunId ? prev.conflicts : [],
    }));
    try {
      const nextConflicts = await actions.recheckHeldPaths();
      if (!mounted.current || activeRunId.current !== targetRunId) return;
      setState((prev) =>
        prev.runId === targetRunId && prev.op === op
          ? { ...prev, pending: undefined, conflicts: nextConflicts }
          : prev,
      );
      if (!nextConflicts.length) {
        focusHeadingOnceGone(targetRunId);
        actions.notify(t.notices.holdCleared, "success");
        return;
      }
      notifyHoldConflicts(nextConflicts);
    } catch (error) {
      if (!mounted.current || activeRunId.current !== targetRunId) return;
      setState((prev) =>
        prev.runId === targetRunId && prev.op === op
          ? { ...prev, pending: undefined }
          : prev,
      );
      actions.notify(
        error instanceof ApiError && (error.status === 409 || error.details.reason === "notJoined")
          ? error.message
          : t.holdStop.recheckFailed({ name: product.name }),
        "error",
      );
    } finally {
      if (mounted.current) {
        setState((prev) =>
          prev.runId === targetRunId && prev.op === op && prev.pending !== undefined
            ? { ...prev, pending: undefined }
            : prev,
        );
      }
    }
  };

  return (
    <div className="run-notices hold-stop-container">
      <section className="run-notice hold-stop-notice" aria-labelledby={`hold-stop-${run.id}`}>
        <TriangleAlert size={16} aria-hidden="true" />
        <div className="run-notice-body">
          <h2 id={`hold-stop-${run.id}`}>{t.holdStop.heading({ count })}</h2>
          <p>{legacy ? t.holdStop.legacyBody : t.holdStop.body}</p>
          {paths.length > 0 && (
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
          )}
          <div className="hold-stop-actions">
            <button type="button" className="button primary" disabled={!!current.pending}
              aria-busy={current.pending === "restore"} onClick={openConfirm}>
              {current.pending === "restore" ? t.holdStop.restoringAction : t.holdStop.restoreAction({ count })}
            </button>
            <button type="button" className="button secondary" disabled={!!current.pending}
              aria-busy={current.pending === "recheck"} onClick={() => void recheck()}>
              {current.pending === "recheck" ? t.holdStop.recheckingAction : t.holdStop.recheckAction}
            </button>
          </div>
        </div>
      </section>
      {current.confirming && (
        <Modal title={t.holdStop.restoreConfirmTitle}
          subtitle={legacy ? t.holdStop.legacyBody : t.holdStop.restoreConfirmBody({ count: paths.length })}
          mark={<TriangleAlert size={22} aria-hidden="true" />}
          onClose={closeConfirm}>
          <div className="modal-actions">
            <button type="button" className="button secondary" disabled={!!current.pending}
              onClick={closeConfirm}>
              {t.holdStop.restoreCancelAction}
            </button>
            <button type="button" className="button primary" disabled={!!current.pending}
              aria-busy={current.pending === "restore"} onClick={() => void restore()}>
              {current.pending === "restore" ? t.holdStop.restoringAction : t.holdStop.restoreConfirmAction}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
