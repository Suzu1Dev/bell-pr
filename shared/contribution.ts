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
import {
  brevityRule,
  draftProseWords,
  sameDraftProse,
  type DraftCheck,
  type DraftPreflightInput,
} from "./draft-checks.js";
import en from "./i18n/draft-checks.en.js";
import zhTW from "./i18n/draft-checks.zh-TW.js";
import { formatters, type Locale } from "./i18n/locale.js";
import { disclosureRule, hasAiDisclosure } from "./project-policy.js";

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
  /**
   * Links to those pull requests (up to 10 of them, on github.com in this
   * repository), so "close the loop first" can point at each one.
   */
  waitingUrls?: string[];
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
 * A weakened-test reason (`run.reviewability.testReasons`, DESIGN F9): a
 * line a maintainer can check, at least 3 words (one CJK character counts
 * as a word) and at most 300 characters. The client, the route and the
 * publish check share it.
 */
export const testReasonLimits = { words: 3, chars: 300 } as const;

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

const dictionaries: Record<Locale, typeof en> = { en, "zh-TW": zhTW };

/**
 * Changes of this many lines or fewer are small enough not to ask about a
 * missing test: the same line count under which the understanding check
 * asks no file question. A BELL default.
 */
const untestedMinLines = 15;

/** Older than this, a closed and unmerged pull request on the issue is history, not news. */
const recentClosedPrDays = 90;
const dayMs = 24 * 60 * 60 * 1000;

const sameLogin = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** A typed reason long enough to lift a block (20 to 200 characters). */
export function validOverride(
  override: Pick<GuardOverride, "id" | "reason"> | undefined,
  id: OverridableCheckId,
) {
  const length = override?.reason.trim().length ?? 0;
  return (
    override?.id === id &&
    length >= overrideReasonLimits.min &&
    length <= overrideReasonLimits.max
  );
}

const unknownPartIds = ["door", "issue", "pacing", "rules", "orgDefaults"] as const;
type UnknownPartId = (typeof unknownPartIds)[number];

/** Splits "<part>: <reason>" from ContributionFacts.unknown or ContributionRules.unknown. */
function unknownParts(entries: readonly string[]) {
  return entries.map((entry) => {
    const [part, ...rest] = entry.split(":");
    const id = unknownPartIds.find((known) => known === part.trim());
    const known: UnknownPartId | "other" = id ?? "other";
    const reason = (known === "other" ? entry : rest.join(":")).trim();
    return { part: known, reason: reason || undefined };
  });
}

/**
 * The respect checks (DESIGN §5.4), computed from what the input carries:
 * the project's quoted rules, the GitHub facts, the reviewability
 * snapshot, the overrides and test reasons. Without facts (none read yet)
 * no fact-based check runs; a fact that could not be read is the
 * `facts-unknown` confirm, never a pass. No plan skips any of them, and
 * the understanding-check switch changes only one detail line. Blocks come
 * first, then confirms; every check's first detail says why maintainers
 * care, and the details after it name the source.
 */
