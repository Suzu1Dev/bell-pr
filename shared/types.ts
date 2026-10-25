import type { LearnerNote, StoredExplanation } from "./explanations.js";
import type { StoredWalkthrough } from "./walkthroughs.js";
import type { EfficiencyMetrics } from "./efficiency.js";
import type { AgentTeam } from "./team.js";
import type { ContributionSettings } from "./insights.js";
import type { DraftPreparation, RunDraft } from "./drafts.js";
import type { ModelExecution } from "./models.js";
import type { FileConversation } from "./chat.js";
import type { PrFeedback } from "./pr-feedback.js";
import type { Locale } from "./i18n/locale.js";
import type { FollowUpRound } from "./followups.js";
import type { BaseSync } from "./sync.js";
import type {
  FeedbackTag,
  FileAttempt,
  RunUnderstanding,
} from "./understanding.js";
import type { PracticeState } from "./practice.js";
import type {
  ContributionFacts,
  ContributionRules,
  GuardOverride,
} from "./contribution.js";
import type { CoachDebrief } from "./coach.js";
import type { ByHandRecord } from "./by-hand.js";
import type { SplitRef } from "./split.js";

export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_plan"
  | "review"
  | "approved"
  | "published"
  | "failed"
  | "cancelled";

/** An imported repository. The client calls it `Repo`. */
export interface Repository {
  id: string;
  name: string;
  owner: string;
  fullName: string;
  path: string;
  defaultBranch: string;
  url: string;
  language?: string;
  /** When the person last updated BELL's clone to the latest default branch. */
  updatedAt?: string;
  /**
   * The project's own rules and whether its pull requests are open to the
   * person ("Before you contribute"), read at import, at Update project and
   * on "Check again". Absent until first read.
   */
  contributionRules?: ContributionRules;
  /** Coach debriefs for this project, newest last, at most 5. GET /api/repos leaves them out. */
  debriefs?: CoachDebrief[];
  /**
   * The test command the person confirmed for this project, in a request of
   * its own (Learn by hand runs it only when they click Run). Any change is
   * a new confirmation; absent until the first one.
   */
  testCommand?: { command: string; confirmedAt: string };
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: "waiting" | "running" | "complete" | "failed";
  detail: string;
}

/**
 * One activity-log line. Entries saved before `kind` existed have none and
 * are plain messages; `detail` carries the exit code of a command or the
 * paths of a file entry.
 */
export interface RunLogEntry {
  time: string;
  agent: string;
  message: string;
  kind?: "message" | "command" | "file" | "status" | "notice";
  detail?: string;
}

/**
 * The fields every run has, on the server and in the client (including the
 * demo run). `server/types.ts` and `src/types.ts` each declare their own
 * `Run extends RunCore`; the server adds the fields only it records.
 */
