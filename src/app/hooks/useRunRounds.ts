import {
  useEffect,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { api, send } from "../../api";
import type { DiffFile, Run } from "../../types";
import type { Notify, Tab } from "../AppShell";

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
  // Feedback picked for the next review follow-up round, and the person's note.
  const [followUpSelection, setFollowUpSelection] = useState<string[]>([]);
  const [followUpNote, setFollowUpNote] = useState("");
  useEffect(() => {
    setFollowUpSelection([]);
    setFollowUpNote("");
  }, [run.id]);
  useEffect(() => {
    const current = new Set(run.prFeedback?.items.map((item) => item.url) ?? []);
    setFollowUpSelection((previous) => {
      const kept = previous.filter((url) => current.has(url));
      return kept.length === previous.length ? previous : kept;
    });
  }, [run.prFeedback]);
  /** Re-reads the diff after a sync, an undo or a discard moved the checkout. */
  async function refreshFiles(id: string) {
    const result = await api<{ files: DiffFile[] }>(`/runs/${id}/diff`);
    if (runIdRef.current === id) setFiles(result.files);
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
          ? `已是 ${run.baseBranch} 的最新版本，不需要同步。`
          : result.conflicts.length
            ? `已同步，但 ${result.conflicts.length} 個檔案有衝突；解決後才能核准。`
            : result.run.prUrl
              ? "已把最新目標分支合併進 PR，審閱後推送一個合併 commit。"
              : "已同步到最新目標分支；改到的檔案請重新審閱。",
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
      notify("Agent 正在解決衝突，完成後請逐檔審閱。");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function undoSync() {
    if (
      !window.confirm(
        "復原同步？工作會回到同步前的內容與基準，同步後在工作目錄做的修改會被移除。",
      )
    )
      return;
    setBusy(true);
    try {
      const { run: updated } = await api<{ run: Run }>(
        `/runs/${run.id}/sync/undo`,
        send("POST"),
      );
      if (runIdRef.current !== updated.id) return;
      setRun(updated);
      await refreshFiles(updated.id);
      notify("已復原同步。");
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
        }),
      );
      if (runIdRef.current !== updated.id) return;
      setRun(updated);
      setFollowUpSelection([]);
      setFollowUpNote("");
      setTab("activity");
      notify("已開始依回饋修正，完成後會請你審閱這輪的修改。");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function discardFollowUp() {
    if (
      !window.confirm(
        "放棄這輪修正？工作目錄裡這輪的修改會被移除，回到已推送的 PR 內容。",
      )
    )
      return;
    setBusy(true);
    try {
      const { run: updated } = await api<{ run: Run }>(
        `/runs/${run.id}/follow-ups/discard`,
        send("POST"),
      );
      if (runIdRef.current !== updated.id) return;
      setRun(updated);
      await refreshFiles(updated.id);
      notify("已放棄這輪修正。");
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
    syncToLatest,
    resolveSyncConflicts,
    undoSync,
    startFollowUp,
    discardFollowUp,
  };
}

export type RunRounds = ReturnType<typeof useRunRounds>;
