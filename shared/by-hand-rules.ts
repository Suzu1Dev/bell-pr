/**
 * The quoted confirm's policy for Learn-by-hand runs (DESIGN v1.2 F12,
 * owner answer 2 of 2026-10-20). STUB: W1A froze these signatures; W2G
 * fills the bodies and owns their tests. Until then the stub keeps the W1
 * behaviour: every Learn-by-hand block stays a block, and no run is fitted.
 *
 * `respectChecks` (shared/contribution.ts), `createRun`
 * (server/new-run.ts), the respect mirrors and, in W2, the task dialog and
 * the GuidePanel call these three functions and nothing else, so W2G fills
 * this module without touching another file. Everything here is pure,
 * deterministic and non-persisted.
 *
 * Final signatures:
 *
 * - `carveOutKinds(text): HelpKind[]`: the help kinds one carve-out
 *   sentence of a project's text names, by the F12 word table
 *   (understand/explain/learning aid, research, questions: explain and
 *   answer; debug: test; review of your own code: review; possible
 *   solutions or solution ideas: plan). Any other word names none. Used
 *   by the carve-out reader when rules are read. Stub: `[]`.
 *
 * - `byHandRulesCase(rules, { learningIssue, now })`: which case applies
 *   before a run exists. `none` when no contribution ban applies and no
 *   `area` finding applies (area findings count only with
 *   `learningIssue`); `blocked` with the first failing finding, its reach
 *   and the reason; `fitted` when every applicable finding passes F12 (a)
 *   and (b) for the kinds its carve-outs name, with the intersection of
 *   those kinds (always explain and answer, else `too-few-kinds`) and the
 *   lock to store (`HelpLock` without `at`, which createRun sets). Stub:
 *   `blocked` with reason `reach` when any `ban` has contribution context,
 *   or when `learningIssue` and any `area` finding exists; otherwise
 *   `none`; never `fitted`.
 *
 * - `byHandRulesDecision({ bans, areas, rules }, learnByHand)`: at
 *   approve and publish, for the contribution `ban` findings and the
 *   applicable `area` findings of a clean Learn-by-hand run (the preflight
 *   input), which stay blocked, each with the first failed condition
 *   (and, for `kind-not-named`, the kinds the text doesn't name), and
 *   which pass all of F12 (a)-(e), each with its carve-outs and up to two
 *   other AI rules of the same document. The caller shows the
 *   `by-hand-rules` confirm only when none is blocked. Stub: every finding
 *   blocked, reason `reach` for an assistance or unknown ban and a "use"
 *   or unknown reservation, `no-carve-out` otherwise.
 */
import type { HelpKind, HelpLock } from "./by-hand.js";
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

/** The help kinds a carve-out sentence names (the F12 word table). Stub: none. */
export function carveOutKinds(text: string): HelpKind[] {
  void text;
  return [];
}

/** Which case applies before a run exists (see the module header). Stub: never `fitted`. */
export function byHandRulesCase(
  rules: ContributionRules | undefined,
  options: { learningIssue: boolean; now: string },
): ByHandRulesCase {
  const findings = rules?.findings ?? [];
  const ban = findings.find((finding) => finding.kind === "ban" && finding.contribution);
  if (ban) return { case: "blocked", finding: ban, reach: banReach(ban.quote), reason: "reach" };
  const area = options.learningIssue
    ? findings.find((finding) => finding.kind === "area")
    : undefined;
  if (area)
    return { case: "blocked", finding: area, reach: areaReach(area.quote), reason: "reach" };
  return { case: "none" };
}

/** The quoted confirm's decision at approve and publish (see the module header). Stub: all blocked. */
export function byHandRulesDecision(
  findings: { bans: PolicyFinding[]; areas: PolicyFinding[]; rules: ContributionRules },
  learnByHand: ByHandPreflightInput,
): ByHandRulesDecision {
  void learnByHand;
  const banBlock = (finding: PolicyFinding) => ({
    finding,
    reason: (banReach(finding.quote) === "output" ? "no-carve-out" : "reach") as ByHandBlockReason,
  });
  const areaBlock = (finding: PolicyFinding) => {
    const reach = areaReach(finding.quote);
    const output = reach === "output" || reach === "automate";
    return { finding, reason: (output ? "no-carve-out" : "reach") as ByHandBlockReason };
  };
  return {
    blocked: [...findings.bans.map(banBlock), ...findings.areas.map(areaBlock)],
    confirmable: [],
  };
}
