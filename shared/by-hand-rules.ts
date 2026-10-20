/**
 * The quoted confirm's policy for Learn-by-hand runs (DESIGN v1.2 F12,
 * owner answer 2 of 2026-10-20). W1A froze these signatures; W2G filled
 * them. A ban or a reserved issue stays a hard block unless every
 * condition holds; nothing here is an override, and an agent run never
 * reaches it.
 *
 * `respectChecks`, `createRun`, the respect mirrors, the task dialog and
 * the GuidePanel call the case reader and the decision. Only the server's
 * carve-out reader (`attachCarveOuts`, shared/project-policy.ts) calls
 * `carveOutKinds`, so the word table stays out of the client. All of it
 * is pure and non-persisted; the only clock is the `now` passed in.
 *
 * - `carveOutKinds(text)`: the help kinds the permitted part of one
 *   carve-out names, by the F12 word table (understanding the code,
 *   explaining, a learning aid, research and questions about the code:
 *   explain and answer; debugging: test; a private review of your own
 *   code: review; possible solutions or solution ideas: plan). Any other
 *   word names none: "static analysis", "find bugs", "analyze" and
 *   "suggest" included.
 *
 * - `byHandRulesCase(rules, { learningIssue, now })`: which case applies
 *   before a run exists. `none` when no contribution ban applies and no
 *   `area` finding applies (area findings count only with
 *   `learningIssue`); `blocked` with the first failing finding, its reach
 *   and the reason ((a) reach, (b) no carve-out or a stale checked-list
 *   entry, then `too-few-kinds`); `fitted` when every applicable finding
 *   passes (a) and (b), with the intersection of the kinds their
 *   carve-outs name (always explain and answer) and the lock to store
 *   (`HelpLock` without `at`, which createRun sets).
 *
 * - `byHandRulesDecision({ bans, areas, rules }, learnByHand)`: at
 *   approve and publish, for the contribution `ban` findings and the
 *   applicable `area` findings of a clean Learn-by-hand run (the preflight
 *   input; condition (c) is the caller's), which stay blocked, each with
 *   the first failed condition (and, for `kind-not-named`, the kinds the
 *   text doesn't name), and which pass all of F12 (a), (b), (d) and (e),
 *   each with its carve-outs and up to two other AI rules of the same
 *   document. The caller shows the `by-hand-rules` confirm only when none
 *   is blocked, and publish needs it acknowledged (f).
 */
import { allHelpKinds, type HelpKind, type HelpLock, type HelpLockRule } from "./by-hand.js";
import type { ContributionRules, PolicyAllowance, PolicyFinding } from "./contribution.js";
import type { ByHandPreflightInput } from "./draft-checks.js";
import { areaReach, banReach, type AreaReach, type BanReach } from "./policy-reach.js";

/**
 * Why a finding stays blocked, or why a run can't be fitted (not
 * persisted). Each maps to one copy clause in shared/i18n/draft-checks.*:
 * `reach` the rule restricts AI help itself, uses "use" wording or BELL
 * can't tell its reach (condition a); `no-carve-out` the project's text
 * doesn't say which uses of AI are fine and `kind-not-named` a used kind
 * it doesn't name (b); `registry-stale` a checked-list entry checked more
 * than 90 days ago (b); `rules-unread` the rules were not read during the
 * run (d); `not-fitted` and `rules-changed` the help set was not fixed at
 * the start, or the locked quotes left the rules (e); `too-few-kinds` the
 * carve-outs leave out explanations or answers, which the guide needs.
 */
export type ByHandBlockReason =
  | "reach"
  | "no-carve-out"
  | "kind-not-named"
  | "registry-stale"
  | "rules-unread"
  | "not-fitted"
  | "rules-changed"
  | "too-few-kinds";

/** Which F12 case applies to a project's rules before a run exists. */
export type ByHandRulesCase =
  | { case: "none" }
  | {
      case: "blocked";
      finding: PolicyFinding;
      reach: BanReach | AreaReach;
      reason: ByHandBlockReason;
    }
  | { case: "fitted"; kinds: HelpKind[]; lock: Omit<HelpLock, "at"> };

/** What the respect checks do with a clean Learn-by-hand run's ban and area findings. */
export interface ByHandRulesDecision {
  blocked: { finding: PolicyFinding; reason: ByHandBlockReason; kinds?: HelpKind[] }[];
  confirmable: {
    finding: PolicyFinding;
    allows: PolicyAllowance[];
    /** Up to two other AI rules of the same document, quoted with the confirm. */
    others: PolicyFinding[];
  }[];
}

