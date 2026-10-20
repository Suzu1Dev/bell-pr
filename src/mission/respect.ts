/**
 * Pure helpers for the "Before you contribute" card, the task dialog's
 * Before-you-start facts and the draft checklist: whether pull requests
 * are open to the person, which facts could not be read, and why Start
 * asks once. Every unknown stays unknown; nothing here turns a missing
 * fact into a pass.
 */
import type { HelpKind } from "../../shared/by-hand";
import type { ByHandBlockReason, ByHandRulesCase } from "../../shared/by-hand-rules";
import {
  byHandBlockClause,
  collaboratorPermission,
  learningLabel,
  openPrBudget,
  pacingExempt,
  unknownReasonText,
  type ContributionFacts,
  type ContributionRules,
  type DoorFacts,
} from "../../shared/contribution";
import en from "../../shared/i18n/draft-checks.en";
import zhTW from "../../shared/i18n/draft-checks.zh-TW";
import { formatters, type Locale } from "../../shared/i18n/locale";
import type { AreaReach, BanReach } from "../../shared/policy-reach";
import { classifyPolicy } from "../../shared/project-policy";
import type { DemoContent } from "../demo/types";
import type { Messages } from "../i18n";

/**
 * Why the task dialog asks once before Start: the facts say publishing
 * will wait (`learning` is the good-first-issue lesson). Nothing here ever
 * refuses to create the run.
 */
export type StartReason =
  | { id: "issue-closed" | "door" | "ban" | "area" | "learning" }
  | { id: "other-pr"; author: string; number: number }
  | { id: "pacing"; open: number; budget: number }
  | ByHandStartReason;

/**
 * A Learn-by-hand run's case before it starts (DESIGN v1.2 F12): BELL won't
 * publish it there (a ban, or a reserved issue), or only through the
 * quoted confirm when the guide stays within the project's carve-out.
 */
export type ByHandStartReason =
  | {
      id: "by-hand-ban" | "by-hand-area";
      reach: BanReach | AreaReach;
      reason: ByHandBlockReason;
      checkedOn?: string;
    }
  | { id: "by-hand-fitted"; kinds: HelpKind[]; quote: string };

/** What the task dialog's Before-you-start facts report to the dialog. */
export interface StartCheck {
  /** The facts read for the issue link, or the sample's. */
  facts?: ContributionFacts;
  /** Empty when Start needs no confirm. */
  reasons: StartReason[];
  /** The project's stored rules, once read. */
  rules?: ContributionRules;
  /** Which case a Learn-by-hand run would start in (byHandRulesCase). */
  rulesCase?: ByHandRulesCase;
  /** The linked issue carries a newcomer label. */
  learningIssue?: boolean;
}

/** How the card states the door. */
export type DoorState = "open" | "collaborators" | "off" | "archived";

/** Whether pull requests are open to the person, from GitHub's own fields. */
export function doorState(door: DoorFacts): DoorState {
  if (door.archived) return "archived";
  if (door.hasPullRequests === false || door.disabled) return "off";
  if (
    door.pullRequestCreationPolicy === "collaborators_only" &&
    !collaboratorPermission(door.viewerPermission)
  )
    return "collaborators";
  return "open";
}

/** Pull requests are closed to the person: publishing is blocked (`pr-closed`). */
export function doorClosed(door: DoorFacts) {
  return doorState(door) !== "open";
}

/**
 * The door the task dialog knows. A door read now wins over the one stored
 * at import. The issue check reads no door of its own, only the person's
 * login, which a project imported from a local folder keeps nowhere else:
 * it joins the stored door, so the person's own pull request or
 * assignment on the issue never reads as someone else's.
 */
export function knownDoor(
  facts?: ContributionFacts,
  rules?: ContributionRules,
): DoorFacts | undefined {
  const read = facts?.door;
  const loginOnly = !!read && Object.keys(read).every((key) => key === "login");
  if (read && !loginOnly) return read;
  if (!rules?.door) return read;
  return read?.login ? { ...rules.door, login: read.login } : rules.door;
}

