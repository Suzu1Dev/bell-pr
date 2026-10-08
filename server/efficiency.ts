import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  defaultPonytailMode,
  ponytailPolicyVersion,
  ponytailModes,
  ponytailRevision,
  type EfficiencyMetrics,
  type PonytailMode,
  type RoleEfficiency,
} from "../shared/efficiency.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const roleEfficiencySchema = z.object({
  calls: count,
  measuredCalls: count,
  inputTokens: count,
  cachedInputTokens: count,
  outputTokens: count,
  durationMs: count,
});
const roleKeys = Object.keys(
  roleEfficiencySchema.shape,
) as (keyof RoleEfficiency)[];
export const efficiencyMetricsSchema = z.object({
  policyVersion: z.string().min(1).max(100),
  mode: z.enum(ponytailModes),
  calls: count,
  completedCalls: count,
  failedCalls: count,
  measuredCalls: count,
  durationMs: count,
  inputTokens: count,
  cachedInputTokens: count,
  outputTokens: count,
  byRole: z.record(z.string().min(1).max(60), roleEfficiencySchema).optional(),
});

const fullRules = readFileSync(
  new URL("../vendor/ponytail/rules.md", import.meta.url),
  "utf8",
);
const liteRules =
  "Understand the task and trace affected callers first. Reuse existing code, standard libraries, native platform features, and installed dependencies before adding code. Make the smallest correct change that meets the requested outcome; avoid speculative abstractions and dependencies. Fix root causes. Search and read relevant files within your assigned scope; do not repeat unchanged searches or checks. Validate meaningful behavior with the smallest relevant existing checks. Preserve input validation, error handling, security, accessibility, and all explicit user requirements. Distinguish measured performance from hypotheses; never invent savings or test results.";

export function applyPonytail(
  prompt: string,
  mode: PonytailMode = defaultPonytailMode,
  role: string,
  readonly: boolean,
): string {
  if (mode === "off") return prompt;
  const scope =
    role === "insights"
      ? "Analyze only the supplied excerpts. Do not call tools, inspect other files, execute code, or change files. Preserve exact source quotations and the required output schema."
      : role === "guide"
        ? "Preserve the requested complete teaching explanation, concrete examples, and design tradeoffs. Do not shorten away information that helps the learner."
        : readonly
          ? "Keep this role read-only; do not edit files or execute project code. Give the required evidence and review findings."
          : "Work only within this task's owned file scopes and preserve the required validation evidence.";
  return `${prompt}\n\nBELL Ponytail efficiency guidance (${ponytailPolicyVersion}; mode=${mode}; upstream=${ponytailRevision}):\n${mode === "full" ? fullRules : liteRules}\nApplication boundaries: this guidance only governs implementation efficiency within the assigned role. It does not override file ownership, read-only restrictions, safety boundaries, user requirements, or the required response format. Do not narrate the ladder or add a preamble. Return the exact requested JSON when required, without extra commentary. ${scope}`;
}

export function emptyEfficiency(mode: PonytailMode): EfficiencyMetrics {
  return {
    policyVersion: ponytailPolicyVersion,
    mode,
    calls: 0,
    completedCalls: 0,
    failedCalls: 0,
    measuredCalls: 0,
    durationMs: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };
}

const tokenCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Codex reports cached input inside input; Claude Code reports uncached, cache-write and cache-read input separately. */
function reportedUsage(event: unknown) {
  if (!event || typeof event !== "object") return;
  const { type, usage } = event as { type?: unknown; usage?: unknown };
  if (!usage || typeof usage !== "object") return;
  const value = usage as Record<string, unknown>;
  if (type === "turn.completed") {
    const counts = [
      value.input_tokens,
      value.cached_input_tokens,
      value.output_tokens,
    ];
    if (!counts.every(tokenCount)) return;
    const [input, cached, output] = counts;
    return { input, cached, output };
  }
  if (type === "result") {
    const counts = [
      value.input_tokens,
      value.cache_creation_input_tokens,
      value.cache_read_input_tokens,
      value.output_tokens,
    ];
    if (!counts.every(tokenCount)) return;
    const [uncached, cacheWrite, cacheRead, output] = counts;
    const input = uncached + cacheWrite + cacheRead;
    if (!Number.isSafeInteger(input)) return;
    return { input, cached: cacheRead, output };
  }
}

/** One exec invocation is one call; repeated terminal events replace, not add, usage. */
export function trackEfficiency(mode: PonytailMode) {
  const started = performance.now();
  const metrics = { ...emptyEfficiency(mode), calls: 1 };
  return {
    observe(event: unknown) {
      const usage = reportedUsage(event);
      if (!usage || usage.cached > usage.input) return;
      metrics.measuredCalls = 1;
      metrics.inputTokens = usage.input;
      metrics.cachedInputTokens = usage.cached;
      metrics.outputTokens = usage.output;
    },
    finish(completed: boolean): EfficiencyMetrics {
      metrics.completedCalls = completed ? 1 : 0;
      metrics.failedCalls = completed ? 0 : 1;
      metrics.durationMs = Math.max(0, Math.round(performance.now() - started));
      return metrics;
    },
  };
}

/** Adds one call to the run total; with a role, the same counts also accumulate under byRole[role]. */
export function addEfficiency(
  previous: EfficiencyMetrics | undefined,
  call: EfficiencyMetrics,
  role?: string,
): EfficiencyMetrics {
  const total = { ...call };
  if (previous) {
    for (const key of [
      "calls",
      "completedCalls",
      "failedCalls",
      "measuredCalls",
      "durationMs",
      "inputTokens",
      "cachedInputTokens",
      "outputTokens",
    ] as const)
      total[key] += previous[key];
    // Older records have no byRole; keep whatever was recorded so far.
    if (previous.byRole) total.byRole = { ...previous.byRole };
  }
  if (role) {
    const byRole = { ...total.byRole };
    const entry = { ...byRole[role] };
    for (const key of roleKeys) entry[key] = (entry[key] ?? 0) + call[key];
    byRole[role] = entry as RoleEfficiency;
    total.byRole = byRole;
  }
  return total;
}
