import { codexEnabled } from "../shared/codex-switch.js";
export { setCodexEnabledForTests } from "../shared/codex-switch.js";
import type { ModelExecution } from "../shared/models.js";
import { AppError } from "./types.js";

/** 422 when this build must not start Codex. Claude Code is unchanged. */
export function assertCodexProviderAllowed(provider: string | undefined): void {
  if (!codexEnabled && provider !== "claude")
    throw new AppError((m) => m.setup.doctor.codexDisabled, 422);
}

/** A stored run whose provider is omitted was going to start Codex. */
export function assertRunAgentAllowed(run: {
  modelExecution?: Pick<ModelExecution, "provider">;
  team?: { config?: { provider?: string } };
}): void {
  if (codexEnabled) return;
  assertCodexProviderAllowed(run.modelExecution?.provider ?? "codex");
  if (run.team)
    assertCodexProviderAllowed(run.team.config?.provider ?? "codex");
}

/** True when `executable` is the Codex CLI, whatever directory it is in. */
export function isCodexExecutable(executable: string): boolean {
  const base = executable.split(/[/\\]/).pop() ?? executable;
  return base === "codex" || base === "codex.exe";
}

export function assertCodexExecutableAllowed(executable: string): void {
  if (!codexEnabled && isCodexExecutable(executable))
    throw new AppError((m) => m.setup.doctor.codexDisabled, 422);
}
