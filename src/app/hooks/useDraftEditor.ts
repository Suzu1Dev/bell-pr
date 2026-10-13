import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { api, send } from "../../api";
import type { Run } from "../../types";
import { validBranchName, type DraftProposal } from "../../../shared/drafts";
import type { DraftCheck, DraftTaskItem } from "../../../shared/draft-checks";
import type { Notify } from "../AppShell";

/** The draft checks bring a Markdown parser, so they load beside the first screen. */
type DraftChecks = typeof import("../../../shared/draft-checks");

interface DraftEditorOptions {
  run: Run;
  setRun: Dispatch<SetStateAction<Run>>;
  demo: boolean;
  /** The open run's id, read after awaits to drop answers for another run. */
  runIdRef: RefObject<string>;
  notify: Notify;
  setBusy: Dispatch<SetStateAction<boolean>>;
}

/**
 * The PR draft being edited (title, description, commit message and branch),
 * the preflight checks derived from it, and generating, applying and saving
 * a draft.
 */
export function useDraftEditor({
  run,
  setRun,
  demo,
  runIdRef,
  notify,
  setBusy,
}: DraftEditorOptions) {
  const [draftTitle, setDraftTitle] = useState(run.draft.title);
  const [draftBody, setDraftBody] = useState(run.draft.body);
  // Empty means "use the PR title alone", matching the server fallback.
  const [draftCommitMessage, setDraftCommitMessage] = useState(
    run.draft.commitMessage ?? "",
  );
  // Empty means "push the run's own branch", matching the server fallback.
  const [draftPublishBranch, setDraftPublishBranch] = useState(
    run.draft.publishBranch ?? "",
  );
  // Preflight items confirmed in the publish dialog; never saved.
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [draftChecks, setDraftChecks] = useState<DraftChecks>();
  useEffect(() => {
    let cancelled = false;
    void import("../../../shared/draft-checks").then((module) => {
      if (!cancelled) setDraftChecks(module);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [draftPreview, setDraftPreview] = useState(false);
  const persistedDraft = useRef({ id: run.id, ...run.draft });
  const draftMutationEpoch = useRef(0);
  const editorDraft = useRef({
    title: draftTitle,
    body: draftBody,
    commitMessage: draftCommitMessage,
    publishBranch: draftPublishBranch,
  });
  editorDraft.current = {
    title: draftTitle,
    body: draftBody,
    commitMessage: draftCommitMessage,
    publishBranch: draftPublishBranch,
  };
  const pendingDrafts = useRef(new Set<string>());
  const [draftRequests, setDraftRequests] = useState<Set<string>>(new Set());
  const draftDirty =
    draftTitle !== run.draft.title ||
    draftBody !== run.draft.body ||
    draftCommitMessage.trim() !== (run.draft.commitMessage ?? "") ||
    draftPublishBranch.trim() !== (run.draft.publishBranch ?? "");
  // The same checks the server runs before approving and publishing; empty
  // until the checks module has loaded, and the server enforces them anyway.
  const draftSources = run.draftPreparation?.context?.sources;
  const proposalBody = run.draftPreparation?.proposal?.body;
  const draftUnfinished = draftChecks
    ?.draftPreflight({ body: draftBody })
    .find((check) => check.kind === "block");
  const draftTasks: DraftTaskItem[] = draftChecks?.draftTaskItems(draftBody) ?? [];
  const draftTaskGroups = [
    ...draftTasks
      .reduce(
        (groups, item) =>
          groups.set(item.heading, [...(groups.get(item.heading) ?? []), item]),
        new Map<string, typeof draftTasks>(),
      )
      .entries(),
  ];
  // Ticking template boxes is not a rewrite of the model's text.
  const draftIsProposal =
    !!proposalBody?.trim() &&
    !!draftChecks?.sameDraftProse(draftBody, proposalBody);
  const publishBranchError = !draftPublishBranch.trim()
    ? ""
    : !validBranchName(draftPublishBranch.trim())
      ? "分支名稱只能用英數字與 . _ - /，不能有 ..，也不能以 . 或 .lock 結尾。"
      : draftPublishBranch.trim().toLowerCase() === run.baseBranch.toLowerCase()
        ? `不能用目標分支 ${run.baseBranch}，否則會直接推送到目標分支而不是建立 PR。`
        : "";
  const publishBranchInvalid = !!publishBranchError;
  const publishChecks: DraftCheck[] =
    draftChecks?.draftPreflight({
      body: run.draft.body,
      sources: draftSources,
      proposalBody,
    }) ?? [];
  const publishBlocked = publishChecks.find((check) => check.kind === "block");
  const publishConfirmations = publishChecks.filter(
    (check) => check.kind === "confirm",
  );
  const commitMessageSuggestion =
    run.draftPreparation?.status === "ready"
      ? run.draftPreparation.proposal?.commitMessageSuggestion
      : undefined;
  useEffect(() => {
    const previous = persistedDraft.current;
    const edited = editorDraft.current;
    // Background draft generation must not discard text the user is editing.
    if (
      previous.id !== run.id ||
      (edited.title === previous.title &&
        edited.body === previous.body &&
        edited.commitMessage.trim() === (previous.commitMessage ?? "") &&
        edited.publishBranch.trim() === (previous.publishBranch ?? ""))
    ) {
      setDraftTitle(run.draft.title);
      setDraftBody(run.draft.body);
      setDraftCommitMessage(run.draft.commitMessage ?? "");
      setDraftPublishBranch(run.draft.publishBranch ?? "");
    }
    persistedDraft.current = { id: run.id, ...run.draft };
  }, [
    run.id,
    run.draft.title,
    run.draft.body,
    run.draft.commitMessage,
    run.draft.publishBranch,
  ]);
  async function prepareDraft() {
    const id = run.id;
    const epoch = draftMutationEpoch.current;
    if (pendingDrafts.current.has(id)) return;
    pendingDrafts.current.add(id);
    setDraftRequests((previous) => new Set(previous).add(id));
    try {
      if (demo) {
        const { demoDraftPreparation } =
          await import("../../draft/DraftGuidancePanel");
        if (runIdRef.current === id)
          setRun((previous) => ({
            ...previous,
            draftPreparation: structuredClone(demoDraftPreparation),
          }));
      } else {
        const { run: updated } = await api<{ run: Run }>(
          `/runs/${id}/draft/prepare`,
          send("POST", { refresh: true }),
        );
        if (runIdRef.current === id)
          setRun((previous) =>
            epoch === draftMutationEpoch.current
              ? updated
              : { ...previous, draftPreparation: updated.draftPreparation },
          );
      }
    } catch (error) {
      if (runIdRef.current === id) notify((error as Error).message, "error");
    } finally {
      pendingDrafts.current.delete(id);
      setDraftRequests((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  }
  function applyDraftProposal(proposal: DraftProposal) {
    setDraftTitle(proposal.title);
    setDraftBody(proposal.body);
    // Like the server's automatic apply, a message the person wrote is kept.
    if (proposal.commitMessageSuggestion && !draftCommitMessage.trim())
      setDraftCommitMessage(proposal.commitMessageSuggestion.message);
    setDraftPreview(true);
    notify("建議草稿已放入編輯區，確認後請儲存草稿。");
  }
  function applyCommitMessageSuggestion() {
    if (!commitMessageSuggestion) return;
    setDraftCommitMessage(commitMessageSuggestion.message);
    notify("建議的提交訊息已放入欄位，可自行補上簽署後儲存。");
  }
  async function saveDraft() {
    if (!draftTitle.trim() || !draftBody.trim()) {
      notify("請填寫 PR 標題與說明。", "error");
      return;
    }
    if (publishBranchInvalid) {
      notify(`GitHub 分支：${publishBranchError}`, "error");
      return;
    }
    const commitMessage = draftCommitMessage.trim();
    const publishBranch = draftPublishBranch.trim();
    setBusy(true);
    draftMutationEpoch.current++;
    try {
      if (demo)
        setRun((previous) => ({
          ...previous,
          draft: {
            title: draftTitle,
            body: draftBody,
            ...(commitMessage ? { commitMessage } : {}),
            ...(publishBranch ? { publishBranch } : {}),
          },
          status: "review",
        }));
      else {
        const { run: updated } = await api<{ run: Run }>(
          `/runs/${run.id}/draft`,
          send("PATCH", {
            title: draftTitle,
            body: draftBody,
            commitMessage,
            publishBranch,
          }),
        );
        if (runIdRef.current === updated.id) setRun(updated);
      }
      notify("PR 草稿已儲存");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      // Discard reads begun before or during this mutation, even if they arrive later.
      draftMutationEpoch.current++;
      setBusy(false);
    }
  }
  return {
    draftTitle,
    setDraftTitle,
    draftBody,
    setDraftBody,
    draftCommitMessage,
    setDraftCommitMessage,
    draftPublishBranch,
    setDraftPublishBranch,
    acknowledged,
    setAcknowledged,
    draftChecks,
    draftPreview,
    setDraftPreview,
    draftMutationEpoch,
    editorDraft,
    draftRequests,
    draftDirty,
    draftUnfinished,
    draftTaskGroups,
    draftIsProposal,
    publishBranchError,
    publishBranchInvalid,
    publishBlocked,
    publishConfirmations,
    commitMessageSuggestion,
    prepareDraft,
    applyDraftProposal,
    applyCommitMessageSuggestion,
    saveDraft,
  };
}

export type DraftEditor = ReturnType<typeof useDraftEditor>;
