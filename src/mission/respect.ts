/**
 * Pure helpers for the "Before you contribute" card, the task dialog's
 * Before-you-start facts and the draft checklist: whether pull requests
 * are open to the person, which facts could not be read, and why Start
 * asks once. Every unknown stays unknown; nothing here turns a missing
 * fact into a pass.
 */
import {
  collaboratorPermission,
  learningLabel,
  openPrBudget,
  pacingExempt,
  type ContributionFacts,
  type ContributionRules,
  type DoorFacts,
} from "../../shared/contribution";
import { classifyPolicy } from "../../shared/project-policy";
import type { DemoContent } from "../demo/types";

/**
 * Why the task dialog asks once before Start: the facts say publishing
 * will wait (`learning` is the good-first-issue lesson). Nothing here ever
 * refuses to create the run.
 */
export type StartReason =
  | { id: "issue-closed" | "door" | "ban" | "area" | "learning" }
  | { id: "other-pr"; author: string; number: number }
  | { id: "pacing"; open: number; budget: number };

/** What the task dialog's Before-you-start facts report to the dialog. */
export interface StartCheck {
  /** The facts read for the issue link, or the sample's. */
  facts?: ContributionFacts;
  /** Empty when Start needs no confirm. */
  reasons: StartReason[];
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

export type FactPart = "door" | "issue" | "pacing" | "other";

/**
 * Splits `unknown` entries ("<part>" or "<part>: <reason>") into their
 * part and reason. A part BELL does not know keeps the whole entry as
 * its reason.
 */
export function unknownParts(entries: readonly string[] = []) {
  return entries.map((entry) => {
    const [head, ...rest] = entry.split(":");
    const part = head.trim();
    if (part === "door" || part === "issue" || part === "pacing")
      return { part: part as FactPart, reason: rest.join(":").trim() || undefined };
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
): StartReason[] {
  const reasons: StartReason[] = [];
  const door = facts?.door ?? rules?.door;
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
  if (findings.some((finding) => finding.kind === "ban" && finding.contribution))
    reasons.push({ id: "ban" });
  if ((issue?.labels ?? []).some(learningLabel))
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
