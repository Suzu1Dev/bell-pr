import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { api, ApiError, send } from "../../api";
import { demoAnswer, getDemo } from "../../demo";
import { useLocale, useT, type Messages } from "../../i18n";
import type { Repo, Run, RunSummary, DiffFile, ChatMessage } from "../../types";
import type { Locale } from "../../../shared/i18n/locale";
import { summarizeRun } from "../../../shared/runs";
import { activeFollowUp } from "../../../shared/followups";
import type { ModalName, Notify, Page, Tab } from "../AppShell";
import {
  demoRunInLocale,
  loadDemo,
  saveDemo,
  saveDemoSettings,
} from "./demoStorage";
import type { DraftEditor } from "./useDraftEditor";
import type { TaskSetup } from "./useTaskSetup";

/**
 * The run's changed files. A run whose working files were cleaned up
 * (410 `workspace_removed`) has none to show, but its reports, notes and
 * explanations stay readable, so it still opens.
 */
export async function readRunFiles(id: string): Promise<DiffFile[]> {
  try {
    return (await api<{ files: DiffFile[] }>(`/runs/${id}/diff`)).files;
  } catch (error) {
    if (error instanceof ApiError && error.code === "workspace_removed")
      return [];
    throw error;
  }
}

/** Persisted Q&A keyed the way the chat state is (`${runId}:${path}`). */
function savedMessages(run: Run): Record<string, ChatMessage[]> {
  return Object.fromEntries(
    Object.entries(run.conversations ?? {}).map(([filePath, conversation]) => [
      `${run.id}:${filePath}`,
      conversation.messages,
    ]),
  );
}

type Notices = Messages["workspace"]["notices"];

/**
 * What stopping a run reports, from the run as it was when the person pressed
 * stop and the run the server returned, in the language of `notices`.
 */
export function stopNotice(
  before: Run,
  updated: Run,
  reviewRerunning: boolean,
  notices: Notices,
) {
  const round = activeFollowUp(before.followUps);
  // The conflict agent of a sync, on the run itself or on a PR's sync round.
  if (before.sync?.resolving || round?.resolving) return notices.stopResolving;
  if (round?.status === "running" && !reviewRerunning)
    return activeFollowUp(updated.followUps)
      ? notices.stopRoundKept
      : notices.stopRoundEmpty;
  if (["review", "approved"].includes(updated.status))
    return notices.stopReview;
  return updated.team?.tasks.length ? notices.stopTeam : notices.stopTask;
}

interface RunActionsOptions {
  run: Run;
  setRun: Dispatch<SetStateAction<Run>>;
  /** The open run's id, read after awaits to drop answers for another run. */
  runIdRef: RefObject<string>;
  /** The changed file open in the code view. */
  file: DiffFile | undefined;
  setFiles: Dispatch<SetStateAction<DiffFile[]>>;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  demo: boolean;
  reviewRerunning: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setFormError: Dispatch<SetStateAction<string>>;
  notify: Notify;
  openModal: (value: ModalName) => void;
  closeModal: () => void;
  navigate: (value: Page) => void;
  setTab: Dispatch<SetStateAction<Tab>>;
  setShowExplanation: Dispatch<SetStateAction<boolean>>;
  setFocusMode: Dispatch<SetStateAction<boolean>>;
  setRepos: Dispatch<SetStateAction<Repo[]>>;
  setRuns: Dispatch<SetStateAction<RunSummary[]>>;
  setExploreRepoId: Dispatch<SetStateAction<string>>;
  /** Bumped by every navigation; a slow answer for an older one is dropped. */
  navigationIntent: RefObject<number>;
  /** Bumped by every run selection; a slow load for an older one is dropped. */
  selectionSequence: RefObject<number>;
  draft: DraftEditor;
  setup: TaskSetup;
}

/**
 * What the reader can do with runs: choose, start, review, ask about,
 * approve, publish and stop a run, steer its team, and import a repository.
 */
