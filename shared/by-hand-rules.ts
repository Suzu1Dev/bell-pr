/**
 * The quoted confirm's policy for Learn-by-hand runs (DESIGN v1.2 F12,
 * owner answer 2 of 2026-10-20). W1A froze these signatures; W2G filled
 * them. A ban or a reserved issue stays a hard block unless every
 * condition holds; nothing here is an override, and an agent run never
 * reaches it. All of it is pure and non-persisted; the only clock is the
 * `now` passed in.
 *
 * - `carveOutKinds(text)`: the help kinds one carve-out's permitted words
 *   name, by the F12 word table (understanding the code, explaining, a
 *   learning aid, research and questions about the code: explain and
 *   answer; debugging: test; a private review of your own code: review;
 *   possible solutions or solution ideas: plan); any other word names
 *   none. Only the server's carve-out reader (`attachCarveOuts`) and the
 *   registry check call it, so the table stays out of the client.
 * - `byHandRulesCase(rules, { learningIssue, now })`, before a run: `none`
 *   when no contribution ban or (with `learningIssue`) `area` finding
 *   applies; `blocked` with the first failing finding, its reach and the
 *   reason ((a) reach, here or in any rule of the rules that refuses AI
 *   help itself; (b) no carve-out or a stale checked-list entry; then
 *   `too-few-kinds`); `fitted` with the intersection of the kinds the
 *   carve-outs name (always explain and answer) and the lock to store.
 * - `byHandRulesDecision({ bans, areas, rules }, learnByHand)`, at approve
 *   and publish, for a clean run (condition (c) is the caller's): which
 *   findings stay blocked, each with the first failed condition, and
 *   which pass (a), (b), (d) and (e), each with its carve-outs and up to
 *   two other AI rules of the same document. The caller shows the
 *   `by-hand-rules` confirm only when none is blocked; publish needs it
 *   acknowledged (f).
 */
import { allHelpKinds, type HelpKind, type HelpLock, type HelpLockRule } from "./by-hand.js";
import type { ContributionRules, PolicyAllowance, PolicyFinding } from "./contribution.js";
import type { ByHandPreflightInput } from "./draft-checks.js";
import type { AreaReach, BanReach } from "./policy-reach.js";

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
  | { case: "blocked"; finding: PolicyFinding; reach: BanReach | AreaReach; reason: ByHandBlockReason }
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

/**
 * Help the person does themselves, not AI: "code that you then debug
 * yourself", "code you can explain", "research the APIs yourself"; never
 * help AI gives the person ("help you debug", "so you can understand").
 * Read in the 60 characters before the word and the 200 after it.
 */
const personBefore = /\b(?:you|I|we|they|contributors?)\s+(?:(?:then|later|still|first|also|can|could|must|should|will|may|need\s+to|have\s+to)\s+){0,2}$/i;
const helpedBefore = /\b(?:help(?:s|ed|ing)?|let(?:s|ting)?|allow(?:s|ing)?|enabl(?:e|es|ing)|so(?:\s+that)?)\s+(?:you|me|us|them|contributors?)\s+(?:(?:to|can|could|better)\s+)?$/i;
const personAfter = /^\W*(?:[\w'-]+\s+){0,3}?(?:yourself|yourselves|on\s+your\s+own|by\s+yourself|by\s+hand|manually)\b/i;
function byPerson(text: string, at: number, end: number) {
  const before = text.slice(Math.max(0, at - 60), at);
  return (personBefore.test(before) && !helpedBefore.test(before)) || personAfter.test(text.slice(end, end + 200));
}

/** The help kinds a carve-out's permitted words name (the F12 word table) where AI gives that help, in vocabulary order. */
export function carveOutKinds(text: string): HelpKind[] {
  const byAi = (pattern: RegExp) =>
    [...text.matchAll(new RegExp(pattern.source, "gi"))].some((match) => !byPerson(text, match.index, match.index + match[0].length));
  const named = new Set(carveOutTable.flatMap(([pattern, kinds]) => (byAi(pattern) ? kinds : [])));
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

/** The reach the server stored with the rule (`withStoredReach`); none reads as "unknown", the strict reading. */
const reachOf = (finding: PolicyFinding): BanReach | AreaReach => finding.reach ?? "unknown";

/**
 * Condition (a): an output-only ban, or a reservation worded around
 * AI-generated or automated pull requests. A checked-list finding's quote
 * is read the same way (the registry check holds its signed reach to it).
 */
function restrictsOutput(finding: PolicyFinding) {
  const reach = reachOf(finding);
  return finding.kind === "area" ? reach === "output" || reach === "automate" : reach === "output";
}

/**
 * A ban anywhere in the rules, contribution named or not, that refuses AI
 * help itself or whose reach BELL can't tell ("AI assistance of any kind
 * is not accepted."): no quoted confirm while it stands. The server marks
 * it (`stopsConfirm`); a ban stored without a reach counts too.
 */
export const helpRefused = (rules: ContributionRules) => rules.findings.find((finding) => finding.kind === "ban" && (finding.stopsConfirm || !finding.reach));

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
  // (a) for the whole rules: a rule elsewhere refuses AI help itself.
  const refused = helpRefused(rules);
  if (refused) return blocked(refused, "reach");
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
  refused: PolicyFinding | undefined,
): { reason: ByHandBlockReason; kinds?: HelpKind[] } | undefined {
  if (!restrictsOutput(finding) || refused) return { reason: "reach" };
  const lock = input.helpLock;
  const locked = lock?.rules.find((rule) => sameRule(rule, finding));
  // (e), the drift guard first for the rule the run was fitted to: a
  // carve-out quote it was fitted to is gone from the rules read now.
  if (locked?.allows.some((allowance) => !finding.allows?.some((current) => current.quote === allowance.quote)))
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

/** Up to two other AI rules of the finding's document (or checked-list entry), in reading order: quoted, never a condition. */
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
  const refused = helpRefused(findings.rules);
  for (const finding of decided) {
    const failed = failedCondition(finding, findings.rules, learnByHand, refused);
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