export type FactPart = "door" | "issue" | "pacing" | "other";

/**
 * Splits `unknown` entries ("<part>" or "<part>: <reason>") into their
 * part and reason, a stored reason code worded in `locale`. A part BELL
 * does not know keeps the whole entry as its reason.
 */
export function unknownParts(entries: readonly string[] | undefined, locale: Locale) {
  return (entries ?? []).map((entry) => {
    const [head, ...rest] = entry.split(":");
    const part = head.trim();
    if (part === "door" || part === "issue" || part === "pacing")
      return {
        part: part as FactPart,
        reason: unknownReasonText(rest.join(":").trim(), locale) || undefined,
      };
    return { part: "other" as FactPart, reason: entry.trim() || undefined };
  });
}

/** The issue number of a GitHub issue page URL, as the server accepts them; undefined otherwise. */
export function issueNumber(url = "") {
  const match =
    /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]+\/issues\/([1-9]\d{0,9})\/?$/.exec(
      url.trim(),
    );
  return match ? Number(match[1]) : undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The rules in a contribution-rules answer, bare or as `{ rules }`. */
export function rulesFrom(body: unknown): ContributionRules | undefined {
  const value = isRecord(body) && "rules" in body ? body.rules : body;
  return isRecord(value) &&
    typeof value.checkedAt === "string" &&
    Array.isArray(value.findings) &&
    Array.isArray(value.filesRead)
    ? (value as unknown as ContributionRules)
    : undefined;
}

/** The facts in a contribution-check answer, bare or as `{ facts }`. */
export function factsFrom(body: unknown): ContributionFacts | undefined {
  const value = isRecord(body) && "facts" in body ? body.facts : body;
  return isRecord(value) && typeof value.checkedAt === "string"
    ? (value as unknown as ContributionFacts)
    : undefined;
}

const sameLogin = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Why Start asks once (DESIGN §5.1): the issue is closed, someone else's
 * open pull request would close it, pull requests are closed to the
 * person, the rules ban AI-assisted contributions, the issue is kept for
 * newcomers (a block where the project reserves such issues, the
 * good-first-issue lesson otherwise), or the person's open pull requests
 * here reach twice the budget. Publishing blocks on each of these; run
 * creation never does.
 */
export function startReasons(
  facts?: ContributionFacts,
  rules?: ContributionRules,
  byHand?: { rulesCase?: ByHandRulesCase },
): StartReason[] {
  const reasons: StartReason[] = [];
  const door = knownDoor(facts, rules);
  const issue = facts?.issue;
  const login = door?.login;
  if (issue?.state?.toUpperCase() === "CLOSED") reasons.push({ id: "issue-closed" });
  const competing = (issue?.otherPrs ?? []).find(
    (pr) =>
      pr.state.toUpperCase() === "OPEN" &&
      pr.willClose !== false &&
      !sameLogin(pr.author, login),
  );
  if (competing)
    reasons.push({ id: "other-pr", author: competing.author ?? "?", number: competing.number });
  if (door && doorClosed(door)) reasons.push({ id: "door" });
  const findings = rules?.findings ?? [];
  // A Learn-by-hand run says its own case; the person writes, so no lesson.
  const byHandReason = byHand && byHandStartReason(byHand.rulesCase);
  if (byHandReason) reasons.push(byHandReason);
  if (!byHand && findings.some((finding) => finding.kind === "ban" && finding.contribution))
    reasons.push({ id: "ban" });
  if (!byHand && (issue?.labels ?? []).some(learningLabel))
    reasons.push(
      findings.some((finding) => finding.kind === "area") ? { id: "area" } : { id: "learning" },
    );
  const pacing = facts?.pacing;
  if (
    pacing &&
    typeof pacing.openPrs === "number" &&
    !pacingExempt(pacing.viewerPermission ?? door?.viewerPermission)
  ) {
    const budget = openPrBudget(pacing.mergedPrs ?? 0);
    if (pacing.openPrs >= 2 * budget)
      reasons.push({ id: "pacing", open: pacing.openPrs, budget });
  }
  return reasons;
}