export function useRunActions({
  run,
  setRun,
  runIdRef,
  file,
  setFiles,
  setSelectedPath,
  demo,
  reviewRerunning,
  setBusy,
  setFormError,
  notify,
  openModal,
  closeModal,
  navigate,
  setTab,
  setShowExplanation,
  setFocusMode,
  setRepos,
  setRuns,
  setExploreRepoId,
  navigationIntent,
  selectionSequence,
  draft,
  setup,
}: RunActionsOptions) {
  const {
    draftDirty,
    editorDraft,
    draftTitle,
    draftBody,
    draftCommitMessage,
    draftPublishBranch,
    acknowledged,
    setAcknowledged,
    loadPublishChecks,
    followUp,
  } = draft;
  const t = useT("workspace").notices;
  const [locale] = useLocale();
  const demoContent = getDemo(locale);
  const {
    source,
    setSource,
    taskRepoId,
    setTaskRepoId,
    prompt,
    setPrompt,
    taskTitle,
    setTaskTitle,
    contributionSettings,
    settingsLoading,
    settingsReady,
  } = setup;
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [loadingChats, setLoadingChats] = useState<Set<string>>(new Set());
  const pendingChats = useRef(new Set<string>());
  const [chatRequests, setChatRequests] = useState<Record<string, number>>({});
  const rerunPending = useRef(new Set<string>());
  const [rerunRequests, setRerunRequests] = useState<Set<string>>(new Set());
  const chatLoading = loadingChats.has(`${run.id}:${file?.path}`);
  // The locale the open demo run's text is in; its progress is kept under it.
  const demoLocale = useRef(locale);
  useEffect(() => {
    if (demo) saveDemo(demoLocale.current, run);
  }, [demo, run]);
  // After a language switch, show the open run again so the text the server
  // writes for a request follows the new locale. The demo takes the new
  // locale's fixtures and keeps the reader's progress.
  const shownLocale = useRef(locale);
  const showInLocale = useRef((next: Locale) => void next);
  showInLocale.current = (next: Locale) => {
    if (demo) {
      demoLocale.current = next;
      setRun((previous) => demoRunInLocale(previous, next));
      setFiles(getDemo(next).files);
      return;
    }
    void reloadRun(run.id);
  };
  useEffect(() => {
    if (shownLocale.current === locale) return;
    shownLocale.current = locale;
    showInLocale.current(locale);
  }, [locale]);
  /** Reads the run and its diff again without a notice; errors stay quiet. */
  async function reloadRun(id: string) {
    const epoch = draft.draftMutationEpoch.current;
    try {
      const [current, files] = await Promise.all([
        api<{ run: Run }>(`/runs/${id}`),
        readRunFiles(id),
      ]);
      if (runIdRef.current !== id) return;
      setFiles(files);
      // A draft saved meanwhile is newer than this read.
      if (epoch === draft.draftMutationEpoch.current) setRun(current.run);
    } catch {
      // The open-run poll and the next action report connection problems.
    }
  }
  async function approveTeamPlan() {
    setBusy(true);
    try {
      const result = await api<{ run: Run }>(
        `/runs/${run.id}/plan/approve`,
        send("POST"),
      );
      if (runIdRef.current === result.run.id) setRun(result.run);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function reviseTeamPlan(feedback: string) {
    // Errors surface inline next to the textarea, like team messages.
    const result = await api<{ run: Run }>(
      `/runs/${run.id}/plan/revise`,
      send("POST", { feedback }),
    );
    if (runIdRef.current === result.run.id) setRun(result.run);
  }
  async function retryTeam(message: string) {
    setBusy(true);
    try {
      const result = await api<{ run: Run }>(
        `/runs/${run.id}/team/retry`,
        send("POST", message ? { message } : {}),
      );
      if (runIdRef.current === result.run.id) setRun(result.run);
      notify(
        result.run.status === "awaiting_plan"
          ? t.retryAwaitingPlan
          : t.retryQueued,
      );
    } finally {
      setBusy(false);
    }
  }
  async function sendTeamMessage(to: string, content: string) {
    if (demo) {
      setRun((previous) => ({
        ...previous,
        team: {
          ...(previous.team || demoContent.team),
          messages: [
            ...(previous.team || demoContent.team).messages,
            {
              id: crypto.randomUUID(),
              from: "user",
              to,
              content,
              createdAt: new Date().toISOString(),
              status: "queued",
              recipients: [],
              deliveredTo: [],
            },
          ],
        },
      }));
      return;
    }
    const result = await api<{ run: Run }>(
      `/runs/${run.id}/team/messages`,
      send("POST", { to, content }),
    );
    if (runIdRef.current === result.run.id) setRun(result.run);
  }
  async function chooseRun(id: string, reportError = true): Promise<boolean> {
    const intent = ++navigationIntent.current;
    if (id === run.id) {
      selectionSequence.current++;
      navigate("workspace");
      return true;
    }
    if (draftDirty && !window.confirm(t.discardDraftConfirm)) return false;
    const sequence = ++selectionSequence.current;
    const draftAtStart = { ...editorDraft.current };
    // Demo Q&A is answered locally and never persisted.
    let saved: Record<string, ChatMessage[]> = {};
    try {
      if (id === demoContent.run.id) {
        demoLocale.current = locale;
        setRun(loadDemo(locale));
        setFiles(demoContent.files);
        setSelectedPath(demoContent.files[0]?.path || "");
      } else {
        const [r, files] = await Promise.all([
          api<{ run: Run }>(`/runs/${id}`),
          readRunFiles(id),
        ]);
        if (sequence !== selectionSequence.current || intent !== navigationIntent.current) return false;
        if (
          editorDraft.current.title !== draftAtStart.title ||
          editorDraft.current.body !== draftAtStart.body ||
          editorDraft.current.commitMessage !== draftAtStart.commitMessage ||
          editorDraft.current.publishBranch !== draftAtStart.publishBranch
        ) {
          notify(t.draftChangedWhileSwitching);
          return false;
        }
        setRun(r.run);
        setFiles(files);
        setSelectedPath(files[0]?.path || "");
        saved = savedMessages(r.run);
      }
      setTab("overview");
      setMessages(saved);
      setChatRequests({});
      navigate("workspace");
      return true;
    } catch (error) {
      if (sequence !== selectionSequence.current || intent !== navigationIntent.current) return false;
      if (!reportError) throw error;
      notify((error as Error).message, "error");
      return false;
    }
  }
  async function refreshRun() {
    if (demo) {
      notify(t.demoRefresh);
      return;
    }
    const id = run.id;
    try {
      const files = await readRunFiles(id);
      const current = await api<{ run: Run }>(`/runs/${id}`);
      if (runIdRef.current !== id) return;
      setFiles(files);
      setRun(current.run);
      notify(t.refreshed);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }
  async function copyWorktreePath() {
    if (!run.worktreePath) return;
    try {
      await navigator.clipboard.writeText(run.worktreePath);
      notify(t.copiedWorktree);
    } catch {
      notify(t.clipboardUnavailable, "error");
    }
  }
  async function rerunReview() {
    if (demo) {
      notify(t.demoRerun);
      return;
    }
    const id = run.id;
    if (rerunPending.current.has(id) || reviewRerunning) return;
    rerunPending.current.add(id);
    setRerunRequests((previous) => new Set(previous).add(id));
    try {
      await api<{ run: Run }>(`/runs/${id}/review/rerun`, send("POST"));
      // The server refreshes the diff before reviewing; show the same version.
      const result = await api<{ files: DiffFile[] }>(`/runs/${id}/diff`);
      const current = await api<{ run: Run }>(`/runs/${id}`);
      if (runIdRef.current !== id) return;
      setFiles(result.files);
      setRun(current.run);
      notify(t.rerunStarted);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      rerunPending.current.delete(id);
      setRerunRequests((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  }
  async function importRepo(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const { repo } = await api<{ repo: Repo }>(
        "/repos",
        send("POST", { source: source.trim() }),
      );
      setRepos((previous) => [
        ...previous.filter((r) => r.id !== repo.id),
        repo,
      ]);
      setTaskRepoId(repo.id);
      setSource("");
      closeModal();
      setExploreRepoId(repo.id);
      navigate("explore");
      notify(t.imported({ name: repo.fullName }));
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function startTask(event: FormEvent) {
    event.preventDefault();
    if (!settingsReady || settingsLoading) return;
    if (taskRepoId === demoContent.repo.id) {
      saveDemoSettings(locale, contributionSettings);
      closeModal();
      notify(t.demoDirectionSaved);
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const { run: created } = await api<{ run: Run }>(
        "/runs",
        send("POST", {
          repoId: taskRepoId,
          prompt: prompt.trim(),
          title: taskTitle.trim() || undefined,
          settings: contributionSettings,
        }),
      );
      setRuns((previous) => [summarizeRun(created), ...previous]);
      setRun(created);
      setFiles([]);
      setMessages({});
      setTab("activity");
      setPrompt("");
      setTaskTitle("");
      closeModal();
      navigate("workspace");
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reviewFile() {
    if (!file) return;
    const reviewed = !run.reviewedFiles.includes(file.path);
    if (demo) {
      setRun((previous) => ({
        ...previous,
        status: "review",
        reviewedFiles: reviewed
          ? [...previous.reviewedFiles, file.path]
          : previous.reviewedFiles.filter((p) => p !== file.path),
      }));
      return;
    }
    try {
      const { run: updated } = await api<{ run: Run }>(
        `/runs/${run.id}/review`,
        send("POST", {
          filePath: file.path,
          reviewed,
          fingerprint: file.fingerprint,
        }),
      );
      if (runIdRef.current === updated.id) setRun(updated);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }
  async function saveNote(text: string) {
    if (!file) return;
    if (demo) {
      // Demo notes live in local state only; no server call.
      setRun((previous) => {
        const notes = { ...previous.notes };
        if (text.trim())
          notes[file.path] = {
            text,
            fingerprint: file.fingerprint ?? "",
            updatedAt: new Date().toISOString(),
          };
        else delete notes[file.path];
        return { ...previous, notes };
      });
      return;
    }
    try {
      const { run: updated } = await api<{ run: Run }>(
        `/runs/${run.id}/notes`,
        send("PATCH", { filePath: file.path, text }),
      );
      if (runIdRef.current === updated.id) setRun(updated);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }
  async function ask(question: string) {
    setShowExplanation(true);
    setFocusMode(false);
    if (!file || !question.trim() || chatLoading) return;
    const key = `${run.id}:${file.path}`;
    if (pendingChats.current.has(key)) return;
    pendingChats.current.add(key);
    setChatRequests((previous) => ({
      ...previous,
      [key]: (previous[key] || 0) + 1,
    }));
    const targetRun = run.id;
    const targetFile = file;
    setMessages((previous) => ({
      ...previous,
      [key]: [
        ...(previous[key] || []),
        { role: "user", content: question, fingerprint: targetFile.fingerprint },
      ],
    }));
    setLoadingChats((previous) => new Set(previous).add(key));
    try {
      const answer = demo
        ? demoAnswer(targetFile, question, locale)
        : (
            await api<{ answer: string }>(
              `/runs/${targetRun}/chat`,
              send("POST", { filePath: targetFile.path, question }),
            )
          ).answer;
      setMessages((previous) => ({
        ...previous,
        [key]: [
          ...(previous[key] || []),
          {
            role: "assistant",
            content: answer,
            fingerprint: targetFile.fingerprint,
          },
        ],
      }));
    } catch (error) {
      setMessages((previous) => ({
        ...previous,
        [key]: [
          ...(previous[key] || []),
          {
            role: "assistant",
            content: t.chatFailed({ message: (error as Error).message }),
            failed: true,
          },
        ],
      }));
    } finally {
      pendingChats.current.delete(key);
      setLoadingChats((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  }
  async function approve() {
    setBusy(true);
    try {
      if (demo) setRun((previous) => ({ ...previous, status: "approved" }));
      else {
        const { run: updated } = await api<{ run: Run }>(
          `/runs/${run.id}/approve`,
          send("POST", {
            draft: {
              title: draftTitle,
              body: draftBody,
              commitMessage: draftCommitMessage.trim(),
              publishBranch: draftPublishBranch.trim(),
            },
          }),
        );
        if (runIdRef.current !== updated.id) return;
        setRun(updated);
        // The dialog asks for every confirmation the server will want.
        if (!followUp)
          await loadPublishChecks(updated.id, updated.approvedFingerprint);
        if (runIdRef.current !== updated.id) return;
      }
      setAcknowledged([]);
      openModal("publish");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (demo) {
      closeModal();
      notify(t.demoPublished);
      return;
    }
    setBusy(true);
    setFormError("");
    const pushingRound = !!followUp;
    try {
      const result = await api<{ run: Run; url?: string }>(
        `/runs/${run.id}/publish`,
        send("POST", { fingerprint: run.approvedFingerprint, acknowledged }),
      );
      setRun(result.run);
      closeModal();
      notify(pushingRound ? t.roundPushed : t.prCreated);
    } catch (error) {
      setFormError((error as Error).message);
      // A refused push may have saved the round's state; show it next to the error.
      if (pushingRound)
        void api<{ run: Run }>(`/runs/${run.id}`)
          .then(({ run: latest }) => {
            if (runIdRef.current === latest.id) setRun(latest);
          })
          .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }
  // Read-only and only on request: no timer refreshes maintainer feedback.
  async function fetchPrFeedback() {
    if (demo) {
      notify(t.demoFeedback);
      return;
    }
    setFeedbackLoading(true);
    try {
      const { run: updated } = await api<{ run: Run }>(
        `/runs/${run.id}/pr/feedback`,
        send("POST"),
      );
      if (runIdRef.current === updated.id) setRun(updated);
      notify(
        t.feedbackRead({ count: updated.prFeedback?.items.length ?? 0 }),
      );
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setFeedbackLoading(false);
    }
  }
  async function cancel() {
    try {
      const { run: updated } = await api<{ run: Run }>(
        `/runs/${run.id}/cancel`,
        send("POST"),
      );
      if (runIdRef.current === updated.id) {
        setRun(updated);
        const result = await api<{ files: DiffFile[] }>(
          `/runs/${updated.id}/diff`,
        );
        if (runIdRef.current === updated.id) {
          setFiles(result.files);
          setSelectedPath(result.files[0]?.path || "");
        }
      }
      notify(stopNotice(run, updated, reviewRerunning, t));
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }
  return {
    feedbackLoading,
    messages,
    chatRequests,
    setChatRequests,
    chatLoading,
    rerunRequests,
    approveTeamPlan,
    reviseTeamPlan,
    retryTeam,
    sendTeamMessage,
    chooseRun,
    refreshRun,
    copyWorktreePath,
    rerunReview,
    importRepo,
    startTask,
    reviewFile,
    saveNote,
    ask,
    approve,
    publish,
    fetchPrFeedback,
    cancel,
  };
}

export type RunActions = ReturnType<typeof useRunActions>;
