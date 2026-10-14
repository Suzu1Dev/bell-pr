import { lazy, Suspense, type Dispatch, type SetStateAction } from "react";
import {
  AlertCircle,
  Check,
  Circle,
  CircleCheck,
  ExternalLink,
  Github,
  GitPullRequest,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useFormat, useT } from "../i18n";
import type { DiffFile, Run } from "../types";
import { groupPrFeedback, summarizeChecks } from "../../shared/pr-feedback";
import {
  followUpFeedbackLimit,
  followUpNoteLimit,
} from "../../shared/followups";
import type { Tab } from "../app/AppShell";
import { ErrorBoundary } from "../app/ErrorBoundary";
import type { DraftEditor } from "../app/hooks/useDraftEditor";
import type { RunActions } from "../app/hooks/useRunActions";
import type { RunRounds } from "../app/hooks/useRunRounds";
import { FollowUpRounds } from "../draft/FollowUpRounds";
import { SyncPanel } from "../draft/SyncPanel";

const DraftGuidancePanel = lazy(() =>
  import("../draft/DraftGuidancePanel").then((module) => ({
    default: module.DraftGuidancePanel,
  })),
);
/** Shared with the publish dialog, so the Markdown renderer loads once. */
export const MarkdownContent = lazy(() =>
  import("../review/MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);

interface DraftTabProps {
  run: Run;
  files: DiffFile[];
  demo: boolean;
  busy: boolean;
  active: boolean;
  preparingDraft: boolean;
  reviewedCount: number;
  allReviewed: boolean;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  setTab: Dispatch<SetStateAction<Tab>>;
  draft: Pick<
    DraftEditor,
    | "draftTitle"
    | "setDraftTitle"
    | "draftBody"
    | "setDraftBody"
    | "draftCommitMessage"
    | "setDraftCommitMessage"
    | "draftPublishBranch"
    | "setDraftPublishBranch"
    | "draftChecks"
    | "draftPreview"
    | "setDraftPreview"
    | "draftRequests"
    | "draftDirty"
    | "draftUnfinished"
    | "draftTaskGroups"
    | "draftIsProposal"
    | "publishBranchError"
    | "publishBranchInvalid"
    | "followUp"
    | "commitMessageUnfinished"
    | "commitMessageSuggestion"
    | "prepareDraft"
    | "applyDraftProposal"
    | "applyCommitMessageSuggestion"
    | "saveDraft"
  >;
  actions: Pick<RunActions, "feedbackLoading" | "fetchPrFeedback">;
  rounds: RunRounds;
}

/**
 * The PR draft tab: the target branch and syncing, review follow-up rounds,
 * contribution guide, draft editor, checklist and feedback.
 */
export function DraftTab({
  run,
  files,
  demo,
  busy,
  active,
  preparingDraft,
  reviewedCount,
  allReviewed,
  setSelectedPath,
  setTab,
  draft,
  actions,
  rounds,
}: DraftTabProps) {
  const t = useT("workspace");
  const optional = useT("common").optional;
  const fmt = useFormat();
  // The run's own branch is shown as code inside the help sentence.
  const [branchHelpBefore, branchHelpAfter = ""] =
    t.draft.branchHelp.split("{branch}");
  const {
    draftTitle,
    setDraftTitle,
    draftBody,
    setDraftBody,
    draftCommitMessage,
    setDraftCommitMessage,
    draftPublishBranch,
    setDraftPublishBranch,
    draftChecks,
    draftPreview,
    setDraftPreview,
    draftRequests,
    draftDirty,
    draftUnfinished,
    draftTaskGroups,
    draftIsProposal,
    publishBranchError,
    publishBranchInvalid,
    followUp,
    commitMessageUnfinished,
    commitMessageSuggestion,
    prepareDraft,
    applyDraftProposal,
    applyCommitMessageSuggestion,
    saveDraft,
  } = draft;
  const { feedbackLoading, fetchPrFeedback } = actions;
  const {
    followUpSelection,
    setFollowUpSelection,
    followUpNote,
    setFollowUpNote,
    syncToLatest,
    resolveSyncConflicts,
    undoSync,
    startFollowUp,
    discardFollowUp,
  } = rounds;
  return (
    <div className="draft-workspace">
      {/* A run has a base only once its checkout exists; a queued run has nothing to sync. */}
      {!demo && !!run.baseSha && (
        <SyncPanel
          run={run}
          busy={busy}
          onSync={() => void syncToLatest()}
          onResolve={() => void resolveSyncConflicts()}
          onUndo={() => void undoSync()}
        />
      )}
      {!!run.followUps?.length && (
        <FollowUpRounds
          rounds={run.followUps}
          headRepository={run.headRepository}
          feedback={run.prFeedback?.items}
          busy={busy || active}
          onDiscard={
            followUp && ["review", "approved"].includes(run.status)
              ? discardFollowUp
              : undefined
          }
        />
      )}
      {!followUp && (
      <ErrorBoundary resetKey={run.id}>
        <Suspense
          fallback={<p className="muted">{t.draft.loadingGuide}</p>}
        >
          <DraftGuidancePanel
            preparation={run.draftPreparation}
            busy={draftRequests.has(run.id)}
            disabled={
              active ||
              busy ||
              !["review", "approved"].includes(run.status)
            }
            demo={demo}
            issueUrl={run.contributionSettings?.issueUrl}
            onGenerate={prepareDraft}
            onApply={applyDraftProposal}
            applied={
              !!run.draftPreparation?.proposal &&
              draftTitle === run.draftPreparation.proposal.title &&
              !!draftChecks?.sameDraftProse(
                draftBody,
                run.draftPreparation.proposal.body,
              )
            }
          />
        </Suspense>
      </ErrorBoundary>
      )}
      <div className="draft-layout">
        <div className="draft-editor">
          <div className="section-heading">
            <div>
              <h2>{t.draft.heading}</h2>
              <p>{t.draft.subheading}</p>
            </div>
            <span className="draft-label">{t.draft.label}</span>
          </div>
          {followUp && (
            <div className="draft-origin-notice" role="status">
              <AlertCircle size={16} />
              <p>
                {followUp.kind === "sync"
                  ? t.draft.syncNotice
                  : t.draft.roundNotice}
              </p>
            </div>
          )}
          {!demo && !followUp && run.status !== "published" && draftIsProposal && (
            <div className="draft-origin-notice" role="status">
              <AlertCircle size={16} />
              <p>{t.draft.proposalNotice}</p>
            </div>
          )}
          {!demo &&
            !followUp &&
            run.status !== "published" &&
            !draftBody.trim() &&
            !preparingDraft && (
              <div className="draft-origin-notice" role="status">
                <AlertCircle size={16} />
                <p>{t.draft.emptyNotice}</p>
              </div>
            )}
          <label className="field-label" htmlFor="pr-title">
            {t.draft.titleLabel}
          </label>
          <input
            id="pr-title"
            className="text-input draft-title"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            disabled={run.status === "published" || !!followUp}
          />
          <div className="editor-toolbar">
            <div>
              <button
                className={!draftPreview ? "selected" : ""}
                onClick={() => setDraftPreview(false)}
              >
                {t.draft.edit}
              </button>
              <button
                className={draftPreview ? "selected" : ""}
                onClick={() => setDraftPreview(true)}
              >
                {t.draft.preview}
              </button>
            </div>
            <span>Markdown</span>
          </div>
          {draftPreview ? (
            <div className="markdown-preview">
              <ErrorBoundary resetKey={run.id}>
                <Suspense fallback={<p>{t.loadingPreview}</p>}>
                  <MarkdownContent>{draftBody}</MarkdownContent>
                </Suspense>
              </ErrorBoundary>
            </div>
          ) : (
            <textarea
              className="draft-textarea"
              aria-label={t.draft.bodyLabel}
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              disabled={run.status === "published" || !!followUp}
            />
          )}
          <label
            className="field-label"
            htmlFor="pr-commit-message"
          >
            {followUp ? t.draft.commitLabelRound : t.draft.commitLabel}{" "}
            <span>git commit</span>
          </label>
          <textarea
            id="pr-commit-message"
            className="draft-textarea draft-commit-message"
            aria-describedby="pr-commit-message-help"
            maxLength={4000}
            value={
              followUp
                ? draftCommitMessage
                : draftCommitMessage || draftTitle
            }
            onChange={(e) =>
              setDraftCommitMessage(e.target.value)
            }
            disabled={run.status === "published"}
          />
          <p id="pr-commit-message-help" className="field-help">
            {followUp ? t.draft.commitHelpRound : t.draft.commitHelp}
          </p>
          <label
            className="field-label"
            htmlFor="pr-publish-branch"
          >
            {t.draft.branchLabel} <span>git push</span>
          </label>
          <input
            id="pr-publish-branch"
            className="text-input"
            value={draftPublishBranch}
            placeholder={run.branch}
            spellCheck={false}
            aria-describedby="pr-publish-branch-help"
            aria-invalid={publishBranchInvalid}
            onChange={(e) => setDraftPublishBranch(e.target.value)}
            disabled={
              run.status === "published" ||
              !!run.publishedBranch ||
              !!followUp
            }
          />
          <p id="pr-publish-branch-help" className="field-help">
            {branchHelpBefore}
            <code>{run.branch}</code>
            {branchHelpAfter}
            {run.publishedBranch && t.draft.branchLocked}
          </p>
          {publishBranchInvalid && (
            <p role="alert" className="inline-error">
              {publishBranchError}
            </p>
          )}
          {commitMessageSuggestion && !followUp && (
            <div className="commit-suggestion">
              <div>
                <strong>{t.draft.suggestionTitle}</strong>
                <p>{commitMessageSuggestion.rationale}</p>
              </div>
              <pre>{commitMessageSuggestion.message}</pre>
              <div className="commit-suggestion-actions">
                <span>{t.draft.suggestionNote}</span>
                <button
                  type="button"
                  className="button secondary"
                  disabled={run.status === "published"}
                  onClick={applyCommitMessageSuggestion}
                >
                  {t.draft.useSuggestion}
                </button>
              </div>
            </div>
          )}
          <div className="draft-save-row">
            <span>
              {demo ? t.draft.savedInBrowser : t.draft.savedLocally}
            </span>
            <button
              className="button primary"
              disabled={
                busy || !draftDirty || run.status === "published"
              }
              onClick={saveDraft}
            >
              {busy ? (
                <Loader2 className="spin" size={15} />
              ) : (
                <Check size={15} />
              )}
              {t.draft.save}
            </button>
          </div>
        </div>
        <aside className="publish-checklist">
          <div className="checklist-icon">
            <GitPullRequest size={24} />
          </div>
          <h3>{t.checklist.title}</h3>
          <p>{t.checklist.text}</p>
          <div
            className={
              allReviewed
                ? "checklist-item checked"
                : "checklist-item"
            }
          >
            {allReviewed ? (
              <CircleCheck size={18} />
            ) : (
              <Circle size={18} />
            )}
            <span>
              {t.checklist.allReviewed}
              <small>
                {t.checklist.files({
                  reviewed: reviewedCount,
                  total: files.length,
                })}
              </small>
            </span>
          </div>
          <div
            className={
              !draftDirty
                ? "checklist-item checked"
                : "checklist-item"
            }
          >
            {!draftDirty ? (
              <CircleCheck size={18} />
            ) : (
              <Circle size={18} />
            )}
            <span>
              {t.checklist.saved}
              <small>
                {draftDirty ? t.checklist.unsaved : t.checklist.canAdjust}
              </small>
            </span>
          </div>
          {followUp ? (
            <div
              className={
                commitMessageUnfinished
                  ? "checklist-item"
                  : "checklist-item checked"
              }
            >
              {commitMessageUnfinished ? (
                <Circle size={18} />
              ) : (
                <CircleCheck size={18} />
              )}
              <span>
                {t.checklist.commitReady}
                <small>
                  {commitMessageUnfinished
                    ? t.checklist.commitMissing
                    : t.checklist.commitBecomes}
                </small>
              </span>
            </div>
          ) : (
          <>
          <div
            className={
              draftBody.trim() && !draftUnfinished
                ? "checklist-item checked"
                : "checklist-item"
            }
          >
            {draftBody.trim() && !draftUnfinished ? (
              <CircleCheck size={18} />
            ) : (
              <Circle size={18} />
            )}
            <span>
              {t.checklist.noPlaceholders}
              <small>
                {!draftBody.trim()
                  ? t.checklist.noDescription
                  : draftUnfinished
                    ? draftUnfinished.details.join("\n")
                    : t.checklist.placeholdersStay}
              </small>
            </span>
          </div>
          {draftTaskGroups.length > 0 && (
            <fieldset
              className="draft-task-items"
              disabled={run.status === "published" || busy}
            >
              <legend>{t.checklist.taskItems}</legend>
              <p>{t.checklist.taskItemsHelp}</p>
              {draftTaskGroups.map(([heading, items]) => (
                <div key={`${heading}:${items[0].line}`}>
                  <strong>{heading || t.checklist.noSection}</strong>
                  {items.map((item) => (
                    <label key={item.line}>
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setDraftBody((body) =>
                            draftChecks
                              ? draftChecks.setDraftTaskItem(
                                  body,
                                  item.line,
                                  checked,
                                )
                              : body,
                          );
                        }}
                      />
                      <span>{item.text}</span>
                    </label>
                  ))}
                </div>
              ))}
            </fieldset>
          )}
          </>
          )}
          <div className="checklist-item">
            <ShieldCheck size={18} />
            {followUp ? (
              <span>
                {t.checklist.samePr}
                <small>{t.checklist.samePrHelp}</small>
              </span>
            ) : (
              <span>
                {t.checklist.draftPr}
                <small>{t.checklist.draftPrHelp}</small>
              </span>
            )}
          </div>
        </aside>
      </div>
      {run.status === "published" && run.prUrl && (
        <section
          className="pr-feedback"
          aria-labelledby="pr-feedback-title"
        >
          <div className="section-heading">
            <div>
              <h2 id="pr-feedback-title">{t.feedback.title}</h2>
              <p>{t.feedback.intro}</p>
            </div>
            <div className="pr-feedback-actions">
              <a
                className="button secondary"
                href={run.prUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Github size={15} />
                {t.feedback.viewPullRequest}
                <ExternalLink size={13} />
              </a>
              <button
                className="button primary"
                disabled={feedbackLoading}
                onClick={fetchPrFeedback}
              >
                {feedbackLoading ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  <RefreshCw size={15} />
                )}
                {run.prFeedback ? t.feedback.fetchAgain : t.feedback.fetch}
              </button>
            </div>
          </div>
          {run.prFeedback ? (
            <>
              <p className="pr-feedback-meta">
                {[
                  t.feedback.fetchedAt({
                    time: fmt.dateTime(run.prFeedback.fetchedAt),
                  }),
                  run.prFeedback.checks &&
                    (() => {
                      const checks = summarizeChecks(run.prFeedback.checks);
                      const state = run.prFeedback.checksState || undefined;
                      return checks.total
                        ? t.feedback.checks({ ...checks, state })
                        : t.feedback.noChecks({ state });
                    })(),
                  !!run.prFeedback.labels?.length &&
                    t.feedback.labels({
                      labels: fmt.list(run.prFeedback.labels, { type: "unit" }),
                    }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {run.prFeedback.labels?.some((label) =>
                label.startsWith("needs:"),
              ) && (
                <p className="pr-feedback-warning">{t.feedback.needsLabel}</p>
              )}
              {run.prFeedback.checks?.some(
                (check) =>
                  !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(
                    check.state.toUpperCase(),
                  ),
              ) && (
                <ul className="pr-feedback-checks">
                  {run.prFeedback.checks
                    .filter(
                      (check) =>
                        !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(
                          check.state.toUpperCase(),
                        ),
                    )
                    .map((check) => (
                      <li key={`${check.name}:${check.url ?? ""}`}>
                        <span>{check.name}</span>
                        <b>{check.state}</b>
                        {check.url && (
                          <a
                            href={check.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t.feedback.details}
                          </a>
                        )}
                      </li>
                    ))}
                </ul>
              )}
              {run.prFeedback.warnings?.map((warning) => (
                <p className="pr-feedback-warning" key={warning}>
                  {warning}
                </p>
              ))}
              {run.prFeedback.items.length === 0 && (
                <p className="muted">{t.feedback.noItems}</p>
              )}
              {groupPrFeedback(run.prFeedback.items).map(
                (group, groupIndex) => (
                  <div
                    className="pr-feedback-group"
                    key={group.path ?? "general"}
                  >
                    <div className="pr-feedback-group-head">
                      <strong>
                        {group.path ?? t.feedback.general}
                      </strong>
                      {group.path &&
                        files.some(
                          (f) => f.path === group.path,
                        ) && (
                          <button
                            className="button secondary"
                            onClick={() => {
                              setSelectedPath(group.path!);
                              setTab("changes");
                            }}
                          >
                            {t.feedback.openInChanges}
                          </button>
                        )}
                    </div>
                    <ul>
                      {group.items.map((item, itemIndex) => (
                        <li key={item.url}>
                          <div className="pr-feedback-item-head">
                            {!followUp && (
                              <input
                                type="checkbox"
                                aria-label={t.feedback.include({
                                  author: item.author,
                                  path: group.path,
                                  line:
                                    typeof item.line === "number"
                                      ? item.line
                                      : undefined,
                                })}
                                aria-describedby={`pr-feedback-body-${groupIndex}-${itemIndex}`}
                                checked={followUpSelection.includes(item.url)}
                                // At the limit only selected items stay changeable.
                                disabled={
                                  busy ||
                                  (!followUpSelection.includes(item.url) &&
                                    followUpSelection.length >=
                                      followUpFeedbackLimit)
                                }
                                onChange={(event) => {
                                  const checked = event.target.checked;
                                  setFollowUpSelection((previous) =>
                                    checked
                                      ? [...previous, item.url]
                                      : previous.filter(
                                          (url) => url !== item.url,
                                        ),
                                  );
                                }}
                              />
                            )}
                            <strong>{item.author}</strong>
                            <span>{item.authorAssociation}</span>
                            {item.state && <span>{item.state}</span>}
                            {typeof item.line === "number" && (
                              <span>{t.feedback.line({ line: item.line })}</span>
                            )}
                            {item.isResolved && (
                              <span>{t.feedback.resolved}</span>
                            )}
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t.feedback.openOnGitHub}
                            </a>
                          </div>
                          <p
                            id={`pr-feedback-body-${groupIndex}-${itemIndex}`}
                          >
                            {item.body}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              )}
              {!followUp && (
                <div className="follow-up-start">
                  <h3>{t.followUp.title}</h3>
                  <p>{t.followUp.intro}</p>
                  <p
                    className="field-help"
                    id="follow-up-limit"
                    role="status"
                  >
                    {t.followUp.limit({
                      limit: followUpFeedbackLimit,
                      selected: followUpSelection.length,
                    })}
                  </p>
                  <label className="field-label" htmlFor="follow-up-note">
                    {t.followUp.note} <span>{optional}</span>
                  </label>
                  <textarea
                    id="follow-up-note"
                    className="text-input follow-up-note-input"
                    value={followUpNote}
                    maxLength={followUpNoteLimit}
                    placeholder={t.followUp.placeholder}
                    onChange={(event) => setFollowUpNote(event.target.value)}
                    disabled={busy}
                  />
                  <button
                    className="button primary"
                    aria-describedby="follow-up-limit"
                    disabled={
                      busy ||
                      feedbackLoading ||
                      followUpSelection.length > followUpFeedbackLimit ||
                      (!followUpSelection.length && !followUpNote.trim())
                    }
                    onClick={startFollowUp}
                  >
                    <Play size={15} />
                    {followUpSelection.length
                      ? t.followUp.startSelected({
                          count: followUpSelection.length,
                        })
                      : t.followUp.startNote}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="muted">{t.feedback.notFetched}</p>
          )}
        </section>
      )}
    </div>
  );
}
