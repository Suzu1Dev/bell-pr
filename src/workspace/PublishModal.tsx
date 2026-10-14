import { Suspense, type Dispatch, type SetStateAction } from "react";
import {
  BookOpen,
  CircleCheck,
  GitBranch,
  Github,
  GitPullRequest,
  Loader2,
} from "lucide-react";
import { useT } from "../i18n";
import type { DiffFile, Repo, Run } from "../types";
import type { Tab } from "../app/AppShell";
import { ErrorBoundary } from "../app/ErrorBoundary";
import type { DraftEditor } from "../app/hooks/useDraftEditor";
import { Modal } from "../modals/Modal";
import { MarkdownContent } from "./DraftTab";

interface PublishModalProps {
  run: Run;
  files: DiffFile[];
  demo: boolean;
  currentRepo: Repo | undefined;
  additions: number;
  deletions: number;
  busy: boolean;
  formError: string;
  draft: Pick<
    DraftEditor,
    | "draftChecks"
    | "publishBlocked"
    | "publishConfirmations"
    | "acknowledged"
    | "setAcknowledged"
    | "followUp"
  >;
  publish: () => void;
  closeModal: () => void;
  setTab: Dispatch<SetStateAction<Tab>>;
}

/**
 * The last look before the approved branch is pushed as a Draft PR, or a
 * follow-up round as one more commit on the PR's branch.
 */
export function PublishModal({
  run,
  files,
  demo,
  currentRepo,
  additions,
  deletions,
  busy,
  formError,
  draft,
  publish,
  closeModal,
  setTab,
}: PublishModalProps) {
  const workspace = useT("workspace");
  const t = workspace.publish;
  const {
    draftChecks,
    publishBlocked,
    publishConfirmations,
    acknowledged,
    setAcknowledged,
    followUp,
  } = draft;
  return (
    <Modal
      title={
        demo
          ? t.titleDemo
          : followUp?.kind === "sync"
            ? t.titleSync
            : followUp
              ? t.titleRound
              : t.title
      }
      subtitle={
        demo
          ? t.subtitleDemo
          : followUp?.kind === "sync"
            ? t.subtitleSync
            : followUp
              ? t.subtitleRound
              : t.subtitle
      }
      onClose={closeModal}
    >
      <div className="publish-summary">
        <span>
          <Github size={16} />
          {currentRepo?.fullName}
        </span>
        <h3>{run.draft.title}</h3>
        <div>
          <GitBranch size={14} />
          {followUp
            ? (run.publishedBranch ?? run.branch)
            : run.draft.publishBranch || run.branch}
          <span>→</span>
          {run.baseBranch}
        </div>
        <p>
          <CircleCheck size={15} />
          {t.filesReviewed({ count: files.length })}{" "}
          <b>
            +{additions} −{deletions}
          </b>
        </p>
      </div>
      {demo && (
        <div className="callout">
          <BookOpen size={18} />
          <p>{t.demoCallout}</p>
        </div>
      )}
      {!demo && followUp && (
        <div className="publish-commit-preview">
          <strong>{t.commitPreview}</strong>
          <pre>{run.draft.commitMessage}</pre>
        </div>
      )}
      {!demo && !followUp && (
        <details className="publish-body-preview" open>
          <summary>
            {draftChecks
              ? t.bodyPreviewWords({
                  count: draftChecks.draftProseWords(run.draft.body),
                })
              : t.bodyPreview}
          </summary>
          <div className="markdown-preview">
            <ErrorBoundary>
              <Suspense fallback={<p>{workspace.loadingPreview}</p>}>
                <MarkdownContent>{run.draft.body}</MarkdownContent>
              </Suspense>
            </ErrorBoundary>
          </div>
        </details>
      )}
      {!demo && publishBlocked && (
        <p role="alert" className="inline-error">
          {[publishBlocked.message, ...publishBlocked.details].join("\n")}
        </p>
      )}
      {!demo && publishConfirmations.length > 0 && (
        <fieldset className="publish-confirmations">
          <legend>{t.confirmLegend}</legend>
          {publishConfirmations.map((check) => (
            <label key={check.id}>
              <input
                type="checkbox"
                checked={acknowledged.includes(check.id)}
                onChange={(event) =>
                  setAcknowledged((previous) =>
                    event.target.checked
                      ? [...previous, check.id]
                      : previous.filter((id) => id !== check.id),
                  )
                }
              />
              <span>
                {check.message}
                {check.details.map((detail) => (
                  <small key={detail}>{detail}</small>
                ))}
              </span>
            </label>
          ))}
          <p>{t.confirmNote}</p>
        </fieldset>
      )}
      {formError && (
        <p role="alert" className="inline-error">
          {formError}
        </p>
      )}
      <div className="modal-actions">
        <button
          className="button secondary"
          onClick={() => {
            closeModal();
            setTab("draft");
          }}
        >
          {t.back}
        </button>
        <button
          className="button primary"
          disabled={
            busy ||
            (!demo &&
              (!draftChecks ||
                !!publishBlocked ||
                publishConfirmations.some(
                  (check) => !acknowledged.includes(check.id),
                )))
          }
          onClick={publish}
        >
          {busy ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <GitPullRequest size={16} />
          )}{" "}
          {demo
            ? t.finishDemo
            : busy
              ? t.sending
              : followUp
                ? t.pushRound
                : t.submit}
        </button>
      </div>
    </Modal>
  );
}
