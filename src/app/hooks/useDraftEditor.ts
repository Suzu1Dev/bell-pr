import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { api, send } from "../../api";
import { getDemo } from "../../demo";
import { useLocale, useT } from "../../i18n";
import type { Run } from "../../types";
import {
  validBranchName,
  withAiDisclosure,
  withoutAiDisclosure,
  type DraftProposal,
} from "../../../shared/drafts";
import type { DraftCheck, DraftTaskItem } from "../../../shared/draft-checks";
import { activeFollowUp } from "../../../shared/followups";
import type { Notify } from "../AppShell";

/** The draft checks bring a Markdown parser, so they load beside the first screen. */
type DraftChecks = typeof import("../../../shared/draft-checks");

/**
 * The checks the publish dialog shows: the server's list when it has been
 * read (it also covers the commit e-mail, this computer's folders and the
 * changed CI files, which only the server knows), plus any check computed
 * here that it does not name.
 */
export function mergePublishChecks(
  local: DraftCheck[],
  server: DraftCheck[] | undefined,
): DraftCheck[] {
  if (!server) return local;
  return [
    ...server,
    ...local.filter((check) => !server.some((item) => item.id === check.id)),
  ];
}

interface DraftEditorOptions {
  run: Run;
  setRun: Dispatch<SetStateAction<Run>>;
  demo: boolean;
  /** The open run's id, read after awaits to drop answers for another run. */
  runIdRef: RefObject<string>;
  notify: Notify;
  setBusy: Dispatch<SetStateAction<boolean>>;
  /** The app setting that discloses AI assistance in every new draft. */
  alwaysDiscloseAi?: boolean;
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
  alwaysDiscloseAi,
}: DraftEditorOptions) {
  const t = useT("workspace").notices;
  // The checks report in the UI language, like the server's for this request.
  const [locale] = useLocale();
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
  // The server's publish checks for one approval (GET /runs/:id/preflight).
  const [serverChecks, setServerChecks] = useState<{
    runId: string;
    fingerprint?: string;
    checks: DraftCheck[];
  }>();
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
    ?.draftPreflight({ body: draftBody }, locale)
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
      ? t.branchInvalid
      : draftPublishBranch.trim().toLowerCase() === run.baseBranch.toLowerCase()
        ? t.branchIsTarget({ branch: run.baseBranch })
        : "";
  const publishBranchInvalid = !!publishBranchError;
  // A follow-up round pushes only a commit: the PR title and description stay.
  const followUp = activeFollowUp(run.followUps);
  const commitMessageUnfinished =
    !!followUp &&
    (!draftCommitMessage.trim() ||
      !!draftChecks?.findDraftPlaceholders(draftCommitMessage).length);
  const publishChecks: DraftCheck[] = followUp
    ? []
    : mergePublishChecks(
        draftChecks?.draftPreflight(
          {
            body: run.draft.body,
            sources: draftSources,
            proposalBody,
          },
          locale,
        ) ?? [],
        serverChecks?.runId === run.id &&
          serverChecks.fingerprint === run.approvedFingerprint
          ? serverChecks.checks
          : undefined,
      );
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
        const { draftPreparation } = getDemo(locale);
        if (runIdRef.current === id)
          setRun((previous) => ({
            ...previous,
            draftPreparation: structuredClone(draftPreparation),
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
  /**
   * Reads the checks the server runs before publishing this approval, so
   * the publish dialog can ask for every confirmation it needs. On failure
   * the local checks stay, and publishing names anything they miss.
   */
  const loadPublishChecks = useCallback(
    async (id: string, fingerprint?: string) => {
      try {
        const { checks } = await api<{ checks: DraftCheck[] }>(
          `/runs/${id}/preflight`,
        );
        if (runIdRef.current === id)
          setServerChecks({ runId: id, fingerprint, checks });
      } catch {
        if (runIdRef.current === id) setServerChecks(undefined);
      }
    },
    [runIdRef],
  );
  function applyDraftProposal(proposal: DraftProposal) {
    setDraftTitle(proposal.title);
    setDraftBody(proposal.body);
    // Like the server's automatic apply, a message the person wrote is kept.
    if (proposal.commitMessageSuggestion && !draftCommitMessage.trim())
      setDraftCommitMessage(proposal.commitMessageSuggestion.message);
    setDraftPreview(true);
    notify(t.proposalApplied);
  }
  function applyCommitMessageSuggestion() {
    if (!commitMessageSuggestion) return;
    setDraftCommitMessage(commitMessageSuggestion.message);
    notify(t.commitSuggestionApplied);
  }
  /**
   * Saves the editor's draft. With `aiDisclosure` it also saves the
   * AI-assistance choice, adding BELL's line to the description or
   * removing it (the server does the same).
   */
  async function persistDraft(aiDisclosure?: boolean) {
    const body =
      aiDisclosure === undefined
        ? draftBody
        : aiDisclosure
          ? withAiDisclosure(draftBody)
          : withoutAiDisclosure(draftBody);
    if (!draftTitle.trim() || !body.trim()) {
      notify(t.draftRequired, "error");
      return;
    }
    if (publishBranchInvalid) {
      notify(t.branchError({ error: publishBranchError }), "error");
      return;
    }
    const commitMessage = draftCommitMessage.trim();
    const publishBranch = draftPublishBranch.trim();
    setBusy(true);
    draftMutationEpoch.current++;
    try {
      let open = true;
      if (demo)
        setRun((previous) => {
          const chosen = aiDisclosure ?? previous.draft.aiDisclosure;
          return {
            ...previous,
            draft: {
              title: draftTitle,
              body,
              ...(commitMessage ? { commitMessage } : {}),
              ...(publishBranch ? { publishBranch } : {}),
              ...(chosen !== undefined ? { aiDisclosure: chosen } : {}),
            },
            status: "review",
          };
        });
      else {
        const { run: updated } = await api<{ run: Run }>(
          `/runs/${run.id}/draft`,
          send("PATCH", {
            title: draftTitle,
            body,
            commitMessage,
            publishBranch,
            ...(aiDisclosure !== undefined ? { aiDisclosure } : {}),
          }),
        );
        open = runIdRef.current === updated.id;
        if (open) setRun(updated);
      }
      // The editor shows the saved line, or no longer shows it.
      if (open && body !== draftBody) setDraftBody(body);
      if (aiDisclosure === undefined) notify(t.draftSaved);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      // Discard reads begun before or during this mutation, even if they arrive later.
      draftMutationEpoch.current++;
      setBusy(false);
    }
  }
  const saveDraft = () => persistDraft();
  /** Turns the PR's AI-assistance line on or off and saves the draft. */
  const setAiDisclosure = (on: boolean) => persistDraft(on);
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
    followUp,
    commitMessageUnfinished,
    publishChecks,
    publishBlocked,
    publishConfirmations,
    loadPublishChecks,
    commitMessageSuggestion,
    prepareDraft,
    applyDraftProposal,
    applyCommitMessageSuggestion,
    saveDraft,
    setAiDisclosure,
    alwaysDiscloseAi,
  };
}

export type DraftEditor = ReturnType<typeof useDraftEditor>;
