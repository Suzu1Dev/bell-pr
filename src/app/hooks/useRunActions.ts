import {
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { api, send } from "../../api";
import { demoRun, demoFiles, demoAnswer } from "../../demo";
import type { Repo, Run, RunSummary, DiffFile, ChatMessage } from "../../types";
import { summarizeRun } from "../../../shared/runs";
import { activeFollowUp } from "../../../shared/followups";
import { demoTeam } from "../../team/TeamBoard";
import type { ModalName, Notify, Page, Tab } from "../AppShell";
import type { DraftEditor } from "./useDraftEditor";
import type { TaskSetup } from "./useTaskSetup";

/** Persisted Q&A keyed the way the chat state is (`${runId}:${path}`). */
function savedMessages(run: Run): Record<string, ChatMessage[]> {
  return Object.fromEntries(
    Object.entries(run.conversations ?? {}).map(([filePath, conversation]) => [
      `${run.id}:${filePath}`,
      conversation.messages,
    ]),
  );
}

/**
 * What stopping a run reports, from the run as it was when the person pressed
 * stop and the run the server returned.
 */
export function stopNotice(before: Run, updated: Run, reviewRerunning: boolean) {
  const round = activeFollowUp(before.followUps);
  // The conflict agent of a sync, on the run itself or on a PR's sync round.
  if (before.sync?.resolving || round?.resolving)
    return "已停止解衝突；已改的檔案保留，可以自行完成，或再請 Agent 處理。";
  if (round?.status === "running" && !reviewRerunning)
    return activeFollowUp(updated.followUps)
      ? "這輪修正已停止；工作目錄保留了部分修改，請審閱、寫好提交訊息後推送，或放棄這輪修正。"
      : "這輪修正已停止，沒有修改任何檔案；PR 維持原狀。";
  if (["review", "approved"].includes(updated.status))
    return "已停止重新審查；原有報告與審閱狀態保留。";
  return updated.team?.tasks.length
    ? "任務已停止；本次工作的目錄與失敗任務的隔離目錄保留，可重試失敗的子任務。"
    : "任務已停止，工作目錄已保留。";
}

/** The demo run with the review progress and draft this browser kept. */
export function loadDemo(): Run {
  try {
    const saved = JSON.parse(localStorage.getItem("bellpr-demo-run") || "null");
    return saved?.id === demoRun.id
      ? {
          ...demoRun,
          team: structuredClone(demoTeam),
          reviewedFiles: saved.reviewedFiles || [],
          draft: saved.draft || demoRun.draft,
          status: saved.status === "approved" ? "approved" : "review",
        }
      : { ...demoRun, team: structuredClone(demoTeam) };
  } catch {
    return { ...demoRun, team: structuredClone(demoTeam) };
  }
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
    followUp,
  } = draft;
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
          ? "計畫尚未核准，已回到等待核准。"
          : "已重新排入：已整合的子任務不重跑，失敗的子任務重新開始。",
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
          ...(previous.team || demoTeam),
          messages: [
            ...(previous.team || demoTeam).messages,
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
    if (
      draftDirty &&
      !window.confirm("PR 草稿尚未儲存。確定切換任務並捨棄這次編輯？")
    )
      return false;
    const sequence = ++selectionSequence.current;
    const draftAtStart = { ...editorDraft.current };
    // Demo Q&A is answered locally and never persisted.
    let saved: Record<string, ChatMessage[]> = {};
    try {
      if (id === demoRun.id) {
        setRun(loadDemo());
        setFiles(demoFiles);
        setSelectedPath(demoFiles[0].path);
      } else {
        const [r, f] = await Promise.all([
          api<{ run: Run }>(`/runs/${id}`),
          api<{ files: DiffFile[] }>(`/runs/${id}/diff`),
        ]);
        if (sequence !== selectionSequence.current || intent !== navigationIntent.current) return false;
        if (
          editorDraft.current.title !== draftAtStart.title ||
          editorDraft.current.body !== draftAtStart.body ||
          editorDraft.current.commitMessage !== draftAtStart.commitMessage ||
          editorDraft.current.publishBranch !== draftAtStart.publishBranch
        ) {
          notify("草稿在切換期間已更新，已保留目前任務。");
          return false;
        }
        setRun(r.run);
        setFiles(f.files);
        setSelectedPath(f.files[0]?.path || "");
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
      notify("目前是示範資料。匯入自己的 repository 後可讀取真實差異。");
      return;
    }
    const id = run.id;
    try {
      const result = await api<{ files: DiffFile[] }>(`/runs/${id}/diff`);
      const current = await api<{ run: Run }>(`/runs/${id}`);
      if (runIdRef.current !== id) return;
      setFiles(result.files);
      setRun(current.run);
      notify("已讀取最新差異與審查狀態");
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }
  async function copyWorktreePath() {
    if (!run.worktreePath) return;
    try {
      await navigator.clipboard.writeText(run.worktreePath);
      notify("已複製工作目錄路徑");
    } catch {
      notify("無法使用剪貼簿，請直接選取路徑複製。", "error");
    }
  }
  async function rerunReview() {
    if (demo) {
      notify("目前是示範資料。匯入自己的 repository 後可重新執行審查。");
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
      notify("已開始依目前差異重新審查，報告完成後會出現在「審查者怎麼看」。");
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
      notify(`已匯入 ${repo.fullName}`);
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function startTask(event: FormEvent) {
    event.preventDefault();
    if (!settingsReady || settingsLoading) return;
    if (taskRepoId === "demo-repo") {
      localStorage.setItem(
        "bellpr-demo-settings",
        JSON.stringify(contributionSettings),
      );
      closeModal();
      notify("示範方向設定已儲存。匯入自己的 repository 後即可啟動真實團隊。");
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
        ? demoAnswer(targetFile, question)
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
            content: `這次未能取得回答：${(error as Error).message}`,
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
      notify("示範審查已完成！匯入你的 repository，即可建立真正的 PR。");
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
      notify(
        pushingRound
          ? "已把這輪修正推送到 PR，分支上多了一個 commit。"
          : "GitHub Draft PR 已建立",
      );
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
      notify("示範模式不會連線 GitHub 讀取回饋。");
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
        `已讀取 ${updated.prFeedback?.items.length ?? 0} 則維護者回饋。`,
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
      notify(stopNotice(run, updated, reviewRerunning));
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
