import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  BookOpen,
  CircleCheck,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Loader2,
  RefreshCw,
  UserRound,
} from "lucide-react";
import type { ContributionFacts } from "../../shared/contribution";
import type { DoctorReport } from "../../shared/doctor";
import type { DraftCheck } from "../../shared/draft-checks";
import { api, ApiError, send } from "../api";
import { getDemo } from "../demo";
import { useLocale, useT } from "../i18n";
import { navigate } from "../navigation/route";
import type { DiffFile, Repo, Run, RunSummary } from "../types";
import type { Tab } from "../app/AppShell";
import { ErrorBoundary } from "../app/ErrorBoundary";
import type { DraftEditor } from "../app/hooks/useDraftEditor";
import { useCheckSettings } from "../app/hooks/useUnderstanding";
import { usePresentation } from "../app/presentation";
import { Modal } from "../modals/Modal";
import {
  ReadinessNotice,
  readinessOf,
  type Requirement,
} from "../setup/ReadinessNotice";
import { useDoctor, type DoctorState } from "../setup/useDoctor";
import { useRulesRecheck } from "../draft/rulesRecheck";
import { ByHandRecord, Deferred, MarkdownContent } from "./draftMounts";

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

/** The topics the publish dialog groups its checks under. */
const checkTopics = {
  unknown: ["facts-unknown"],
  rules: ["pr-closed", "ai-ban", "ai-disclosure", "project-rules", "issue"],
  issue: ["issue-closed", "issue-has-pr", "area-reserved", "issue-state"],
  pacing: ["pacing", "pacing-max"],
  words: ["own-words", "brevity", "reviewability", "tests-weakened", "placeholder", "unchecked"],
  safety: ["secret", "local-paths", "workflows", "author-email"],
} as const satisfies Record<string, readonly DraftCheck["id"][]>;
type CheckTopic = keyof typeof checkTopics;

/** `checks` by topic, in the dialog's order; a check of no topic joins the rules, led by Learn by hand's quoted confirm. */
export function groupChecks(checks: readonly DraftCheck[]) {
  const topicOf = (id: DraftCheck["id"]): CheckTopic =>
    (Object.keys(checkTopics) as CheckTopic[]).find((topic) =>
      (checkTopics[topic] as readonly string[]).includes(id),
    ) ?? "rules";
  const quoted = (check: DraftCheck) => (check.id === "by-hand-rules" ? 0 : 1);
  return (Object.keys(checkTopics) as CheckTopic[])
    .map((topic) => ({ topic, checks: checks.filter((check) => topicOf(check.id) === topic).sort((a, b) => quoted(a) - quoted(b)) }))
    .filter((group) => group.checks.length);
}

/** The respect checks' first detail says why maintainers care; the rest name the source. */
const respectIds = new Set<string>([
  ...checkTopics.unknown,
  ...checkTopics.issue,
  ...checkTopics.pacing,
  "pr-closed",
  "ai-ban",
  "by-hand-rules",
  "ai-disclosure",
  "project-rules",
  "own-words",
  "reviewability",
  "tests-weakened",
]);

/**
 * Whether the dialog says "Understanding check: off" for `run`: the run
 * was approved without the check (its mark stays for good), or the person
 * turned the check off and this run has not passed it. A passed check wins
 * over the setting, as in the maintainer checklist and the review footer:
 * approving it marked nothing.
 */
export function showsCheckOffLine(
  run: Pick<Run, "understandingCheckOff" | "understanding">,
  settingOff: boolean,
) {
  return run.understandingCheckOff === true || (settingOff && !run.understanding?.passedAt);
}

/** A typed reason that lifts "someone else's PR fixes this issue": 20 to 200 characters. */
const validReason = (reason = "") => {
  const length = reason.trim().length;
  return length >= 20 && length <= 200;
};

