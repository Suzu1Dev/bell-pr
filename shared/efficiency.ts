export const ponytailModes = ["off", "lite", "full"] as const;
export type PonytailMode = (typeof ponytailModes)[number];
export const defaultPonytailMode: PonytailMode = "lite";
export const ponytailVersion = "4.10.2";
export const ponytailRevision = "a17afe0712fc43b08f812d54391a0e5c35353b61";
export const ponytailPolicyVersion = "bell-ponytail-v1";
export const ponytailSource = "https://github.com/DietrichGebert/ponytail";

/** Provider-reported token totals, never a cost estimate. Cached input is part of input. */
export interface EfficiencyMetrics {
  policyVersion: string;
  mode: PonytailMode;
  calls: number;
  completedCalls: number;
  failedCalls: number;
  measuredCalls: number;
  durationMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  /** Same provider-reported counts split by the calling role (lead, member-N, reviewer, …); absent on older records. */
  byRole?: Record<string, RoleEfficiency>;
}

export type RoleEfficiency = Pick<
  EfficiencyMetrics,
  | "calls"
  | "measuredCalls"
  | "inputTokens"
  | "cachedInputTokens"
  | "outputTokens"
  | "durationMs"
>;
