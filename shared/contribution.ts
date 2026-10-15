/**
 * Respect for the maintainer's time: the project's own rules, whether its
 * pull requests are open to the person, the state of the linked issue and
 * the person's pace of publishing in that repository. The facts come from
 * the project's files (read locally) and read-only GitHub calls; this
 * module holds their shapes and the pure rules over them.
 *
 * Every fact has an explicit unknown state: a fact that could not be read
 * is never a pass. The numbers are BELL defaults, labelled as such, and
 * the same on every plan.
 */

/** Rule kinds the classifier finds (shared/project-policy.ts); stored as text, frozen. */
export const policyKinds = [
  "ban",
  "disclose",
  "understand",
  "area",
  "agent",
  "own-words",
  "issue-first",
] as const;
export type PolicyKind = (typeof policyKinds)[number];

/** One rule quoted from a project document. */
export interface PolicyFinding {
  kind: PolicyKind;
  /** The repository path the quote comes from. */
  path: string;
  /** 1-based line of the quote's start. */
  line: number;
  /** Verbatim, 300 characters or fewer. */
  quote: string;
  /** The same sentence names a PR, patch, contribution, commit or submitted code. */
  contribution: boolean;
}

/**
 * Whether the repository takes pull requests from the person, read through
 * `gh api` (REST `repos/{owner}/{repo}` and GraphQL `viewerPermission`).
 * GitHub's own field values are kept as text.
 */
export interface DoorFacts {
  /** `has_pull_requests`; false when the repository turned pull requests off. */
  hasPullRequests?: boolean;
  /** `pull_request_creation_policy`, such as `all` or `collaborators_only`. */
  pullRequestCreationPolicy?: string;
  archived?: boolean;
  disabled?: boolean;
  /** GraphQL `repository.viewerPermission`: ADMIN, MAINTAIN, WRITE, TRIAGE, READ or none. */
  viewerPermission?: string;
  /** GraphQL `viewer.login`. */
  login?: string;
}

/** The project's size reference: one of its last merged pull requests. */
export interface MergedPrSize {
  number: number;
  additions: number;
  deletions: number;
  changedFiles: number;
}

/**
 * The "Before you contribute" facts of a repository
 * (`Repository.contributionRules`), read at import, at Update project and
 * on "Check again".
 */
export interface ContributionRules {
  /** The clone's commit the files were read at. */
  baseSha?: string;
  checkedAt: string;
  door?: DoorFacts;
  /** At most 30. */
  findings: PolicyFinding[];
  /** Every file read, so the card can say "not found in the N files BELL read". At most 60. */
  filesRead: string[];
  /** `.gitattributes` `linguist-generated` patterns. At most 30. */
  generated?: string[];
  /** The last 3 merged pull requests' sizes. */
  mergedSizes?: MergedPrSize[];
  /** The organization repository (`<owner>/.github`) whose default files were read. */
  orgDefaults?: string;
  /** What could not be read, as `<part>` or `<part>: <reason>`. */
  unknown?: string[];
}

/** Another pull request on the linked issue. */
export interface IssuePr {
  number: number;
  url?: string;
  author?: string;
  /** OPEN, CLOSED or MERGED. */
  state: string;
  /** GitHub would close the issue when it merges (`closedByPullRequestsReferences`, `willCloseTarget`). */
  willClose?: boolean;
  closedAt?: string;
}

/** The linked issue, read through one GraphQL call. */
export interface IssueFacts {
  url: string;
  number?: number;
  title?: string;
  /** OPEN or CLOSED. */
  state?: string;
  /** COMPLETED, NOT_PLANNED, DUPLICATE, … */
  stateReason?: string;
  locked?: boolean;
  /** The issue's labels, as the repository names them. */
  labels?: string[];
  assignees?: string[];
  /** Comments that claim the issue ("I'd like to work on this"), with their author and date. */
  claims?: { author: string; at: string; bot?: boolean }[];
  otherPrs?: IssuePr[];
  /** The latest comment by an OWNER, MEMBER or COLLABORATOR, quoted (300 characters or fewer). */
  maintainerQuote?: { author: string; association: string; quote: string; at: string };
  /** Whether the person ever commented on the issue. */
  viewerCommented?: boolean;
}

