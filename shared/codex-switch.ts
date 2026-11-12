import type { AgentProvider } from "./models.js";

/**
 * Release switch for the Codex provider.
 *
 * This constant is the only control. There is no Settings toggle, CLI flag,
 * environment variable, or config-file key. `false` means Codex cannot be
 * selected. The sentence doctor and the provider picker show is
 * `setup.doctor.codexDisabled` (English and Traditional Chinese).
 */
export let codexEnabled = true;

/** Tests flip the switch and must restore the previous value. */
export function setCodexEnabledForTests(value: boolean): void {
  codexEnabled = value;
}

/** True for Codex, which an omitted or unknown provider also means. */
export function startsCodex(provider: unknown): boolean {
  return provider !== "claude" && provider !== "antigravity";
}

/**
 * The provider a saved or omitted choice actually runs.
 * With the switch off, Codex falls back to Claude Code.
 * With the switch on, an omitted provider stays Codex, as before.
 */
export function activeProvider(provider?: AgentProvider): AgentProvider {
  if (!codexEnabled && startsCodex(provider)) return "claude";
  return provider ?? "codex";
}

/** True when a request is trying to select Codex while the switch is off. */
export function codexSelectionBlocked(provider: unknown): boolean {
  return !codexEnabled && provider === "codex";
}

/**
 * Settings as the UI and new runs should see them. The file on disk is left
 * unchanged, so turning the switch back on keeps a saved Codex choice.
 * A Codex model id is cleared because Claude Code would not accept it.
 */
export function presentedModelSettings<
  T extends { provider?: AgentProvider; model?: string; reasoningEffort?: string },
>(settings: T): T & { provider?: AgentProvider } {
  if (codexEnabled || !startsCodex(settings.provider)) return settings;
  return { ...settings, provider: "claude", model: "", reasoningEffort: "" };
}
