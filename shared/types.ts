import type { LearnerNote, StoredExplanation } from "./explanations.js";
import type { EfficiencyMetrics } from "./efficiency.js";
import type { AgentTeam } from "./team.js";
import type { ContributionSettings } from "./insights.js";
import type { DraftPreparation } from "./drafts.js";
import type { ModelExecution } from "./models.js";
import type { FileConversation } from "./chat.js";
import type { PrFeedback } from "./pr-feedback.js";

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
  efficiency?: EfficiencyMetrics;
  id: string;
  repoId: string;
  title: string;
  prompt: string;
  status: RunStatus;
  branch: string;
  baseBranch: string;
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
  draft: {
    title: string;
    body: string;
    commitMessage?: string;
    publishBranch?: string;
  };
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
  contributionSettings?: ContributionSettings;
  team?: AgentTeam;
  /** Follow-up Q&A per diff path; absent on runs saved before it was persisted. */
  conversations?: Record<string, FileConversation>;
}
