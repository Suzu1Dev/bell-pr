import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { api } from "../../api";
import type { DiffFile, Run, RunSummary } from "../../types";
import { summarizeRun } from "../../../shared/runs";
import { activeFollowUp } from "../../../shared/followups";
import type { Tab } from "../AppShell";

interface RunPollingOptions {
  run: Run;
  demo: boolean;
  active: boolean;
  preparingDraft: boolean;
  reviewRerunning: boolean;
  /** Bumped by draft saves; a poll begun before a save is discarded. */
  draftMutationEpoch: RefObject<number>;
  setRun: Dispatch<SetStateAction<Run>>;
  setRuns: Dispatch<SetStateAction<RunSummary[]>>;
  setFiles: Dispatch<SetStateAction<DiffFile[]>>;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  setTab: Dispatch<SetStateAction<Tab>>;
  setApiError: Dispatch<SetStateAction<string>>;
}

/**
 * Polls the open run every 2.5 s while it is active, preparing a draft,
 * re-running the review or running a Learn-by-hand job (`byHand.busy`: the
 * guide, plan questions, the review at Ready, the person's tests), and
 * loads the diff once the team finishes.
 */
export function useRunPolling({
  run,
  demo,
  active,
  preparingDraft,
  reviewRerunning,
  draftMutationEpoch,
  setRun,
  setRuns,
  setFiles,
  setSelectedPath,
  setTab,
  setApiError,
}: RunPollingOptions) {
  const byHandBusy = !!run.byHand?.busy;
  useEffect(() => {
    if (demo || (!active && !preparingDraft && !reviewRerunning && !byHandBusy)) return;
    let cancelled = false;
    let observedStatus = run.status;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      const epoch = draftMutationEpoch.current;
      try {
        const { run: updated } = await api<{ run: Run }>(`/runs/${run.id}`);
        if (cancelled || epoch !== draftMutationEpoch.current) return;
        if (
          updated.status === "awaiting_plan" &&
          observedStatus !== "awaiting_plan"
        )
          setTab("activity");
        const wasActive = ["running", "queued", "awaiting_plan"].includes(
          observedStatus,
        );
        observedStatus = updated.status;
        if (
          wasActive &&
          !["running", "queued", "awaiting_plan"].includes(updated.status)
        ) {
          const { files: changed } = await api<{ files: DiffFile[] }>(
            `/runs/${run.id}/diff`,
          );
          if (!cancelled && epoch === draftMutationEpoch.current) {
            setFiles(changed);
            setSelectedPath(changed[0]?.path || "");
            if (updated.status === "review")
              setTab(
                activeFollowUp(updated.followUps) || updated.sync
                  ? "draft"
                  : "overview",
              );
          }
        }
        if (!cancelled && epoch === draftMutationEpoch.current) {
          setRun(updated);
          setRuns((previous) =>
            previous.map((r) =>
              r.id === updated.id ? summarizeRun(updated) : r,
            ),
          );
        }
      } catch (error) {
        if (!cancelled) setApiError((error as Error).message);
      } finally {
        polling = false;
      }
    };
    const interval = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    run.id,
    demo,
    active,
    preparingDraft,
    reviewRerunning,
    byHandBusy,
    // Refs and state setters never change; listed for the hooks lint rule.
    draftMutationEpoch,
    setRun,
    setRuns,
    setFiles,
    setSelectedPath,
    setTab,
    setApiError,
  ]);
}
