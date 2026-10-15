/**
 * The live maintainer checklist of the draft guide (DESIGN §5.3): one row
 * per thing maintainers check, built from the publish checks and the facts
 * behind them. A row is a block or a confirm when a check says so, OK only
 * when its facts were read and no check fires, and "Couldn't check"
 * otherwise: an unknown is never shown as a pass.
 */
import {
  openPrBudget,
  pacingExempt,
  type ContributionFacts,
  type ContributionRules,
} from "../../shared/contribution";
import type { DraftCheck, DraftRuleQuote } from "../../shared/draft-checks";
import type { Formatters } from "../../shared/i18n/locale";
import type { ReviewabilitySnapshot } from "../../shared/reviewability";
import type { Messages } from "../i18n";
import { doorClosed, unknownParts } from "../mission/respect";

export const checklistRowIds = [
  "rules",
  "door",
  "issue",
  "pacing",
  "words",
  "reviewability",
  "disclosure",
  "understanding",
] as const;
export type ChecklistRowId = (typeof checklistRowIds)[number];
export type ChecklistStatus = "ok" | "confirm" | "block" | "unknown";

export interface ChecklistRow {
  id: ChecklistRowId;
  status: ChecklistStatus;
  /** What the row found, one sentence each. */
  lines: string[];
  /** Where it comes from: quotes with path:line, or GitHub fields. */
  sources: string[];
}

/**
 * Which row shows each check: the respect checks (shared/contribution.ts
 * respectChecks), and the two text checks that quote the project's rules
 * about the same things, `issue` (the description links no issue) and
 * `brevity` (short descriptions in the contributor's own words).
 */
const rowOfCheck: Partial<Record<DraftCheck["id"], ChecklistRowId>> = {
  issue: "issue",
  brevity: "words",
  "ai-ban": "rules",
  "project-rules": "rules",
  "pr-closed": "door",
  "issue-closed": "issue",
  "issue-has-pr": "issue",
  "area-reserved": "issue",
  "issue-state": "issue",
  "pacing-max": "pacing",
  pacing: "pacing",
  "own-words": "words",
  "tests-weakened": "reviewability",
  reviewability: "reviewability",
  "ai-disclosure": "disclosure",
};

/** The text checks above: their details are all sources, with no "why" first. */
const textChecks = new Set<DraftCheck["id"]>(["issue", "brevity"]);

/**
 * The checks the checklist shows instead of the preflight list: the ones
 * above and `facts-unknown` (its parts go to the door, issue and pacing
 * rows).
 */
export function checklistCheck(check: DraftCheck) {
  return check.id in rowOfCheck || check.id === "facts-unknown";
}

/**
 * Respect checks that follow from the project's rules, the GitHub facts,
 * the issue link, the change and the description alone. Checks computed
 * with the same facts have them too; a saved override or test reason,
 * which only the server knows, never lifts them.
 */
const factCheckIds = new Set<DraftCheck["id"]>([
  "pr-closed",
  "ai-ban",
  "ai-disclosure",
  "issue-closed",
  "area-reserved",
  "pacing-max",
  "pacing",
  "project-rules",
  "issue-state",
  "reviewability",
]);

/**
 * `checks` with the fact checks of `local` (computed here from the facts
 * the checklist shows) that it lacks: checks computed without those facts,
 * such as the editor's before the server's arrive, never leave a row OK
 * while its facts say otherwise.
 */
export function withFactChecks(checks: DraftCheck[], local: readonly DraftCheck[] = []) {
  const present = new Set(checks.map((check) => check.id));
  return [
    ...checks,
    ...local.filter((check) => factCheckIds.has(check.id) && !present.has(check.id)),
  ];
}