/**
 * The mode the dialog starts with: Learn by hand when discovery chose it or
 * the linked issue carries a newcomer label, never while the rules are
 * unread or when they have a contribution ban or a reserved-issue rule (a
 * banning project is never a reason to preselect it).
 */
export function suggestedMode({
  preferred,
  learningIssue,
  rules,
}: {
  preferred?: "agents" | "hand";
  learningIssue: boolean;
  rules?: ContributionRules;
}): "agents" | "hand" {
  const restricted = (rules?.findings ?? []).some(
    (finding) => (finding.kind === "ban" && finding.contribution) || finding.kind === "area",
  );
  const wanted = preferred === "hand" || (preferred !== "agents" && learningIssue);
  return wanted && rules && !restricted ? "hand" : "agents";
}

/** Whether a start reason is a Learn-by-hand run's case. */
export const isByHandReason = (reason: StartReason): reason is ByHandStartReason =>
  reason.id.startsWith("by-hand-");

/** The start reason of a Learn-by-hand run's case; none when no rule applies. */
export function byHandStartReason(rulesCase?: ByHandRulesCase): ByHandStartReason | undefined {
  if (rulesCase?.case === "fitted")
    return {
      id: "by-hand-fitted",
      kinds: rulesCase.kinds,
      quote: rulesCase.lock.rules.find((rule) => rule.allows.length)?.allows[0].quote ?? "",
    };
  if (rulesCase?.case !== "blocked") return undefined;
  const { finding, reach, reason } = rulesCase;
  return {
    id: finding.kind === "area" ? "by-hand-area" : "by-hand-ban",
    reach,
    reason,
    ...(finding.source ? { checkedOn: finding.source.checkedOn } : {}),
  };
}

/** Kinds of help as the respect checks name them (shared/i18n/draft-checks), as one list. */
export function helpKindList(kinds: readonly string[], locale: Locale) {
  const names: Record<string, string> = (locale === "zh-TW" ? zhTW : en).respect.byHand.kinds;
  return formatters(locale).list(kinds.map((kind) => names[kind] ?? kind));
}

/** The sentence of a Learn-by-hand start reason, in `locale` (`m`: mission.startConfirm.byHand). */
export function byHandReasonText(
  reason: ByHandStartReason,
  m: Messages["mission"]["startConfirm"]["byHand"],
  locale: Locale,
) {
  if (reason.id === "by-hand-fitted")
    return m.fitted({ kinds: helpKindList(reason.kinds, locale), quote: reason.quote });
  const condition = byHandBlockClause(reason.reason, locale, { checkedOn: reason.checkedOn });
  return (reason.id === "by-hand-ban" ? m.ban : m.area)({ reach: reason.reach, condition });
}

/**
 * The sample project's "Before you contribute" facts: its fictional
 * CONTRIBUTING.md through the real classifier, its door and its merged
 * sizes. The one source for the rules card, the task dialog, the Draft tab
 * and the publish dialog (src/workspace/respect.ts uses it too). It lives
 * here, in a module only lazy views load, because every module under
 * src/demo/ joins the demo chunk that loads at startup, and the classifier
 * would bring the PR-check tooling into it.
 */
export function sampleRules(demo: DemoContent): ContributionRules {
  const context = demo.draftPreparation.context;
  return {
    checkedAt: context?.checkedAt ?? "",
    ...(demo.contributionFacts?.door ? { door: { ...demo.contributionFacts.door } } : {}),
    findings: classifyPolicy("CONTRIBUTING.md", demo.contributingText ?? ""),
    filesRead: (context?.sources ?? []).flatMap((source) => (source.path ? [source.path] : [])),
    ...(demo.mergedSizes ? { mergedSizes: demo.mergedSizes.map((size) => ({ ...size })) } : {}),
  };
}
