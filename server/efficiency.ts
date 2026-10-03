import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  defaultPonytailMode,
  ponytailPolicyVersion,
  ponytailModes,
  ponytailRevision,
  type EfficiencyMetrics,
  type PonytailMode,
} from "../shared/efficiency.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
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

/** One exec invocation is one call; repeated terminal events replace, not add, usage. */
export function trackEfficiency(mode: PonytailMode) {
  const started = performance.now();
  const metrics = { ...emptyEfficiency(mode), calls: 1 };
  return {
    observe(event: unknown) {
      if (!event || typeof event !== "object") return;
      const { type, usage } = event as { type?: unknown; usage?: unknown };
      if (type !== "turn.completed" || !usage || typeof usage !== "object")
        return;
      const value = usage as Record<string, unknown>;
      const input = value.input_tokens;
      const cached = value.cached_input_tokens;
      const output = value.output_tokens;
      if (
        ![input, cached, output].every(
          (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0,
        )
      )
        return;
      if ((cached as number) > (input as number)) return;
      metrics.measuredCalls = 1;
      metrics.inputTokens = input as number;
      metrics.cachedInputTokens = cached as number;
      metrics.outputTokens = output as number;
    },
    finish(completed: boolean): EfficiencyMetrics {
      metrics.completedCalls = completed ? 1 : 0;
      metrics.failedCalls = completed ? 0 : 1;
      metrics.durationMs = Math.max(0, Math.round(performance.now() - started));
      return metrics;
    },
  };
}

export function addEfficiency(
  previous: EfficiencyMetrics | undefined,
  call: EfficiencyMetrics,
): EfficiencyMetrics {
  const total = { ...call };
  if (!previous) return total;
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
  return total;
}