type Respect = typeof import("./respect");

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
    | "acknowledged"
    | "setAcknowledged"
    | "followUp"
    | "publishChecks"
    | "serverChecksRead"
    | "loadPublishChecks"
    | "overrides"
    | "setOverrides"
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
    acknowledged,
    setAcknowledged,
    followUp,
    publishChecks,
    serverChecksRead,
    loadPublishChecks,
    overrides,
    setOverrides,
  } = draft;
  const [locale] = useLocale();
  const settings = useCheckSettings();
  const sample = demo ? getDemo(locale) : undefined;
  const [respect, setRespect] = useState<Respect>();
  useEffect(() => {
    let cancelled = false;
    void import("./respect").then((module) => {
      if (!cancelled) setRespect(module);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // The GitHub facts are read once as the dialog opens, then the server's
  // checks again; a fact that could not be read is never a pass. A project
  // whose rules BELL never read (imported by an earlier build) has them
  // read too, so an AI ban or a required disclosure in them applies.
  const reads = !demo && !followUp;
  // Read once per opening, not again when the repository list reloads.
  const unreadRules = useRef<string>(undefined);
  unreadRules.current =
    reads && currentRepo && !currentRepo.contributionRules ? currentRepo.id : undefined;
  const [facts, setFacts] = useState<{ loading: boolean; facts?: ContributionFacts; error?: string }>(
    { loading: reads },
  );
  // The server's checks as this dialog reads them (`done` reads so far); a
  // Learn-by-hand run waits for them (F12) and says when they couldn't be read.
  const [reading, setReading] = useState({ now: reads, done: 0 });
  const readChecks = useCallback(async () => {
    setReading((previous) => ({ ...previous, now: true }));
    await loadPublishChecks(run.id, run.approvedFingerprint);
    setReading((previous) => ({ now: false, done: previous.done + 1 }));
  }, [loadPublishChecks, run.id, run.approvedFingerprint]);
  useEffect(() => {
    setOverrides([]);
    if (!reads) return;
    let cancelled = false;
    // A failed read is recorded in the rules' `unknown`, never thrown; the
    // checks below say what stayed unknown.
    const rules = unreadRules.current
      ? api(
          `/repos/${encodeURIComponent(unreadRules.current)}/contribution-rules/refresh`,
          send("POST"),
        ).catch(() => undefined)
      : undefined;
    api<{ run?: Run }>(`/runs/${encodeURIComponent(run.id)}/contribution-facts/refresh`, send("POST"))
      .then(
        ({ run: updated }) => {
          if (!cancelled) setFacts({ loading: false, facts: updated?.contributionFacts });
        },
        (error: Error) => {
          if (cancelled) return;
          const missing = error instanceof ApiError && [404, 501].includes(error.status);
          setFacts({ loading: false, error: missing ? t.factsMissing : error.message });
        },
      )
      .finally(async () => {
        await rules;
        if (!cancelled) void readChecks();
      });
    return () => {
      cancelled = true;
    };
  }, [reads, run.id, readChecks, setOverrides, t.factsMissing]);
  // A refused publish may have read new facts: the checks it names show up.
  useEffect(() => {
    if (formError && reads) void readChecks();
  }, [formError, reads, readChecks]);
  const checkOff = showsCheckOffLine(run, settings.off);
  // The sample's checks come from its fixtures, as the server's would.
  const sampleChecks = useMemo(
    () => sample && respect?.samplePublishChecks(sample, run, files, locale, settings.off),
    [sample, respect, run, files, locale, settings.off],
  );
  // A Learn-by-hand run's checks wait for the server's list (DESIGN v1.2 F12).
  const byHand = !!run.learnByHand && !sample && !followUp;
  const checks: DraftCheck[] | undefined = followUp
    ? []
    : sample
      ? sampleChecks
      : draftChecks && (serverChecksRead || !byHand) ? publishChecks : undefined;
  const checkRules = useRulesRecheck(byHand ? run : undefined, currentRepo?.contributionRules, checks, loadPublishChecks);
  // A quoted confirm whose words changed in a later read (or that couldn't be read) is unticked:
  // the person confirms what they read (F12 f). Until then its tick counts for nothing, not even
  // for the one frame before the untick, so no click can send it for words that came after it.
  const quoted = JSON.stringify(checks?.find((check) => check.id === "by-hand-rules") ?? null);
  const [confirmed, setConfirmed] = useState(quoted);
  useEffect(() => {
    if (confirmed === quoted) return;
    setAcknowledged((previous) => previous.filter((id) => id !== "by-hand-rules"));
    setConfirmed(quoted);
  }, [confirmed, quoted, setAcknowledged]);
  const ticked = confirmed === quoted ? acknowledged : acknowledged.filter((id) => id !== "by-hand-rules");
  const reason = overrides.find((override) => override.id === "issue-has-pr")?.reason ?? "";
  const blocks = (checks ?? []).filter(
    (check) => check.kind === "block" && !(check.id === "issue-has-pr" && validReason(reason)),
  );
  const confirms = (checks ?? []).filter((check) => check.kind === "confirm");
  const pacing = respect?.pacingOf(sample ? sample.contributionFacts : (facts.facts ?? run.contributionFacts));
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
      {!followUp && (
        <PublishChecks
          checks={checks}
          facts={facts}
          pacing={pacing}
          checkOff={checkOff}
          acknowledged={ticked}
          setAcknowledged={setAcknowledged}
          reason={reason}
          onReason={(value) =>
            setOverrides(value ? [{ id: "issue-has-pr", reason: value }] : [])
          }
          mask={mask}
          record={
            byHand && (
              <Deferred resetKey={run.id} fallback={<Loader2 className="spin" size={16} aria-hidden="true" />}>
                <ByHandRecord
                  run={run}
                  place="publish"
                  // An unknown is never a pass: the dialog says the checks couldn't be read, with a retry.
                  {...(!serverChecksRead && !facts.loading
                    ? { unchecked: { checking: reading.now, failed: reading.done > 0, onRetry: () => void readChecks() } }
                    : {})}
                />
              </Deferred>
            )
          }
          checkRules={checkRules}
          loop={
            demo ? undefined : (
              <LoopRuns
                run={run}
                waiting={(facts.facts ?? run.contributionFacts)?.pacing?.waitingUrls}
                closeModal={closeModal}
              />
            )
          }
        />
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
            (!demo && !ready) ||
            !checks ||
            blocks.length > 0 ||
            confirms.some((check) => !ticked.includes(check.id))
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

/**
 * The publish dialog's checks, grouped by topic: the project's rules, the
 * issue, the person's pace here, their words and the change's
 * reviewability, and safety. A block names why maintainers care and where
 * it comes from; only "someone else's PR fixes this issue" can be lifted,
 * with a reason. GitHub facts that could not be read say so and never pass.
 * Learn by hand's record stands right before its quoted confirm (F12 f).
 */
export function PublishChecks({
  checks,
  facts,
  pacing,
  checkOff,
  acknowledged,
  setAcknowledged,
  reason,
  onReason,
  mask,
  loop,
  record,
  checkRules,
}: {
  /** Undefined while the checks load. */
  checks: DraftCheck[] | undefined;
  facts: { loading: boolean; error?: string };
  pacing: ReturnType<Respect["pacingOf"]>;
  checkOff: boolean;
  acknowledged: string[];
  setAcknowledged: Dispatch<SetStateAction<string[]>>;
  /** The typed reason for the `issue-has-pr` block. */
  reason: string;
  onReason(value: string): void;
  mask(text: string): string;
  /** Links to the person's other published runs, for the pacing check. */
  loop?: ReactNode;
  record?: ReactNode;
  /** "Check again" on a Learn-by-hand block while the rules were read before the run started, and what it found. */
  checkRules?: { offer: boolean; checking: boolean; note?: string; onCheck(): Promise<void> };
}) {
  const t = useT("workspace").publish;
  const rulesCard = useT("mission").rules;
  const confirms = (checks ?? []).filter((check) => check.kind === "confirm");
  const recordFirst = !checks?.some((check) => check.id === "by-hand-rules");
  // In a Learn-by-hand run's dialog (the one with a record), a read that removes the focused
  // button (Try again, Check again) leaves the focus in the dialog, on the heading.
  const title = useRef<HTMLHeadingElement>(null);
  const shown = useRef<string>(undefined);
  const now = `${checks?.map((check) => check.id + check.kind).join() ?? "-"}${checkRules?.offer ? "+" : ""}`;
  useEffect(() => {
    if (record && shown.current !== undefined && shown.current !== now && document.activeElement === document.body) title.current?.focus();
    shown.current = now;
  }, [now, record]);
  return (
    <section className="publish-checks" aria-labelledby="publish-checks-title">
      <h3 id="publish-checks-title" ref={title} tabIndex={-1}>{t.checksTitle}</h3>
      {facts.loading && (
        <p className="publish-fact" role="status">
          <Loader2 className="spin" size={14} aria-hidden="true" /> {t.factsLoading}
        </p>
      )}
      {facts.error && (
        <p className="publish-fact is-unknown" role="status">
          {mask(t.couldntCheck({ reason: facts.error }))}
        </p>
      )}
      {pacing && (
        <p className="publish-fact">{pacing === "exempt" ? t.pacingExempt : t.pacing(pacing)}</p>
      )}
      {checkOff && <p className="publish-fact">{t.checkOff}</p>}
      {/* Facts still being read, or that could not be read, are never a pass. */}
      {checks && !checks.length && !facts.loading && !facts.error && (
        <p className="publish-fact is-clear">
          <CircleCheck size={14} aria-hidden="true" /> {t.allClear}
        </p>
      )}
      {confirms.length > 0 && <p className="publish-fact">{t.confirmLegend}</p>}
      {recordFirst && record}
      {groupChecks(checks ?? []).map((group) => (
        <fieldset key={group.topic} className="publish-confirmations">
          <legend>{t.groups[group.topic]}</legend>
          {!recordFirst && group.checks[0].id === "by-hand-rules" && record}
          {group.checks.map((check) => {
            const [why, ...sources] = respectIds.has(check.id) ? check.details : [undefined, ...check.details];
            const text = (
              <span>
                {check.kind === "block" ? t.blocked({ message: mask(check.message) }) : mask(check.message)}
                {why && <small className="publish-why">{mask(why)}</small>}
                {sources.map((detail) => (
                  <small key={detail}>{mask(detail!)}</small>
                ))}
              </span>
            );
            if (check.kind === "block")
              return (
                <div key={check.id} className="publish-block" role="alert">
                  {text}
                  {checkRules?.offer && ["ai-ban", "area-reserved"].includes(check.id) && (
                    // aria-disabled while it reads, so the focus stays on it.
                    <button type="button" className="button secondary" aria-disabled={checkRules.checking} onClick={() => !checkRules.checking && void checkRules.onCheck()}>
                      <RefreshCw size={14} aria-hidden="true" /> {checkRules.checking ? rulesCard.checking : rulesCard.checkAgain}
                    </button>
                  )}
                  {checkRules?.note && ["ai-ban", "area-reserved"].includes(check.id) && <small>{mask(checkRules.note)}</small>}
                  {check.id === "issue-has-pr" && (
                    <label className="publish-override">
                      {t.overrideLabel}
                      <textarea
                        className="text-input"
                        maxLength={200}
                        value={reason}
                        onChange={(event) => onReason(event.target.value)}
                      />
                      <small aria-live="polite">{t.overrideCount({ count: reason.trim().length })}</small>
                    </label>
                  )}
                </div>
              );
            return (
              <label key={check.id}>
                <input
                  type="checkbox"
                  checked={acknowledged.includes(check.id)}
                  onChange={(event) =>
                    setAcknowledged((previous) =>
                      event.target.checked
                        ? [...previous, check.id].slice(-16)
                        : previous.filter((id) => id !== check.id),
                    )
                  }
                />
                {text}
              </label>
            );
          })}
          {group.topic === "pacing" && loop}
        </fieldset>
      ))}
      {confirms.length > 0 && <p className="publish-fact">{t.confirmNote}</p>}
    </section>
  );
}

/** The number in a pull request link such as https://github.com/o/r/pull/12. */
const pullNumber = (url: string) => /\/pull\/(\d+)/.exec(url)?.[1] ?? "?";

/**
 * "Close the loop first", shown when the pacing check says a maintainer is
 * waiting: each pull request GitHub names as waiting on the person (up to
 * 3), as its BELL run whose feedback BELL reads (Free) or else as a link to
 * the review on GitHub; without that list, the person's other published
 * runs of this repository.
 */
export function LoopRuns({
  run,
  waiting,
  closeModal,
}: {
  run: Run;
  /** PacingFacts.waitingUrls: the pull requests a maintainer has waited on for more than 7 days. */
  waiting?: readonly string[];
  closeModal: () => void;
}) {
  const t = useT("workspace").publish;
  const [others, setOthers] = useState<RunSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    api<{ runs: RunSummary[] }>("/runs").then(
      ({ runs }) => {
        if (!cancelled)
          setOthers(
            runs.filter(
              (other) =>
                other.repoId === run.repoId &&
                other.id !== run.id &&
                other.status === "published" &&
                !!other.prUrl,
            ),
          );
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [run.id, run.repoId]);
  const open = (other: RunSummary) => (
    <button
      key={other.id}
      type="button"
      className="run-notice-link"
      onClick={() => {
        closeModal();
        navigate({ name: "run", runId: other.id, tab: "draft" });
      }}
    >
      {t.closeLoop({ title: other.title })}
    </button>
  );
  if (!waiting?.length) return others.slice(0, 3).map(open);
  return waiting.slice(0, 3).map((url) => {
    const own = others.find((other) => other.prUrl === url);
    return own ? (
      open(own)
    ) : (
      <a key={url} className="run-notice-link" href={url} target="_blank" rel="noreferrer">
        {t.waitingPr({ number: pullNumber(url) })}
      </a>
    );
  });
}