/** The person's pull requests in this repository (one aliased GraphQL call). */
export interface PacingFacts {
  /** Open pull requests by the person here, drafts included. */
  openPrs?: number;
  /** Merged pull requests by the person here. */
  mergedPrs?: number;
  /** Open pull requests where a maintainer asked for changes more than 7 days ago. */
  waitingPrs?: number;
  viewerPermission?: string;
}

/**
 * A display snapshot of the GitHub facts for one run
 * (`run.contributionFacts`). Publishing always reads them again.
 */
export interface ContributionFacts {
  checkedAt: string;
  door?: DoorFacts;
  issue?: IssueFacts;
  pacing?: PacingFacts;
  /** The facts that could not be read, as `<part>` or `<part>: <reason>` (part: door, issue or pacing). */
  unknown?: string[];
}

/** A block the person lifted with a reason (`run.guardOverrides`). */
export interface GuardOverride {
  /** A DraftCheck id; only `issue-has-pr` can be overridden in v1.1. */
  id: string;
  /** Typed by the person, 20 to 200 characters. */
  reason: string;
  at: string;
}

/** Checks a typed reason can lift. */
export const overridableCheckIds = ["issue-has-pr"] as const;
export type OverridableCheckId = (typeof overridableCheckIds)[number];
export const overrideReasonLimits = { min: 20, max: 200 } as const;

/**
 * How many of the person's pull requests may be open in one repository
 * before BELL asks to close the loop first: 1 before their first merged
 * pull request there, 2 after. BELL defaults.
 */
export function openPrBudget(mergedHere: number | boolean): 1 | 2 {
  return (typeof mergedHere === "number" ? mergedHere > 0 : mergedHere)
    ? 2
    : 1;
}

/** People with write access maintain the repository; their pace is not BELL's business. */
export function pacingExempt(viewerPermission?: string) {
  return ["WRITE", "MAINTAIN", "ADMIN"].includes(
    (viewerPermission ?? "").toUpperCase(),
  );
}

/** Permissions that may open pull requests where creation is limited to collaborators. */
export function collaboratorPermission(viewerPermission?: string) {
  return ["ADMIN", "MAINTAIN", "WRITE", "TRIAGE"].includes(
    (viewerPermission ?? "").toUpperCase(),
  );
}

/** A label for issues set aside for people who are learning, by the repository's own name for it. */
export function learningLabel(name: string) {
  return /\bgood[\s_-]*first[\s_-]*(?:issue|bug|pr)s?\b|\bfirst[\s_-]*timers?(?:[\s_-]*only)?\b|\bbeginners?\b|\bstarter\b|\bnewcomers?\b|\b(?:e|d)[\s_-]easy\b|^easy$|\beasy[\s_-]*(?:fix|pick)\b/i.test(
    name.trim(),
  );
}

/** A label saying the issue is not ready to be worked on: triage, design or blocked. */
export function notReadyLabel(name: string) {
  return /\btriage\b|\bdesign\b|\bblocked\b|\bon[\s_-]*hold\b|\bneeds?[\s_:-]*(?:discussion|decision|approval|info|investigation|repro\w*)\b|\bwaiting[\s_-]*(?:for|on)\b|\bstale\b/i.test(
    name.trim(),
  );
}

/** A comment that claims an issue: "I'd like to work on this", "/assign", "can I take it?". */
export function claimComment(body: string) {
  return /^\s*\/(?:assign|claim|take)\b|\b(?:i(?:'d| would) (?:like|love) to (?:work on|take|tackle|pick up|fix)|i(?:'m| am) (?:working on|taking|on) (?:this|it)|i(?:'ll| will) (?:work on|take|fix|tackle|pick up) (?:this|it)|can i (?:work on|take|tackle|pick up|fix) (?:this|it)|(?:please )?assign (?:(?:this|it) )?(?:to )?me|let me (?:work on|take|fix) (?:this|it))\b/i.test(
    body,
  );
}

/** GitHub's author associations that speak for the project. */
export function maintainerAssociation(value?: string) {
  return ["OWNER", "MEMBER", "COLLABORATOR"].includes((value ?? "").toUpperCase());
}