export function respectChecks(
  input: DraftPreflightInput,
  locale: Locale = "en",
): DraftCheck[] {
  const m = dictionaries[locale].respect;
  const fmt = formatters(locale);
  const blocks: DraftCheck[] = [];
  const confirms: DraftCheck[] = [];
  const findings = input.rules?.findings ?? [];
  const found = (kind: PolicyKind) =>
    findings.filter((finding) => finding.kind === kind);
  const quote = (finding: PolicyFinding) =>
    m.quote({ path: finding.path, line: finding.line, quote: finding.quote });
  const facts = input.facts;
  const door = facts?.door;
  const issue = facts?.issue;
  const login = door?.login;

  // The door: pull requests closed, archived, or for collaborators only.
  if (door) {
    const sources: string[] = [];
    if (door.hasPullRequests === false)
      sources.push(m.githubField({ field: "has_pull_requests", value: "false" }));
    if (door.archived) sources.push(m.githubField({ field: "archived", value: "true" }));
    if (door.disabled) sources.push(m.githubField({ field: "disabled", value: "true" }));
    if (
      door.pullRequestCreationPolicy === "collaborators_only" &&
      !collaboratorPermission(door.viewerPermission)
    )
      sources.push(
        m.githubField({
          field: "pull_request_creation_policy",
          value: `collaborators_only (viewerPermission ${door.viewerPermission || "NONE"})`,
        }),
      );
    if (sources.length)
      blocks.push({ id: "pr-closed", kind: "block", message: m.prClosed, details: [m.why.prClosed, ...sources] });
  }

  // An explicit ban of AI-assisted contributions; an ambiguous one is a confirm below.
  const bans = found("ban").filter((finding) => finding.contribution);
  if (bans.length)
    blocks.push({ id: "ai-ban", kind: "block", message: m.aiBan, details: [m.why.aiBan, ...bans.map(quote)] });

  // A disclosure the project requires, enforced at publish.
  const disclosures = found("disclose");
  const disclosureSource = disclosureRule(input.sources ?? []);
  if (
    (disclosures.length || disclosureSource) &&
    !hasAiDisclosure(input.body, input.commitMessage)
  )
    blocks.push({
      id: "ai-disclosure",
      kind: "block",
      message: m.aiDisclosure,
      details: [
        m.why.aiDisclosure,
        ...(disclosures.length
          ? disclosures.map(quote)
          : [dictionaries[locale].ruleQuote(disclosureSource!)]),
      ],
    });

  // The description is still BELL's suggestion: a block where the project
  // asks for the contributor's own words, a confirm on every other project.
  const unrevised =
    !!input.proposalBody?.trim() &&
    sameDraftProse(input.body, input.proposalBody);
  const ownWords = found("own-words");
  const brevity = brevityRule(input.sources ?? []);
  if (unrevised && ownWords.length)
    blocks.push({
      id: "own-words",
      kind: "block",
      message: m.ownWordsRequired,
      details: [m.why.ownWords, ...ownWords.map(quote)],
    });
  // A brevity rule already raises the `brevity` confirm for it, quoting the rule.
  else if (unrevised && !brevity)
    confirms.push({
      id: "own-words",
      kind: "confirm",
      message: m.ownWords,
      details: [m.why.ownWords],
    });

  // The linked issue.
  if (issue?.state?.toUpperCase() === "CLOSED")
    blocks.push({
      id: "issue-closed",
      kind: "block",
      message: m.issueClosed,
      details: [
        m.why.issueClosed,
        m.githubField({
          field: "state",
          value: issue.stateReason ? `CLOSED (${issue.stateReason})` : "CLOSED",
        }),
      ],
    });
  const competing = (issue?.otherPrs ?? []).filter(
    (pr) =>
      pr.state.toUpperCase() === "OPEN" &&
      pr.willClose !== false &&
      !sameLogin(pr.author, login),
  );
  if (
    competing.length &&
    !(input.overrides ?? []).some((override) => validOverride(override, "issue-has-pr"))
  )
    blocks.push({
      id: "issue-has-pr",
      kind: "block",
      message: m.issueHasPr,
      details: [
        m.why.issueHasPr,
        ...competing.map((pr) => m.otherPr({ number: pr.number, author: pr.author ?? "?" })),
      ],
    });
  const learning = (issue?.labels ?? []).filter(learningLabel);
  const areas = found("area");
  if (learning.length && areas.length)
    blocks.push({
      id: "area-reserved",
      kind: "block",
      message: m.areaReserved,
      details: [m.why.areaReserved, m.learningLabels({ labels: learning }), ...areas.map(quote)],
    });

  // Weakened tests need a reason each.
  const unexplained = (input.changes?.weakened ?? []).filter(
    (item) => draftProseWords(input.testReasons?.[item.id] ?? "") < testReasonLimits.words,
  );
  if (unexplained.length)
    blocks.push({
      id: "tests-weakened",
      kind: "block",
      message: m.testsWeakened({ count: unexplained.length }),
      details: [
        m.why.testsWeakened,
        ...unexplained.map((item) =>
          item.line === 0
            ? m.weakenedFile({ path: item.path })
            : m.weakenedLine({
                path: item.path,
                line: item.line,
                text: item.text,
                removed: item.id.includes("#-"),
              }),
        ),
      ],
    });

  // Pacing: the person's open pull requests in this repository.
  const pacing = facts?.pacing;
  if (
    pacing &&
    typeof pacing.openPrs === "number" &&
    !pacingExempt(pacing.viewerPermission ?? door?.viewerPermission)
  ) {
    const budget = openPrBudget(pacing.mergedPrs ?? 0);
    const counts = m.pacingCounts({ open: pacing.openPrs, merged: pacing.mergedPrs ?? 0, budget });
    if (pacing.openPrs >= 2 * budget)
      blocks.push({
        id: "pacing-max",
        kind: "block",
        message: m.pacingMax({ open: pacing.openPrs, budget }),
        details: [m.why.pacingMax, counts],
      });
    else {
      const details = [
        ...(pacing.openPrs >= budget ? [m.atBudget({ open: pacing.openPrs, budget })] : []),
        ...(pacing.waitingPrs ? [m.waiting({ count: pacing.waitingPrs })] : []),
      ];
      if (details.length)
        confirms.push({ id: "pacing", kind: "confirm", message: m.pacing, details: [m.why.pacing, ...details, counts] });
    }
  }

  // Rules the person reads and decides on.
  const ruleDetails = [
    ...found("ban")
      .filter((finding) => !finding.contribution)
      .map((finding) => m.ambiguousBan(finding)),
    ...(input.understandingOff ? found("understand").map((finding) => m.understandOff(finding)) : []),
    ...found("agent").map((finding) => m.agent(finding)),
    ...(!input.issueUrl?.trim() ? found("issue-first").map((finding) => m.issueFirst(finding)) : []),
  ];
  if (ruleDetails.length)
    confirms.push({
      id: "project-rules",
      kind: "confirm",
      message: m.projectRules,
      details: [m.why.projectRules, ...ruleDetails],
    });

  // The issue's state beyond open or closed.
  if (issue && issue.state?.toUpperCase() !== "CLOSED") {
    const now = Date.now();
    const others = (issue.assignees ?? []).filter((name) => !sameLogin(name, login));
    const claims = (issue.claims ?? []).filter((claim) => !sameLogin(claim.author, login));
    const notReady = (issue.labels ?? []).filter(notReadyLabel);
    const closed = (issue.otherPrs ?? []).filter(
      (pr) =>
        pr.state.toUpperCase() === "CLOSED" &&
        (!pr.closedAt || now - Date.parse(pr.closedAt) <= recentClosedPrDays * dayMs),
    );
    const details = [
      ...(others.length ? [m.assigned({ names: others })] : []),
      ...claims.map((claim) =>
        m.claimed({ author: claim.author, date: fmt.date(claim.at), bot: !!claim.bot }),
      ),
      ...(notReady.length ? [m.notReady({ labels: notReady })] : []),
      ...(issue.locked ? [m.locked] : []),
      ...closed.map((pr) => m.closedPr({ number: pr.number, author: pr.author ?? "?" })),
      ...(found("issue-first").length && issue.viewerCommented === false ? [m.sayHello] : []),
    ];
    if (details.length)
      confirms.push({
        id: "issue-state",
        kind: "confirm",
        message: m.issueState,
        details: [m.why.issueState, ...details],
      });
  }

  // How reviewable the change is.
  const changes = input.changes;
  if (changes) {
    const details = [
      ...(changes.band === "very-large"
        ? [m.split({ lines: changes.changedLines, files: changes.files })]
        : []),
      ...(changes.sourceChanged &&
      !changes.testFilesChanged &&
      !changes.docsOnly &&
      changes.changedLines > untestedMinLines
        ? [m.noTests]
        : []),
      ...(changes.outsidePlan.length
        ? [m.outsidePlan({ files: changes.outsidePlan.slice(0, 10) })]
        : []),
      ...(changes.whitespaceOnly.length
        ? [m.whitespace({ files: changes.whitespaceOnly.slice(0, 10) })]
        : []),
      ...(changes.newDependencies.length
        ? [m.dependencies({ names: changes.newDependencies.map((dependency) => dependency.name).slice(0, 10) })]
        : []),
    ];
    if (details.length) {
      const sizes = (changes.mergedSizes ?? input.rules?.mergedSizes ?? []).map(
        (size) => size.additions + size.deletions,
      );
      confirms.push({
        id: "reviewability",
        kind: "confirm",
        message: m.reviewability,
        details: [m.why.reviewability, ...details, ...(sizes.length ? [m.mergedSizes({ sizes })] : [])],
      });
    }
  }

  // Facts that could not be read. With facts (the publish dialog and
  // publish itself), rules BELL never read, or files it could not read,
  // are unknown too: an AI ban or a required disclosure may be in them.
  const rulesUnknown = facts
    ? input.rules
      ? unknownParts(input.rules.unknown ?? []).filter(
          ({ part }) => part === "rules" || part === "orgDefaults",
        )
      : undefined
    : [];
  const unknown = [
    ...unknownParts(facts?.unknown ?? []).map((part) => m.unknownPart(part)),
    ...(rulesUnknown ? rulesUnknown.map((part) => m.unknownPart(part)) : [m.rulesUnread]),
  ];
  if (unknown.length)
    confirms.push({
      id: "facts-unknown",
      kind: "confirm",
      message: m.factsUnknown,
      details: [m.why.factsUnknown, ...unknown],
    });

  return [...blocks, ...confirms];
}
