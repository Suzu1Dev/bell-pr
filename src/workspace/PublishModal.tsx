import { Suspense, type Dispatch, type SetStateAction } from "react";
import {
  BookOpen,
  CircleCheck,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Loader2,
  UserRound,
} from "lucide-react";
import type { DoctorReport } from "../../shared/doctor";
import { useT } from "../i18n";
import type { DiffFile, Repo, Run } from "../types";
import type { Tab } from "../app/AppShell";
import { ErrorBoundary } from "../app/ErrorBoundary";
import type { DraftEditor } from "../app/hooks/useDraftEditor";
import { usePresentation } from "../app/presentation";
import { Modal } from "../modals/Modal";
import {
  ReadinessNotice,
  readinessOf,
  type Requirement,
} from "../setup/ReadinessNotice";
import { useDoctor, type DoctorState } from "../setup/useDoctor";
import { MarkdownContent } from "./DraftTab";

/** Publishing commits with the Git identity and pushes with the GitHub CLI. */
const publishRequirements: readonly Requirement[] = ["git-identity", "gh"];

/**
 * Who the publish acts as, from the environment check: the commit author
 * Git uses ("Name <e-mail>", or the address Git guessed) and the GitHub
 * login that pushes. Either is absent when the check has not found it.
 */
export function publishIdentity(report: DoctorReport | null): {
  author?: string;
  login?: string;
} {
  const identity = report?.checks.find((check) => check.id === "git-identity");
  const guessed = identity?.params?.email;
  const author =
    identity?.status === "ok"
      ? identity.detail
      : identity?.status === "warn" && typeof guessed === "string"
        ? guessed
        : undefined;
  const auth = report?.checks.find((check) => check.id === "gh-auth");
  const login =
    auth?.status === "ok" && typeof auth.params?.login === "string"
      ? auth.params.login
      : undefined;
  return {
    ...(author ? { author } : {}),
    ...(login ? { login } : {}),
  };
}

/** "Commit author: Name <e-mail> · Pushing as @login", masked while presenting. */
export function PublishIdentity({
  author,
  login,
  maskUser,
}: {
  author?: string;
  login?: string;
  maskUser: (value: string) => string;
}) {
  const t = useT("workspace").publish.identity;
  if (!author && !login) return null;
  const text =
    author && login
      ? t.both({ author: maskUser(author), login: maskUser(login) })
      : author
        ? t.author({ author: maskUser(author) })
        : t.login({ login: maskUser(login!) });
  return (
    <p className="publish-identity">
      <UserRound size={15} aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

const emailPattern = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** A path under a home folder, where the user name is. */
const homePathPattern =
  /(?:\/(?:home|Users)\/|[A-Za-z]:\\Users\\)[^\s"'`<>]+/g;

/**
 * `text` with e-mail addresses and home-folder paths masked, for the
 * preflight results and errors shown while presenting.
 */
export function maskPersonalText(
  text: string,
  presentation: {
    present: boolean;
    maskUser: (value: string) => string;
    maskPath: (value: string) => string;
  },
): string {
  if (!presentation.present) return text;
  return text
    .replace(emailPattern, (email) => presentation.maskUser(email))
    .replace(homePathPattern, (path) => presentation.maskPath(path));
}

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
  /** A useDoctor() state to share; the dialog loads its own otherwise. */
  doctor?: DoctorState;
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
  doctor: shared,
}: PublishModalProps) {
  const workspace = useT("workspace");
  const t = workspace.publish;
  const presentation = usePresentation();
  const mask = (text: string) => maskPersonalText(text, presentation);
  // The sample publishes nothing, so it needs neither tool and asks for no
  // check; a real publish waits until both are ready.
  const own = useDoctor({ enabled: !demo && !shared });
  const doctor = shared ?? own;
  const ready = demo || readinessOf(doctor.report, publishRequirements).ready;
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
          <FolderGit2 size={16} />
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
      {demo ? (
        <div className="callout">
          <BookOpen size={18} />
          <p>{t.demoCallout}</p>
        </div>
      ) : (
        <PublishIdentity
          {...publishIdentity(doctor.report)}
          maskUser={presentation.maskUser}
        />
      )}
      <ReadinessNotice
        requires={publishRequirements}
        bypass={demo}
        doctor={doctor}
        maskUser={presentation.maskUser}
      />
      {!demo && followUp && (
        <div className="publish-commit-preview">
          <strong>{t.commitPreview}</strong>
          <pre>{run.draft.commitMessage}</pre>
        </div>
      )}
      {!followUp && (
        <details className="publish-body-preview" open>
          <summary>
            {draftChecks
              ? (demo ? t.bodyPreviewDemoWords : t.bodyPreviewWords)({
                  count: draftChecks.draftProseWords(run.draft.body),
                })
              : demo
                ? t.bodyPreviewDemo
                : t.bodyPreview}
          </summary>
          {/* It scrolls when long, so a keyboard can reach and scroll it. */}
          <div
            className="markdown-preview"
            role="region"
            aria-label={demo ? t.bodyPreviewDemo : t.bodyPreview}
            tabIndex={0}
          >
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
          {mask([publishBlocked.message, ...publishBlocked.details].join("\n"))}
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
                {mask(check.message)}
                {check.details.map((detail) => (
                  <small key={detail}>{mask(detail)}</small>
                ))}
              </span>
            </label>
          ))}
          <p>{t.confirmNote}</p>
        </fieldset>
      )}
      {formError && (
        <p role="alert" className="inline-error">
          {mask(formError)}
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
              (!ready ||
                !draftChecks ||
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