/**
 * The F12 word table, and nothing else: each pattern with the kinds of
 * help it names. Understanding and questions count only about the code,
 * a review only of the person's own work or in private.
 */
const carveOutTable: readonly (readonly [RegExp, readonly HelpKind[]])[] = [
  [
    /\bunderstand(?:ing)?\b(?:\W+\w+){0,4}?\W+(?:code(?:base)?|source|project|repository|internals|APIs?|algorithms?)\b/i,
    ["explain", "answer"],
  ],
  [/\bexplain(?:s|ing)?\b|\bexplanations?\b|\blearning\s+aids?\b/i, ["explain", "answer"]],
  [/\bresearch(?:ing)?\b/i, ["explain", "answer"]],
  [
    /\banswer(?:s|ing)?\s+(?:\w+\s+){0,2}?questions\b|\bquestions?\b(?:\W+\w+){0,3}?\W+(?:about|on|regarding)\b(?:\W+\w+){0,3}?\W+(?:code(?:base)?|source|project|repository|internals|APIs?)\b/i,
    ["explain", "answer"],
  ],
  [/\bdebug(?:ging)?\b/i, ["test"]],
  [
    /\bprivate(?:ly)?\s+review\w*|\bself[- ]review\w*|\breview(?:s|ing)?\s+(?:of\s+)?(?:your|my|their)\s+own\b|\breview(?:s|ing)?\s+your\s+(?:code|changes?|work|patch(?:es)?|prose)\b/i,
    ["review"],
  ],
  [/\bpossible\s+solutions?\b|\bsolution\s+ideas?\b/i, ["plan"]],
];

/** The help kinds a carve-out's permitted words name (the F12 word table), in vocabulary order. */
export function carveOutKinds(text: string): HelpKind[] {
  const named = new Set(
    carveOutTable.flatMap(([pattern, kinds]) => (pattern.test(text) ? kinds : [])),
  );
  return allHelpKinds.filter((kind) => named.has(kind));
}

const dayMs = 24 * 60 * 60 * 1000;

/** Days after its quotes were last checked that a checked-list entry may still lift a block. */
export const registryFreshDays = 90;

/**
 * A checked-list entry checked more than 90 days before `now`, or with a
 * date BELL can't read: it still applies and blocks, but never lifts.
 */
export function registryStale(checkedOn: string, now: string) {
  return !(Date.parse(now) - Date.parse(checkedOn) <= registryFreshDays * dayMs);
}

/** A lock holds at most this many rules (the `HelpLock.rules` cap). */
const maxLockRules = 4;

/** Kinds of the AI rules a document can state (the classifier's AI findings). */
const aiRuleKinds: readonly string[] = ["ban", "area", "agent", "disclose"];

type RuleText = { kind: string; path: string; quote: string };
const sameRule = (a: RuleText, b: RuleText) =>
  a.kind === b.kind && a.path === b.path && a.quote === b.quote;

const reachOf = (finding: PolicyFinding) =>
  finding.kind === "area" ? areaReach(finding.quote) : banReach(finding.quote);

/**
 * Condition (a): an output-only ban, or a reservation worded around
 * AI-generated or automated pull requests. A checked-list finding's quote
 * is read the same way; the registry check refuses an entry whose signed
 * reach the quote doesn't read as.
 */
function restrictsOutput(finding: PolicyFinding) {
  const reach = reachOf(finding);
  return finding.kind === "area" ? reach === "output" || reach === "automate" : reach === "output";
}

/** The kinds a finding's carve-outs name, together. */
const namedKinds = (finding: PolicyFinding) =>
  new Set(finding.allows?.flatMap((allowance) => allowance.kinds) ?? []);

/** Conditions (a) and (b) without the help used: the rule's reach, a carve-out, a fresh checked-list entry. */
function textCondition(finding: PolicyFinding, now: string): ByHandBlockReason | undefined {
  if (!restrictsOutput(finding)) return "reach";
  if (!finding.allows?.length) return "no-carve-out";
  if (finding.source && registryStale(finding.source.checkedOn, now)) return "registry-stale";
  return undefined;
}

/** The lock's copy of a finding: what the run is fitted to, quoted when it starts. */
function lockRule(finding: PolicyFinding): HelpLockRule {
  return {
    kind: finding.kind,
    path: finding.path,
    line: finding.line,
    quote: finding.quote,
    allows: (finding.allows ?? []).map((allowance) => ({
      line: allowance.line,
      quote: allowance.quote,
      kinds: [...allowance.kinds],
    })),
    ...(finding.source ? { source: { ...finding.source } } : {}),
  };
}

