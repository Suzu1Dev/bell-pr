/**
 * Free and Pro: the plan types, the entitlements each plan grants, and the
 * feature table that the app, the site and the READMEs render. The copy for
 * the table lives in `shared/i18n/plans.<locale>.ts`; links such as the
 * purchase page live in `shared/product.ts`.
 */
import type { ReasoningEffort } from "./models.js";

/**
 * Features only Pro (or the trial) unlocks. Re-running the Reviewer and Test
 * analyst is deliberately not here: it is part of the human review gate and
 * stays Free. So are the understanding check, the project-rule, issue,
 * reviewability and pacing checks, reading maintainer feedback and the
 * practice deck: no plan buys a way past a check. Pro goes deeper, never
 * to more pull requests.
 */
export const proFeatures = [
  "teamSize",
  "parallelRuns",
  "discovery",
  "moreRecommendations",
  "learningExport",
  /** AI follow-up rounds on maintainer feedback; reading the feedback is Free. */
  "prFeedback",
  "webAccess",
  "deepReasoning",
  /** The model-written coach debrief from the person's own records. */
  "coachDebrief",
] as const;
export type ProFeature = (typeof proFeatures)[number];

export type Plan = "free" | "trial" | "pro";

/** Why the current plan is Free (or a license is not active). */
export type LicenseReason =
  | "no_license"
  | "expired"
  | "trial_ended"
  | "updates_expired"
  | "invalid";

export interface Entitlements {
  plan: Plan;
  /** Teammates a run may use; the persisted setting stays 2 | 3 | 4. */
  maxTeammates: 2 | 3 | 4;
  /** Runs that may execute at once; the rest queue. */
  maxActiveRuns: number;
  features: Record<ProFeature, boolean>;
}

function allFeatures(enabled: boolean): Record<ProFeature, boolean> {
  return Object.fromEntries(
    proFeatures.map((feature) => [feature, enabled]),
  ) as Record<ProFeature, boolean>;
}

/** Free runs one contribution at a time with a Lead and 2 teammates. */
export const freeEntitlements: Entitlements = Object.freeze({
  plan: "free",
  maxTeammates: 2,
  maxActiveRuns: 1,
  features: Object.freeze(allFeatures(false)),
});

/**
 * The most runs Pro and the trial execute at once; the configured limit
 * (1-8: BELLPR_MAX_ACTIVE_RUNS or the app settings) applies below it.
 */
export const proMaxActiveRuns = 8;

/** How long the Pro trial lasts; each data directory gets one. */
export const trialDays = 14;

/** Pro stays on this many days after a license's expiry date. */
export const licenseGraceDays = 7;

/**
 * Pro unlocks every feature; `maxActiveRuns` is the configured concurrency.
 * The trial grants the same with `plan: "trial"`.
 */
export function proEntitlements(maxActiveRuns: number): Entitlements {
  if (!Number.isInteger(maxActiveRuns) || maxActiveRuns < 1)
    throw new RangeError("maxActiveRuns must be a positive integer.");
  return {
    plan: "pro",
    maxTeammates: 4,
    maxActiveRuns,
    features: allFeatures(true),
  };
}

/** Reasoning efforts that need Pro. "Default" (no effort) is on every plan. */
export const proOnlyEfforts = [
  "xhigh",
  "max",
  "ultra",
] as const satisfies readonly ReasoningEffort[];

/** The license state the server reports; personal fields appear only when present. */
export interface LicenseSummary {
  plan: Plan;
  source: "env" | "file" | "trial" | "none";
  status: "active" | "grace" | "expired" | "invalid" | "none";
  reason?: LicenseReason;
  licenseId?: string;
  name?: string;
  email?: string;
  /** ISO date the license expires; absent for perpetual licenses. */
  expiresAt?: string;
  /** ISO date until which new builds are covered. */
  updatesUntil?: string;
  trialDaysLeft?: number;
  /**
   * True while this data directory has not used its trial and no Pro
   * license is active, so the trial can start.
   */
  trialAvailable?: boolean;
  /**
   * True while BELLPR_LICENSE_KEY is set: the key can only change there,
   * so the app shows the license read-only.
   */
  envLocked?: boolean;
}

/**
 * Lowers `maxTeammates` to what the plan allows and says whether it did.
 * It never raises a value, so a Free choice of 2 stays 2 under Pro.
 */
export function clampContributionSettings<T extends { maxTeammates: 2 | 3 | 4 }>(
  settings: T,
  ent: Entitlements,
): { settings: T; clamped: boolean } {
  if (settings.maxTeammates <= ent.maxTeammates)
    return { settings, clamped: false };
  return {
    settings: { ...settings, maxTeammates: ent.maxTeammates },
    clamped: true,
  };
}

/** The rows of the Free/Pro table, in display order. */
export const planFeatureIds = [
  "runs",
  "analysis",
  "moreRecommendations",
  "teamSize",
  "parallelRuns",
  "planApproval",
  "learnByHand",
  "review",
  "understandingCheck",
  "reviewRerun",
  "reading",
  "publish",
  "respectChecks",
  "sync",
  "learningNotes",
  "practice",
  "learningExport",
  "coachDebrief",
  "maintainerFeedback",
  "prFeedback",
  "discovery",
  "webAccess",
  "deepReasoning",
  "providers",
  "demo",
  "trial",
  "licenseTerm",
] as const;
export type PlanFeatureId = (typeof planFeatureIds)[number];

/** Free, Free with a lower limit than Pro, or Pro only. */
export type PlanTier = "free" | "free-limited" | "pro";

export interface PlanFeatureRow {
  id: PlanFeatureId;
  tier: PlanTier;
  /** The entitlement that gates the row, when one does. */
  feature?: ProFeature;
}

export const planFeatureTable: readonly PlanFeatureRow[] = [
  { id: "runs", tier: "free" },
  { id: "analysis", tier: "free" },
  {
    id: "moreRecommendations",
    tier: "pro",
    feature: "moreRecommendations",
  },
  { id: "teamSize", tier: "free-limited", feature: "teamSize" },
  { id: "parallelRuns", tier: "free-limited", feature: "parallelRuns" },
  { id: "planApproval", tier: "free" },
  { id: "learnByHand", tier: "free" },
  { id: "review", tier: "free" },
  { id: "understandingCheck", tier: "free" },
  { id: "reviewRerun", tier: "free" },
  { id: "reading", tier: "free" },
  { id: "publish", tier: "free" },
  { id: "respectChecks", tier: "free" },
  { id: "sync", tier: "free" },
  { id: "learningNotes", tier: "free" },
  { id: "practice", tier: "free" },
  { id: "learningExport", tier: "pro", feature: "learningExport" },
  { id: "coachDebrief", tier: "pro", feature: "coachDebrief" },
  { id: "maintainerFeedback", tier: "free" },
  { id: "prFeedback", tier: "pro", feature: "prFeedback" },
  { id: "discovery", tier: "pro", feature: "discovery" },
  { id: "webAccess", tier: "pro", feature: "webAccess" },
  { id: "deepReasoning", tier: "pro", feature: "deepReasoning" },
  { id: "providers", tier: "free" },
  { id: "demo", tier: "free" },
  { id: "trial", tier: "free" },
  { id: "licenseTerm", tier: "pro" },
];