export interface RunCore {
  draftPreparation?: DraftPreparation;
  modelExecution?: ModelExecution;
  /** Stored per-file explanations keyed by path; the learning page aggregates the ready ones. */
  explanations?: Record<string, StoredExplanation>;
  /** Walkthroughs of the functions around each change, keyed by path; absent before they existed. */
  walkthroughs?: Record<string, StoredWalkthrough>;
  efficiency?: EfficiencyMetrics;
  id: string;
  repoId: string;
  title: string;
  prompt: string;
  status: RunStatus;
  branch: string;
  baseBranch: string;
  /** The target-branch commit the contribution is measured against; the server always records it, the demo run has none. */
  baseSha?: string;
  /** Local checkout the learner may edit by hand; the server always records it, the demo run has none. */
  worktreePath?: string;
  createdAt: string;
  agents: Agent[];
  logs: RunLogEntry[];
  /**
   * commitMessage is the full commit message the human wrote (subject, body,
   * trailers such as Signed-off-by). Absent or empty means the PR title alone
   * is used, which is how runs saved before this field existed were published.
   * publishBranch is the branch name pushed to GitHub; absent means `branch`.
   */
  draft: RunDraft;
  reviewedFiles: string[];
  /** Learner notes keyed by diff path; absent on runs saved before notes existed. */
  notes?: Record<string, LearnerNote>;
  approvedFingerprint?: string;
  /** Final role answers keyed by role; also holds teammate task ids and guide answers. */
  reports?: Record<string, string>;
  prUrl?: string;
  /** Maintainer feedback read from the PR on request; absent until the learner fetches it. */
  prFeedback?: PrFeedback;
  error?: string;
  /** The GitHub branch the publish commit was pushed to; absent until a push succeeds. The branch field is locked once set. */
  publishedBranch?: string;
  /** The PR head BELL last pushed or took over; absent until the run is published. */
  publishCommit?: string;
  /** True while BELL pushes to GitHub. */
  publishing?: boolean;
  /** owner/name the PR branch was pushed to: the target repository or the person's fork. */
  headRepository?: string;
  /** Rounds of changes after maintainer review, oldest first; absent until the first one. */
  followUps?: FollowUpRound[];
  /** The last move of an unpublished run onto a newer target-branch commit. */
  sync?: BaseSync;
  contributionSettings?: ContributionSettings;
  team?: AgentTeam;
  /** Follow-up Q&A per diff path; absent on runs saved before it was persisted. */
  conversations?: Record<string, FileConversation>;
  /**
   * The UI locale when the run was created. Agent output and the run's own
   * messages follow it; absent on runs created before it was recorded, which
   * use the current locale.
   */
  locale?: Locale;
  /**
   * True when a Claude Code write agent of this run ran without the OS
   * sandbox because the user allowed unsandboxed agents. Absent when every
   * agent ran sandboxed and on runs saved before it was recorded.
   */
  unsandboxed?: boolean;
  /**
   * When storage cleanup removed this run's worktree (ISO time). The run,
   * its notes and its explanations stay readable; absent while the worktree
   * exists.
   */
  workspaceRemovedAt?: string;
  /** Disk use of the run's worktree in bytes at the last measurement; absent when not measured. */
  workspaceBytes?: number;
  /** The Explain-it-back check; absent until the person opens it. */
  understanding?: RunUnderstanding;
  /**
   * True when the run was approved while the person had turned the
   * understanding check off and had not passed it. Set only by a
   * successful approval and removed when the run is approved again with
   * the check passed; absent on every other run, including runs approved
   * before the check existed.
   */
  understandingCheckOff?: boolean;
  /** Per-file "try first" attempts keyed by diff path, for the run's current files. */
  attempts?: Record<string, FileAttempt>;
  /** The person's tags on maintainer feedback, keyed by the feedback item's URL; at most 100. */
  feedbackTags?: Record<string, FeedbackTag>;
  /** Practice-deck schedules of this run's items, keyed by practiceKey(); at most 40. */
  practice?: Record<string, PracticeState>;
  /** The GitHub facts last read for publishing (display only; publishing reads them again). */
  contributionFacts?: ContributionFacts;
  /** Blocks the person lifted with a reason, newest last, at most 8. */
  guardOverrides?: GuardOverride[];
  /** The person's one-line reason for each weakened-test item, keyed by its id. */
  reviewability?: { testReasons?: Record<string, string> };
  /**
   * True for a Learn-by-hand run: the person writes every line and BELL's
   * agents only read. Set only by createRun from the request and never
   * changed; absent on agent runs. Not a detail field, so the run list
   * shows it.
   */
  learnByHand?: true;
  /**
   * A Learn-by-hand run's record (shared/by-hand.ts): the person's plan, the
   * guide's answers, BELL's test runs, the help used and, for a run fitted
   * to a project's rules, the help set fixed when it started. Absent on
   * agent runs and until the run records something.
   */
  byHand?: ByHandRecord;
  /** The contribution this one was split from; set only by a split, and dropped when that contribution is deleted. Absent on every other run. */
  splitFrom?: SplitRef;
  /**
   * The contributions a split made from this run, in the order they were
   * made. The run itself stays as it was. Absent until the run is split; a
   * deleted contribution leaves the list, and the last one takes the list
   * with it, so the run can be split again.
   */
  splitInto?: SplitRef[];
}