/** Which case applies before a run exists (see the module header). */
export function byHandRulesCase(
  rules: ContributionRules | undefined,
  options: { learningIssue: boolean; now: string },
): ByHandRulesCase {
  const applicable = (rules?.findings ?? []).filter(
    (finding) =>
      (finding.kind === "ban" && finding.contribution) ||
      (options.learningIssue && finding.kind === "area"),
  );
  if (!rules || !applicable.length) return { case: "none" };
  const blocked = (finding: PolicyFinding, reason: ByHandBlockReason): ByHandRulesCase => ({
    case: "blocked",
    finding,
    reach: reachOf(finding),
    reason,
  });
  for (const finding of applicable) {
    const reason = textCondition(finding, options.now);
    if (reason) return blocked(finding, reason);
  }
  const named = applicable.map(namedKinds);
  // The orientation turn and the first hint explain and answer: a run
  // fitted to a text that doesn't name both could not start.
  const short = applicable.find((_, index) => !named[index].has("explain") || !named[index].has("answer"));
  if (short) return blocked(short, "too-few-kinds");
  if (applicable.length > maxLockRules) return blocked(applicable[maxLockRules], "not-fitted");
  const kinds = allHelpKinds.filter((kind) => named.every((set) => set.has(kind)));
  return {
    case: "fitted",
    kinds,
    lock: { kinds: [...kinds], rulesCheckedAt: rules.checkedAt, rules: applicable.map(lockRule) },
  };
}

/** The first condition a clean run's finding fails, with the kinds the text doesn't name. */
function failedCondition(
  finding: PolicyFinding,
  rules: ContributionRules,
  input: ByHandPreflightInput,
): { reason: ByHandBlockReason; kinds?: HelpKind[] } | undefined {
  if (!restrictsOutput(finding)) return { reason: "reach" };
  const lock = input.helpLock;
  const locked = lock?.rules.find((rule) => sameRule(rule, finding));
  // (e), the drift guard first for the rule the run was fitted to: a
  // carve-out quote it was fitted to is gone from the rules read now.
  if (
    locked?.allows.some(
      (allowance) => !finding.allows?.some((current) => current.quote === allowance.quote),
    )
  )
    return { reason: "rules-changed" };
  // (b) the project's own text names every kind of help the run used.
  const text = textCondition(finding, input.now);
  if (text) return { reason: text };
  const named = namedKinds(finding);
  const unnamed = input.helps.filter((kind) => !named.has(kind));
  if (unnamed.length) return { reason: "kind-not-named", kinds: unnamed };
  // (d) the rules were read during the run, where publishing is checked.
  if (input.createdAt !== undefined && !(Date.parse(rules.checkedAt) >= Date.parse(input.createdAt)))
    return { reason: "rules-unread" };
  // (e) the help set was fixed at the start, for this very rule.
  if (!lock) return { reason: "not-fitted" };
  if (!locked)
    return {
      reason: lock.rules.some((rule) => !rules.findings.some((current) => sameRule(rule, current)))
        ? "rules-changed"
        : "not-fitted",
    };
  const outside = input.helps.filter((kind) => !lock.kinds.includes(kind));
  if (outside.length) return { reason: "kind-not-named", kinds: outside };
  return undefined;
}

/**
 * Up to two other AI rules of the finding's document (or of its
 * checked-list entry), in reading order: quoted with the confirm, never
 * a condition.
 */
function otherRules(finding: PolicyFinding, all: readonly PolicyFinding[], decided: readonly PolicyFinding[]) {
  return all
    .filter(
      (other) =>
        other.path === finding.path &&
        other.source?.url === finding.source?.url &&
        aiRuleKinds.includes(other.kind) &&
        !decided.some((entry) => sameRule(entry, other)),
    )
    .sort((a, b) => a.line - b.line)
    .slice(0, 2);
}

/** The quoted confirm's decision at approve and publish (see the module header). */
export function byHandRulesDecision(
  findings: { bans: PolicyFinding[]; areas: PolicyFinding[]; rules: ContributionRules },
  learnByHand: ByHandPreflightInput,
): ByHandRulesDecision {
  const decided = [...findings.bans, ...findings.areas];
  const decision: ByHandRulesDecision = { blocked: [], confirmable: [] };
  for (const finding of decided) {
    const failed = failedCondition(finding, findings.rules, learnByHand);
    if (failed) decision.blocked.push({ finding, ...failed });
    else
      decision.confirmable.push({
        finding,
        allows: finding.allows ?? [],
        others: otherRules(finding, findings.rules.findings, decided),
      });
  }
  return decision;
}