export interface ChecklistInput {
  /** The publish checks for the saved draft; absent until they ran. */
  checks?: DraftCheck[];
  rules?: ContributionRules;
  facts?: ContributionFacts;
  changes?: ReviewabilitySnapshot;
  understanding?: { required: boolean; passed: boolean; off: boolean };
  /** The run's issue link; empty means none. */
  issueUrl?: string;
  /** The project's disclosure rule from the draft's sources, when it has one. */
  disclosureRule?: DraftRuleQuote;
}

/** The reason each part of the facts could not be read, by part. */
function unknownReasons(entries?: readonly string[]) {
  const reasons: Partial<Record<"door" | "issue" | "pacing", string>> = {};
  for (const { part, reason } of unknownParts(entries))
    // A fact without a known part shows on the door row, the first one read.
    reasons[part === "other" ? "door" : part] ??= reason ?? "";
  return reasons;
}

const worse: Record<ChecklistStatus, number> = { ok: 0, unknown: 1, confirm: 2, block: 3 };

export function checklistRows(
  input: ChecklistInput,
  m: Messages["draft"]["guidance"]["checklist"],
  fmt: Formatters,
  bands: Messages["draft"]["reviewability"]["bands"],
): ChecklistRow[] {
  const { checks, rules, facts, changes, understanding } = input;
  const byRow = new Map<ChecklistRowId, DraftCheck[]>();
  for (const check of checks ?? []) {
    const row = rowOfCheck[check.id];
    if (row) byRow.set(row, [...(byRow.get(row) ?? []), check]);
  }
  const unknown = unknownReasons(facts?.unknown);
  const door = facts?.door ?? rules?.door;
  const issue = facts?.issue;
  const pacing = facts?.pacing;
  const couldnt = (reason?: string) =>
    reason ? m.couldntCheck({ reason }) : m.couldntCheckAny;

  /** A row from its checks when one fires; `fallback` otherwise. */
  const row = (
    id: ChecklistRowId,
    fallback: () => Omit<ChecklistRow, "id">,
  ): ChecklistRow => {
    const fired = byRow.get(id) ?? [];
    if (!fired.length) return { id, ...fallback() };
    const status = fired.reduce<ChecklistStatus>(
      (current, check) => (worse[check.kind] > worse[current] ? check.kind : current),
      "ok",
    );
    return {
      id,
      status,
      // A required disclosure: the row says that publishing waits for it.
      lines: [
        ...(id === "disclosure" && status === "block" ? [m.disclosureWaits] : []),
        ...fired.map((check) => check.message),
      ],
      // A respect check's first detail says why maintainers care; the row
      // has its own sentence, so only the sources stay.
      sources: fired.flatMap((check) =>
        textChecks.has(check.id) ? check.details : check.details.slice(1),
      ),
    };
  };
  const quote = (finding: ContributionRules["findings"][number]) =>
    m.quote({ path: finding.path, line: finding.line, quote: finding.quote });
  const field = (name: string, value: string) => m.githubField({ field: name, value });

  return [
    row("rules", () =>
      !rules
        ? { status: "unknown", lines: [m.rulesUnknown], sources: [] }
        : rules.findings.length
          ? {
              status: "ok",
              lines: [m.rulesFound({ count: rules.findings.length })],
              sources: rules.findings.slice(0, 5).map(quote),
            }
          : {
              status: "ok",
              lines: [m.rulesNotFound({ files: rules.filesRead.length })],
              sources: [],
            },
    ),
    row("door", () =>
      unknown.door !== undefined
        ? { status: "unknown", lines: [couldnt(unknown.door)], sources: [] }
        : door
          ? doorClosed(door)
            ? // The facts close the door although no check ran on them: publishing will.
              { status: "block", lines: [m.doorClosed], sources: [] }
            : {
                status: "ok",
                lines: [m.doorOpen],
                sources: door.pullRequestCreationPolicy
                  ? [field("pull_request_creation_policy", door.pullRequestCreationPolicy)]
                  : [],
              }
          : { status: "unknown", lines: [m.factsUnknown], sources: [] },
    ),
    row("issue", () => {
      if (!input.issueUrl?.trim()) return { status: "ok", lines: [m.noIssue], sources: [] };
      if (unknown.issue !== undefined)
        return { status: "unknown", lines: [couldnt(unknown.issue)], sources: [] };
      if (!issue) return { status: "unknown", lines: [m.factsUnknown], sources: [] };
      // The facts say closed although no check ran on them: publishing will.
      if (issue.state?.toUpperCase() === "CLOSED")
        return { status: "block", lines: [m.issueClosed], sources: [field("state", "CLOSED")] };
      // Another person's pull request would close the issue, and no check
      // says so: never "nobody else is on it".
      const login = door?.login?.toLowerCase();
      const competing = (issue.otherPrs ?? []).filter(
        (pr) =>
          pr.state.toUpperCase() === "OPEN" &&
          pr.willClose !== false &&
          (!login || pr.author?.toLowerCase() !== login),
      );
      if (competing.length)
        return {
          status: "confirm",
          lines: competing.map((pr) => m.otherPr({ author: pr.author ?? "?", number: pr.number })),
          sources: [...(issue.state ? [field("state", issue.state)] : [])],
        };
      return {
        status: "ok",
        lines: [m.issueOpen({ number: issue.number })],
        sources: [
          ...(issue.state ? [field("state", issue.state)] : []),
          ...(issue.maintainerQuote
            ? [
                m.maintainerSaid({
                  quote: issue.maintainerQuote.quote,
                  date: fmt.date(issue.maintainerQuote.at),
                }),
              ]
            : []),
        ],
      };
    }),
    row("pacing", () => {
      if (unknown.pacing !== undefined)
        return { status: "unknown", lines: [couldnt(unknown.pacing)], sources: [] };
      if (!pacing || typeof pacing.openPrs !== "number")
        return { status: "unknown", lines: [m.factsUnknown], sources: [] };
      if (pacingExempt(pacing.viewerPermission ?? door?.viewerPermission))
        return { status: "ok", lines: [m.pacingExempt], sources: [] };
      return {
        status: "ok",
        lines: [m.pacing({ open: pacing.openPrs, budget: openPrBudget(pacing.mergedPrs ?? 0) })],
        sources: [],
      };
    }),
    row("words", () =>
      checks
        ? { status: "ok", lines: [m.wordsOk], sources: [] }
        : { status: "unknown", lines: [m.draftUnknown], sources: [] },
    ),
    row("reviewability", () =>
      changes
        ? {
            status: "ok",
            lines: [
              m.reviewable({
                band: bands[changes.band],
                lines: changes.changedLines,
                files: changes.files,
              }),
            ],
            sources: [],
          }
        : { status: "unknown", lines: [m.changesUnknown], sources: [] },
    ),
    row("disclosure", () => {
      const required = [
        ...(rules?.findings.filter((finding) => finding.kind === "disclose").map(quote) ?? []),
        ...(input.disclosureRule
          ? [m.ruleFrom({ label: input.disclosureRule.label, quote: input.disclosureRule.quote })]
          : []),
      ];
      if (!checks) return { status: "unknown", lines: [m.draftUnknown], sources: required };
      if (required.length)
        return { status: "ok", lines: [m.disclosureRequired], sources: required };
      if (!rules) return { status: "unknown", lines: [m.rulesUnknown], sources: [] };
      return { status: "ok", lines: [m.disclosureChoice], sources: [] };
    }),
    {
      id: "understanding",
      // The check is not required only while the person turned it off.
      ...(!understanding
        ? { status: "unknown" as const, lines: [m.notChecked], sources: [] }
        : understanding.off || (!understanding.required && !understanding.passed)
          ? { status: "confirm" as const, lines: [m.understandingOff], sources: [] }
          : understanding.passed
            ? { status: "ok" as const, lines: [m.understandingPassed], sources: [] }
            : { status: "block" as const, lines: [m.understandingRequired], sources: [] }),
    },
  ];
}
