import {
  useEffect,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { api, send } from "../../api";
import { useT } from "../../i18n";
import type { DiffFile, Run } from "../../types";
import type { Notify, Tab } from "../AppShell";
import { readRunFiles } from "./useRunActions";

interface RunRoundsOptions {
  run: Run;
  setRun: Dispatch<SetStateAction<Run>>;
  /** The open run's id, read after awaits to drop answers for another run. */
  runIdRef: RefObject<string>;
  setFiles: Dispatch<SetStateAction<DiffFile[]>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  notify: Notify;
  setTab: Dispatch<SetStateAction<Tab>>;
}

/**
 * What the reader can do once the target branch moved or maintainers
 * reviewed the PR: sync the run onto the latest target branch, undo that
 * sync, have an agent resolve its conflicts, and start or discard a review
 * follow-up round from the feedback picked here.
 */
export function useRunRounds({
  run,
  setRun,
  runIdRef,
  setFiles,
  setBusy,
  notify,
  setTab,
}: RunRoundsOptions) {
  const t = useT("workspace").notices;
  // Feedback picked for the next review follow-up round, and the person's note.
  const [followUpSelection, setFollowUpSelection] = useState<string[]>([]);
  const [followUpNote, setFollowUpNote] = useState("");
  // The person's own words for each selected comment (the round's task).
  const [restatements, setRestatements] = useState<Record<string, string>>({});
  useEffect(() => {
    setFollowUpSelection([]);
    setFollowUpNote("");
    setRestatements({});
  }, [run.id]);
  useEffect(() => {
    const current = new Set(run.prFeedback?.items.map((item) => item.url) ?? []);
    setFollowUpSelection((previous) => {
      const kept = previous.filter((url) => current.has(url));
      return kept.length === previous.length ? previous : kept;
    });
  }, [run.prFeedback]);
  /**
   * Re-reads the diff after a sync, an undo or a discard moved the checkout.
   * A run whose files were freed has none: a discard can rescue such a run.
   */
  async function refreshFiles(id: string) {
    const files = await readRunFiles(id);
    if (runIdRef.current === id) setFiles(files);
  }
  async function syncToLatest() {
    setBusy(true);
    try {
      const result = await api<{ run: Run; updated: boolean; conflicts: string[] }>(
        `/runs/${run.id}/sync`,
        send("POST"),
      );
      if (runIdRef.current !== result.run.id) return;
      setRun(result.run);
      await refreshFiles(result.run.id);
      notify(
        !result.updated
          ? t.syncCurrent({ branch: run.baseBranch })
          : result.conflicts.length
            ? t.syncConflicts({ count: result.conflicts.length })
            : result.run.prUrl
              ? t.syncedPr
              : t.synced,
        result.conflicts.length ? "error" : "success",
      );
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function resolveSyncConflicts() {
    setBusy(true);
    try {
      const { run: updated } = await api<{ run: Run }>(
        `/runs/${run.id}/sync/resolve`,
        send("POST"),
      );
      if (runIdRef.current !== updated.id) return;
      setRun(updated);
      setTab("activity");
      notify(t.resolvingConflicts);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function undoSync() {
    if (!window.confirm(t.undoSyncConfirm)) return;
    setBusy(true);
    try {
      const { run: updated } = await api<{ run: Run }>(
        `/runs/${run.id}/sync/undo`,
        send("POST"),
      );
      if (runIdRef.current !== updated.id) return;
      setRun(updated);
      await refreshFiles(updated.id);
      notify(t.syncUndone);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function startFollowUp() {
    setBusy(true);
    try {
      const { run: updated } = await api<{ run: Run }>(
        `/runs/${run.id}/follow-ups`,
        send("POST", {
          feedbackUrls: followUpSelection,
          ...(followUpNote.trim() ? { note: followUpNote.trim() } : {}),
          ...(followUpSelection.length
            ? {
                restatements: followUpSelection.map((url) => ({
                  url,
                  text: (restatements[url] ?? "").trim(),
                })),
              }
            : {}),
        }),
      );
      if (runIdRef.current !== updated.id) return;
      setRun(updated);
      setFollowUpSelection([]);
      setFollowUpNote("");
      setRestatements({});
      setTab("activity");
      notify(t.followUpStarted);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function discardFollowUp() {
    if (!window.confirm(t.discardRoundConfirm)) return;
    setBusy(true);
    try {
      const { run: updated } = await api<{ run: Run }>(
        `/runs/${run.id}/follow-ups/discard`,
        send("POST"),
      );
      if (runIdRef.current !== updated.id) return;
      setRun(updated);
      await refreshFiles(updated.id);
      notify(t.roundDiscarded);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return {
    followUpSelection,
    setFollowUpSelection,
    followUpNote,
    setFollowUpNote,
    restatements,
    /** Sets the person's restatement of the comment at `url`. */
    setRestatement(url: string, text: string) {
      setRestatements((previous) => ({ ...previous, [url]: text }));
    },
    syncToLatest,
    resolveSyncConflicts,
    undoSync,
    startFollowUp,
    discardFollowUp,
  };
}

export type RunRounds = ReturnType<typeof useRunRounds>;
